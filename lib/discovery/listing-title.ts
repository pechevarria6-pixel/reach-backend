// ─── An event whose title is only its venue's name ──────────────────────
// Discover showed a card titled "The Lounge at Martin Marietta Center for the
// Performing Arts" under that same venue (QA walk, 2026-11-05). A title that
// is the venue says where, never what, and the card already says where.
//
// So the title becomes what the listing itself says the event is — its own
// classification ("Comedy", "Arts & Theatre") — and where the listing says
// nothing more than the venue, the card is left out: there is no event on it
// we can name. Nothing is made up: both words are the source's.
//
// Pure, relative imports only.

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Classifications that say nothing about what the event is. */
const SAYS_NOTHING = new Set(['', 'event', 'events', 'other', 'misc', 'miscellaneous', 'undefined', 'general', 'things to do']);

/** Whether a title is only the venue's name (or the start of it, cut short). */
export function titleIsVenue(title: unknown, venue: unknown): boolean {
  const t = norm(title), v = norm(venue);
  if (!t || !v) return false;
  if (t === v) return true;
  // "The Lounge at Martin Marietta Center…" of the full name: a cut-short
  // copy, at least three words of it, so "The Lounge" alone of "The Lounge
  // Bar" is not read as one.
  return t.split(' ').length >= 3 && v.startsWith(`${t} `);
}

export interface TitledListing {
  title: string;
  venue?: string | null;
  category?: string | null;
  /** A one-off's date; a venue card (a place, not an event) has none. */
  date?: string | null;
  source?: string | null;
}

/**
 * The listing with a title that says what it is, or null when its own words
 * say nothing beyond the venue. Places (no date, not a ticketed source) are
 * left as they are: a place's title is its name.
 */
export function titledByListing<T extends TitledListing>(f: T): T | null {
  const isEvent = !!f.date || f.source === 'ticketmaster';
  if (!isEvent || !titleIsVenue(f.title, f.venue)) return f;
  const what = String(f.category ?? '').trim();
  if (SAYS_NOTHING.has(what.toLowerCase())) return null;
  return { ...f, title: what };
}
