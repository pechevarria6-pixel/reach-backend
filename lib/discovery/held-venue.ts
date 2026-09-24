// ─── The venue a booking line names, found where the trip is ────────────
// The booking screen offers a restaurant's phone number and booking link
// from our venue table. It found the row by name alone — `.ilike('name',
// venueName).limit(1)` — anywhere in the world. That was harmless while the
// table held a few dozen places a town. The weekly map load holds every
// Chipotle and every "The Crown" across thirty-odd regions, so the number
// offered for dinner in Raleigh could ring a restaurant in Ohio: a venue fact
// invented by a join, on the one screen where somebody acts on it.
//
// So the row has to be near the trip, live, and the same name — not a name
// that merely matches a pattern. When the trip cannot be placed, nothing is
// looked up at all: a number we cannot tie to this town is not one to offer.
import type { SupabaseClient } from '@supabase/supabase-js';
import { milesBetween } from './cache.ts';

/** The menu reads twenty-five miles around a town; so does this. */
export const HELD_VENUE_MILES = 25;

export interface HeldVenue {
  reservation_platform: string | null;
  reservation_url: string | null;
  phone: string | null;
}

/**
 * A name as an ILIKE pattern that matches only itself (case aside).
 * `%` and `_` are LIKE's wildcards and `*` is PostgREST's spelling of `%`;
 * "100% Burger" or "Bar_One" must not match every bar.
 */
export function likeExactly(name: string): string {
  return name.replace(/[\\%_]/g, c => `\\${c}`).replace(/\*/g, '_');
}

const same = (a: string, b: string) =>
  a.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim() === b.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

type Row = HeldVenue & { name: string; lat: number | null; lng: number | null };
type ReadError = { code?: string; message?: string } | null;

/**
 * The live venue of this name nearest the trip, within HELD_VENUE_MILES, or
 * null. `error` is set only for a failure worth logging; a column a pending
 * migration has not added yet reads as "nothing held", which is the honest
 * degraded state for a booking lookup.
 */
export async function heldVenueNear(
  db: SupabaseClient,
  name: string,
  at: { lat: number; lng: number } | null,
  miles = HELD_VENUE_MILES,
): Promise<{ venue: HeldVenue | null; error: ReadError }> {
  const wanted = String(name || '').trim();
  if (!wanted || !at || !Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return { venue: null, error: null };
  const dLat = miles / 69;
  const dLng = miles / Math.max(1, 69 * Math.cos((at.lat * Math.PI) / 180));

  const read = (live: boolean) => {
    let q = db
      .from('discovery_venues')
      .select('name, lat, lng, reservation_platform, reservation_url, phone')
      .ilike('name', likeExactly(wanted))
      // The weekly map load holds hotels too. A table line is never a
      // hotel's front desk, even when the two share a name.
      .neq('interest', 'places to stay')
      .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
      .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng);
    // A place two weekly loads in a row did not find is not somewhere to ring.
    if (live) q = q.is('gone_at', null);
    return q.limit(20) as unknown as Promise<{ data: Row[] | null; error: ReadError }>;
  };
  let { data, error } = await read(true);
  // gone_at arrives in sql/world-data-phase1-2026-09-24.sql; before it, nothing is gone.
  if (error && (error.code === '42703' || /gone_at/.test(error.message || ''))) ({ data, error } = await read(false));
  if (error) {
    const pending = /reservation_platform|reservation_url|phone|schema cache/i.test(error.message || '');
    return { venue: null, error: pending ? null : error };
  }

  const best = (data ?? [])
    .filter(r => same(String(r.name || ''), wanted) && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)))
    .map(r => ({ r, miles: milesBetween(at.lat, at.lng, Number(r.lat), Number(r.lng)) }))
    .sort((a, b) => a.miles - b.miles)[0]?.r;
  if (!best) return { venue: null, error: null };
  return {
    venue: {
      reservation_platform: best.reservation_platform ?? null,
      reservation_url: best.reservation_url ?? null,
      phone: best.phone ?? null,
    },
    error: null,
  };
}
