// ─── A plan's ledger, read once for every route that needs it ────────────
// Who has put in what, who owes what, and what they have since said they
// paid each other. The ledger screen reads it (GET /api/plans/[id]/ledger)
// and so does "Mark as paid" (/api/plans/[id]/settlements), which has to
// know what is still owed before it records a payment against it — a stale
// screen tapped twice by both sides would otherwise count one payment twice
// and leave the payee owing the payer.
//
// Every id here is a `users.id` UUID.
import type { SupabaseClient } from '@supabase/supabase-js';
import { NOT_CHARGED, chargedRows } from './booking/charged.ts';
import { applySettlements, apportion, evenSplit, planShares, settleLines, type Settlement, type SettleLine } from './money.ts';
import { planSkips } from './participation.ts';
import { netPaidCents } from './refunds.ts';

/** The table is not there yet: sql/settle-up-2026-09-25.sql has not run. */
export function settlementsMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === 'PGRST205' || e.code === '42P01' || e.code === 'PGRST204' || e.code === '42703'
    || (/settlements/i.test(String(e.message ?? '')) && /schema cache|does not exist/i.test(String(e.message ?? '')));
}

export const SETTLE_UP_SQL = 'sql/settle-up-2026-09-25.sql';

export interface Ledger {
  members: string[];
  /** A group of one has nobody to settle up with, and gets nothing to settle. */
  solo: boolean;
  contributions: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  /** Before any settlement: what the expenses and the pot say. */
  baseBalances: Record<string, number>;
  /** After every settlement marked paid. Positive is owed, negative owes. */
  netBalances: Record<string, number>;
  settlements: Settlement[];
  /** False until the settlements table exists; nothing can be marked paid before then. */
  settlementsAvailable: boolean;
  lines: SettleLine[];
}

type Plan = { id: string; group_id: string; budget_cents?: unknown; [k: string]: unknown };

export async function loadLedger(db: SupabaseClient, plan: Plan): Promise<Ledger> {
  const planId = String(plan.id);
  const [{ data: expenses }, { data: contributions }, { data: bookings }, skips, settled, { data: memberRows }] = await Promise.all([
    db.from('expenses').select('*').eq('plan_id', planId),
    db.from('contributions').select('*').eq('plan_id', planId).eq('status', 'succeeded'),
    db.from('bookings').select('id,price_cents,status,mode,provider').eq('plan_id', planId)
      .not('status', 'in', NOT_CHARGED),
    planSkips(db, planId),
    db.from('settlements').select('id, from_user_id, to_user_id, amount_cents, status, method, created_at')
      .eq('plan_id', planId).neq('status', 'cancelled'),
    db.from('group_members').select('user_id').eq('group_id', String(plan.group_id)),
  ]);

  const members = (memberRows || []).map(m => String(m.user_id));

  // Net balance per person, in cents: positive = is owed, negative = owes.
  const net: Record<string, number> = Object.fromEntries(members.map(id => [id, 0]));
  const add = (id: string, cents: number) => { net[id] = (net[id] || 0) + cents; };

  for (const e of expenses || []) {
    const parties: string[] = e.split_between || [];
    if (parties.length === 0) continue;
    add(e.paid_by, e.amount_cents);
    evenSplit(e.amount_cents, parties.length).forEach((share, i) => add(parties[i], -share));
  }

  // Contributions were fetched but never counted, so money already collected
  // for the trip did not reduce anyone's balance.
  //
  // Net of refunds: a share Stripe has handed back is not money in the pot,
  // and counting it would show the payer as owed money they already have.
  // netPaidCents reads a missing refunded_cents column as nothing refunded.
  const target = (contributions || []).reduce((s, c) => s + netPaidCents(c), 0);
  if (target > 0 && members.length > 0) {
    // Collected money is owed in proportion to each person's share, so
    // somebody who sat out the dinner is not down for a slice of it. With
    // nobody sitting anything out this is the even split it always was.
    const owed = planShares(chargedRows(bookings), Number(plan.budget_cents) || 0, members, skips);
    apportion(target, members.map(id => owed[id] || 0)).forEach((share, i) => add(members[i], -share));
    for (const c of contributions || []) add(c.user_id, netPaidCents(c));
  }

  let settlementsAvailable = true;
  let settlements: Settlement[] = [];
  if (settled.error) {
    if (settlementsMissing(settled.error)) settlementsAvailable = false;
    else {
      // Reading "nobody has paid anybody" when the read failed would put
      // every settled line back on the screen as owed. Refuse instead.
      console.error('[ledger] could not read settlements', { planId, code: settled.error.code });
      throw new Error('Could not read who has paid whom');
    }
  } else {
    settlements = (settled.data || []) as Settlement[];
  }

  const lines = settleLines(net, settlements);
  const netBalances = applySettlements(net, settlements);

  return {
    members,
    solo: members.length < 2,
    contributions: contributions || [],
    expenses: expenses || [],
    baseBalances: net,
    netBalances,
    settlements,
    settlementsAvailable,
    lines,
  };
}

/** What a settlement is for, in the note of the payer's app: "Cabo trip". */
export function settleNote(plan: { [k: string]: unknown }): string {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const city = text(plan.destination_city);
  const title = text(plan.title);
  // The same test the called-off notice uses for a night out. A night out's
  // own title says it best ("Dinner at Lupe"); a trip is where it went.
  const night = plan.type === 'restaurant';
  if (night && title) return title;
  if (city) return `${city} ${night ? 'night out' : 'trip'}`;
  return title || 'Reach';
}
