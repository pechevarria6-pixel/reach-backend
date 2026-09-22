// ─── The itinerary item, defined once ────────────────────────────────────
// Six of the seven bugs found on 2026-09-21 were the same shape: a fact the
// app already held stopped one layer short of the person reading it. The
// ticket URL, the venue's website, what is on there, the venue's name — each
// was generated correctly, written correctly, returned correctly, and
// dropped between the response and the render.
//
// They were all possible because four layers each kept their own
// hand-written list of fields:
//
//   the slot the generator returns          components/reach-app.jsx
//   the row the PUT writes                  app/api/plans/[id]/itinerary
//   the object the client builds on load    convertPlan
//   the object it rebuilds after a build    the post-generate refresh
//
// Adding a column meant remembering all four. Three times somebody did not,
// and the comments in those files say so — "dropping these here would show
// the practicals right after generating and lose them on the next load,
// which is the exact shape of the bug that lost whole itineraries."
//
// So the shape lives here and the layers import it. Adding a field here
// carries it everywhere, which is the entire point: it should not be
// possible to add a fact and forget to deliver it.
import { z } from 'zod';

/**
 * What a row is, as the database holds it.
 *
 * Nullable means genuinely unknowable — we have not read it, or the place
 * does not have one. It never means "we could not be bothered to carry it".
 */
export const ItineraryItemRow = z.object({
  id: z.string().nullish(),
  scheduled_time: z.string().nullish(),
  title: z.string(),
  subtitle: z.string().nullish(),
  type: z.string().nullish(),
  confirmation_number: z.string().nullish(),
  is_confirmed: z.boolean().nullish(),
  cost_cents: z.number().nullish(),
  booking_mode: z.string().nullish(),
  payment_note: z.string().nullish(),
  because: z.string().nullish(),
  /** Where this is actually booked — a ticket page, or the venue's own site. */
  venue_website: z.string().nullish(),
  venue_name: z.string().nullish(),
  venue_phone: z.string().nullish(),
  /** What is on there, in the venue's own words, read off their page. */
  venue_note: z.string().nullish(),
  venue_note_credit: z.string().nullish(),
  sort_order: z.number().nullish(),
});
export type ItineraryItemRow = z.infer<typeof ItineraryItemRow>;

/** The same item as the screen wants it. Only the names differ. */
export interface ItineraryItem {
  id: string | null;
  time: string;
  title: string;
  sub: string;
  type: string | null;
  conf: string | null;
  filled: boolean;
  cost_cents: number;
  booking_mode: string | null;
  payment_note: string | null;
  because: string | null;
  venue_website: string | null;
  venue_name: string | null;
  venue_phone: string | null;
  venue_note: string | null;
  venue_note_credit: string | null;
}

/**
 * Every column a row needs to arrive complete.
 *
 * A narrow `.select()` is the original sin here: it looks like an
 * optimisation and it silently removes a fact from every screen downstream.
 * One list, next to the shape it fills.
 */
export const ITEM_COLUMNS = [
  'id', 'scheduled_time', 'title', 'subtitle', 'type', 'confirmation_number',
  'is_confirmed', 'cost_cents', 'booking_mode', 'payment_note', 'because',
  'venue_website', 'venue_name', 'venue_phone', 'venue_note',
  'venue_note_credit', 'sort_order',
].join(', ');

/** A database row, as the screen wants it. The only place this is done. */
export function itemFromRow(row: Record<string, unknown>): ItineraryItem {
  const r = ItineraryItemRow.parse(row);
  return {
    id: r.id ?? null,
    time: r.scheduled_time ?? '',
    title: r.title,
    sub: r.subtitle ?? '',
    type: r.type ?? null,
    conf: r.confirmation_number ?? null,
    filled: !!r.is_confirmed,
    cost_cents: r.cost_cents ?? 0,
    booking_mode: r.booking_mode ?? null,
    payment_note: r.payment_note ?? null,
    because: r.because ?? null,
    venue_website: r.venue_website ?? null,
    venue_name: r.venue_name ?? null,
    venue_phone: r.venue_phone ?? null,
    venue_note: r.venue_note ?? null,
    venue_note_credit: r.venue_note_credit ?? null,
  };
}

/**
 * The screen's item, as a row to write.
 *
 * Accepts the loose shapes the client has always sent — `sub` or `subtitle`,
 * `conf` or `confirmation_number` — because the generator and the editor
 * disagree about names and both are callers.
 */
export function rowFromItem(item: Record<string, unknown>, sortOrder: number): Record<string, unknown> {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = item[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };
  const conf = pick('conf', 'confirmation_number');
  return {
    type: item.type ?? null,
    title: item.title,
    subtitle: pick('sub', 'subtitle'),
    scheduled_time: pick('time', 'scheduled_time'),
    confirmation_number: conf,
    // Confirmed is not the same as holding a reference for it: a ticket
    // bought from the seller is confirmed and has no number we hold.
    is_confirmed: typeof item.filled === 'boolean' ? item.filled : !!conf,
    cost_cents: item.cost_cents ?? 0,
    booking_mode: item.booking_mode ?? null,
    payment_note: item.payment_note ?? null,
    because: item.because ?? null,
    venue_website: item.venue_website ?? null,
    venue_name: item.venue_name ?? null,
    venue_phone: item.venue_phone ?? null,
    venue_note: item.venue_note ?? null,
    sort_order: sortOrder,
  };
}

/**
 * Which facts must survive a round trip, and their names on each side.
 *
 * The test that uses this is the one that would have caught all six: it
 * writes a row with every fact set, reads it back, and fails if any arrives
 * empty. Adding a field to the contract and not to a mapper fails here.
 */
export const FACTS_THAT_MUST_SURVIVE: { row: keyof ItineraryItemRow; item: keyof ItineraryItem }[] = [
  { row: 'venue_website', item: 'venue_website' },
  { row: 'venue_name', item: 'venue_name' },
  { row: 'venue_phone', item: 'venue_phone' },
  { row: 'venue_note', item: 'venue_note' },
  { row: 'payment_note', item: 'payment_note' },
  { row: 'booking_mode', item: 'booking_mode' },
  { row: 'because', item: 'because' },
];

/**
 * A list of rows, for a screen.
 *
 * `itemFromRow` throws on a row that does not match, which is what you want
 * on a server and behind a test: a fact missing from the contract should be
 * loud. On a screen it is not what you want at all — one bad row from an
 * old record would white-screen somebody's whole trip, which is a far worse
 * failure than the one it is guarding against.
 *
 * So a screen uses this: the bad row is dropped and said out loud in the
 * console, and the other nineteen days still render.
 */
export function itemsFromRows(rows: unknown[] | null | undefined): ItineraryItem[] {
  const out: ItineraryItem[] = [];
  for (const row of rows ?? []) {
    try {
      out.push(itemFromRow(row as Record<string, unknown>));
    } catch (err) {
      console.error('[itinerary] a row did not match the contract and was left out', {
        row, error: err instanceof Error ? err.message : 'invalid',
      });
    }
  }
  return out;
}
