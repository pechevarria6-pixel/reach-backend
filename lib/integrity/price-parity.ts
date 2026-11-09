// ─── Is Reach's price at or below the public one? (L3) ───────────────────
// REACH-BUSINESS-MODEL-2026-11-08.md §4B L3 and the §4F standing rule:
// "Native price must be at or below public price or the member is told."
//
// A public price is stored only where a supplier hands one over through an
// API — never scraped, never estimated. Today that is one place:
//
//   LiteAPI's `retailRate.suggestedSellingPrice` on the rate that was quoted.
//   Its reference calls it "the suggested (public) selling price", "the stay
//   total including taxes and fees" (docs.liteapi.travel, post_hotels-rates).
//   Because it includes taxes and fees, it is compared with everything the
//   member pays for the stay: our price plus whatever the hotel collects at
//   the desk (`included: false`). Comparing it with our price alone would
//   flatter us by the tax bill.
//
//   It sits on each per-occupancy rate, and the docs disagree with
//   themselves on whether that figure is one room's or the whole offer's, so
//   it is read only for a single-room stay, where both readings agree.
//
// Duffel's fare is the airline's own offer, and Duffel returns no separate
// public figure to compare it with; flights are left unchecked (null) rather
// than declared at parity. Null means "not checked", never "fine".

/** The existing "equivalent within ~15%" tolerance (business model §4B L2). */
export const PARITY_TOLERANCE = 0.15;

export interface ParityRow {
  vertical?: string | null;
  mode?: string | null;
  provider?: string | null;
  price_cents?: number | null;
  currency?: string | null;
  request_payload?: unknown;
  response_payload?: unknown;
  public_price_cents?: number | null;
}

type Money = { amount?: unknown; currency?: unknown };
const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? v as Record<string, unknown> : null);
const moneyCents = (m: unknown, currency: string): number | null => {
  const list = Array.isArray(m) ? m as Money[] : m && typeof m === 'object' ? [m as Money] : [];
  if (list.length !== 1) return null;
  const n = Number(list[0]?.amount);
  const cur = list[0]?.currency ? String(list[0].currency).toUpperCase() : currency;
  if (!Number.isFinite(n) || n <= 0 || cur !== currency) return null;
  return Math.round(n * 100);
};

function roomsOf(row: ParityRow): number {
  const hotel = asObj(asObj(row.request_payload)?.hotel);
  const n = Number(hotel?.rooms ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** What the hotel collects at the desk on top of our price, from the quote itself. */
export function paidAtDeskCents(row: ParityRow): number {
  const raw = asObj(row.response_payload);
  const stored = Number(raw?.payAtHotelCents);
  if (Number.isFinite(stored) && stored >= 0 && raw?.payAtHotelCents !== null && raw?.payAtHotelCents !== undefined) return Math.round(stored);
  const fees = asObj(raw?.retailRate)?.taxesAndFees;
  let total = 0;
  for (const f of Array.isArray(fees) ? fees as Record<string, unknown>[] : []) {
    if (f?.included !== false) continue;
    const n = Number(f.amount);
    if (Number.isFinite(n) && n > 0) total += Math.round(n * 100);
  }
  return total;
}

/**
 * The supplier's public price for exactly what was quoted, in cents, or null
 * when no supplier gave one we can compare like for like.
 */
export function publicPriceOf(row: ParityRow): number | null {
  if (row.mode !== 'native') return null;
  const currency = String(row.currency || 'USD').toUpperCase();
  const liteapiHotel = row.vertical === 'hotel' && row.provider === 'liteapi';
  if (liteapiHotel) {
    if (roomsOf(row) !== 1) return null;
    const ssp = asObj(asObj(row.response_payload)?.retailRate)?.suggestedSellingPrice;
    return moneyCents(ssp, currency);
  }
  return null;
}

export interface Parity {
  /** What the member pays for it through Reach, everything included. */
  ourCents: number;
  publicCents: number;
  /** How much less the public price is; 0 when ours is at or below it. */
  cheaperPubliclyByCents: number;
  /** Public is cheaper by more than the tolerance: the member must be told. */
  tellMember: boolean;
}

/** Reach's price against the public one, from the stored public price when there is one. */
export function parityOf(row: ParityRow): Parity | null {
  const stored = Number(row.public_price_cents);
  const publicCents = Number.isFinite(stored) && stored > 0 && row.public_price_cents != null ? Math.round(stored) : publicPriceOf(row);
  const price = Number(row.price_cents);
  if (!publicCents || !Number.isFinite(price) || price <= 0) return null;
  const ourCents = Math.round(price) + (row.vertical === 'hotel' ? paidAtDeskCents(row) : 0);
  const cheaperPubliclyByCents = Math.max(0, ourCents - publicCents);
  return {
    ourCents, publicCents, cheaperPubliclyByCents,
    tellMember: publicCents < ourCents * (1 - PARITY_TOLERANCE),
  };
}

/**
 * Where to book it directly: a public search for the same hotel on the same
 * nights for the same number of people. A search, not a booking page — it is
 * where public prices are shown, and it claims nothing about the result.
 */
export function directLink(row: ParityRow): string | null {
  if (row.vertical !== 'hotel') return null;
  const req = asObj(row.request_payload);
  const hotel = asObj(req?.hotel);
  const name = String(asObj(asObj(row.response_payload)?.hotel)?.name ?? '').trim();
  const city = String(hotel?.city ?? '').trim();
  const checkin = String(hotel?.checkin ?? '');
  const checkout = String(hotel?.checkout ?? '');
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return null;
  const party = Math.max(1, Math.floor(Number(req?.party) || 1));
  const q = new URLSearchParams({
    ss: city ? `${name}, ${city}` : name,
    checkin, checkout,
    group_adults: String(party),
    no_rooms: String(roomsOf(row)),
  });
  return `https://www.booking.com/searchresults.html?${q.toString()}`;
}

/** The words the member reads when the public price is meaningfully lower. */
export const CHEAPER_DIRECTLY = 'Cheaper if you book this one directly →';
