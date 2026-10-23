// ─── "Change" on one line of a plan: what else could go there ───────────
// The checkout spec's Task 7a. Somebody looks at Day 2's dinner and wants a
// different one. Everything here is held to the rule the generator is held
// to: a line may name only a place on the verified menu (lib/discovery/
// real-places.ts), so the three offered are menu rows, and nothing about
// them is said that the row does not hold.
//
// "The same slot" is three things, in order of how much they matter:
//
//   what it is   a bar is swapped for a bar before anything else; then for
//                anything of the same line type (somewhere to eat, or
//                somewhere to go — typeForKind). Never a restaurant for a
//                museum: that is a different plan, and the single-slot
//                regeneration is where a different plan comes from.
//   where        near the rest of that day's stops. An evening is one part of
//                town (SAME_EVENING_KM); a day can take a drive (SAME_DAY_KM).
//                A place with no point on the map is kept — not knowing where
//                something is is not evidence it is far — and sorted last.
//   when         open on that day, in that part of the day (slotWindow —
//                the slot's, whatever the place is), going by the map's
//                hours (closedThroughout). Hours we cannot read keep the
//                place, the same lean the menu itself takes.
//
// Price: we hold no price for a venue. Not one row in discovery_venues says
// what dinner costs, so the difference per person is null and the copy says
// the line's estimate stays. A number here would be the model's guess dressed
// up as ours. Hotels and flights do carry prices — those lines are changed
// through /api/bookings/[id]/options, which prices them for real.
//
// Pure, so the rule can be tested without a database.
import type { RealPlace } from './discovery/real-places.ts';
import { namedPlace, SAME_EVENING_KM, SAME_DAY_KM, bookingFor } from './discovery/real-places.ts';
import { closedThroughout, type Window } from './discovery/hours.ts';
import { haversineMiles } from './discovery/distance.ts';
import { dayOf } from './budget.ts';
import { typeForKind, honestMode, ABOUT_THE_PLACE } from './contracts/itinerary-item.ts';

const KM_PER_MILE = 1.609344;

/** One line of the plan, as much of it as choosing a replacement needs. */
export interface PlanLine {
  id: string;
  type?: string | null;
  title?: string | null;
  scheduled_time?: string | null;
  venue_name?: string | null;
  booking_mode?: string | null;
  cost_cents?: number | null;
}

/** The lines whose places come off a menu. Hotels and flights are priced, not picked. */
export const MENU_TYPES = new Set(['restaurant', 'activity']);
/** Changed through the booking's own options, which prices them for real. */
export const BOOKING_TYPES = new Set(['hotel', 'flight']);

/**
 * A stable name for a menu place.
 *
 * The menu's own refs ("p4") are positions in one read and mean nothing on
 * the next, so a suggestion stored against "p4" would apply a different bar
 * tomorrow. This is the place itself: its name and where it is, hashed
 * (FNV-1a), short enough to be an event property. The same row reads back
 * to the same ref; a different row never does, short of a hash collision
 * inside one town's menu.
 */
