// ─── The venue cache ─────────────────────────────────────────────────────
// Overpass cannot sit in a request. It is run by volunteers, it answers 504
// when a city is dense, and when it is merely busy it does not refuse — it
// hangs, which is worse. Three mirrors in sequence took over two minutes in
// testing, for a screen somebody is staring at.
//
// So the sweep runs in the background and writes what it finds here, and
// Discover reads here. A fifteen second maybe becomes an indexed select.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Finding, SourceResult, Seeker } from './types.ts';
import { canTurnUp, notRuledOut } from './rules.ts';
import { kindFor } from './taste.ts';
import { dayWhere } from '../calendar.ts';

/**
 * The area a point belongs to, rounded to about seven miles. Everybody in a
 * city shares one, so one sweep serves all of them rather than each person
 * minting an area of their own and the sweep never catching up.
 */
export function areaOf(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Number(lat.toFixed(1)), lng: Number(lng.toFixed(1)) };
}

/** Rough miles between two points. Good enough to sort a list by. */
export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 69;
  const dLng = (bLng - aLng) * 69 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Everything worth looking for on this person's behalf: theirs, then everyday things. */
export function lookedFor(seeker: Seeker): string[] {
  return [...new Set([...seeker.interests, ...(seeker.browse ?? [])].map(i => kindFor(i).key))]
    .filter(Boolean)
    .slice(0, 16);
}

/**
 * The interest to credit, or null. "Because you like comedy" on something
 * found for everybody in the city is the app claiming to know somebody it
 * does not, and it reads that way.
 */
function becauseOf(seeker: Seeker, interest: string): string | null {
  const key = kindFor(interest).key;
  return seeker.interests.some(i => kindFor(i).key === key) ? key : null;
}

// Venues swept before interests were normalised were stored under the chip's
// own capitalisation, "Pottery & crafts". Read both until they are re-swept.
const asStored = (keys: string[]) =>
  [...new Set(keys.flatMap(k => [k, k.charAt(0).toUpperCase() + k.slice(1)]))];

const label = (interest: string) => {
  const key = kindFor(interest).key;
  return key.charAt(0).toUpperCase() + key.slice(1);
};

const PER_KIND = 4;
const MAX_VENUES = 40;

/** What the live ticketed search covers, so the cache matches it. */
const TICKETED_MILES = 90;

function box(seeker: Seeker, miles = 15) {
  // A degree of longitude narrows towards the poles, so a fixed box would
  // search twice as wide as asked for in Edinburgh and correctly in Quito.
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.max(0.1, Math.cos((seeker.lat * Math.PI) / 180)));
  return { dLat, dLng };
}

export async function cachedVenues(db: SupabaseClient, seeker: Seeker): Promise<SourceResult> {
  const keys = lookedFor(seeker);
  if (!keys.length) return { source: 'osm', status: 'ok', findings: [] };
  const { dLat, dLng } = box(seeker);

  const { data, error } = await db
    .from('discovery_venues')
    .select('osm_type, osm_id, name, lat, lng, city, website, interest, kind, street, image_url')
    .in('interest', asStored(keys))
    .gte('lat', seeker.lat - dLat).lte('lat', seeker.lat + dLat)
    .gte('lng', seeker.lng - dLng).lte('lng', seeker.lng + dLng)
    .limit(300);

  if (error) {
    // A missing table means the migration has not been run. That is worth
    // saying plainly in the log rather than looking like an empty city.
    console.error('[discover/cache] could not read venues', error.message);
    return { source: 'osm', status: 'error', findings: [], detail: error.message };
  }

  const all = (data ?? [])
    .map((v): Finding & { miles: number } => {
      const miles = milesBetween(seeker.lat, seeker.lng, v.lat, v.lng);
      return {
        id: `osm_${v.osm_type}_${v.osm_id}_${kindFor(v.interest).key}`,
        title: v.name,
        meta: [v.kind, v.street || v.city || seeker.city].filter(Boolean).join(' · '),
        emoji: kindFor(v.interest).emoji,
        // The map does not carry prices, and inventing one is a lie about
        // money. The card says where to look instead.
        price: null,
        dist: `${Math.max(1, Math.round(miles))} mi`,
        category: label(v.interest),
        url: v.website,
        image: (v as { image_url?: string | null }).image_url ?? null,
        // A studio is open on Tuesdays. It does not happen once, and giving it
        // a date is what made the detail screen ask people to pick one.
        date: null,
        venue: v.street || null,
        source: 'osm',
        because: becauseOf(seeker, v.interest),
        miles,
      };
    })
    // Filtered on the way out as well as the way in, so venues a past sweep
    // stored before this rule existed stop appearing without waiting a night.
    .filter(f => canTurnUp(f.title, [String(f.meta).split(' · ')[0]]))
    .filter(f => notRuledOut(`${f.title} ${f.meta}`, seeker.avoid))
    // Theirs before everyday things, then nearest first.
    .sort((a, b) => Number(!a.because) - Number(!b.because) || a.miles - b.miles);

  // A few of each kind, so a city's restaurants cannot bury its one studio.
  const taken = new Map<string, number>();
  const findings: Finding[] = [];
  for (const { miles: _miles, ...f } of all) {
    const n = taken.get(f.category) ?? 0;
    if (n >= PER_KIND) continue;
    taken.set(f.category, n + 1);
    findings.push(f);
    if (findings.length >= MAX_VENUES) break;
  }

  return { source: 'osm', status: 'ok', findings };
}

