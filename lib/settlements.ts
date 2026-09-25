// ─── Recording that one member paid another ──────────────────────────────
// Reach never moves money between members. This records that one of them
// says they paid another — in their own app or in cash — so the ledger can
// count it (lib/ledger.ts → settleLines). Nothing here talks to Venmo, Cash
// App or a bank. The route, /api/plans/[planId]/settlements, is a thin
// wrapper; the logic lives here so it can be run against a database that
// behaves like the real one, unique indexes and all
// (tests/unit/settlements.test.ts).
//
// A double tap is two requests in the same instant. Three things stop it
// counting twice:
//   1. the client's key — one per line and action, the same on every tap —
//      is unique (settlements_one_per_key);
//   2. there is only one pending settlement per pair
//      (settlements_one_pending_per_pair), and every write starts as one, so
//      a "paid" from each side at once lands on one row and one conditional
//      update wins;
//   3. nothing is recorded for more than the ledger still says is owed, so a
//      stale screen tapped after the other side marked it is refused.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadLedger, settlementsMissing, SETTLE_UP_SQL } from './ledger.ts';
import { checkSettlement, settlementKey, settlementMoveRefused } from './money.ts';
import { track } from './track.ts';

export const METHODS = ['venmo', 'cashapp', 'zelle', 'other'] as const;
export const COLUMNS = 'id, plan_id, from_user_id, to_user_id, amount_cents, currency, method, status, paid_at, closed_by, created_by, created_at, updated_at';

export type SettlementRow = {
  id: string; plan_id: string; from_user_id: string; to_user_id: string;
  amount_cents: number; method: string; status: string; [k: string]: unknown;
};

/** What the route sends back: a status and a JSON body. */
export type Outcome = { status: number; body: Record<string, unknown> };

const ok = (settlement: unknown, status = 200, replay = false): Outcome =>
  ({ status, body: replay ? { settlement, replay: true } : { settlement } });
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): Outcome =>
  ({ status, body: { error, ...extra } });

export function notYet(): Outcome {
  console.warn('[settlements] the settlements table is not there yet', SETTLE_UP_SQL);
  return refuse(503, `Settling up is not switched on yet: run ${SETTLE_UP_SQL} in Supabase.`);
}

type Plan = { id: string; group_id: string; [k: string]: unknown };

export interface RecordInput {
  /** The caller paid them. */
  toUserId?: unknown;
  /** They paid the caller ("Mark received"). */
  fromUserId?: unknown;
  amountCents?: unknown;
  method?: unknown;
  /** 'pending' after tapping a pay button, 'paid' for "Mark as paid" / "Mark received". */
  status?: unknown;
  idempotencyKey?: unknown;
}

