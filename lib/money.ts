// ─── Money math ──────────────────────────────────────────────────────────
// One definition of how a bill is divided. This lived inline in four routes
// (funding, payments, ledger, savings), each rounding slightly differently,
// so the same trip could report different shares depending on which screen
// asked. Cents are integers everywhere; never divide money with `/` alone.

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
