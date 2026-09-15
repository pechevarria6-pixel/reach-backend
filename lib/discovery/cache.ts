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
import { notRuledOut } from './rules.ts';

const EMOJI: Record<string, string> = {
  'pottery & crafts': '🏺', 'cooking': '🍳', 'art & galleries': '🎨',
  'live music': '🎸', 'dancing': '💃', 'wellness': '🧘', 'sport': '⚽',
  'books & talks': '📚', 'film & theatre': '🎬', 'comedy': '🎤',
  'photography': '📷', 'outdoors': '🥾',
};

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

export async function cachedVenues(db: SupabaseClient, seeker: Seeker): Promise<SourceResult> {
  const interests = seeker.interests.slice(0, 6);
  if (!interests.length) return { source: 'osm', status: 'ok', findings: [] };

  // A degree of longitude narrows towards the poles, so a fixed box would
  // search twice as wide as asked for in Edinburgh and correctly in Quito.
  const miles = 15;
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.max(0.1, Math.cos((seeker.lat * Math.PI) / 180)));

  const { data, error } = await db
    .from('discovery_venues')
    .select('osm_type, osm_id, name, lat, lng, city, website, interest, kind, street')
    .in('interest', interests)
    .gte('lat', seeker.lat - dLat).lte('lat', seeker.lat + dLat)
    .gte('lng', seeker.lng - dLng).lte('lng', seeker.lng + dLng)
    .limit(60);

  if (error) {
    // A missing table means the migration has not been run. That is worth
    // saying plainly in the log rather than looking like an empty city.
    console.error('[discover/cache] could not read venues', error.message);
    return { source: 'osm', status: 'error', findings: [], detail: error.message };
  }

  const findings: Finding[] = (data ?? [])
    .map((v): Finding => ({
      id: `osm_${v.osm_type}_${v.osm_id}_${v.interest}`,
      title: v.name,
      meta: [v.kind, v.street || v.city || seeker.city].filter(Boolean).join(' · '),
      emoji: EMOJI[String(v.interest).toLowerCase()] || '📍',
      // The map does not carry prices, and inventing one is a lie about
      // money. The card says where to look instead.
      price: null,
      dist: `${Math.max(1, Math.round(milesBetween(seeker.lat, seeker.lng, v.lat, v.lng)))} mi`,
      category: String(v.interest).charAt(0).toUpperCase() + String(v.interest).slice(1),
      url: v.website,
      // A studio is open on Tuesdays. It does not happen once, and giving it
      // a date is what made the detail screen ask people to pick one.
      date: null,
      venue: v.street || null,
      source: 'osm',
      because: v.interest,
    }))
    .filter(f => notRuledOut(`${f.title} ${f.meta}`, seeker.avoid))
    .sort((a, b) => parseInt(a.dist || '99') - parseInt(b.dist || '99'));

  return { source: 'osm', status: 'ok', findings };
}

/**
 * Remember that somebody asked about here, so the sweep knows where to go.
 * Reach cannot sweep the world, and it does not have to: it only has to
 * sweep where its users are, and they say where that is by opening Discover.
 */
export async function noteArea(db: SupabaseClient, seeker: Seeker): Promise<void> {
  const area = areaOf(seeker.lat, seeker.lng);
  try {
    const { data: existing } = await db
      .from('discovery_areas').select('id, interests, asked_count')
      .eq('lat', area.lat).eq('lng', area.lng).maybeSingle();

    if (existing) {
      // Union, not replace: one person who only likes cinema must not narrow
      // the sweep for everybody else in the city.
      const merged = [...new Set([...(existing.interests || []), ...seeker.interests])];
      await db.from('discovery_areas').update({
        interests: merged,
        asked_count: (existing.asked_count || 0) + 1,
        last_asked_at: new Date().toISOString(),
        city: seeker.city || undefined,
      }).eq('id', existing.id);
      return;
    }
    await db.from('discovery_areas').insert({
      lat: area.lat, lng: area.lng, city: seeker.city || null,
      interests: seeker.interests,
    });
  } catch (e) {
    // Never fail a screen over bookkeeping for a background job.
    console.error('[discover/cache] could not note the area', e);
  }
}