export function placeRef(p: Pick<RealPlace, 'name' | 'lat' | 'lng' | 'street'>): string {
  const name = String(p.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const at = p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    ? `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`
    : String(p.street ?? '').trim().toLowerCase();
  let h = 0x811c9dc5;
  for (const ch of `${name}|${at}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v:${h.toString(16).padStart(8, '0')}`;
}

/** The menu place with this ref, or null. */
export function placeByRef(ref: unknown, places: RealPlace[]): RealPlace | null {
  if (typeof ref !== 'string' || !/^v:[0-9a-f]{8}$/.test(ref)) return null;
  return places.find(p => placeRef(p) === ref) ?? null;
}

/** The menu place a line is about: the venue it names, else its title. */
export function placeOfLine(line: PlanLine, places: RealPlace[]): RealPlace | null {
  return (line.venue_name ? namedPlace(line.venue_name, places) : null) ?? namedPlace(line.title, places);
}

/** Whether a line's slot is in the evening: a night out is, and so is "Day 2 · Evening" or "Day 2 · 9:30 PM". */
export function eveningSlot(time: unknown, nightOut: boolean): boolean {
  if (nightOut) return true;
  const w = slotWindow(time, false);
  return w === 'evening' || w === 'night';
}

/** The hour a "7:30 PM" or "19:30" in a slot label gives, or null. */
function clockHour(time: string): number | null {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(time);
  if (ampm) {
    const h = Number(ampm[1]);
    if (h < 1 || h > 12) return null;
    return (h % 12) + (/p/i.test(ampm[3]) ? 12 : 0);
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(time);
  return h24 ? Number(h24[1]) : null;
}

/**
 * The part of the day a line is in, for whether a place is open then.
 *
 * Read off the slot, never the kind of place: a museum offered for "Day 2 ·
 * Evening" has to be open in the evening, and a club offered for the morning
 * has to be open in the morning — judging either on the whole day offered
 * a gallery at nine at night. A clock time wins over a word. A night out with
 * nothing more said is the evening; a slot that says nothing ("Day 2") is the
 * whole day, the lean the menu takes when it cannot tell.
 */
export type SlotPart = 'morning' | 'afternoon' | 'evening' | 'night' | 'day';
const PART_WINDOW: Record<SlotPart, Window> = {
  morning: 'morning', afternoon: 'afternoon', evening: 'after_six', night: 'night', day: 'day',
};

export function slotWindow(time: unknown, nightOut: boolean): SlotPart {
  const t = String(time ?? '');
  const h = clockHour(t);
  if (h !== null) return h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  if (/\blate[\s-]*night\b|\bnight\b/i.test(t) && !/\bnight out\b/i.test(t)) return 'night';
  if (/\b(evening|dinner|sunset)\b/i.test(t)) return 'evening';
  if (/\b(afternoon|lunch)\b/i.test(t)) return 'afternoon';
  if (/\b(morning|breakfast|brunch)\b/i.test(t)) return 'morning';
  return nightOut ? 'evening' : 'day';
}

/**
 * The calendar day a line falls on, as YYYY-MM-DD, or null.
 *
 * "Day 3 · Evening" on a trip starting the 10th is the 12th, counted on the
 * calendar from its parts — never through a UTC instant, which rolls over at
 * eight in the evening in New York. A night out is its start date.
 */
export function dateOfLine(time: unknown, startDate: unknown, nightOut: boolean): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(startDate ?? ''));
  if (!m) return null;
  if (nightOut) return `${m[1]}-${m[2]}-${m[3]}`;
  const n = /^day\s+(\d+)/i.exec(String(time ?? '').trim());
  if (!n) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(n[1]) - 1);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const located = (p: RealPlace | null | undefined): p is RealPlace & { lat: number; lng: number } =>
  !!p && p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Kilometres from a place to the nearest of some others, or null. */
function kmToNearest(p: RealPlace, others: RealPlace[]): number | null {
  if (!located(p)) return null;
  let best: number | null = null;
  for (const o of others) {
    if (!located(o)) continue;
    const km = haversineMiles({ lat: p.lat, lng: p.lng }, { lat: o.lat, lng: o.lng }) * KM_PER_MILE;
    if (best === null || km < best) best = km;
  }
  return best;
}

export interface Alternative {
  /** Stable — what a suggestion or a swap names (placeRef). */
  ref: string;
  name: string;
  kind: string;
  street: string | null;
  url: string | null;
  phone: string | null;
  /** A bar for a bar: the same kind of place as the line has now. */
  sameKind: boolean;
  /** From the nearest of that day's other stops, when both are on the map. */
  km: number | null;
  /** One line, every word of it from the row. */
  why: string;
  /** How it would be arranged, by what the map says (bookingFor). */
  booking_mode: string | null;
  price: {
    /** Null: we hold no price for a venue, so there is no difference to state. */
    deltaPerPersonCents: number | null;
    estimate: true;
    note: string;
  };
}

export type AlternativesResult =
  | { status: 'ok'; current: { ref: string | null; name: string | null; kind: string | null }; alternatives: Alternative[] }
  /** Hotels and flights: the booking's own options price them. */
  | { status: 'booking_line'; type: string }
  /** A ticket, a journey or a note — nothing on a menu replaces it. */
  | { status: 'not_a_place'; type: string | null }
  /** The town holds nothing of this kind near enough, open then. */
  | { status: 'none'; current: { ref: string | null; name: string | null; kind: string | null }; reason: string };

export interface AlternativesInput {
  line: PlanLine;
  /** Every line on the plan, this one included. */
  lines: PlanLine[];
  /** The verified menu for the plan's town. */
  places: RealPlace[];
  nightOut: boolean;
  startDate?: string | null;
  countryCode?: string | null;
  /** How many to offer. The spec says three. */
  count?: number;
  /**
   * "Something else…": the one-slot rewrite (app/api/trips/generate, `slot`)
   * may name any menu place, not only one of the line's own type — asking
   * for a museum instead of a bar is the point of it. Everything else still
   * holds: on the menu, near the rest of the day, open then, not already on
   * the plan.
   */
  anyType?: boolean;
}

const PRICE_NOTE = "We hold no price for this place, so this line's estimate stays as it is.";

/** "Bar", "Museum" — the map's word, capitalised. */
function kindLabel(kind: string): string {
  const k = String(kind || '').replace(/_/g, ' ').trim();
  return k && k !== 'place' ? k[0].toUpperCase() + k.slice(1) : '';
}

/**
 * Why this one, in one line, from the row and nothing else.
 *
 *   "Bar · 1332 F Street Northwest · 0.3 mi from the rest of your evening"
 *   "Pub · Trivia Night, every Wednesday — from their own page"
 *
 * The map's hours are never restated as ours (they are a volunteer's note),
 * so "open then" is what decided it was offered, not something it says.
 */
export function whyLine(p: RealPlace, km: number | null, dayLabel: string): string {
  const parts: string[] = [];
  const label = kindLabel(p.kind);
  if (label) parts.push(label);
  if (p.street) parts.push(String(p.street).trim());
  if (km !== null) {
    const mi = km / KM_PER_MILE;
    parts.push(`${mi < 0.1 ? 'under 0.1' : mi.toFixed(1)} mi from the rest of ${dayLabel}`);
  }
  const on = (p.whatsOn ?? []).find(s => String(s || '').trim());
  if (on) parts.push(`${String(on).trim()} — from their own page`);
  else if (p.reservation === 'required' || p.reservation === 'recommended') parts.push('the map says to book ahead');
  else if (p.reservation === 'no') parts.push('walk-in, per the map');
  const line = parts.join(' · ');
  return line.length > 180 ? `${line.slice(0, 177).replace(/\s+\S*$/, '')}…` : line;
}

/** "your evening", "Day 2" — what the distance is measured from, in words. */
function dayWords(time: unknown, nightOut: boolean): string {
  if (nightOut) return 'your evening';
  const d = dayOf(time);
  return d.label === 'Everything else' || d.label === 'Before you go' ? 'the plan' : d.label;
}

/**
 * Up to `count` alternatives for one line, nearest first, the same kind of
 * place before the same type of line.
 */
export function alternativesFor(input: AlternativesInput): AlternativesResult {
  const { line, lines, places, nightOut } = input;
  const count = input.count ?? 3;
  const type = String(line.type ?? '').toLowerCase() || null;
  if (type && BOOKING_TYPES.has(type)) return { status: 'booking_line', type };

  const current = placeOfLine(line, places);
  // A line with no type and no menu place is not something a menu replaces.
  // A ticket or a journey is never swapped from a menu, even when the place
  // it is at is on it: the gig is the plan, and the seat is the seller's.
  const lineType = type ? (MENU_TYPES.has(type) ? type : null) : (current ? typeForKind(current.kind) : null);
  if (!lineType) return { status: 'not_a_place', type };

  const cur = { ref: current ? placeRef(current) : null, name: current?.name ?? null, kind: current?.kind ?? null };

  // What that day already holds: the other stops on the same day, by the
  // places they name. Their points say where "near" is.
  const day = dayOf(line.scheduled_time).label;
  const sameDay = lines.filter(l => l.id !== line.id && dayOf(l.scheduled_time).label === day);
  const dayStops = sameDay.map(l => placeOfLine(l, places)).filter((p): p is RealPlace => !!p);
  // Where the line is now counts as part of the day when nothing else on it
  // is on the map: a dinner swapped for one across town is still a move.
  const anchors = dayStops.some(located) ? dayStops : (current ? [current] : []);

  // Nothing already on the plan, anywhere on it, is offered again.
  const onPlan = new Set(
    lines.map(l => placeOfLine(l, places)).filter((p): p is RealPlace => !!p).map(p => placeRef(p)),
  );

  const evening = eveningSlot(line.scheduled_time, nightOut);
  const window = slotWindow(line.scheduled_time, nightOut);
  const limitKm = evening ? SAME_EVENING_KM : SAME_DAY_KM;
  const date = dateOfLine(line.scheduled_time, input.startDate ?? null, nightOut);

  const pool = places.filter(p => {
    if (onPlan.has(placeRef(p))) return false;
    const kindType = typeForKind(p.kind);
    if (input.anyType ? !MENU_TYPES.has(String(kindType)) : kindType !== lineType) return false;
    const km = kmToNearest(p, anchors);
    if (km !== null && km > limitKm) return false;
    // Shut on that day, in that part of it, by the map's hours. No date (an
    // undated plan, or a line with no day in its label) and nothing is ruled
    // out: the menu was already read for the plan's dates.
    const where = located(p) ? { lat: p.lat, lng: p.lng, countryCode: input.countryCode ?? null } : null;
    return !(date && closedThroughout(p.hours ?? null, { from: date, to: date }, PART_WINDOW[window], where));
  });

  const sameKind = (p: RealPlace) => !!current && p.kind === current.kind;
  const ranked = pool
    .map(p => ({ p, km: kmToNearest(p, anchors), same: sameKind(p) }))
    .sort((a, b) =>
      Number(b.same) - Number(a.same)
      || (a.km === null ? 1 : 0) - (b.km === null ? 1 : 0)
      || (a.km ?? 0) - (b.km ?? 0)
      || a.p.name.localeCompare(b.p.name));

  const words = dayWords(line.scheduled_time, nightOut);
  const alternatives: Alternative[] = ranked.slice(0, count).map(({ p, km, same }) => ({
    ref: placeRef(p),
    name: p.name,
    kind: p.kind,
    street: p.street ?? null,
    url: p.url ?? null,
    phone: p.phone ?? null,
    sameKind: same,
    km: km === null ? null : Math.round(km * 10) / 10,
    why: whyLine(p, km, words),
    booking_mode: honestMode(lineType, bookingFor(String(line.booking_mode || 'walk_in'), p)),
    price: { deltaPerPersonCents: null, estimate: true, note: PRICE_NOTE },
  }));

  if (!alternatives.length) {
    return {
      status: 'none', current: cur,
      reason: places.length
        ? `Nothing else of this kind we've verified is near the rest of ${words} and open then.`
        : "We haven't verified any places in this town yet, so there is nothing to offer in its place.",
    };
  }
  return { status: 'ok', current: cur, alternatives };
}

// ─── The line, once it names somewhere else ─────────────────────────────

/**
 * The title with the new place in it.
 *
 * "Dinner at Vinny's Italian Grill, known for the lasagne" becomes "Dinner at
 * Vic's Italian Restaurant": what came before the old name is the shape of
 * the slot and stays; whatever came after it was about Vinny's, and goes. A
 * title that never named the old place is replaced by the new name alone,
 * because there is no telling which of its words were about it.
 */
export function swappedTitle(oldTitle: unknown, oldName: string | null | undefined, newName: string): string {
  const t = String(oldTitle ?? '');
  const name = String(oldName ?? '').trim();
  if (name) {
    const at = t.indexOf(name);
    const lead = at > 0 ? t.slice(0, at) : '';
    // A short lead-in ("Dinner at ", "Drinks at ") — never a whole sentence
    // that happened to end on the name.
    if (at >= 0 && lead.length <= 32 && !/[.!?;]/.test(lead)) return `${lead}${newName}`.trim();
  }
  return newName;
}

/**
 * The title "Something else…" wrote, when it is about this place. The
 * rewrite was read back on the server that wrote it; the line it lands on is
 * held to one thing more, here: the title names the place the line now
 * points at, by the menu's own spelling, so no title can arrive naming
 * somewhere the line is not. Anything else falls back to swappedTitle.
 */
export function titleNaming(title: unknown, place: RealPlace): string | null {
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (!t || t.length > 200) return null;
  return namedPlace(t, [place]) ? t : null;
}

/**
 * Everything a line says about its place, rewritten for a new one.
 *
 * Every key of ABOUT_THE_PLACE is set — from the new row, or to null — and
 * nothing else is touched, so the id, the slot, the order and the estimate
 * stay. Built the way the generator builds a cited slot (the site, the
 * booking page when it needs booking, the number, what is on there, the
 * photo with its credit), so a swapped line is no thinner than a generated
 * one.
 */
/**
 * What a "Something else…" stop costs a person, in cents, from the one-slot
 * rewrite's own `cost` (whole dollars, the same estimate every generated
 * line carries). Null when it said nothing usable.
 */
export function slotCostCents(cost: unknown): number | null {
  const n = typeof cost === 'number' ? cost : typeof cost === 'string' && cost.trim() ? Number(cost) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 5000) return null;
  return Math.round(n) * 100;
}

