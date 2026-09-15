// ─── Ticketmaster: what is ticketed near you ─────────────────────────────
// Lifted out of the route unchanged in behaviour so it can sit alongside the
// other sources. It used to be the whole of Discover, which is why Discover
// could only ever answer "what's on Friday" and never "I like pottery".
//
// It still fabricates nothing. This route once fell back to a model that
// invented plausible local events, and then to eight hardcoded fixtures of
// the same shape. Neither could be bought. An empty answer that says why is
// worth more than a fixture.
import type { Finding, SourceResult, Seeker } from './types';
import { notRuledOut } from './yelp';

const EMOJI: Record<string, string> = {
  Music: '🎵', Sports: '🏆', 'Arts & Theatre': '🎭',
  Film: '🎬', Miscellaneous: '🎉', Family: '👨‍👩‍👧',
};

/** Lowest advertised price, or null when none is published. Never "Free". */
function priceFrom(e: any): string | null {
  const mins = (e.priceRanges ?? [])
    .map((r: any) => r?.min)
    .filter((n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (!mins.length) return null;
  const low = Math.min(...mins);
  return low === 0 ? 'Free' : `From $${Math.round(low)}`;
}

/**
 * Past once its end date, or its start date when there is no end. Compared by
 * local date so an event tonight still counts.
 */
function notPast(e: any): boolean {
  const day = e.dates?.end?.localDate || e.dates?.start?.localDate;
  if (!day) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${day}T23:59:59`).getTime() >= today.getTime();
}

export async function ticketmaster(seeker: Seeker): Promise<SourceResult> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    console.error('[discover/ticketmaster] TICKETMASTER_API_KEY is not set');
    return { source: 'ticketmaster', status: 'no_key', findings: [] };
  }

  // Without startDateTime the Discovery API happily returns events from the
  // past, sorted to the top by date ascending.
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url = `https://app.ticketmaster.com/discovery/v2/events.json`
    + `?apikey=${encodeURIComponent(key)}`
    + `&latlong=${encodeURIComponent(`${seeker.lat},${seeker.lng}`)}`
    + `&startDateTime=${encodeURIComponent(now)}`
    + `&radius=90&unit=miles&size=20&sort=date,asc`;

  let data: any;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      console.error('[discover/ticketmaster] returned', res.status);
      return { source: 'ticketmaster', status: 'error', findings: [], detail: String(res.status) };
    }
    data = await res.json();
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'request failed';
    console.error('[discover/ticketmaster] request failed:', detail);
    return { source: 'ticketmaster', status: 'error', findings: [], detail };
  }

  const findings: Finding[] = (data?._embedded?.events ?? [])
    // No url means nothing to buy. Belt and braces on the date: the API is
    // asked for future events, but a stale cached page or a timezone edge
    // can still slip one through.
    .filter((e: any) => e?.url && e?.name && notPast(e))
    .map((e: any): Finding => {
      const venue = e._embedded?.venues?.[0];
      const start = e.dates?.start?.localDate;
      const when = start
        ? new Date(`${start}T12:00:00`).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          })
        : 'Date TBC';
      const segment = e.classifications?.[0]?.segment?.name || 'Event';
      return {
        id: e.id,
        title: e.name,
        meta: `${when} · ${venue?.name || 'Venue TBC'}`,
        emoji: EMOJI[segment] || '🎫',
        // Ticketmaster omits priceRanges on plenty of events. That is "we are
        // not told", not "free" — labelling it free is a lie about money.
        price: priceFrom(e),
        dist: venue?.distance != null ? `${Math.round(venue.distance)} mi` : null,
        category: segment,
        url: e.url,
        date: start || null,
        venue: venue?.name || null,
        source: 'ticketmaster',
        because: null,
      };
    })
    .filter((f: Finding) => notRuledOut(`${f.title} ${f.category}`, seeker.avoid));

  return { source: 'ticketmaster', status: 'ok', findings };
}
