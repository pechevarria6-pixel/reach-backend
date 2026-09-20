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

// ─── Working out which platform, from the restaurant's own page ─────────
// Google Places will tell you a restaurant is reservable. It will not tell
// you where, which is the only part we need: "Reserve on Resy" for a place
// that has never been on Resy is the lie this whole module exists to avoid.
//
// A restaurant's own site does say. They embed the widget or link the
// button, and that link is proof rather than inference. Checked against real
// pages before it was written: Poole's Diner reads opentable, Desert Bistro
// in Moab reads tock, and two small-town restaurants read none — which is
// the correct answer for places that take bookings by telephone.
const PLATFORM_HOSTS: [Exclude<Platform, 'none'>, RegExp][] = [
  ['resy', /resy\.com/i],
  ['opentable', /opentable\.(com|co\.uk)/i],
  ['tock', /exploretock\.com/i],
];

export interface PlatformFinding {
  platform: Platform;
  /** The booking page they linked, which always beats one we construct. */
  url: string | null;
}

/**
 * What a page says about where it takes bookings.
 *
 * Deliberately only looks for the platform's own domain. Matching the word
 * "resy" anywhere would find it in "nursery" and in prose about somebody's
 * reservation policy; a link to resy.com is a fact.
 */
export function platformFromHtml(html: string | null | undefined): PlatformFinding {
  const text = String(html ?? '');
  if (!text) return { platform: 'none', url: null };

  for (const [platform, host] of PLATFORM_HOSTS) {
    if (!host.test(text)) continue;
    // The specific link, if one is sitting in an href.
    const href = new RegExp(`https?://[^"'\\s<>]*${host.source}[^"'\\s<>]*`, 'i').exec(text);
    return { platform, url: href ? href[0].replace(/&amp;/g, '&') : null };
  }
  return { platform: 'none', url: null };
}