/**
 * The classes themselves, read off the venues' own pages by the harvest job.
 * A venue is a place that is open on Tuesdays; this is "Wheel Throwing
 * Taster Sessions, £60 per individual". It is the whole point of the engine,
 * so it is ranked above the venue it came from.
 */
export async function cachedEvents(db: SupabaseClient, seeker: Seeker): Promise<SourceResult> {
  const keys = lookedFor(seeker);
  if (!keys.length) return { source: 'harvest', status: 'ok', findings: [] };
  const { dLat, dLng } = box(seeker);

  // An inner join here, which is what this used to be, asks the database for
  // events that hang off a venue we found ourselves. That is every harvested
  // row and none of the others — a ticketed gig has a venue's NAME, not a row
  // in our table, so the rows the sources migration exists to allow were
  // excluded before anything could look at them.
  //
  // Left join, and the row describes itself when there is nothing to join to.
  // The bounding box then has to be applied here rather than in the query,
  // because it can no longer be expressed against a joined table alone.
  const COLUMNS = 'id, title, starts_on, when_text, price_text, booking_url, interest, source, venue_name, lat, lng, city, discovery_venues(name, lat, lng, city, street)';
  const fresh = new Date().toISOString();

  // Two questions, because the two kinds of row are filed differently.
  //
  // A harvested class is found BECAUSE somebody is into pottery, so it is
  // filed under that interest and only shown to people who asked for it.
  //
  // A ticketed event is not. It came back from a search for what is on near
  // this point, filed under the provider's own word for it — "sports",
  // "Arts & Theatre" — which is a vocabulary the reader does not share. Gated
  // on the seeker's interests it would be stored where nobody looks, which is
  // exactly what happened: twenty rows written and none ever read. Its gates
  // are the ones it was found by — near here, and not stale.
  //
  // Near and upcoming INSIDE the query. This fetched sixty rows from anywhere
  // in the world, in no order, and only then kept the ones near the reader —
  // measured: Raleigh holds 84 harvested classes within the box and 0 reached
  // the screen; Miami 20 ticketed events and 0. The sixty slots went to other
  // cities and to events that had already happened. Harvested rows hang off a
  // venue, so the box is on the venue (an inner embed); ticketed rows carry
  // their own point. The JS checks below stay as a second line.
  const day = dayWhere(seeker.lng);
  const near = box(seeker), far = box(seeker, TICKETED_MILES);
  const upcoming = `starts_on.is.null,starts_on.gte.${day}`;
  // Written out rather than derived, so the client can type the rows.
  const HARVEST_COLUMNS = 'id, title, starts_on, when_text, price_text, booking_url, interest, source, venue_name, lat, lng, city, discovery_venues!inner(name, lat, lng, city, street)';
  const [harvested, external] = await Promise.all([
    db.from('discovery_events').select(HARVEST_COLUMNS)
      .eq('source', 'harvest').in('interest', asStored(keys)).gt('stale_after', fresh)
      .gte('discovery_venues.lat', seeker.lat - near.dLat).lte('discovery_venues.lat', seeker.lat + near.dLat)
      .gte('discovery_venues.lng', seeker.lng - near.dLng).lte('discovery_venues.lng', seeker.lng + near.dLng)
      .or(upcoming)
      .order('starts_on', { ascending: true, nullsFirst: false }).limit(60),
    db.from('discovery_events').select(COLUMNS)
      .neq('source', 'harvest').gt('stale_after', fresh)
      .gte('lat', seeker.lat - far.dLat).lte('lat', seeker.lat + far.dLat)
      .gte('lng', seeker.lng - far.dLng).lte('lng', seeker.lng + far.dLng)
      .or(upcoming)
      .order('starts_on', { ascending: true, nullsFirst: false }).limit(60),
  ]);

  const error = harvested.error ?? external.error;
  const data = [...(harvested.data ?? []), ...(external.data ?? [])];

  if (error) {
    console.error('[discover/cache] could not read events', error.message);
    return { source: 'harvest', status: 'error', findings: [], detail: error.message };
  }

  // Their day, not the server's. Against the UTC date, a class happening
  // tonight disappeared from Discover from eight in the evening onwards.
  const today = dayWhere(seeker.lng);
  const findings: Finding[] = (data ?? [])
    // A dated class that has been and gone is worse than no class at all.
    .filter(e => !e.starts_on || e.starts_on >= today)
    .map((e): Finding => {
      const joined = (Array.isArray(e.discovery_venues) ? e.discovery_venues[0] : e.discovery_venues) as
        { name: string; lat: number; lng: number; city: string | null; street: string | null } | null;
      // Whichever knows where this is: the venue we found, or the row itself.
      const venue = joined ?? (e.venue_name || e.lat != null
        ? { name: String(e.venue_name ?? ''), lat: Number(e.lat), lng: Number(e.lng), city: e.city ?? null, street: null }
        : null);
      return {
        id: `${e.source || 'harvest'}_${e.id}`,
        title: e.title,
        meta: [e.when_text, venue?.name].filter(Boolean).join(' · '),
        emoji: kindFor(e.interest).emoji,
        // Their words, not ours. An empty price on the page is "we are not
        // told", which is a different thing from free.
        price: e.price_text || null,
        dist: venue ? `${Math.max(1, Math.round(milesBetween(seeker.lat, seeker.lng, venue.lat, venue.lng)))} mi` : null,
        category: label(e.interest),
        url: e.booking_url,
        date: e.starts_on || null,
        venue: venue?.name || null,
        // What actually found it. A cached ticketed gig is a Ticketmaster
        // finding that happens to have been stored; calling it 'harvest'
        // would make the health table and the logs lie about where Discover
        // gets its results.
        source: (e.source && e.source !== 'harvest' ? e.source : 'harvest') as Finding['source'],
        because: becauseOf(seeker, e.interest),
        lat: Number.isFinite(venue?.lat as number) ? (venue?.lat as number) : null,
        lng: Number.isFinite(venue?.lng as number) ? (venue?.lng as number) : null,
      };
    })
    // Near them, now that the box cannot be a condition of the join. A row
    // that cannot say where it is does not get to claim it is nearby.
    //
    // How near depends on what it is. Fifteen miles is right for a pottery
    // class — that is a thing you go to on a Tuesday evening. It is wrong for
    // a stadium: the live ticketed search covers ninety miles and people do
    // drive that far for a game. Holding cached events to the walking radius
    // stored twenty of them and returned none, because every venue was a
    // stadium twenty to sixty miles out.
    .filter(f => {
      if (f.lat == null || f.lng == null) return false;
      const reach = f.source === 'harvest' ? box(seeker) : box(seeker, TICKETED_MILES);
      return Math.abs(f.lat - seeker.lat) <= reach.dLat && Math.abs(f.lng - seeker.lng) <= reach.dLng;
    })
    .filter(f => notRuledOut(`${f.title} ${f.meta}`, seeker.avoid))
    // One event once. "Balloon Museum | Pop Air" was stored eighteen times
    // under the same title, venue and date, and each copy took a slot.
    .filter((f, i, all) => all.findIndex(g =>
      g.title.toLowerCase() === f.title.toLowerCase() && g.venue === f.venue && g.date === f.date) === i)
    .slice(0, 40);

  return { source: 'harvest', status: 'ok', findings };
}

