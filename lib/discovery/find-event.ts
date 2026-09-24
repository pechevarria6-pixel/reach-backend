// ─── The event somebody actually named ──────────────────────────────────
// "milk carton kids concert in dc" came back as a multi-day trip built
// around a venue nobody plays at, because nothing looked the concert up. The
// model was asked to plan an evening around a named act and did what a model
// does with a name it has no facts for: it produced a plausible one.
//
// A concert is the most checkable thing in this whole product. It has a
// date, a venue and a page that sells tickets, and we already hold 138 of
// them. So the evening is built around the real event or it is not built
// around one at all — there is no third option where we make up where a band
// is playing.
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventPhoto } from './place-photo.ts';

export interface RealEvent {
  title: string;
  venue: string | null;
  city: string | null;
  /** ISO day. The evening is planned around this, not around a guess. */
  startsOn: string | null;
  /** Where tickets are actually sold. */
  url: string | null;
  source: 'cache' | 'ticketmaster';
  /**
   * The act's picture from the listing itself, with its credit and what it
   * is of — the act, the event or, failing both, the hall. Never searched for.
   */
  photo?: { url: string; credit: string; of: string | null } | null;
}

/** Words that describe the outing rather than name the act. */
const NOT_A_NAME = new Set([
  'concert', 'gig', 'show', 'tickets', 'ticket', 'live', 'tour', 'night',
  'out', 'with', 'my', 'the', 'and', 'for', 'his', 'her', 'their', 'a', 'an',
  'see', 'seeing', 'go', 'going', 'watch', 'watching', 'in', 'at', 'on',
  'birthday', 'friends', 'buddy', 'mate', 'wife', 'husband', 'girlfriend',
  'boyfriend', 'partner', 'this', 'that', 'next', 'weekend', 'friday',
  'saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday',
  'to', 'of', 'from', 'by', 'up', 'us', 'we', 'me', 'it', 'is', 'are', 'im',
  'want', 'wanna', 'just', 'some', 'get', 'got', 'take', 'taking',
]);

/**
 * The act somebody named, as words worth searching for.
 *
 * Deliberately a list of words rather than a name: "milk carton kids" is
 * lower case and three words long, and no capitalisation rule finds it.
 * Everything that describes the outing is dropped and what remains is
 * whatever they called the thing they are going to see.
 */
