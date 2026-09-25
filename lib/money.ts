// ─── Money math ──────────────────────────────────────────────────────────
// One definition of how a bill is divided. This lived inline in four routes
// (funding, payments, ledger, savings), each rounding slightly differently,
// so the same trip could report different shares depending on which screen
// asked. Cents are integers everywhere; never divide money with `/` alone.
import { settleOptions, type SettleOptions } from './settle-links.ts';

/**
 * Split `totalCents` into `heads` whole-cent shares that sum to exactly
 * `totalCents`. Leftover cents go to the earliest positions, so the result is
 * deterministic for a stable member ordering.
 *
 * Rounding each share independently (the previous behaviour) loses or invents
 * cents, which leaves a ledger that never settles to zero.
 */
export function evenSplit(totalCents: number, heads: number): number[] {
  const total = Math.max(0, Math.round(totalCents || 0));
  const n = Math.max(1, Math.floor(heads));
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * One member's share of `totalCents`, given the group's member ids.
 * Returns 0 for someone outside the group.
 */
export function shareFor(totalCents: number, memberIds: string[], userId: string): number {
  const idx = memberIds.indexOf(userId);
  if (idx < 0) return 0;
  return evenSplit(totalCents, memberIds.length)[idx];
}

export type Transfer = { from: string; to: string; amountCents: number };

/**
 * Greedy minimal-transfer settle-up: the biggest debtor pays the biggest
 * creditor until everyone is square. Balances must already sum to zero.
 */
export function settleUp(net: Record<string, number>): Transfer[] {
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, amt: -v }))
    .sort((a, b) => b.amt - a.amt);
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, amt: v }))
    .sort((a, b) => b.amt - a.amt);

  const transfers: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0 && debtors[i].id !== creditors[j].id) {
      transfers.push({ from: debtors[i].id, to: creditors[j].id, amountCents: pay });
    }
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}

// ── Sitting things out ──────────────────────────────────────────────────
// Flights and somewhere to sleep are the trip. A dinner, a show or a day out
// is something one person can sit out, and when they do, its cost is shared
// among the people going.

/** The kinds of booking somebody can sit out. */
export const SKIPPABLE = ['activity', 'event', 'restaurant'] as const;

export function canSkip(vertical: unknown): boolean {
  return typeof vertical === 'string' && (SKIPPABLE as readonly string[]).includes(vertical);
}

export type ShareItem = { ref: string; priceCents: number };
export type Skip = { ref: string; userId: string };

/**
 * Each member's share when people can sit out individual items, in whole
 * cents that always add up to exactly what the items cost.
 *
 * Items with the same people in them are pooled before splitting, so a trip
 * nobody has sat anything out of divides exactly as it always did — one total,
 * one even split — and a member who paid under that rule is not a cent adrift.
 * An item everybody has skipped is still split across everyone: a booked
 * thing is paid for whether or not anyone goes. The API refuses the last skip,
 * so that is a guard, not a rule anybody meets.
 */
export function sharesWithSkips(items: ShareItem[], memberIds: string[], skips: Skip[] = []): Record<string, number> {
  const shares: Record<string, number> = Object.fromEntries(memberIds.map(id => [id, 0]));
  if (!memberIds.length) return shares;

  const out = new Map<string, Set<string>>();
  for (const s of skips) {
    if (!out.has(s.ref)) out.set(s.ref, new Set());
    out.get(s.ref)!.add(s.userId);
  }

  const pools = new Map<string, { payers: string[]; cents: number }>();
  for (const item of items) {
    const skipped = out.get(item.ref);
    const going = memberIds.filter(id => !skipped?.has(id));
    const payers = going.length ? going : memberIds;
    const key = payers.join('|');
    const pool = pools.get(key) ?? { payers, cents: 0 };
    pool.cents += Math.max(0, Math.round(item.priceCents || 0));
    pools.set(key, pool);
  }
  for (const { payers, cents } of pools.values()) {
    evenSplit(cents, payers.length).forEach((c, i) => { shares[payers[i]] += c; });
  }
  return shares;
}

export type PlanBooking = { id: string | number; price_cents?: number | null };

/**
 * What every member owes a plan: its priced bookings, less anything each of
 * them is sitting out; before anything is priced, an even share of the budget.
 *
 * Funding charges this, the participation route shows it, the reminder email
 * quotes it and the ledger apportions by it, so no two screens can disagree
 * about what somebody owes. The shares always add up to the bookings' total,
 * which is what the approval gate compares collected money against.
 */