/**
 * Remember that somebody asked about here, so the sweep knows where to go.
 * Reach cannot sweep the world, and it does not have to: it only has to
 * sweep where its users are, and they say where that is by opening Discover.
 *
 * Everybody counts, including somebody who has not done the quiz. Leaving
 * them out is what kept a new person's city unswept and their screen empty.
 */
export async function noteArea(db: SupabaseClient, seeker: Seeker): Promise<void> {
  const area = areaOf(seeker.lat, seeker.lng);
  const interests = lookedFor(seeker);
  if (!interests.length) return;
  try {
    const { data: existing } = await db
      .from('discovery_areas').select('id, interests, asked_count')
      .eq('lat', area.lat).eq('lng', area.lng).maybeSingle();

    if (existing) {
      // Union, not replace: one person who only likes cinema must not narrow
      // the sweep for everybody else in the city.
      const merged = [...new Set([...(existing.interests || []).map((i: string) => kindFor(i).key), ...interests])];
      // Bookkeeping for a background job: deliberately unchecked, because a
      // note about where somebody looked must never fail the screen they are
      // looking at. The sweep comes round again regardless.
      await db.from('discovery_areas').update({
        interests: merged,
        asked_count: (existing.asked_count || 0) + 1,
        last_asked_at: new Date().toISOString(),
        city: seeker.city || undefined,
      }).eq('id', existing.id);
      return;
    }
    // Bookkeeping for a background job: deliberately unchecked, because a
    // note about where somebody looked must never fail the screen they are
    // looking at. The sweep comes round again regardless.
    await db.from('discovery_areas').insert({
      lat: area.lat, lng: area.lng, city: seeker.city || null, interests,
    });
  } catch (e) {
    // Never fail a screen over bookkeeping for a background job.
    console.error('[discover/cache] could not note the area', e);
  }
}