export function swappedLine(
  line: PlanLine, oldPlace: RealPlace | null, place: RealPlace, title?: string | null,
  opts: { costCents?: number | null } = {},
): Record<string, unknown> {
  const type = typeForKind(place.kind) ?? (line.type && MENU_TYPES.has(String(line.type)) ? String(line.type) : 'activity');
  const mode = honestMode(type, bookingFor(String(line.booking_mode || 'walk_in'), place));
  const site = mode === 'ahead' && place.reserveUrl ? place.reserveUrl : place.url ?? null;
  const photo = place.photo && /^https:\/\//.test(place.photo.url) && place.photo.credit ? place.photo : null;
  const out: Record<string, unknown> = Object.fromEntries(ABOUT_THE_PLACE.map(k => [k, null]));
  Object.assign(out, {
    title: titleNaming(title, place) ?? swappedTitle(line.title, oldPlace?.name ?? line.venue_name ?? null, place.name),
    type,
    booking_mode: mode,
    venue_name: place.name,
    venue_website: site,
    venue_phone: place.phone ?? null,
    venue_note: place.whatsOn?.length ? place.whatsOn.slice(0, 2).join(' · ') : null,
    venue_image_url: photo?.url ?? null,
    venue_image_credit: photo?.credit ?? null,
    venue_image_of: photo ? place.name : null,
    venue_image_link: photo?.link ?? null,
    is_confirmed: false,
  });
  // "Something else…" may be another kind of place altogether — a walk
  // becomes a brunch — so the old line's estimate is not this one's. It
  // takes the rewrite's own estimate for the new stop. A same-kind swap
  // keeps the estimate it had: no venue row holds a price.
  if (title && typeof opts.costCents === 'number' && Number.isFinite(opts.costCents) && opts.costCents >= 0) {
    out.cost_cents = Math.round(opts.costCents);
  }
  return out;
}
