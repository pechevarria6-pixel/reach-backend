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
function tidyLegacy(detail: string): string {
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
export function itemTitle(row: CheckoutRow): string {
  const d = row.detail;
  if (typeof d === 'string' && d.trim()) return tidyLegacy(d.trim());
  // Older rows stored an object. Both spellings appear in the table.
  if (d && typeof d === 'object') {
    const o = d as { title?: unknown; name?: unknown };
    for (const v of [o.title, o.name]) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  // No name at all is a malformed row. Say so rather than printing the enum,
  // which reads like a title and is not one.
  return 'Trip item (details coming)';
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
      : name === 'Trip item (details coming)'
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
  totalCents: number;
  canPay: boolean;
  /** Why the button is off, in words for the screen. Null when it is on. */
  blockedCopy: string | null;
  /** Set when something real is being arranged that has no price yet. */
  conciergeNote: string | null;
}

/**
 * Everything the screen needs to decide what to show and whether to let
 * anybody pay.
 */
export function checkoutState(rows: CheckoutRow[]): CheckoutState {
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

  const canPay = totalCents > 0 && unpricedCharged.length === 0;

  return {
    rows: deduped,
    totalCents,
    canPay,
    blockedCopy: canPay ? null : "We're still pricing this — check back soon.",
    // "concierge" is our word for how we handle something, not a word anybody
    // outside this codebase should have to read. It shipped to the checkout
    // screen under the total and a founder saw it there.
    conciergeNote: conciergeCount
      ? '+ a few things we price once they are confirmed'
      : null,
  };
}
