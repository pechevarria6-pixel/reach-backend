// ─── Yelp: the local long tail ───────────────────────────────────────────
// Two sources, both on the Fusion API.
//
//   yelp-events — what is on near you, from listings rather than ticketing.
//   yelp-places — the studios and schools behind an interest. This is the
//                 one that answers "I like pottery", because a wheel on a
//                 Tuesday evening is a business with a class, not a ticketed
//                 event, and no ticketing catalogue has ever held one.
//
// Both fail quietly and separately. Discover showing two sources' worth of
// things is better than showing none because a third was misconfigured.
import type { Finding, SourceResult, Seeker } from './types.ts';
import { canTurnUp, notRuledOut } from './rules.ts';
import { kindFor, searchTermFor } from './taste.ts';

const BASE = 'https://api.yelp.com/v3';
const MILES = 1609.34;
// Yelp refuses any radius over 40,000 metres, about twenty-five miles. This
// once asked for forty miles, and every search came back 400.
const RADIUS = 40000;

function auth() {
  const key = process.env.YELP_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : null;
}

const money = (p?: string | null) =>
  p && /^\$+$/.test(p) ? ({ $: 'Inexpensive', $$: 'Moderate', $$$: 'Pricey', $$$$: 'Splashing out' }[p] ?? p) : null;

const milesFrom = (metres?: number | null) =>
  typeof metres === 'number' && Number.isFinite(metres) ? `${Math.max(1, Math.round(metres / MILES))} mi` : null;

// ── What's on near you ──────────────────────────────────────────────────
export async function yelpEvents(seeker: Seeker): Promise<SourceResult> {
  const headers = auth();
  if (!headers) return { source: 'yelp-events', status: 'no_key', findings: [] };

  const today = new Date().toISOString().slice(0, 10);
  const url = `${BASE}/events?latitude=${seeker.lat}&longitude=${seeker.lng}`
    + `&radius=${RADIUS}&limit=20&sort_on=time_start&sort_by=asc`
    + `&start_date=${Math.floor(new Date(`${today}T00:00:00`).getTime() / 1000)}`;

  let json: any;
  try {
    const res = await fetch(url, { headers, next: { revalidate: 1800 } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[discover/yelp-events] returned', res.status, detail.slice(0, 200));
      return { source: 'yelp-events', status: 'error', findings: [], detail: `${res.status}` };
    }
    json = await res.json();
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'request failed';
    console.error('[discover/yelp-events] request failed', detail);
    return { source: 'yelp-events', status: 'error', findings: [], detail };
  }

  const findings: Finding[] = (json?.events ?? [])
    // No link means nothing to do with it, which is the whole point of a card.
    .filter((e: any) => e?.event_site_url && e?.name)
    .map((e: any): Finding => {
      const when = e.time_start
        ? new Date(e.time_start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : 'Date TBC';
      const where = e.location?.city || seeker.city;
      return {
        id: `yelp_event_${e.id}`,
        title: e.name,
        meta: [when, where].filter(Boolean).join(' · '),
        emoji: '📍',
        // is_free is a statement; a missing cost is not. Only one of them
        // may be printed as a price.
        price: e.is_free ? 'Free' : (typeof e.cost === 'number' ? `From $${Math.round(e.cost)}` : null),
        dist: null,
        category: e.category ? String(e.category).replace(/[-_]/g, ' ') : 'Event',
        url: e.event_site_url,
        date: e.time_start ? String(e.time_start).slice(0, 10) : null,
        venue: e.location?.address1 || null,
        source: 'yelp-events',
        because: null,
      };
    })
    .filter((f: Finding) => notRuledOut(`${f.title} ${f.category}`, seeker.avoid));

  return { source: 'yelp-events', status: 'ok', findings };
}

// ── The places behind an interest ───────────────────────────────────────
// A search term rather than a category alias, because the quiz lets people
// type their own — "sourdough", "sea swimming", "letterpress" — and a fixed
// map of category aliases would throw away exactly the answers that make a
// suggestion feel like it was meant for one person.
// The words to search for live alongside every other source's, in taste.ts,
// so the map and Yelp cannot disagree about what "pottery" means.
export { searchTermFor };

async function placesFor(interest: string, seeker: Seeker, headers: Record<string, string>): Promise<Finding[]> {
  const term = searchTermFor(interest);
  const url = `${BASE}/businesses/search?latitude=${seeker.lat}&longitude=${seeker.lng}`
    + `&term=${encodeURIComponent(term)}&radius=${RADIUS}&limit=4&sort_by=rating`;

  const res = await fetch(url, { headers, next: { revalidate: 3600 } });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[discover/yelp-places] returned', res.status, 'for', term, detail.slice(0, 160));
    throw new Error(String(res.status));
  }
  const json = await res.json();
  return (json?.businesses ?? [])
    // Yelp answers "cooking class" with catering companies and colleges. It
    // also says what each one is, which it had been printing on the card and
    // never reading.
    .filter((b: any) => b?.url && b?.name && !b.is_closed
      && canTurnUp(b.name, (b.categories ?? []).flatMap((c: any) => [c.alias, c.title])))
    .map((b: any): Finding => ({
      id: `yelp_place_${b.id}`,
      title: b.name,
      meta: [
        (b.categories ?? []).map((c: any) => c.title).slice(0, 2).join(' · '),
        b.location?.city || seeker.city,
      ].filter(Boolean).join(' · '),
      emoji: kindFor(interest).emoji,
      price: money(b.price),
      dist: milesFrom(b.distance),
      // The interest is the category, so the filter chips on Discover read
      // as the person's own words rather than a provider's taxonomy.
      category: interest.charAt(0).toUpperCase() + interest.slice(1),
      url: b.url,
      // A studio is open on Tuesdays; it does not happen once. Giving it a
      // date is what made the detail screen ask people to pick one.
      date: null,
      venue: b.location?.address1 || null,
      source: 'yelp-places',
      // Only when it is theirs. A spare search spent on everyday things did
      // not find this because of anything they told us.
      because: seeker.interests.includes(interest) ? interest : null,
    }))
    .filter((f: Finding) => notRuledOut(`${f.title} ${f.meta}`, seeker.avoid));
}

export async function yelpPlaces(seeker: Seeker): Promise<SourceResult> {
  const headers = auth();
  if (!headers) return { source: 'yelp-places', status: 'no_key', findings: [] };
  // Three at once. Every interest would be a dozen round trips inside one
  // request, and the three they picked first are the three they care about.
  // Somebody with fewer than three answers, or none, gets everyday things in
  // the spare searches rather than an empty lane.
  const wanted = [...seeker.interests, ...(seeker.browse ?? [])].slice(0, 3);
  if (!wanted.length) return { source: 'yelp-places', status: 'ok', findings: [] };
  const settled = await Promise.allSettled(wanted.map(i => placesFor(i, seeker, headers)));

  const findings = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const failed = settled.filter(r => r.status === 'rejected').length;
  // One interest failing while two answered is not a broken source.
  if (failed === wanted.length) {
    return { source: 'yelp-places', status: 'error', findings: [], detail: `all ${failed} searches failed` };
  }
  return { source: 'yelp-places', status: 'ok', findings };
}
