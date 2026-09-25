// ─── What counts as a category worth showing ────────────────────────────
// Discover builds its filter pills from whatever categories come back, and
// a pill reading "Undefined" appeared in production between "Sports" and
// "Wine tasting". The cause was not a bug in our mapping: Ticketmaster's own
// word for an unclassified event is the literal string "Undefined". The
// guard that was meant to catch it, `|| 'Event'`, never fired, because a
// non-empty string is truthy.
//
// Any provider can send us one of these, so the rule lives in one place
// rather than being remembered at each call site.

/**
 * Words that are a provider saying "we don't know", not a category.
 *
 * Deliberately short. "Other" is not here: plenty of catalogues use it as a
 * real label, and dropping its pill would make those things harder to find
 * for the sake of tidiness. This list is only the ones that are machine
 * noise in any language — a null that became a string somewhere upstream.
 */
const NOT_A_CATEGORY = new Set(['undefined', 'null', 'nil', 'n/a', '-']);

/**
 * The category, or null when the value is a provider's way of saying it has
 * none. Null rather than a substitute, so the caller decides what an
 * unclassified thing should be called in its own context.
 */
export function usableCategory(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (NOT_A_CATEGORY.has(text.toLowerCase())) return null;
  return text;
}

/**
 * The filter pills for a set of items: every category that is real and has
 * something behind it, in alphabetical order. A tab with nothing under it is
 * a dead end, and a tab with no name is worse.
 */
export function visibleCategories(items: { category?: unknown }[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items ?? []) {
    const category = usableCategory(item?.category);
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => a.localeCompare(b));
}

// ─── Copy that belongs to a different kind of place ─────────────────────
// Plan f979c880 said "End the night at SPIN, a bar with … a Friday-night
// pace good for dancing", and under it a tip about how far apart the
// monuments on the Mall are. The row we hold for SPIN says a bar, "cocktail
// bars", 1332 F Street Northwest, and nothing else. Nothing we hold says
// anybody dances there, and the monuments belonged to the morning.
//
// The name check (withoutUnverified) could not see this: every name in the
// line was on the menu. What was wrong was what the line said ABOUT the
// name. So each line that cites a place is read against that place's own
// row, and a topic nothing in the row supports is a claim we cannot make.
//
// Deterministic on purpose, not a model asked "does this fit?". A model's
// yes certifies nothing in this codebase's sense; a word list either finds
// the word or it does not, and anybody can read why a line was dropped.
// The list only ever takes copy away. A line it lets through is not thereby
// verified — it is merely not caught saying something of the wrong kind.

/** The parts of a held row a line is read against. */
export interface Describable {
  name: string;
  kind: string;
  interest?: string | null;
  street?: string | null;
  /** What is on there, in the venue's own words — it vouches as the row does. */
  whatsOn?: string[];
}

/**
 * Topics a line can assert about a place, and what in the row would have
 * to say so before we may.
 *
 * Each `says` is the words that make the assertion; each `fits` is read
 * against the row's own name, kind, interest and listings. A bar named
 * "Ping Pong Club" may be said to have ping-pong; a bar filed as "cocktail
 * bars" may not, whatever its name suggests to somebody who has been.
 */
const TOPICS: { topic: string; says: RegExp; fits: RegExp }[] = [
  // Dancing and DJs are a nightclub's, or a listing's ("DJ night — Fri").
  { topic: 'dancing', says: /\b(danc(e|es|ed|ing)|dance ?floors?|djs?|clubbing)\b/i, fits: /night ?club|\bclub\b|danc|disco|\bdj/i },
  { topic: 'ping-pong', says: /\b(ping[- ]?pong|table[- ]tennis)\b/i, fits: /ping[- ]?pong|table[- ]tennis/i },
  { topic: 'rooftop', says: /\b(roof ?tops?|roof terraces?|skyline views?)\b/i, fits: /roof/i },
  // Monuments are the Mall's, not a cocktail bar's.
  { topic: 'monuments', says: /\b(monuments?|memorials?)\b/i, fits: /monument|memorial|histor|landmark|attraction|viewpoint|archaeolog|castle|ruins?\b/i },
  { topic: 'exhibits', says: /\b(exhibits?|exhibitions?|galler(y|ies)|paintings?|sculptures?|artworks?|collections?)\b/i, fits: /museum|galler|\bart|exhibit|histor|arts? cent/i },
  { topic: 'trails', says: /\b(hik(e|es|ed|ing)|trails?|trailheads?|summit)\b/i, fits: /park|trail|nature|outdoor|peak|reserve|forest|mountain|canyon|viewpoint|hik|beach|garden/i },
  { topic: 'live music', says: /\b(live music|live bands?|the band|gigs?|concerts?)\b/i, fits: /music|concert|theat|venue|night ?club|jazz|\bclub\b|stage|arts? cent|gig|band|opera|live/i },
  // A museum does not pour pints, as far as anything we hold says.
  { topic: 'drinks', says: /\b(cocktails?|pints?|craft beers?|beers? on tap|wine list|happy hour|nightcap)\b/i, fits: /\bbars?\b|pub|brew|wine|cocktail|restaurant|distill|tavern|lounge|taproom|night|cafe|biergarten|food|\beat|winery/i },
];

/** Everything the row itself says about what the place is. */
function rowText(place: Describable): string {
  return [place.name, place.kind, place.interest ?? '', ...(place.whatsOn ?? [])].join(' ');
}