/** The number somebody rings when there is no platform at all. */
export function phoneFromHtml(html: string | null | undefined): string | null {
  const text = String(html ?? '');
  const tel = /href=["']tel:([+0-9()\-.\s]{7,})["']/i.exec(text);
  if (!tel) return null;
  const cleaned = tel[1].replace(/[^\d+]/g, '');
  return cleaned.length >= 7 ? cleaned : null;
}


// ─── How a restaurant takes a booking, if it takes one at all ───────────
// "No third-party platform" is not the same as "no reservations", and the
// first version of this treated them as one thing: every restaurant without
// a Resy link was offered as "Call to book", which is a guess about a place
// that may not take bookings at all.
//
// Read off real pages in Southern Pines, Raleigh and Moab before this was
// written. What they actually say:
//
//   Valenti's       "For Reservations … join waitlist"  → a waitlist, not a table
//   Poole's Diner   a "Reservations" nav link → their page, which is OpenTable
//   Desert Bistro   "Make a Reservation" → their page, which is Tock
//   Casa Santa Ana  a telephone number and online ordering, nothing else
//
// The last of those is the common case and the honest answer for it is the
// number, not a claim about whether they hold tables.
export type ReservationMethod =
  | 'third_party'   // Resy, OpenTable, Tock — book on that platform
  | 'own_form'      // their own booking page
  | 'waitlist'      // you join a queue on the day, you do not hold a table
  | 'phone'         // they say reservations and give a number
  | 'walk_in'       // they say plainly that they do not take bookings
  | 'unknown';      // nothing on the page settles it

export interface ReservationFinding {
  method: ReservationMethod;
  platform: Platform;
  /** Where to go: the platform, their form, or the waitlist. */
  url: string | null;
  phone: string | null;
}

/** Said plainly enough to be believed. */
const NO_BOOKINGS = /(we (do not|don't) (take|accept) reservations|no reservations (are )?(taken|accepted)|walk[- ]?ins? only|first[- ]come,? first[- ]served)/i;
const WAITLIST = /(join (the )?waitlist|waitlist only|add your name)/i;
/** A link to their own booking page — by its address or by its words. */
const OWN_FORM = /href=["']([^"']*\/(reservations?|reserve|book[a-z-]*|bookings?)[^"']*)["']/i;
/**
 * The page pairing a booking with a telephone, in so many words. The earlier
 * version accepted a number anywhere on a page that said "reservation"
 * anywhere else, which is two facts sitting near each other rather than one
 * fact. "Call 910-555-0100 for reservations" is the claim; a number in a
 * footer under a page that mentions a reservation policy is not.
 */
const PHONE_BOOKING = /(for reservations[^.<]{0,40}?(call|ring|phone|telephone)|(call|ring|phone|telephone)[^.<]{0,40}?(for|to (make|book))[^.<]{0,20}?(a )?reservation|reservations?[:\s]{1,4}(\+?[\d()\-.\s]{9,})|to (book|reserve)[^.<]{0,30}?(call|phone))/i;

/** A link to their own booking page, which is worth following. */
const FOLLOW_FORM = /href=["']([^"']*\/(reservations?|reserve|book[a-z-]*|bookings?)[^"']*)["']/i;

/**
 * Everything needed to get a table here, or the honest absence of it.
 *
 * Order matters and is not arbitrary. A link to Resy is proof and outranks
 * everything. A waitlist comes next because a page can say "For Reservations:
 * join waitlist" — as Valenti's does — and reading that as a booking form
 * would send somebody expecting a held table to a queue. An explicit refusal
 * beats an inference. A number with reservation language beside it is a phone
 * booking; a number on its own is just a number, and saying "call to book"
 * about a place that may not take bookings is the guess this exists to stop.
 */
export function reservationFromHtml(html: string | null | undefined): ReservationFinding {
  const text = String(html ?? '');
  const phone = phoneFromHtml(text);
  if (!text) return { method: 'unknown', platform: 'none', url: null, phone };

  const third = platformFromHtml(text);
  if (third.platform !== 'none') {
    return { method: 'third_party', platform: third.platform, url: third.url, phone };
  }

  if (WAITLIST.test(text)) return { method: 'waitlist', platform: 'none', url: null, phone };
  if (NO_BOOKINGS.test(text)) return { method: 'walk_in', platform: 'none', url: null, phone };

  const form = OWN_FORM.exec(text);
  if (form) {
    return { method: 'own_form', platform: 'none', url: form[1].replace(/&amp;/g, '&'), phone };
  }

  if (phone && PHONE_BOOKING.test(text)) return { method: 'phone', platform: 'none', url: null, phone };

  // Nothing here settles it. That is not an answer to hand a traveller —
  // "call to book" about a place that may not take bookings is exactly the
  // guess this module exists to refuse. It is recorded as unresolved so Reach
  // goes and finds out, and the screen says nothing until it has.
  return { method: 'unknown', platform: 'none', url: null, phone };
}

/**
 * Whether a finding is something to act on, or something to go and settle.
 *
 * The line: proof on the page, versus two facts near each other. Only the
 * first reaches a traveller.
 */
export function isCertain(finding: ReservationFinding): boolean {
  return finding.method !== 'unknown';
}

/** Where a page points for its own booking, so the crawl can follow it. */
export function bookingPageLink(html: string | null | undefined, base: string): string | null {
  const m = FOLLOW_FORM.exec(String(html ?? ''));
  if (!m) return null;
  try {
    return new URL(m[1].replace(/&amp;/g, '&'), base).toString();
  } catch {
    return null;
  }
}

/**
 * Settling it, rather than inferring it.
 *
 * A restaurant's front page often says only "Reservations" and links
 * elsewhere — Poole's Diner does, and that link is where the OpenTable widget
 * actually lives. Reading the front page alone would have called that an own
 * form when it is OpenTable, so the booking page is fetched too and the
 * stronger answer wins. One extra request per restaurant, once, on a
 * schedule; never while somebody is waiting.
 */
export async function resolveReservation(
  website: string,
  read: (url: string) => Promise<string | null>,
): Promise<ReservationFinding> {
  const home = await read(website);
  const first = reservationFromHtml(home);
  // A platform link on the front page is already proof.
  if (first.method === 'third_party') return first;

  const link = bookingPageLink(home, website);
  if (!link) return first;

  const page = await read(link);
  if (!page) return first;

  const second = reservationFromHtml(page);
  if (second.method === 'third_party') return { ...second, phone: second.phone ?? first.phone };
  // Their own page, confirmed by having one — the link is where to send them.
  if (first.method === 'own_form' || second.method === 'own_form') {
    return { method: 'own_form', platform: 'none', url: link, phone: first.phone ?? second.phone };
  }
  if (second.method !== 'unknown') return { ...second, phone: second.phone ?? first.phone };
  return first;
}

/** What the button says, for each way in. */
export function methodLabel(method: ReservationMethod, platform: Platform): string {
  if (method === 'third_party' && platform !== 'none') return `Reserve on ${PLATFORM_NAME[platform]}`;
  if (method === 'own_form') return 'Book on their site';
  if (method === 'waitlist') return 'Join their waitlist';
  if (method === 'phone') return 'Call to book';
  if (method === 'walk_in') return 'Just turn up';
  return 'See their page';
}

/** The sentence under it, which is where the honesty lives. */
export function methodNote(method: ReservationMethod, phone: string | null): string {
  switch (method) {
    case 'third_party': return 'You book it on their platform, with your own card.';
    case 'own_form': return 'They take bookings on their own site.';
    case 'waitlist': return 'They hold no tables — you put your name down on the day.';
    case 'phone': return phone ? `They book by phone: ${phone}` : 'They book by telephone.';
    case 'walk_in': return 'They do not take bookings — turn up and wait for a table.';
    // Deliberately not "call to book": we do not know that they take
    // bookings, and saying so would hand somebody our uncertainty to resolve
    // at the door. Reach settles this and the line changes when it has.
    default: return 'We are checking how this one takes bookings.';
  }
}
