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
 * What this row is, in the words it was booked under.
 *
 * Never the vertical. "restaurant" is a category, and a person looking at a
 * checkout screen is entitled to know which restaurant.
 */
export function itemTitle(row: CheckoutRow): string {
  const d = row.detail;
  if (typeof d === 'string' && d.trim()) return d.trim();
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
export function dedupe(rows: CheckoutRow[]): CheckoutRow[] {
  const seen = new Set<string>();
  const out: CheckoutRow[] = [];
  for (const row of rows) {
    const name = itemTitle(row);
    const key = row.itinerary_item_id
      ? `line:${row.itinerary_item_id}`
      : name === 'Trip item (details coming)'
        ? null                                   // never merged
        : `${row.vertical}|${name.toLowerCase()}|${row.scheduled_date ?? ''}`;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(row);
  }
  return out;
}

/** A row that costs money to the person tapping the button. */
function charged(row: CheckoutRow): boolean {
  // Concierge is a request, not a purchase: somebody rings the restaurant
  // and the price is settled there. A failed or cancelled row is not a
  // purchase either, and counting it would ask for money for nothing.
  return row.provider !== 'concierge'
    && row.mode !== 'concierge'
    && row.status !== 'failed'
    && row.status !== 'cancelled';
}

function priced(row: CheckoutRow): boolean {
  return typeof row.price_cents === 'number' && row.price_cents > 0;
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

  const conciergeCount = deduped.filter(r => !charged(r)
    && r.status !== 'failed' && r.status !== 'cancelled' && !priced(r)).length;

  const canPay = totalCents > 0 && unpricedCharged.length === 0;

  return {
    rows: deduped,
    totalCents,
    canPay,
    blockedCopy: canPay ? null : "We're still pricing this — check back soon.",
    conciergeNote: conciergeCount
      ? '+ concierge items priced after confirmation'
      : null,
  };
}
