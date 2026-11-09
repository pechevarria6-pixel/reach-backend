// ─── What goes through the rail, and what does not (directives P3, P4) ──
// Only what Reach itself buys is collected: a mode='native' booking at a
// provider Reach pays (reachBuys in lib/booking/charged.ts). Everything
// else — a ticket on Ticketmaster, a table on Resy, an Airbnb, a flight
// handed to the airline — is paid by the member on the seller's own site
// with their own card, and comes back into the trip as an expense for
// settle-up when they say "Booked it ✓" (app/api/bookings/[id]/confirmation).
//
// So a plan made only of things people book themselves has nothing to
// collect: a $0 target, no share to pay, and no payment step (P4: no pooled
// money). Saying "we're still pricing this" over such a plan would be a
// claim about the world that is not true — every price is in, and none of
// it is Reach's to take.
import { chargedRows, reachBuys } from '../booking/charged.ts';

type Row = { price_cents?: unknown; mode?: unknown; provider?: unknown };

export interface FundingTarget<T extends Row> {
  /** The rows the group pays Reach for — the only ones in the target. */
  charged: T[];
  targetCents: number;
  /** What people pay on the sellers' own sites, priced where a price is known. */
  selfPaidCents: number;
  /** Live rows exist and not one of them is Reach's to buy: nothing to collect. */
  nothingThroughReach: boolean;
  /** Whether a payment step exists at all. */
  fundingNeeded: boolean;
}

const cents = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));

/** `rows` are a plan's live bookings — the caller has already left out NOT_CHARGED. */
export function fundingTarget<T extends Row>(rows: T[] | null | undefined): FundingTarget<T> {
  const live = rows ?? [];
  const charged = chargedRows(live);
  const targetCents = charged.reduce((s, b) => s + cents(b.price_cents), 0);
  const selfPaidCents = live.filter(r => !reachBuys(r)).reduce((s, b) => s + cents(b.price_cents), 0);
  return {
    charged, targetCents, selfPaidCents,
    nothingThroughReach: live.length > 0 && charged.length === 0,
    fundingNeeded: targetCents > 0,
  };
}

/**
 * The budget figure a share may be guessed from before anything is priced.
 * Only while the plan has nothing on it at all and nothing has been paid: a
 * plan whose every line is paid on the seller's own site owes Reach nothing,
 * and a share guessed from its budget read as money to chip in.
 */
export function guessBudgetCents(
  target: Pick<FundingTarget<Row>, 'charged' | 'nothingThroughReach'>,
  collectedCents: number,
  budgetCents: number,
): number {
  if (collectedCents > 0 || target.nothingThroughReach) return 0;
  return Math.max(0, Math.round(budgetCents || 0));
}

export const NOTHING_THROUGH_REACH =
  'Nothing on this trip is paid through Reach — each one is booked and paid on its own site. Nothing has been charged.';
