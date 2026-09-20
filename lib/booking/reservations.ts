// ─── Booking a table, on the platform the restaurant actually uses ──────
// Reach does not take the reservation. The member does, on their own
// account, with their own card — which is the point: Amex opens doors on
// Resy, Chase does on OpenTable, and a booking made by us on our card throws
// all of that away.
//
// So Reach's job is to arrive at the right page with the date, the time and
// the party already filled in, and then to hear back whether it worked.
//
// The one rule that matters here: never send somebody to a platform the
// restaurant is not on. A search page that finds nothing is a small
// annoyance; "Reserve on Resy" for a place that has never been on Resy is
// the same lie as offering tickets to a wine bar.

export type Platform = 'resy' | 'opentable' | 'tock' | 'none';

export const PLATFORM_NAME: Record<Exclude<Platform, 'none'>, string> = {
  resy: 'Resy',
  opentable: 'OpenTable',
  tock: 'Tock',
};

/**
 * The card perk worth mentioning, if any.
 *
 * Advisory only, from a static list — no card of anybody's is read to decide
 * this. It is the reason the member books rather than us, so it is worth one
 * line under the button.
 */
export const PLATFORM_PERK: Record<string, string> = {
  resy: 'American Express cards unlock Resy tables at some restaurants.',
  opentable: 'Chase Sapphire cards unlock OpenTable Exclusive Tables at some restaurants.',
};

export interface TableRequest {
  /** The restaurant, as it is known to the platform. */
  name: string;
  city?: string | null;
  /** YYYY-MM-DD. */
  date?: string | null;
  /** 24-hour HH:MM. The itinerary sometimes stores prose; that is filtered. */
  time?: string | null;
  partySize?: number | null;
  /** A link the venue itself published, if the harvest found one. */
  knownUrl?: string | null;
}

/** "19:30" — anything else (like "Day 3 · Evening") is not a time. */
export function usableTime(value: string | null | undefined): string | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim());
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** A party of a sane size. Two is the honest default for a table. */
export function usableParty(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(20, Math.round(n));
}

/**
 * Where to send somebody to book this table.
 *
 * Returns null when we do not know the platform, which is a real answer:
 * the caller offers the phone number instead rather than guessing.
 */
export function reservationUrl(platform: Platform, req: TableRequest): string | null {
  if (platform === 'none') return null;
  // A link the restaurant published beats anything we can construct.
  if (req.knownUrl && /^https?:\/\//i.test(req.knownUrl)) return req.knownUrl;

  const name = (req.name || '').trim();
  if (!name) return null;
  const party = String(usableParty(req.partySize));
  const date = req.date || '';
  const time = usableTime(req.time);

  if (platform === 'resy') {
    // Resy's own search takes the query and the party; the date narrows it.
    const q = new URLSearchParams({ query: name, seats: party });
    if (date) q.set('date', date);
    return `https://resy.com/cities/search?${q.toString()}`;
  }

  if (platform === 'opentable') {
    const q = new URLSearchParams({ term: name, covers: party });
    // OpenTable wants the two together or neither.
    if (date && time) q.set('dateTime', `${date}T${time}`);
    return `https://www.opentable.com/s?${q.toString()}`;
  }

  // Tock has no documented search parameters worth guessing at, so this is
  // its search page and the name. Better than a constructed URL that 404s.
  return `https://www.exploretock.com/search?query=${encodeURIComponent(name)}`;
}

/** "Reserve on Resy" — the button, in the platform's own name. */
export function reserveLabel(platform: Platform): string {
  if (platform === 'none') return 'Call to book';
  return `Reserve on ${PLATFORM_NAME[platform]}`;
}

/**
 * Does this reservation cost anything up front?
 *
 * Almost none do: a table is held, not sold. Tock is the exception — its
 * prix-fixe and deposit bookings are paid at the time. That distinction
 * decides whether the amount belongs in the group's funding target or in the
 * ledger of who paid for what, so it is worth being explicit about.
 */
export function chargesUpfront(platform: Platform, priceCents?: number | null): boolean {
  return platform === 'tock' && !!priceCents && priceCents > 0;
}
