// ─── What the checkout screen is allowed to show, and charge ────────────
// From a production screenshot on 18 September: three rows all titled
// "restaurant", each saying "We'll handle this one for you", a total of $0,
// and "Looks good" ready to be tapped.
//
// Reading the rows behind it, the three were not duplicates. They were three
// different reservations — a seafood dinner, a night in Canyonlands, a last
// seafood dinner — every one of them rendered as the word `restaurant`,
// because the screen did this:
//
//     (b.detail && (b.detail.title || b.detail.name)) || b.vertical
//
// `bookings.detail` is a string. `.title` and `.name` on a string are both
// undefined, so every row fell through to the enum. That matters more than
// it looks: dedupe on what the screen was displaying would have collapsed
// three real reservations into one and quietly dropped two of somebody's
// dinners.
//
// So the order here is deliberate — name the rows properly first, then
// collapse only what is genuinely the same row.

export type CheckoutRow = {
  id?: string;
  vertical: string;
  /** bookings.detail — a string, sometimes an object from older rows. */
  detail?: unknown;
  price_cents?: number | null;
  mode?: string | null;
  provider?: string | null;
  status?: string | null;
  itinerary_item_id?: string | null;
  scheduled_date?: string | null;
};


/**
 * Rows written before the concierge label was shortened.
 *
 * They hold the whole request in one string, which on the Moab trip reads:
 *
 *   Reservation request: Seafood dinner at Desert Bistro,  · 2026-09-17
 *   Day 3 · Evening · party of 2 · "Mesa Arch at sunrise means a crowd…"
 *
 * The name is the part before the first separator. Trimming it here rather
 * than rewriting the rows means nobody's existing trip has its booking
 * history edited to make a screen look tidier.
 */
export function tidyLegacy(detail: string): string {
  let text = detail.replace(/^Reservation request:\s*/i, '');
  const cut = text.indexOf(' · ');
  if (cut > 0) text = text.slice(0, cut);
  // A missing city left "Desert Bistro, " with nothing after the comma.
  return text.replace(/,\s*$/, '').trim() || detail;
}

/**
 * What this row is, in the words it was booked under.
 *
 * Never the vertical. "restaurant" is a category, and a person looking at a
 * checkout screen is entitled to know which restaurant.
 */
/**
 * What a row with no name of its own should be called.
 *
 * Never "Trip item (details coming)". Eleven rows in the table have no
 * detail — mostly flights that failed before a provider ever named one — and
 * that string promised details were on their way when nothing was coming.
 * It is a placeholder, and the rule is that a placeholder never reaches a
 * screen.
 *
 * An article makes these read as a description rather than a title, which is
 * what they are: the row says what kind of thing it was, the status chip
 * says it could not be booked, and the reason sits underneath. That is three
 * true things, which beats one invented one.
 */
const UNNAMED: Record<string, string> = {
  flight: 'A flight',
  hotel: 'Somewhere to stay',
  restaurant: 'A table',
  activity: 'An activity',
  event: 'A ticket',
  transport: 'Getting around',
};

/**
 * Whether this row carries a name of its own.
 *
 * `dedupe` used to ask "is the title the placeholder string?", which tied a
 * correctness rule to a piece of copy. Changing the copy would then have
 * merged two unnamed rows into one and dropped somebody's booking — the very
 * thing the test beside it was written to prevent. The question is about the
 * row, so it is asked of the row.
 */
export function hasOwnName(row: CheckoutRow): boolean {
  const d = row.detail;
  if (typeof d === 'string') return d.trim().length > 0;
  if (d && typeof d === 'object') {
    const o = d as { title?: unknown; name?: unknown };
    return [o.title, o.name].some(v => typeof v === 'string' && v.trim().length > 0);
  }
  return false;
}