// ─── Keeping what a ticketed source told us ─────────────────────────────
// Ticketmaster answers every time Discover is opened, which is a request per
// visit for a list that changes daily at most. Storing what came back means
// the lane keeps answering when the API is slow, rate-limited or down —
// which is the difference between a quiet week and a city that looks dead.
//
// Only possible since sql/discovery-events-sources-2026-09-18.sql: these
// rows have a venue's name and no venue of ours, and venue_id was NOT NULL.
const CACHE_DAYS = 2;

export async function rememberEvents(
  db: SupabaseClient,
  findings: Finding[],
  interestFor: (f: Finding) => string,
): Promise<number> {
  // Only what can be identified again. The unique rule for a non-harvest row
  // is (source, external_id); without an id of its own a row would be written
  // afresh on every visit and the table would grow without bound.
  const rows = findings
    .filter(f => f.source !== 'harvest' && f.id && f.lat != null && f.lng != null)
    .map(f => ({
      source: f.source,
      external_id: String(f.id),
      title: f.title,
      starts_on: f.date || null,
      when_text: f.meta || null,
      price_text: f.price || null,
      booking_url: f.url,
      interest: interestFor(f),
      venue_name: f.venue || null,
      lat: f.lat,
      lng: f.lng,
      city: null,
      found_at: new Date().toISOString(),
      stale_after: new Date(Date.now() + CACHE_DAYS * 86400_000).toISOString(),
    }));
  if (!rows.length) return 0;

  const { error } = await db.from('discovery_events').upsert(rows, { onConflict: 'source,external_id' });
  if (error) {
    // Never fatal, and never surfaced. Discover has already answered from the
    // live call by the time this runs; failing to keep a copy is a slower
    // tomorrow, not a broken today.
    console.error('[discover/cache] could not remember events', error.message);
    return 0;
  }
  return rows.length;
}
