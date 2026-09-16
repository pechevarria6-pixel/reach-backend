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

function box(seeker: Seeker) {
  // A degree of longitude narrows towards the poles, so a fixed box would
  // search twice as wide as asked for in Edinburgh and correctly in Quito.
  const miles = 15;
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
    .select('osm_type, osm_id, name, lat, lng, city, website, interest, kind, street')
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

  const { data, error } = await db
    .from('discovery_events')
    .select('id, title, starts_on, when_text, price_text, booking_url, interest, discovery_venues!inner(name, lat, lng, city, street)')
    .in('interest', asStored(keys))
    // A harvest that failed must not leave last month's classes standing.
    .gt('stale_after', new Date().toISOString())
    .gte('discovery_venues.lat', seeker.lat - dLat).lte('discovery_venues.lat', seeker.lat + dLat)
    .gte('discovery_venues.lng', seeker.lng - dLng).lte('discovery_venues.lng', seeker.lng + dLng)
    .limit(40);

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
      const venue = (Array.isArray(e.discovery_venues) ? e.discovery_venues[0] : e.discovery_venues) as
        { name: string; lat: number; lng: number; city: string | null; street: string | null };
      return {
        id: `harvest_${e.id}`,
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
        source: 'harvest',
        because: becauseOf(seeker, e.interest),
        lat: venue?.lat ?? null,
        lng: venue?.lng ?? null,
      };
    })
    .filter(f => notRuledOut(`${f.title} ${f.meta}`, seeker.avoid));

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
      await db.from('discovery_areas').update({
        interests: merged,
        asked_count: (existing.asked_count || 0) + 1,
        last_asked_at: new Date().toISOString(),
        city: seeker.city || undefined,
      }).eq('id', existing.id);
      return;
    }
    await db.from('discovery_areas').insert({
      lat: area.lat, lng: area.lng, city: seeker.city || null, interests,
    });
  } catch (e) {
    // Never fail a screen over bookkeeping for a background job.
    console.error('[discover/cache] could not note the area', e);
  }
}