export function actWords(goal: string | null | undefined): string[] {
  const text = String(goal || '').toLowerCase().replace(/[’']/g, '');
  // Only up to the place, since "in dc" is where and not who.
  const upToPlace = text.split(/\b(?:in|at)\s+/)[0] ?? text;
  return upToPlace
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !NOT_A_NAME.has(w))
    .slice(0, 6);
}

/** Does this event's title plainly answer those words? */
export function titleMatches(title: string, words: string[]): boolean {
  if (words.length < 2) return false;
  const t = ` ${String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const hits = words.filter(w => t.includes(` ${w} `)).length;
  // Two of the words, or all of them when somebody gave only two. One shared
  // word matches half a listings page.
  return hits >= Math.min(2, words.length) && hits >= 2;
}

/**
 * The real event, from what we already hold.
 *
 * The cache first, because it costs nothing and it is the same data — these
 * rows came from the same provider on a previous sweep.
 */
export async function eventFromCache(
  db: SupabaseClient,
  words: string[],
): Promise<RealEvent | null> {
  if (words.length < 2) return null;

  const ask = (columns: string) => db
    .from('discovery_events')
    .select(columns)
    .eq('source', 'ticketmaster')
    .not('starts_on', 'is', null)
    .gte('starts_on', new Date().toISOString().slice(0, 10))
    .order('starts_on')
    .limit(400) as unknown as Promise<{ data: Record<string, any>[] | null; error: { code?: string; message?: string } | null }>;
  // The act's picture arrives in sql/place-photos-2026-09-24.sql; until
  // then the event is found exactly as before, without one.
  let { data, error } = await ask('title, venue_name, city, starts_on, booking_url, image_url, image_credit, image_of');
  if (error && /image_url|image_credit|image_of/.test(error.message || '')) {
    ({ data, error } = await ask('title, venue_name, city, starts_on, booking_url'));
  }

  if (error) {
    console.error('[find-event] could not read the cached events', { code: error.code });
    return null;
  }

  const hit = (data ?? []).find(e => titleMatches(String(e.title), words));
  if (!hit) return null;

  return {
    title: String(hit.title),
    venue: hit.venue_name ?? null,
    city: hit.city ?? null,
    startsOn: hit.starts_on ?? null,
    url: hit.booking_url ?? null,
    source: 'cache',
    photo: hit.image_url && hit.image_credit
      ? { url: String(hit.image_url), credit: String(hit.image_credit), of: hit.image_of ? String(hit.image_of) : null } : null,
  };
}

/**
 * The real event, asked of the provider by name.
 *
 * Same endpoint and the same response shape the discovery lane has been
 * reading all along — `keyword` instead of `latlong`, which is the documented
 * way to ask "where is this act playing". Reusing a parser that has produced
 * 138 real rows is not the same as writing against a shape nobody has seen.
 */
export async function eventFromProvider(
  words: string[],
  city: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<RealEvent | null> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key || words.length < 2) return null;

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url = 'https://app.ticketmaster.com/discovery/v2/events.json'
    + `?apikey=${encodeURIComponent(key)}`
    + `&keyword=${encodeURIComponent(words.join(' '))}`
    + (city ? `&city=${encodeURIComponent(city.split(',')[0].trim())}` : '')
    + `&startDateTime=${encodeURIComponent(now)}`
    + '&size=10&sort=date,asc';

  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 3600 } } as RequestInit);
    if (!res.ok) {
      console.error('[find-event] the provider returned', res.status);
      return null;
    }
    const json = await res.json() as { _embedded?: { events?: Record<string, never>[] } };
    const raw = (json._embedded?.events ?? []).find((e: Record<string, unknown>) =>
      e.url && e.name && titleMatches(String(e.name), words));
    if (!raw) return null;

    const e = raw as unknown as {
      name: string; url: string;
      dates?: { start?: { localDate?: string } };
      _embedded?: { venues?: { name?: string; city?: { name?: string } }[] };
    };
    const venue = e._embedded?.venues?.[0];
    const photo = eventPhoto(raw);
    return {
      title: e.name,
      venue: venue?.name ?? null,
      city: venue?.city?.name ?? null,
      startsOn: e.dates?.start?.localDate ?? null,
      url: e.url,
      source: 'ticketmaster',
      // `of` travels with it: the line names the venue, and the picture may
      // be the band.
      photo: photo ? { url: photo.url, credit: photo.credit, of: photo.of ?? null } : null,
    };
  } catch (err) {
    console.error('[find-event] could not ask the provider', err instanceof Error ? err.message : 'failed');
    return null;
  }
}

/**
 * What the prompt is told about the event, when there is one.
 *
 * Everything here is a fact read off a row. Nothing is described, embellished
 * or filled in — a venue's character, what the crowd is like, how long the
 * set runs are all things we do not know.
 */
export function eventFacts(event: RealEvent): string {
  return [
    `They are going to a real event, and these are its actual details:`,
    `- What: ${event.title}`,
    event.venue ? `- Where: ${event.venue}${event.city ? `, ${event.city}` : ''}` : null,
    event.startsOn ? `- Date: ${event.startsOn}` : null,
    event.url ? `- Tickets: ${event.url}` : null,
    '',
    'Use these exactly. Do not rename the venue, move it, change the date, or',
    'describe the room, the crowd or the running time — none of that is known.',
    'Plan the evening AROUND it: somewhere to eat beforehand and somewhere to',
    'go after, both near that venue. The event itself is already decided.',
  ].filter(Boolean).join('\n');
}
