// ─── Is this link somewhere a person can book a table? ──────────────────
// The first harvest kept the first URL on a page that mentioned a platform,
// or the first href whose path began "/reserv…", and stored it as where to
// book. Read back on 2026-11-04, the rows it wrote included:
//
//   Ronnie Sushi       https://ronniesushi.com/files/reserve-css.css
//   DayBeds            a cloudbeds HOTEL booking page
//   Transfer Co.       /book-an-event
//   Peppe Pizzeria     https://bookings.zenchef.com/   (no restaurant in it)
//   Mission on the Bay https://widgets.resy.com        (no restaurant in it)
//   Rosie's, Nick's    Resy links carrying a date from 2022
//
// Each would have been handed to somebody as "Book on their site". So a link
// is kept only when it names one restaurant on one platform (or is the
// restaurant's own page, on its own site, about tables), and a date somebody
// else searched for is taken out of it.
//
// Nothing here fetches anything. It reads links the restaurant published.

export type LinkPlatform = 'resy' | 'opentable' | 'tock' | 'sevenrooms' | 'yelp' | 'thefork';

/** The order a page is read in when it links more than one. */
export const LINK_PLATFORMS: LinkPlatform[] = ['resy', 'opentable', 'tock', 'sevenrooms', 'yelp', 'thefork'];

const HOSTS: Record<LinkPlatform, RegExp> = {
  resy: /(^|\.)resy\.com$/i,
  opentable: /(^|\.)opentable\.(com|co\.uk|ca|com\.au|de|jp|ie|com\.mx|es|it|nl|ae|sg|hk)$/i,
  tock: /(^|\.)exploretock\.com$/i,
  sevenrooms: /(^|\.)sevenrooms\.com$/i,
  yelp: /(^|\.)yelp\.(com|ca|co\.uk)$/i,
  thefork: /(^|\.)(thefork\.[a-z.]+|lafourchette\.com|eltenedor\.[a-z.]+)$/i,
};

/** A file, not a page. Ronnie Sushi's "/files/reserve-css.css" was stored as a booking link. */
const ASSET = /\.(css|js|mjs|json|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|pdf|xml|txt|mp4|webm)$/i;

/** OpenTable paths that are the site, not a restaurant on it. */
const OT_NOT_A_VENUE = new Set([
  's', 'search', 'start', 'landing', 'metro', 'region', 'neighborhood', 'cuisine', 'about', 'careers', 'legal',
  'info', 'gift-cards', 'giftcards', 'blog', 'c', 'm', 'lists', 'restaurant-solutions', 'widget', 'booking',
  'restref', 'my', 'user', 'login', 'sign-in', 'privacy-policy', 'terms-and-conditions', 'dining-rewards',
]);
const TOCK_NOT_A_VENUE = new Set(['', 'search', 'city', 'explore', 'tock', 'about', 'login', 'signup', 'gift-cards', 'business', 'static']);

/** The platform a URL's host belongs to, whether or not it names a restaurant. */
export function platformOfHost(host: string): LinkPlatform | null {
  for (const p of LINK_PLATFORMS) if (HOSTS[p].test(host)) return p;
  return null;
}

/** A query parameter by name, whatever its case: Miso Phat Sushi's link spells it "restRef". */
function param(url: URL, name: string): string | null {
  for (const [k, v] of url.searchParams) if (k.toLowerCase() === name) return v;
  return null;
}

