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
  /**
   * The slot's own tip (`slot.tip`), about the place this line names. Never
   * the day's title or the day's tip: those were about other lines, and
   * printed here they read as a description of this one.
   */
  subtitle: z.string().nullish(),
  /**
   * From the cited place's kind (`slot.kind`, through typeForKind) when the
   * slot cites one; from the ticket or the journey's words before that; from
   * the slot's position only when nothing says what the place is.
   */
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
  /**
   * A photo of the venue or act the line names, and whose it is. Attached
   * by the generator from the row it cited or the listing that sold the
   * ticket; never looked up by name. Both or neither.
   */
  venue_image_url: z.string().nullish(),
  venue_image_credit: z.string().nullish(),
  /**
   * What the picture is of — the act, the event or the place — for its alt
   * text. The line names the venue; a gig's picture is usually the band.
   */
  venue_image_of: z.string().nullish(),
  /** The picture's page (a Commons file), so its credit can be followed. */
  venue_image_link: z.string().nullish(),
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
  venue_image_url: string | null;
  venue_image_credit: string | null;
  venue_image_of: string | null;
  venue_image_link: string | null;
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
  'venue_note_credit', 'venue_image_url', 'venue_image_credit', 'venue_image_of',
  'venue_image_link', 'sort_order',
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
    // Never the picture without its credit.
    ...photoPair(r.venue_image_url, r.venue_image_credit, r.venue_image_of, r.venue_image_link),
  };
}

/**
 * A photo and its credit, both or neither — and only an https picture. What
 * it is of goes only with a picture: there is nothing to describe without one.
 */
function photoPair(url: unknown, credit: unknown, of: unknown, link: unknown):
  { venue_image_url: string | null; venue_image_credit: string | null; venue_image_of: string | null; venue_image_link: string | null } {
  const u = typeof url === 'string' && /^https:\/\//.test(url) ? url.slice(0, 1000) : null;
  const c = typeof credit === 'string' && credit.trim() ? credit.trim().slice(0, 200) : null;
  const o = typeof of === 'string' && of.trim() ? of.trim().slice(0, 200) : null;
  const l = typeof link === 'string' && /^https:\/\//.test(link) ? link.slice(0, 1000) : null;
  return u && c
    ? { venue_image_url: u, venue_image_credit: c, venue_image_of: o, venue_image_link: l }
    : { venue_image_url: null, venue_image_credit: null, venue_image_of: null, venue_image_link: null };
}

/**
 * The screen's item, as a row to write.
 *
 * Accepts the loose shapes the client has always sent — `sub` or `subtitle`,
 * `conf` or `confirmation_number` — because the generator and the editor
 * disagree about names and both are callers.
 */
/**
 * Only flights, stays and activities can be booked by Reach. A restaurant,
 * an event or a car marked "reach" is a promise with nothing behind it —
 * every such row in the table came from a saved itinerary that said so and
 * was believed. Anything else claiming "reach" is the traveller's to book.
 */
const REACH_BOOKS = new Set(['flight', 'hotel', 'activity']);
export function honestMode(type: unknown, mode: unknown): string | null {
  const m = typeof mode === 'string' && mode ? mode : null;
  if (m === 'reach' && !REACH_BOOKS.has(String(type ?? ''))) return 'ahead';
  return m;
}

/**
 * What a line is, from what the place it cites is.
 *
 * The type used to come from where a slot sat in the day: every evening was
 * a "restaurant", so SPIN — a bar we hold as kind `bar` at 1332 F Street NW —
 * was filed as somewhere to book a table, with a knife and fork beside it.
 * The generator now hands back the cited row's kind as `slot.kind`, and the
 * row decides.
 *
 * Only two answers, because only two are honest from a kind alone: somewhere
 * you go to eat, or somewhere you go. A hotel is never on the menu, a ticket
 * is decided by the ticket, and the journey by its words — all before this
 * is asked. Null when there is no kind, so the caller keeps whatever it
 * would have said without one rather than this guessing.
 */
const EATS = /\b(?:restaurants?|cafes?|cafés?|bakery|bakeries|bistro|diner|deli|food|places to eat|markets?|ice cream|brunch|pizzeria|steakhouse|noodles?|taqueria)\b/i;
export type SlotType = 'restaurant' | 'activity';
export function typeForKind(kind: unknown): SlotType | null {
  const k = typeof kind === 'string' ? kind.replace(/_/g, ' ').trim() : '';
  if (!k) return null;
  return EATS.test(k) ? 'restaurant' : 'activity';
}

/**
 * The line shown under an item, or nothing.
 *
 * The subtitle holds the slot's own tip — about that place, written with it.
 * Until 2026-09-25 it could also hold the whole day's tip, pinned under the
 * evening row behind a 💡 so it "read as a note about the day": on f979c880
 * SPIN was captioned with advice about walking between the monuments. That
 * was the only thing that ever wrote a 💡 into a subtitle, and slot tips are
 * stored without one, so a 💡 line is a day note on the wrong row. It stays
 * in the table as the record; it is not shown as that place's description.
 */
const DAY_NOTE = '💡';
export function itemNote(sub: unknown): string {
  const s = typeof sub === 'string' ? sub.trim() : '';
  return s.startsWith(DAY_NOTE) ? '' : s;
}

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
    // The slot's own tip is its subtitle. There is no separate column, and a
    // field with nowhere to be stored works once and vanishes on reload. A
    // caller handing over `tip` is read, not dropped.
    subtitle: pick('sub', 'subtitle', 'tip'),
    scheduled_time: pick('time', 'scheduled_time'),
    confirmation_number: conf,
    // Confirmed is not the same as holding a reference for it: a ticket
    // bought from the seller is confirmed and has no number we hold.
    is_confirmed: typeof item.filled === 'boolean' ? item.filled : !!conf,
    cost_cents: item.cost_cents ?? 0,
    booking_mode: honestMode(item.type, item.booking_mode),
    payment_note: item.payment_note ?? null,
    because: item.because ?? null,
    venue_website: item.venue_website ?? null,
    venue_name: item.venue_name ?? null,
    venue_phone: item.venue_phone ?? null,
    venue_note: item.venue_note ?? null,
    ...photoPair(item.venue_image_url, item.venue_image_credit, item.venue_image_of, item.venue_image_link),
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
  { row: 'venue_image_url', item: 'venue_image_url' },
  { row: 'venue_image_credit', item: 'venue_image_credit' },
  { row: 'venue_image_of', item: 'venue_image_of' },
  { row: 'venue_image_link', item: 'venue_image_link' },
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
