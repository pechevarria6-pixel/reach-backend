// ─── More than one place to buy a ticket ─────────────────────────────────
// CLAUDE.md's sixth rule: solve problems before they are problems. A plan
// that names one seller ends when that seller sells out — J. Cole in
// Fayetteville went off sale on Ticketmaster and the plan simply stopped,
// with StubHub and the box office still selling.
//
// What this is careful about: only the primary link is a claim. It is the
// URL a source handed us for that exact event. Everything after it is a
// search on a real marketplace, offered as somewhere to look and never as a
// statement that tickets are there. Reach has not asked StubHub whether J.
// Cole is available and must not imply that it has.
//
// SeatGeek is deliberately absent. Its search URL answers 403 to anything
// that is not a browser, so it could not be verified the way the others
// were, and a link nobody has checked is the bug this is fixing.
//
// The three below were each requested and returned 200 on 2026-09-22:
//   https://www.stubhub.com/search?q=…
//   https://www.vividseats.com/search?searchTerm=…
//   https://www.ticketmaster.com/search?q=…
// StubHub's documented-looking /find/s/?q= answers 404, which is why the
// shape is written down here rather than guessed at the call site.

export interface TicketSource {
  label: string;
  url: string;
  kind: 'seller' | 'box_office' | 'resale';
  /**
   * True when this URL is for this exact event, false when it is a search.
   * The screen uses it to decide what it is allowed to say.
   */
  exact: boolean;
}

/** The hostname, for telling two links apart. Null when it is not a URL. */
function host(url: unknown): string | null {
  try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

/**
 * The act, out of the sentence the itinerary wrote around it.
 *
 * "See The Milk Carton Kids live at 9:30 Club" is a line on a plan, not a
 * search term; searching a marketplace for the whole sentence finds nothing.
 * The venue is given so the tail can be removed by name rather than by
 * guessing where it starts.
 *
 * Returns null when there is nothing left worth searching for, and the
 * caller then falls back to the venue — "what else is on at 9:30 Club" is a
 * worse answer than the act and a much better one than nothing.
 */
export function actFrom(title: unknown, venueName?: unknown): string | null {
  let t = String(title ?? '').trim();
  if (!t) return null;
  t = t.replace(/^(?:go\s+(?:and\s+)?)?(?:see|catch|watch|hear)\s+/i, '');
  const venue = String(venueName ?? '').trim();
  if (venue) {
    // "… live at 9:30 Club", "… at 9:30 CLUB." — matched on the venue's own
    // name so a title containing other "at"s survives.
    const escaped = venue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\s*(?:,\\s*)?(?:live\\s+)?at\\s+${escaped}.*$`, 'i'), '');
  }
  t = t.replace(/\s*[.,;:]+\s*$/, '').trim();
  // Two words or fewer that are all filler is not an act.
  if (!t || t.length < 3) return null;
  return t;
}

const SEARCHES: { label: string; kind: TicketSource['kind']; build: (q: string) => string }[] = [
  { label: 'StubHub', kind: 'resale', build: q => `https://www.stubhub.com/search?q=${encodeURIComponent(q)}` },
  { label: 'VividSeats', kind: 'resale', build: q => `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(q)}` },
];

export interface TicketInput {
  /** The itinerary line, or the event's own title. */
  title?: unknown;
  venueName?: unknown;
  /** The URL a source gave us for this exact event. */
  primaryUrl?: unknown;
  /** The venue's own website, where we hold one. */
  venueWebsite?: unknown;
}

/**
 * Everywhere worth looking for this ticket, best first.
 *
 * The exact seller, then the venue's own box office when we hold a site for
 * it and it is somewhere other than the seller, then searches.
 */
export function ticketSources(input: TicketInput): TicketSource[] {
  const out: TicketSource[] = [];
  const primary = String(input.primaryUrl ?? '').trim();
  const primaryHost = host(primary);

  if (primaryHost) {
    out.push({ label: 'Get tickets', url: primary, kind: 'seller', exact: true });
  }

  const site = String(input.venueWebsite ?? '').trim();
  const siteHost = host(site);
  // Only when it is genuinely somewhere else. A harvested event's booking
  // URL is the venue's own page already, and offering it twice under two
  // headings is the redundancy rule.
  if (siteHost && siteHost !== primaryHost) {
    const venue = String(input.venueName ?? '').trim();
    out.push({
      label: venue ? `${venue} box office` : 'Box office',
      url: site, kind: 'box_office', exact: true,
    });
  }

  const query = actFrom(input.title, input.venueName) ?? String(input.venueName ?? '').trim();
  if (query) {
    for (const s of SEARCHES) {
      out.push({ label: `Also try ${s.label}`, url: s.build(query), kind: s.kind, exact: false });
    }
  }
  return out;
}