/**
 * The topics this text asserts that nothing in the place's row supports.
 *
 * Empty means nothing was caught, which is not the same as the text being
 * true. A non-empty answer is enough to stop the line going out as written.
 */
export function misfits(text: unknown, place: Describable | null | undefined): string[] {
  if (!place) return [];
  // The place's own name is not something said about it: "Dinner at Summit
  // Grill" makes no claim about a summit.
  const name = String(place.name || '').trim();
  const t = name
    ? String(text ?? '').replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
    : String(text ?? '');
  if (!t.trim()) return [];
  const row = rowText(place);
  return TOPICS.filter(({ says, fits }) => says.test(t) && !fits.test(row)).map(({ topic }) => topic);
}

/**
 * A line about a place built only from its row: its name, its kind and its
 * street, as stored.
 *
 *   "SPIN · Bar · 1332 F Street Northwest"
 *
 * No neighbourhood, because the row holds a street and not a district, and
 * guessing the district is how "a bar in Shaw" would have put a Downtown
 * bar a mile and a half away. No hours, because the map's hours are a
 * volunteer's note and never ours to state. Duller than what the model
 * wrote, and every word of it is something we hold.
 */
export function neutralLine(place: Describable): string {
  const kind = String(place.kind || '').replace(/_/g, ' ').trim();
  const label = kind && kind !== 'place' ? kind[0].toUpperCase() + kind.slice(1) : '';
  return [place.name, label, String(place.street || '').trim()].filter(Boolean).join(' · ');
}

// ─── Which part of a line is about the place ────────────────────────────
// misfits() reads a whole text as a claim about one place, which is right
// for "End the night at SPIN, … good for dancing" and wrong for "Breakfast
// at Love Muffin before the hike": the hike is the day, not the cafe. Wiping
// that line to "Love Muffin · Cafe" took the shape of the day away and said
// nothing more true about the cafe, so the read-back scopes it first.
//
// A line is cut where it moves on to something else — "before", "after",
// "then", "ahead of", "on the way to", "followed by" — and nowhere else.
// Commas and dashes are not cuts: "SPIN, a bar … good for dancing" is one
// claim about SPIN. The lead part is about the place; so is any later part
// that names it or points back at it ("dancing there", "its rooftop").
// Everything else is about the thing the line moves on to, is not read
// against this place, and tells the rest of the day what the day holds.
//
// A tip or a reason (`because`) is cut the same way and at sentences too. A
// part that names or points at the place is read against the place. A part
// that does not may only mention what the day's own lines already moved on
// to: "the trail has no water" under the cafe of a day that heads out on a
// hike is about the hike; "the dance floor fills late" under a bar, on a day
// that holds no dancing anywhere, is about the bar and is not ours to say.

const MOVES_ON = /\b(?:before|after(?:wards)?|then|ahead of|on (?:the|your) way (?:to|back)|followed by|en route to)\b/i;
const POINTS_BACK = /\b(?:here|its|inside|there(?!\s+(?:is|are|was|were|'s|’s)\b)|this (?:spot|place|bar|venue|cafe|restaurant|museum|room))\b/i;

function mentions(text: string, name: string): boolean {
  if (!name) return false;
  return new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i').test(text);
}

function aboutIt(part: string, name: string): boolean {
  return mentions(part, name) || POINTS_BACK.test(part.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '));
}

/** The topics a text raises at all, whatever it raises them about. */
export function topicsIn(text: unknown): string[] {
  const t = String(text ?? '');
  return TOPICS.filter(({ says }) => says.test(t)).map(({ topic }) => topic);
}

/**
 * A plan line read against the place it cites, only where it speaks of that
 * place. Returns what it caught, and the topics of the parts that moved on to
 * something else — which is what the day holds besides this place.
 */
export function lineMisfits(text: unknown, place: Describable | null | undefined): { wrong: string[]; elsewhere: string[] } {
  const t = String(text ?? '');
  if (!place || !t.trim()) return { wrong: [], elsewhere: [] };
  const name = String(place.name || '').trim();
  const parts = t.split(new RegExp(MOVES_ON.source, 'i'));
  const wrong = new Set<string>();
  const elsewhere = new Set<string>();
  parts.forEach((part, i) => {
    if (i === 0 || aboutIt(part, name)) for (const w of misfits(part, place)) wrong.add(w);
    else for (const w of topicsIn(part.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '))) elsewhere.add(w);
  });
  return { wrong: [...wrong], elsewhere: [...elsewhere] };
}

/**
 * A tip or a reason read against its slot's place. A part that names the
 * place or points back at it must fit the place; a part that does neither
 * must fit the place or be something the day already holds (`dayHolds`).
 */
export function asideMisfits(text: unknown, place: Describable | null | undefined, dayHolds: Iterable<string>): string[] {
  const t = String(text ?? '');
  if (!place || !t.trim()) return [];
  const name = String(place.name || '').trim();
  const holds = new Set(dayHolds);
  const parts = t.split(new RegExp(`${MOVES_ON.source}|[.;!?](?:\\s|$)`, 'i'));
  const wrong = new Set<string>();
  for (const part of parts) {
    if (!part || !part.trim()) continue;
    const caught = misfits(part, place);
    for (const w of caught) if (aboutIt(part, name) || !holds.has(w)) wrong.add(w);
  }
  return [...wrong];
}
