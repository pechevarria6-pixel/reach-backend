// ─── What the itinerary email may say about each line ────────────────────
// The email said "Reach will book these" over rows that were already booked
// and over restaurants Reach cannot book, printed $0 for lines nobody had
// priced and added the zeros into "per person, all in", and told a person
// travelling alone that it was "paid once the group funds the trip". Each
// line's words now come from the row and its booking, decided here so the
// rules are tested rather than assembled inside HTML.
import { honestMode } from './contracts/itinerary-item.ts';

export interface EmailItem {
  id?: string | null;
  type?: string | null;
  title: string;
  subtitle?: string | null;
  scheduled_time?: string | null;
  cost_cents?: number | null;
  booking_mode?: string | null;
  payment_note?: string | null;
}
export interface EmailBooking { itinerary_item_id?: string | null; status: string; provider_ref?: string | null }

export interface FixedLine { title: string; detail: string | null; cents: number | null; state: string }
export interface DayLine { when: string; title: string; payment: string | null; cents: number | null }

/** Priced, or null — never a zero standing in for "nobody knows". */
const priced = (c: unknown) => (typeof c === 'number' && c > 0 ? c : null);

export function itineraryLines(items: EmailItem[], bookings: EmailBooking[] = []): {
  fixed: FixedLine[]; days: DayLine[]; unpriced: number;
} {
  const live = new Map<string, EmailBooking>();
  for (const b of bookings) {
    if (!b.itinerary_item_id || b.status === 'cancelled') continue;
    const had = live.get(b.itinerary_item_id);
    // A confirmed booking outranks any other row for the same line.
    if (!had || b.status === 'confirmed') live.set(b.itinerary_item_id, b);
  }
  const fixed: FixedLine[] = [];
  const days: DayLine[] = [];
  let unpriced = 0;
  for (const i of items) {
    const reach = honestMode(i.type, i.booking_mode) === 'reach';
    const cents = priced(i.cost_cents);
    if (reach) {
      const b = i.id ? live.get(i.id) : undefined;
      const state = b?.status === 'confirmed'
        ? `Booked${b.provider_ref ? ` · ${b.provider_ref}` : ''}`
        : b?.status === 'quoted' ? 'Held back for later'
        : b?.status === 'failed' ? "Didn't go through — open the trip to try again"
        : 'Book it in Reach';
      if (cents === null) unpriced++;
      fixed.push({ title: i.title, detail: i.subtitle ?? null, cents, state });
    } else {
      days.push({ when: i.scheduled_time || '', title: i.title, payment: i.payment_note ?? null, cents });
    }
  }
  return { fixed, days, unpriced };
}