export function planShares(
  bookings: PlanBooking[], budgetCents: number, memberIds: string[], skips: Skip[] = [],
): Record<string, number> {
  const priced = bookings.filter(b => (b.price_cents || 0) > 0);
  if (priced.length) {
    return sharesWithSkips(priced.map(b => ({ ref: String(b.id), priceCents: b.price_cents || 0 })), memberIds, skips);
  }
  const even = evenSplit(budgetCents, memberIds.length);
  return Object.fromEntries(memberIds.map((id, i) => [id, even[i] ?? 0]));
}

/**
 * Divide `totalCents` in proportion to `weights`, in whole cents that add up to
 * exactly `totalCents`. Leftover cents go to the largest remainders, earliest
 * first on a tie. With no weight to go on it is an even split.
 */
export function apportion(totalCents: number, weights: number[]): number[] {
  const total = Math.max(0, Math.round(totalCents || 0));
  if (!weights.length) return [];
  const w = weights.map(x => Math.max(0, Number(x) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return evenSplit(total, w.length);

  const exact = w.map(x => (total * x) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, rest: x - out[i] }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

// ── Settling up ─────────────────────────────────────────────────────────
// Reach never moves money between members. When one of them says they paid
// another — on Venmo, Cash App, Zelle or in cash — that is stored as what it
// is, a payment from one person to another for an amount
// (sql/settle-up-2026-09-25.sql), and it counts in the balances like any
// other money that changed hands. The settle-up lines are recomputed from the
// balances on every read, so a line that has been paid is gone because the
// balances say square, not because a flag hid it.

export type SettlementStatus = 'pending' | 'paid' | 'cancelled';

export type Settlement = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  status: SettlementStatus | string;
  method?: string | null;
  created_at?: string | null;
};

/**
 * The balances once every settlement somebody has marked as paid is counted:
 * the payer is owed back what they paid, the payee has it. A pending one
 * ("Sent on Venmo?") moves nothing — nobody has said the money arrived — and
 * a cancelled one counts for nothing.
 */
export function applySettlements(net: Record<string, number>, settlements: Settlement[]): Record<string, number> {
  const out: Record<string, number> = { ...net };
  for (const s of settlements) {
    if (s.status !== 'paid') continue;
    const cents = Math.round(Number(s.amount_cents) || 0);
    if (cents <= 0 || s.from_user_id === s.to_user_id) continue;
    out[s.from_user_id] = (out[s.from_user_id] || 0) + cents;
    out[s.to_user_id] = (out[s.to_user_id] || 0) - cents;
  }
  return out;
}

export type PendingSettlement = { id: string; amountCents: number; method: string | null; createdAt: string | null };

export type SettleLine = Transfer & {
  /** A payment one side said they sent and nobody has confirmed yet. */
  pending: PendingSettlement | null;
};

/**
 * Who still pays whom, after the paid settlements, with the pending one for
 * each pair attached. A pending settlement whose pair no longer owes anything
 * (the ledger changed under it) is still returned, as a line of 0 owed, so
 * the payee can say whether it arrived — somebody said they sent that money,
 * and dropping the claim would be worse than showing it.
 */
export function settleLines(net: Record<string, number>, settlements: Settlement[]): SettleLine[] {
  const pendingByPair = new Map<string, Settlement>();
  for (const s of settlements) {
    if (s.status !== 'pending') continue;
    const key = `${s.from_user_id}>${s.to_user_id}`;
    const seen = pendingByPair.get(key);
    // The index allows one per pair; if two ever exist, show the newest.
    if (!seen || String(s.created_at ?? '') > String(seen.created_at ?? '')) pendingByPair.set(key, s);
  }
  const asPending = (s: Settlement): PendingSettlement => ({
    id: s.id, amountCents: Math.round(Number(s.amount_cents) || 0), method: s.method ?? null, createdAt: s.created_at ?? null,
  });

  const lines: SettleLine[] = settleUp(applySettlements(net, settlements)).map(t => {
    const key = `${t.from}>${t.to}`;
    const p = pendingByPair.get(key);
    pendingByPair.delete(key);
    return { ...t, pending: p ? asPending(p) : null };
  });
  for (const p of pendingByPair.values()) {
    lines.push({ from: p.from_user_id, to: p.to_user_id, amountCents: 0, pending: asPending(p) });
  }
  return lines;
}

/** What the balances say `from` still owes `to`, in cents. */
export function owedOn(lines: Transfer[], from: string, to: string): number {
  return lines.filter(l => l.from === from && l.to === to).reduce((s, l) => s + Math.max(0, l.amountCents), 0);
}

export type SettleRefusal = { reason: 'nothing_owed' | 'more_than_owed'; owedCents: number };

/**
 * Whether a payment from `from` to `to` for `amountCents` can be recorded
 * against what is still owed. Less than owed is a part payment, and fine.
 * More than owed is a screen that was out of date — the other side already
 * marked it, or an expense changed the lines — and recording it would leave
 * the payee owing the payer money nobody sent.
 */
export function checkSettlement(lines: Transfer[], from: string, to: string, amountCents: number): SettleRefusal | null {
  const owed = owedOn(lines, from, to);
  if (owed <= 0) return { reason: 'nothing_owed', owedCents: 0 };
  if (amountCents > owed) return { reason: 'more_than_owed', owedCents: owed };
  return null;
}

/**
 * Who may move a settlement where. Either side can say a pending one went
 * ("Mark as paid" / "Mark received") or withdraw it. A paid one can be
 * withdrawn only by the person it was paid to — they are the one who knows
 * whether it arrived. Returns why not, or null when the move is allowed.
 */
export function settlementMoveRefused(
  row: { from_user_id: string; to_user_id: string; status: string },
  callerId: string,
  next: 'paid' | 'cancelled',
): string | null {
  if (callerId !== row.from_user_id && callerId !== row.to_user_id) return 'not_yours';
  if (row.status === next) return null; // already there: a repeat, not a change
  if (row.status === 'pending') return null;
  if (row.status === 'paid' && next === 'cancelled') return callerId === row.to_user_id ? null : 'only_payee_can_undo';
  return 'closed';
}

/**
 * The stored idempotency key for one person's tap. The client mints one per
 * line when it draws it and sends the same one on every tap, so a double tap
 * is two requests with one key and the unique index keeps one row. Scoped to
 * the plan and the caller, so one person's key can never land on another's
 * payment. Null for anything that is not a plausible key.
 */
export function settlementKey(planId: string, callerId: string, clientKey: unknown): string | null {
  if (typeof clientKey !== 'string' || !/^[A-Za-z0-9_:.-]{8,100}$/.test(clientKey)) return null;
  return `settle:${planId}:${callerId}:${clientKey}`;
}

/**
 * The people whose handles one viewer may be given: only those the viewer
 * owes. Being in a group with somebody is not consent to be read, so a
 * member's Venmo, Cash App or Zelle contact goes only to someone who has to
 * pay them.
 */
export function payeesOf(viewerId: string, lines: Transfer[]): string[] {
  return [...new Set(lines.filter(l => l.from === viewerId && l.amountCents > 0).map(l => l.to))];
}

export type Handles = { venmo?: unknown; cashtag?: unknown; zelle?: unknown };

export type ViewerLine = {
  /** 'you_owe': the viewer pays `with`. 'owed_to_you': `with` pays the viewer. */
  direction: 'you_owe' | 'owed_to_you';
  /** The other person on the line, a users.id. */
  with: string;
  /** What the balances say is still owed. 0 on a line kept only for its pending claim. */
  amountCents: number;
  pending: PendingSettlement | null;
  /**
   * Ways to pay, built from the payee's own handles. Only on a line the
   * viewer pays and something is owed; null otherwise, whatever was passed.
   */
  pay: SettleOptions | null;
};

/**
 * One member's view of the settle-up: the lines they pay or are paid on,
 * nobody else's, and pay links only where they are the one paying.
 *
 * `handles` is whatever the route fetched. The rule is kept here, so a route
 * that fetched too much still cannot hand it out.
 */
export function viewerLines(
  viewerId: string, lines: SettleLine[], handles: Record<string, Handles>, note: string,
): ViewerLine[] {
  const payees = new Set(payeesOf(viewerId, lines));
  const out: ViewerLine[] = [];
  for (const l of lines) {
    if (l.from === viewerId) {
      const h = payees.has(l.to) ? handles[l.to] : undefined;
      out.push({
        direction: 'you_owe', with: l.to, amountCents: l.amountCents, pending: l.pending,
        pay: h && l.amountCents > 0
          ? settleOptions({ amountCents: l.amountCents, note, venmo: h.venmo, cashtag: h.cashtag, zelle: h.zelle })
          : null,
      });
    } else if (l.to === viewerId) {
      out.push({ direction: 'owed_to_you', with: l.from, amountCents: l.amountCents, pending: l.pending, pay: null });
    }
  }
  return out;
}
