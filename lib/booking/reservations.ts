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

import {
  LINK_PLATFORMS, linksIn, ownBookingUrl, platformBookingUrl, platformOfHost,
  type LinkPlatform,
} from './booking-links.ts';

/**
 * SevenRooms, Yelp and TheFork arrive with sql/reservation-coverage-2026-11-04.sql,
 * which widens the column's check. Until it runs the database refuses them
 * and the platforms cron leaves those restaurants unsettled rather than
 * filing them under a platform they are not on.
 */
export type Platform = LinkPlatform | 'none';

export const PLATFORM_NAME: Record<Exclude<Platform, 'none'>, string> = {
  resy: 'Resy',
  opentable: 'OpenTable',
  tock: 'Tock',
  sevenrooms: 'SevenRooms',
  yelp: 'Yelp',
  thefork: 'TheFork',
};

/** The platforms the database accepted before 2026-11-04. */
export const FIRST_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(['resy', 'opentable', 'tock', 'none']);

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
  // A link the restaurant published beats anything we can construct — once
  // it is checked. Rows stored before 2026-11-04 include a stylesheet and
  // Resy links that open on a night in 2022; a stored link that names no
  // restaurant is passed over for the search below rather than handed on.
  // A link that is kept carries this line's night, not its own (datedLink).
  const known = usableStoredUrl(platform, req.knownUrl);
  if (known) return datedLink(withNightKeys(String(req.knownUrl), known), req);
  // Only the three platforms with a search page we know the shape of get a
  // constructed link. SevenRooms, Yelp and TheFork are reached through the
  // restaurant's own link or not at all; a guessed URL that 404s is the
  // same dead end as no link, with a worse feeling.
  if (platform !== 'resy' && platform !== 'opentable' && platform !== 'tock') return null;

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

/**
 * A published booking link, carrying this table's night rather than its own.
 *
 * Restaurants link their Resy or OpenTable page with whatever date was in the
 * address bar when somebody copied it: Rosie's and Nick's are stored with
 * 2022 and 2025 dates in them. Handed over as it is, the person lands on a
 * night long gone — or worse, on a real night that is not theirs. Only the
 * date, time and party parameters a link already carries are touched: set to
 * this line's when we know them, removed when we do not, so the page asks
 * rather than showing a stale night. Every other link is returned untouched.
 */
export function datedLink(url: string, req: Pick<TableRequest, 'date' | 'time' | 'partySize'>): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.date ?? '')) ? String(req.date) : null;
  const time = usableTime(req.time);
  const party = req.partySize ? String(usableParty(req.partySize)) : null;
  const q = u.searchParams;
  // A night we do not know takes the stale one out; a party we do not know
  // leaves theirs alone — two seats is a guess, not a stale fact.
  const put = (k: string, v: string | null, dropIfUnknown = true) => {
    if (!q.has(k)) return;
    if (v) q.set(k, v); else if (dropIfUnknown) q.delete(k);
  };
  if (/(^|\.)resy\.com$/i.test(u.hostname)) {
    put('date', date);
    put('seats', party, false);
  } else if (/(^|\.)opentable\.(com|co\.uk)$/i.test(u.hostname)) {
    put('dateTime', date && time ? `${date}T${time}` : null);
    put('datetime', date && time ? `${date}T${time}` : null);
    put('covers', party, false);
  } else {
    return url;
  }
  return u.toString();
}

/**
 * The night parameters the published link carried, put back on the cleaned
 * one so datedLink can move them onto this line's night. Cleaning takes a
 * stale date out (usableStoredUrl); this is what lets the line's own date
 * go back in where the restaurant's link had a place for one.
 */
function withNightKeys(original: string, cleaned: string): string {
  let from: URL; let to: URL;
  try { from = new URL(original); to = new URL(cleaned); } catch { return cleaned; }
  if (from.hostname !== to.hostname) return cleaned;
  for (const k of ['date', 'seats', 'dateTime', 'datetime', 'covers']) {
    const v = from.searchParams.get(k);
    if (v !== null && !to.searchParams.has(k)) to.searchParams.set(k, v);
  }
  return to.toString();
}

/**
 * A stored booking link, if it is still one worth sending somebody to: a
 * restaurant on this platform with yesterday's search taken out, or the
 * restaurant's own page. The rows written before booking-links.ts existed
 * are read through this, so they are corrected without a migration.
 */
