// ─── What Discover shows, whoever found it ───────────────────────────────
// Discover was hardwired to Ticketmaster, whose catalogue is concerts,
// sport, theatre and film. That is a fine answer to "what's on Friday" and
// no answer at all to "I like pottery" — Ticketmaster does not sell a seat
// at a wheel on a Tuesday evening, and no radius makes it.
//
// So sources are plural. Each one answers in this shape, the route merges
// them, and a source that is unconfigured or down costs the others nothing.

export interface Finding {
  id: string;
  title: string;
  /** The line under the title: when and where, or what and where. */
  meta: string;
  emoji: string;
  /** Null when the source does not tell us. Never guess, and never "Free". */
  price: string | null;
  dist: string | null;
  category: string;
  /** Where it is actually bought or booked. No url, no card. */
  url: string;
  /** ISO date for things that happen once. Null for places that are open. */
  date: string | null;
  venue: string | null;
  /** Which source found it, so the UI can say and the logs can tell. */
  source: SourceName;
  /** Set when this was found because of something the person told us. */
  because: string | null;
  /** Where it actually is, when the source knows. Null when it does not. */
  lat?: number | null;
  lng?: number | null;
}

export type SourceName = 'ticketmaster' | 'yelp-events' | 'yelp-places' | 'osm';

export type SourceStatus =
  | 'ok'            // answered, with or without results
  | 'no_key'        // not configured for this deployment
  | 'error';        // configured and failed — the one worth shouting about

export interface SourceResult {
  source: SourceName;
  status: SourceStatus;
  findings: Finding[];
  /** Kept for the log, never shown to a traveller. */
  detail?: string;
}

export interface Seeker {
  lat: number;
  lng: number;
  city: string;
  /** What they told the quiz they are into, most telling first. */
  interests: string[];
  /** Absolute nos. Anything matching these never reaches the screen. */
  avoid: string[];
}
