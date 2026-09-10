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