export function usableStoredUrl(
  platform: Platform,
  stored: string | null | undefined,
  /** The venue's website, when the caller holds it: then an own page must be on it (or a booking engine). */
  website?: string | null,
): string | null {
  const raw = String(stored ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  let host: string;
  try { host = new URL(raw).hostname; } catch { return null; }
  if (platformOfHost(host)) {
    const found = platformBookingUrl(raw);
    return found && (platform === 'none' || found.platform === platform) ? found.url : null;
  }
  return ownBookingUrl(raw, website || raw);
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
export interface PlatformFinding {
  platform: Platform;
  /** The booking page they linked, which always beats one we construct. */
  url: string | null;
}

/** Resy and SevenRooms widgets name the restaurant in script, not in a link. */
const RESY_WIDGET = /resyWidget\.addButton\([\s\S]{0,300}?venueId["']?\s*:\s*["']?(\d+)/i;
const SEVENROOMS_WIDGET = /SevenroomsWidget\.init\(\s*\{[^}]*venueId\s*:\s*["']([a-z0-9_-]+)["']/i;

/**
 * What a page says about where it takes bookings.
 *
 * Only a link that names one restaurant on the platform counts. Matching the
 * word "resy" anywhere would find it in "nursery"; matching the domain
 * anywhere found "https://widgets.resy.com" — Resy's script, naming nobody —
 * and stored it as Mission on the Bay's booking page. A widget that carries
 * the restaurant's id in its config is proof of the platform even with no
 * link, and then the link is left empty rather than invented.
 */
export function platformFromHtml(html: string | null | undefined, base?: string, name?: string | null): PlatformFinding {
  const text = String(html ?? '');
  if (!text) return { platform: 'none', url: null };
  const links = linksIn(text);

  for (const platform of LINK_PLATFORMS) {
    for (const raw of links) {
      const found = platformBookingUrl(raw, base, name);
      if (found && found.platform === platform) return { platform, url: found.url };
    }
  }
  const unescaped = text.replace(/\\\//g, '/');
  if (RESY_WIDGET.test(unescaped)) return { platform: 'resy', url: null };
  const seven = SEVENROOMS_WIDGET.exec(unescaped);
  if (seven) return { platform: 'sevenrooms', url: `https://www.sevenrooms.com/reservations/${seven[1]}` };
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
/**
 * The page pairing a booking with a telephone, in so many words. The earlier
 * version accepted a number anywhere on a page that said "reservation"
 * anywhere else, which is two facts sitting near each other rather than one
 * fact. "Call 910-555-0100 for reservations" is the claim; a number in a
 * footer under a page that mentions a reservation policy is not.
 */
const PHONE_BOOKING = /(for reservations[^.<]{0,40}?(call|ring|phone|telephone)|(call|ring|phone|telephone)[^.<]{0,40}?(for|to (make|book))[^.<]{0,20}?(a )?reservation|reservations?[:\s]{1,4}(\+?[\d()\-.\s]{9,})|to (book|reserve)[^.<]{0,30}?(call|phone))/i;

/**
 * Their own booking page: the first href that is about tables, on their own
 * site or a booking engine (booking-links.ts says which). Not a stylesheet,
 * not "/book-an-event", not a hotel's room booking.
 */
function ownFormIn(html: string, base?: string): string | null {
  for (const m of html.matchAll(/href\s*=\s*["']([^"']{1,600})["']/gi)) {
    const url = ownBookingUrl(m[1], base);
    if (url) return url;
  }
  return null;
}

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
export function reservationFromHtml(html: string | null | undefined, base?: string, name?: string | null): ReservationFinding {
  const text = String(html ?? '');
  const phone = phoneFromHtml(text);
  if (!text) return { method: 'unknown', platform: 'none', url: null, phone };

  const third = platformFromHtml(text, base, name);
  if (third.platform !== 'none') {
    return { method: 'third_party', platform: third.platform, url: third.url, phone };
  }

  if (WAITLIST.test(text)) return { method: 'waitlist', platform: 'none', url: null, phone };
  if (NO_BOOKINGS.test(text)) return { method: 'walk_in', platform: 'none', url: null, phone };

  const form = ownFormIn(text, base);
  if (form) return { method: 'own_form', platform: 'none', url: form, phone };

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
  return ownFormIn(String(html ?? ''), base);
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
  /** The restaurant's name, so a link to a different restaurant on the platform is not taken for theirs. */
  name?: string | null,
): Promise<ReservationFinding> {
  const home = await read(website);
  const first = reservationFromHtml(home, website, name);
  // A platform link on the front page is already proof.
  if (first.method === 'third_party') return first;

  const link = bookingPageLink(home, website);
  if (!link) return first;

  const page = await read(link);
  if (!page) return first;

  const second = reservationFromHtml(page, link, name);
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

/**
 * The four answers a person needs, from the five ways in: book it online
 * (on a platform or their own page), ring them, just turn up, or Reach does
 * not know yet. A waitlist is turning up with your name down, not a table.
 * "unknown" is never stored — it is a null, asked again on a schedule.
 */
export type BookingChannel = 'online' | 'phone' | 'walk_in' | 'unknown';

export function bookingChannel(method: ReservationMethod | null | undefined): BookingChannel {
  if (method === 'third_party' || method === 'own_form') return 'online';
  if (method === 'phone') return 'phone';
  if (method === 'walk_in' || method === 'waitlist') return 'walk_in';
  return 'unknown';
}