export function itemTitle(row: CheckoutRow, fallback?: string | null): string {
  const d = row.detail;
  if (typeof d === 'string' && d.trim()) return tidyLegacy(d.trim());
  // Older rows stored an object. Both spellings appear in the table.
  if (d && typeof d === 'object') {
    const o = d as { title?: unknown; name?: unknown };
    for (const v of [o.title, o.name]) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  // The itinerary line this booking was made from, where the caller knows
  // it. A booking of "13 nights in Moab" is that, whatever the provider
  // managed to return.
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return UNNAMED[row.vertical] ?? 'Part of this trip';
}

/**
 * The same row twice, collapsed.
 *
 * Keyed on the itinerary line where there is one, because that is what a
 * booking is actually of, and two rows from one line are the duplicate we
 * care about. Only rows with no line fall back to name-matching, and a row
 * with no usable name is never merged with another — two unnamed rows are
 * two rows until somebody proves otherwise.
 */
/**
 * How much a row means, when two describe the same itinerary line.
 *
 * Keeping whichever came back first was wrong: a line that failed and was
 * then booked would have shown the failure and hidden the booking.
 */
const WEIGHT: Record<string, number> = {
  confirmed: 6, redirected: 5, pending: 4, awaiting_approval: 3, quoted: 2, failed: 1, cancelled: 0,
};
const weigh = (row: CheckoutRow) => WEIGHT[row.status ?? ''] ?? 2;

export function dedupe(rows: CheckoutRow[]): CheckoutRow[] {
  const seen = new Map<string, number>();
  const out: CheckoutRow[] = [];
  // A cancelled row is an attempt that a later one replaced. It is history,
  // not part of the trip, and listing it only raises a question the screen
  // cannot answer.
  for (const row of (rows ?? []).filter(r => r.status !== 'cancelled')) {
    const name = itemTitle(row);
    const key = row.itinerary_item_id
      ? `line:${row.itinerary_item_id}`
      : !hasOwnName(row)
        ? null                                   // never merged
        : `${row.vertical}|${name.toLowerCase()}|${row.scheduled_date ?? ''}`;
    if (key && seen.has(key)) {
      // Same line twice: keep whichever actually says more about the trip.
      const at = seen.get(key) as number;
      if (weigh(row) > weigh(out[at])) out[at] = row;
      continue;
    }
    if (key) seen.set(key, out.length);
    out.push(row);
  }
  return out;
}

function priced(row: CheckoutRow): boolean {
  return typeof row.price_cents === 'number' && row.price_cents > 0;
}

const isConcierge = (row: CheckoutRow) => row.provider === 'concierge' || row.mode === 'concierge';
const settled = (row: CheckoutRow) => row.status !== 'failed' && row.status !== 'cancelled';

/**
 * A row that costs money to the person tapping the button.
 *
 * Who books it is not the question — whether it has a price is. A table
 * somebody rings up about is a request with no price, settled at the venue.
 * A flight booked by a person because the automated channel will not carry
 * an X passport marker is a seat that costs $236 and the group owes it.
 * Excluding by provider put the second in the same bucket as the first, so a
 * trip whose only booking was that flight showed a total of nothing and
 * refused to take payment for a real fare.
 */
function charged(row: CheckoutRow): boolean {
  if (!settled(row)) return false;
  return priced(row) || !isConcierge(row);
}


export interface CheckoutState {
  rows: CheckoutRow[];
  /** Rows the provider refused. The pay button stays shut while any exist. */
  broken: CheckoutRow[];
  totalCents: number;
  canPay: boolean;
  /** Why the button is off, in words for the screen. Null when it is on. */
  blockedCopy: string | null;
  /** Set when something real is being arranged that has no price yet. */
  conciergeNote: string | null;
  /**
   * Nothing here is Reach's to charge for, and nothing ever will be.
   *
   * A concert where the ticket is bought from the seller, an evening of
   * walk-ins, a day of things you turn up to: the total is nought and no
   * quote is coming. That used to be indistinguishable from "we have not
   * priced it yet", so the screen said "we're still pricing this — check
   * back soon" for ever, over a button that could never switch on, on a
   * plan that was already as finished as it was ever going to be.
   *
   * A plan can be complete without Reach taking any money.
   */
  nothingToCharge: boolean;
}

/**
 * Everything the screen needs to decide what to show and whether to let
 * anybody pay.
 */
export function checkoutState(rows: CheckoutRow[], opts: { ignoreBroken?: boolean } = {}): CheckoutState {
  const deduped = dedupe(rows ?? []);
  const chargeable = deduped.filter(charged);

  const totalCents = chargeable.filter(priced)
    .reduce((s, r) => s + (r.price_cents as number), 0);

  // A row we intend to charge for but cannot price is the dangerous case:
  // it is going on the trip and its cost is not in the number on the screen.
  const unpricedCharged = chargeable.filter(r => !priced(r));

  // Real things being arranged that genuinely have no price yet — the table,
  // not the seat.
  const conciergeCount = deduped.filter(r => settled(r) && isConcierge(r) && !priced(r)).length;

  // A booking that failed is not a reason to let somebody pay.
  //
  // `charged()` drops failed rows, so they were invisible to this: a plan
  // with a flight that could not be booked still offered "Looks good" over a
  // total that quietly excluded it. The person confirms a trip they think is
  // whole, and finds out later that a piece of it never happened.
  //
  // Failed rows are listed on the screen either way — each says what went
  // wrong — so this only stops the button, which is the thing that cannot be
  // undone.
  const broken = deduped.filter(r => r.status === 'failed');

  // Blocked by a failure, and never trapped by one.
  //
  // Blocking outright would deadlock a real plan: Moab's flight cannot be
  // booked at any price because the trip started five days ago, so a rule of
  // "no failures, no payment" would mean that trip could never pay for its
  // hotel either. The screen offers "Book the rest without these" and that
  // sets `ignoreBroken` — a decision somebody makes on purpose, once, having
  // read what failed and why.
  const canPay = totalCents > 0 && unpricedCharged.length === 0
    && (broken.length === 0 || opts.ignoreBroken === true);

  // Nothing chargeable at all AND nothing being arranged, as opposed to
  // something chargeable we have not priced yet. Waiting is the right
  // answer to the second, and to a table somebody is still arranging, and
  // never to the first.
  const nothingToCharge = chargeable.length === 0 && conciergeCount === 0;

  return {
    rows: deduped,
    broken,
    totalCents,
    canPay,
    nothingToCharge,
    blockedCopy: canPay ? null
      : broken.length && !opts.ignoreBroken
        // Named, because "something went wrong" sends somebody looking. The
        // row itself carries the provider's reason.
        ? `${broken.length === 1 ? "One booking couldn't be made" : `${broken.length} bookings couldn't be made`}. Fix it, or carry on without it.`
        : nothingToCharge
          ? 'Nothing here for Reach to pay for — the tickets and tables are yours to book.'
          : "We're still pricing this — check back soon.",
    // "concierge" is our word for how we handle something, not a word anybody
    // outside this codebase should have to read. It shipped to the checkout
    // screen under the total and a founder saw it there.
    conciergeNote: conciergeCount
      ? '+ a few things we price once they are confirmed'
      : null,
  };
}

// ─── What the success screen may claim ──────────────────────────────────
// "You're all booked!" once sat above two lines both reading "Quoted",
// because the screen counted rows rather than reading them. That was fixed
// by requiring every row to be settled — and the fix still counted
// `redirected` as booked.
//
// It is not. Redirected means Reach handed somebody to Resy or OpenTable
// and they went off to get the table themselves. Whether there was a table
// is known to exactly one person, and it is not us: there is a "did you get
// it?" prompt on this very screen for precisely that reason. Saying "you're
// all booked" over a row we are still asking about is the app claiming to
// know something it has just admitted it does not.
//
// So the claim is narrowed to what a row can prove. Confirmed is a booking.
// Everything else is honest about what it is.

export type BookedClaim =
  /** Every settled row came back confirmed. */
  | 'all_booked'
  /** Some confirmed, others still waiting on the person or the provider. */
  | 'partly_booked'
  /** Money is in, nothing is confirmed yet. */
  | 'paid_only';

const SETTLED = new Set(['confirmed', 'redirected', 'pending']);

export function bookedClaim(rows: { status?: string | null }[] | null | undefined): BookedClaim {
  const live = (rows ?? []).filter(r => SETTLED.has(String(r.status ?? '')));
  if (!live.length) return 'paid_only';

  const confirmed = live.filter(r => String(r.status) === 'confirmed');
  if (!confirmed.length) return 'paid_only';
  return confirmed.length === live.length ? 'all_booked' : 'partly_booked';
}

/** The headline and the line under it, per claim. */
export function bookedWording(claim: BookedClaim): { title: string; sub: string } {
  switch (claim) {
    case 'all_booked':
      return { title: "You're all booked!", sub: 'Powered by Stripe · PCI-DSS compliant' };
    case 'partly_booked':
      return {
        title: "Some of it's booked",
        sub: 'The rest is waiting on you or on the place — see below',
      };
    case 'paid_only':
      return {
        title: 'Your share is in',
        sub: "Nothing is booked yet — we'll confirm each one with you",
      };
  }
}