export async function recordSettlement(db: SupabaseClient, plan: Plan, me: string, input: RecordInput): Promise<Outcome> {
  const planId = String(plan.id);
  const toUserId = typeof input.toUserId === 'string' ? input.toUserId : null;
  const fromUserId = typeof input.fromUserId === 'string' ? input.fromUserId : null;
  if (!!toUserId === !!fromUserId) {
    return refuse(400, 'Say who was paid (toUserId) or who paid you (fromUserId), not both');
  }
  const from = fromUserId ?? me;
  const to = toUserId ?? me;
  if (from === to) return refuse(400, 'Nobody settles up with themselves');

  const status = input.status === 'pending' ? 'pending' : input.status === 'paid' ? 'paid' : null;
  if (!status) return refuse(400, "status is 'pending' or 'paid'");
  if (status === 'pending' && from !== me) return refuse(400, 'Only the person paying can say it is on its way');
  const method = (METHODS as readonly string[]).includes(String(input.method)) ? String(input.method) : 'other';
  const amountCents = Number(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return refuse(400, 'amountCents is a positive whole number of cents');
  // The action is part of the key, so the "Sent on Venmo?" a pay button
  // made is never mistaken for the "Mark as paid" that follows it.
  const key = settlementKey(planId, me, typeof input.idempotencyKey === 'string' ? `${status}:${input.idempotencyKey}` : null);
  if (!key) return refuse(400, 'idempotencyKey is required: one per line, the same on every tap');

  // A repeat of a tap that already landed gets the row it made, whatever
  // the ledger says now — the first one is why the line is gone.
  {
    const { data: again, error } = await db.from('settlements').select(COLUMNS).eq('idempotency_key', key).maybeSingle();
    if (error) {
      if (settlementsMissing(error)) return notYet();
      console.error('[settlements] key read', error.code);
      return refuse(500, 'Could not record that');
    }
    if (again) {
      const row = again as SettlementRow;
      if (status === 'paid' && row.status === 'pending') return closeAsPaid(db, row, me, plan, amountCents);
      return ok(row, 200, true);
    }
  }

  let ledger;
  try {
    ledger = await loadLedger(db, plan);
  } catch (e) {
    console.error('[settlements] ledger', e instanceof Error ? e.message : 'unknown');
    return refuse(500, 'Could not read the ledger');
  }
  if (!ledger.settlementsAvailable) return notYet();
  if (ledger.solo) return refuse(409, 'A trip of one has nobody to settle up with.');
  if (!ledger.members.includes(from) || !ledger.members.includes(to)) {
    return refuse(400, 'Both people have to be on this trip');
  }

  const refused = checkSettlement(ledger.lines, from, to, amountCents);
  if (refused) {
    // Most often the other side marked it first. The screen should read
    // the ledger again rather than guess.
    return refuse(409, refused.reason === 'nothing_owed'
      ? 'Nothing is owed there any more. It may already be marked as paid.'
      : 'That is more than is still owed there.', { reason: refused.reason, owedCents: refused.owedCents });
  }

  let row: SettlementRow | null = null;
  {
    const { data, error } = await db.from('settlements').insert({
      plan_id: planId,
      from_user_id: from,
      to_user_id: to,
      amount_cents: amountCents,
      method,
      status: 'pending',
      idempotency_key: key,
      created_by: me,
    }).select(COLUMNS).single();
    if (error && error.code !== '23505') {
      if (settlementsMissing(error)) return notYet();
      console.error('[settlements] insert', error.code, error.message);
      return refuse(500, 'Could not record that');
    }
    if (data) row = data as SettlementRow;
  }
  let replay = false;
  if (!row) {
    // 23505: this key landed a moment ago (a double tap), or the pair
    // already has a pending one. Either way, that row is the answer.
    replay = true;
    const { data: byKey } = await db.from('settlements').select(COLUMNS).eq('idempotency_key', key).maybeSingle();
    let open = byKey;
    if (!open) {
      ({ data: open } = await db.from('settlements').select(COLUMNS)
        .eq('plan_id', planId).eq('from_user_id', from).eq('to_user_id', to).eq('status', 'pending')
        .maybeSingle());
    }
    if (!open) {
      console.error('[settlements] a conflict with no row to show', { planId });
      return refuse(500, 'Could not record that');
    }
    row = open as SettlementRow;
  }

  if (status === 'pending') return ok(row, replay ? 200 : 201, replay);
  // "Mark as paid" on a line the ledger says is $20 is a claim of $20, even
  // when an earlier "Sent on Venmo?" for the pair said something else.
  return closeAsPaid(db, row, me, plan, amountCents);
}

export async function moveSettlement(
  db: SupabaseClient, plan: Plan, me: string, input: { id?: unknown; status?: unknown },
): Promise<Outcome> {
  const next = input.status === 'paid' ? 'paid' : input.status === 'cancelled' ? 'cancelled' : null;
  if (typeof input.id !== 'string' || !next) return refuse(400, "id and a status of 'paid' or 'cancelled' are required");

  const { data: found, error } = await db.from('settlements').select(COLUMNS)
    .eq('id', input.id).eq('plan_id', String(plan.id)).maybeSingle();
  if (error) {
    if (settlementsMissing(error)) return notYet();
    console.error('[settlements] read', error.code);
    return refuse(500, 'Could not read that');
  }
  if (!found) return refuse(404, 'Not found');
  const row = found as SettlementRow;

  const why = settlementMoveRefused(row, me, next);
  // Somebody else's settlement is not theirs to know about.
  if (why === 'not_yours') return refuse(404, 'Not found');
  if (why === 'only_payee_can_undo') return refuse(403, 'Only the person it was paid to can say it never arrived');
  if (why) return refuse(409, 'That one is already closed', { settlement: row });
  if (row.status === next) return ok(row, 200, true);

  if (next === 'paid') return closeAsPaid(db, row, me, plan);

  const { data: moved, error: moveErr } = await db.from('settlements')
    .update({ status: 'cancelled', paid_at: null, closed_by: me, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', row.status)
    .select(COLUMNS).maybeSingle();
  if (moveErr) {
    console.error('[settlements] cancel', moveErr.code, moveErr.message);
    return refuse(500, 'Could not withdraw that');
  }
  if (!moved) return reread(db, row.id);
  return ok(moved);
}

/**
 * pending → paid, only while it is still pending. The loser of a race
 * between both sides finds the row already paid and gets it back as it is.
 */
async function closeAsPaid(db: SupabaseClient, row: SettlementRow, me: string, plan: Plan, amountCents?: number): Promise<Outcome> {
  if (row.status === 'paid') return ok(row, 200, true);
  const now = new Date().toISOString();
  const { data: moved, error } = await db.from('settlements')
    .update({
      status: 'paid', paid_at: now, closed_by: me, updated_at: now,
      ...(amountCents ? { amount_cents: amountCents } : {}),
    })
    .eq('id', row.id).eq('status', 'pending')
    .select(COLUMNS).maybeSingle();
  if (error) {
    console.error('[settlements] mark paid', error.code, error.message);
    return refuse(500, 'Could not mark that as paid');
  }
  if (!moved) return reread(db, row.id);

  // Only once the row says paid, and only from here: the browser sends
  // settle_up_link_opened, never this.
  const paid = moved as SettlementRow;
  void track(db, 'settle_up_marked_paid', {
    userId: me, groupId: String(plan.group_id), planId: String(plan.id),
    props: { method: paid.method, amount_cents: paid.amount_cents, side: me === paid.from_user_id ? 'payer' : 'payee' },
  });
  return ok(paid);
}

async function reread(db: SupabaseClient, id: string): Promise<Outcome> {
  const { data } = await db.from('settlements').select(COLUMNS).eq('id', id).maybeSingle();
  return ok(data, 200, true);
}

/** The settlements one member is on, either side, newest first. */
export async function mySettlements(db: SupabaseClient, planId: string, me: string): Promise<Outcome> {
  const { data, error } = await db.from('settlements').select(COLUMNS)
    .eq('plan_id', planId)
    .or(`from_user_id.eq.${me},to_user_id.eq.${me}`)
    .order('created_at', { ascending: false });
  if (error) {
    if (settlementsMissing(error)) return { status: 200, body: { settlements: [], available: false } };
    console.error('[settlements] list', error.code, error.message);
    return refuse(500, 'Could not read who has paid whom');
  }
  return { status: 200, body: { settlements: data || [], available: true } };
}