function parse(raw: string, base?: string): URL | null {
  const text = String(raw || '').trim().replace(/&amp;/g, '&').replace(/&#0?38;/g, '&');
  if (!text) return null;
  try {
    const url = new URL(text.startsWith('//') ? `https:${text}` : text, base);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Whether this URL is one restaurant on its platform — the thing a person
 * can book from — rather than the platform's home page, its search, or the
 * script that draws its widget.
 */
export function namesAVenue(platform: LinkPlatform, url: URL): boolean {
  if (ASSET.test(url.pathname)) return false;
  const parts = url.pathname.split('/').filter(Boolean);
  switch (platform) {
    case 'resy':
      return /^\/cities\/[^/]+\/(venues\/)?[^/]+/i.test(url.pathname)
        || /#\/venues\/[^/?]+/i.test(url.hash) || /^\d+$/.test(param(url, 'venueid') ?? '');
    case 'opentable':
      if (/^\d+$/.test(param(url, 'rid') ?? '') || /^\d+$/.test(param(url, 'restref') ?? '')) return true;
      if (parts[0] === 'r' && parts[1]) return true;
      return parts.length === 1 && parts[0].includes('-') && !OT_NOT_A_VENUE.has(parts[0].toLowerCase());
    case 'tock':
      return !!parts[0] && !TOCK_NOT_A_VENUE.has(parts[0].toLowerCase());
    case 'sevenrooms':
      return /^\/(reservations|explore)\/[^/]+/i.test(url.pathname);
    case 'yelp':
      // A /biz page is somebody's review of the place, not a table.
      return /^\/reservations\/[^/]+/i.test(url.pathname);
    case 'thefork':
      if (/^widget\.|^module\./i.test(url.hostname)) return parts.some(p => /^[0-9a-f-]{20,}$/i.test(p));
      return /\/(restaurant|restaurante|ristorante|restaurang|restaurace|restauracja)\/[^/]+/i.test(url.pathname);
  }
}

/** The restaurant's name as the platform spells it in the link, when it does. */
export function slugOf(platform: LinkPlatform, url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const pick = (() => {
    switch (platform) {
      case 'resy': return parts[0] === 'cities' ? (parts[2] === 'venues' ? parts[3] : parts[2]) : null;
      case 'opentable': return parts[0] === 'r' ? parts[1] : parts.length === 1 ? parts[0] : null;
      case 'tock': return parts[0];
      case 'sevenrooms': return parts[1];
      case 'yelp': return parts[1];
      case 'thefork': {
        const i = parts.findIndex(p => /^(restaurant|restaurante|ristorante|restaurang|restaurace|restauracja)$/i.test(p));
        return i >= 0 ? parts[i + 1] : null;
      }
    }
  })();
  return pick ? decodeURIComponent(pick) : null;
}

/** Words in a restaurant's name that say nothing about which restaurant. */
const GENERIC = new Set([
  'the', 'and', 'restaurant', 'restaurante', 'ristorante', 'bar', 'grill', 'cafe', 'kitchen', 'house', 'bistro',
  'dining', 'room', 'eatery', 'tavern', 'pub', 'steakhouse', 'pizzeria', 'trattoria', 'sushi', 'thai', 'indian',
  'italian', 'mexican', 'chinese', 'japanese', 'french', 'cuisine', 'lounge', 'club', 'company', 'reservations',
]);

const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`]/g, '');

/**
 * Whether a platform's slug can be this restaurant. Cascina Doss's page links
 * OpenTable's "ikoyi-reservations-london" — a different restaurant in a
 * different country — and that is not where Cascina Doss takes bookings.
 * One distinctive word of the name in the slug is enough ("mulino" in
 * "mulino-reservations-raleigh", "pizzapunks" in "pizzapunksglasgow"). A
 * link with no slug (an OpenTable id, a TheFork widget id) or a name with no
 * Latin letters to compare cannot be checked this way and is not refused.
 */
export function slugFits(slug: string | null, name: string): boolean {
  if (!slug) return true;
  const s = plain(slug).replace(/[^a-z0-9]/g, '');
  const words = plain(name).split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  if (!words.length || !s) return true;
  const distinctive = words.filter(w => !GENERIC.has(w));
  if (s.includes(words.join(''))) return true;
  return (distinctive.length ? distinctive : words).some(w => s.includes(w));
}

/**
 * The query parameters that are one person's search, not the restaurant.
 * Rosie's Resy link carried a date in 2022; a link that opens on a day long
 * gone is worse than one that opens on today.
 */
const SEARCH_STATE = /^(date|datetime|day|time|covers|seats|party|partysize|party_size|people|persons|guests|correlationid|corrid|searchdatetime|ot_?source|utm_[a-z]+)$/i;

export function withoutSearchState(url: URL): string {
  const stale = [...url.searchParams.keys()].filter(k => SEARCH_STATE.test(k));
  const out = new URL(url.toString());
  for (const k of stale) out.searchParams.delete(k);
  return out.toString();
}

/**
 * A platform URL a person can book from, cleaned — or null.
 *
 * OpenTable's widget is drawn by a script (`/widget/reservation/loader?rid=…`)
 * that names the restaurant but is not a page. Its restaurant id is turned
 * into OpenTable's own booking page, in the shape restaurants already link
 * (Miso Phat Sushi's site and Mr. Tuna's OpenStreetMap entry both publish
 * `opentable.com/booking/restref/availability?rid=…`). That is the one link
 * here that is built rather than copied, and it is built only from an id the
 * restaurant itself published.
 */
export function platformBookingUrl(
  raw: string,
  base?: string,
  /** The restaurant this is meant to be. A link to a different one on the same platform is not theirs. */
  name?: string | null,
): { platform: LinkPlatform; url: string } | null {
  const url = parse(raw, base);
  if (!url) return null;
  const platform = platformOfHost(url.hostname);
  if (!platform || !namesAVenue(platform, url)) return null;
  if (name && !slugFits(slugOf(platform, url), name)) return null;
  if (platform === 'opentable' && /\/widget\//i.test(url.pathname)) {
    const rid = param(url, 'rid') ?? param(url, 'restref');
    return rid && /^\d+$/.test(rid)
      ? { platform, url: `https://www.opentable.com/booking/restref/availability?rid=${rid}&restref=${rid}` }
      : null;
  }
  return { platform, url: withoutSearchState(url) };
}

// ─── The restaurant's own booking page ──────────────────────────────────
/** A path about tables. */
const ABOUT_TABLES = /\/(reservations?|reservar|reservas?|reservaciones|reservieren|reservierung|reserveren|reserver|r%c3%a9server|prenota(zione|re)?|reserve|book[a-z-]*|bookings?)(\/|$|[?#.-])/i;
/**
 * Booking pages that are not for a table: Transfer Co.'s "/book-an-event",
 * gift cards, hotel rooms, catering. Each was, or would be, a "Book on their
 * site" that sends somebody to the wrong form.
 */
// Whole words only: "spa" is in Yakitoro's ".../grupo-yakitoro/spanish".
const NOT_A_TABLE = /(^|[^a-z])(events?|private|party|parties|catering|gifts?|giftcards?|vouchers?|orders?|ordering|delivery|takeout|rooms?|stays?|hotels?|lodging|careers?|jobs?|spa|class(es)?|lessons?|tours?|tickets?|cruises?|weddings?)(?=[^a-z]|$)/i;

/**
 * Booking engines restaurants use that are not one of the platforms above —
 * seen in the rows already held (Tonkatsu Tamafuji on TableCheck, Yakitoro on
 * CoverManager, Metzy's on SpotOn, Café d'Anvers on resOS…). A link to one of
 * these is the restaurant's own booking page even though it is on another
 * domain. Anything else off-site — a hotel's cloudbeds, an aquarium's ticket
 * page — is not somewhere to send a diner.
 */
const BOOKING_ENGINES = /(^|\.)(toast\.app|tables\.toasttab\.com|oddle\.me|tablecheck\.com|zenchef\.com|covermanager\.com|resos\.com|spotapps\.co|spoton\.com|gastro-book\.de|gastro\.site|minitable\.net|chefonline\.co\.uk|formitable\.com|quandoo\.[a-z.]+|bookatable\.[a-z.]+|tableagent\.com|eat2eat\.com|resdiary\.com|tablein\.com|dish\.co|guestplan\.com|eveve\.com)$/i;

/**
 * Sites that take bookings for something other than a table. DayBeds Beach
 * Restaurant's row pointed at a cloudbeds hotel-room page; with no website to
 * compare against, the host is the only thing that gives it away.
 */
const NOT_A_TABLE_HOST = /(^|\.)(cloudbeds\.com|booking\.com|expedia\.[a-z.]+|airbnb\.[a-z.]+|hotels\.com|ticketmaster\.[a-z.]+|eventbrite\.[a-z.]+|fareharbor\.com|peek\.com|viator\.com|getyourguide\.[a-z.]+|doordash\.com|ubereats\.com|grubhub\.com|facebook\.com|instagram\.com)$/i;

/** "example.co.uk" for "www.example.co.uk"; near enough for "is it their site". */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const two = labels.slice(-2).join('.');
  const secondLevel = /^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(two);
  return labels.slice(secondLevel ? -3 : -2).join('.');
}

/**
 * The restaurant's own booking page, if this link is one: on their own site
 * with a path about tables, or on a known booking engine with something after
 * the host (a bare "bookings.zenchef.com/" names nobody).
 */
export function ownBookingUrl(raw: string, website?: string | null): string | null {
  // A template a script fills in is not a link: STK's page carries
  // href="reservation.manageUrl", which reads as a path until it is opened.
  if (/[{}$\[\]]/.test(raw)) return null;
  const url = parse(raw, website ?? undefined);
  if (!url || ASSET.test(url.pathname)) return null;
  const last = url.pathname.split('/').pop() ?? '';
  if (/\.[a-z]+$/i.test(last) && !/\.(html?|php|aspx?|jsp|cfm)$/i.test(last)) return null;
  if (platformOfHost(url.hostname) || NOT_A_TABLE_HOST.test(url.hostname)) return null;
  const where = `${url.pathname}${url.search}`;
  if (NOT_A_TABLE.test(where)) return null;
  if (BOOKING_ENGINES.test(url.hostname)) {
    return url.pathname.replace(/\/+$/, '') || url.search ? withoutSearchState(url) : null;
  }
  // Their own booking subdomain counts as a path about tables: Dastaan's is
  // booking.dastaan.co.uk/restaurant/leeds.
  const tablesHost = /^(booking|bookings|book|reserve|reservations?|tables?)\./i.test(url.hostname);
  if (!ABOUT_TABLES.test(url.pathname) && !tablesHost) return null;
  const home = website ? parse(website) : null;
  // With no site to compare against, only a relative link can be theirs.
  if (!home) return /^https?:|^\/\//i.test(String(raw).trim()) ? null : withoutSearchState(url);
  return siteOf(url.hostname) === siteOf(home.hostname) ? withoutSearchState(url) : null;
}

/** Every link-shaped thing on a page: hrefs, srcs, and URLs inside scripts. */
export function linksIn(html: string): string[] {
  // A widget's config is JSON inside a script, where "/" is written "\/".
  const text = String(html ?? '').replace(/\\\//g, '/');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:href|src|data-href|action)\s*=\s*["']([^"']{1,600})["']/gi)) out.push(m[1]);
  for (const m of text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>()\\]*/gi)) out.push(m[0]);
  return out;
}
