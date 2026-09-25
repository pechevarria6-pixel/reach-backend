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
