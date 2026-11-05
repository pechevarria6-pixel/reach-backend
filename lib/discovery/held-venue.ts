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
import { acrossTheBorder } from './real-places.ts';

/** The menu reads twenty-five miles around a town; so does this. */
export const HELD_VENUE_MILES = 25;

export interface HeldVenue {
  reservation_platform: string | null;
  reservation_url: string | null;
  phone: string | null;
  /** The venue's own homepage, as the map gives it. Not a booking page. */
  website?: string | null;
  /**
   * The venue's mapped hours and where it is, for the reservation assistant,
   * which may ring only while a place is plainly open
   * (lib/reservations/policy.ts). Optional so a row built elsewhere need not
   * carry them.
   */
  opening_hours?: string | null;
  lng?: number | null;
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

type Row = HeldVenue & { name: string; lat: number | null; lng: number | null; opening_hours?: string | null; region?: string | null; countries?: string[] | null };
type ReadError = { code?: string; message?: string } | null;

/**
 * The live venue of this name nearest the trip, within HELD_VENUE_MILES, or
 * null. `error` is set only for a failure worth logging; a column a pending
 * migration has not added yet reads as "nothing held", which is the honest
 * degraded state for a booking lookup.
 *
 * `country` is the trip's (ISO 3166-1, as the geocoder gives it). A row
 * filed in another country's region is not this trip's venue however near
 * it is: downtown Ciudad Juárez is a mile or two from the point El Paso
 * geocodes to, and the whole-region load holds Mexico's file, so without
 * this an El Paso dinner could be offered a +52 number. The same rule as
 * the menu's (acrossTheBorder), which drops a row only when both countries
 * are known.
 */
export async function heldVenueNear(
  db: SupabaseClient,
  name: string,
  at: { lat: number; lng: number } | null,
  opts: { country?: string | null; miles?: number } = {},
): Promise<{ venue: HeldVenue | null; error: ReadError }> {
  const miles = opts.miles ?? HELD_VENUE_MILES;
  const wanted = String(name || '').trim();
  if (!wanted || !at || !Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return { venue: null, error: null };
  const dLat = miles / 69;
  const dLng = miles / Math.max(1, 69 * Math.cos((at.lat * Math.PI) / 180));

  // `migrated`: gone_at and region, both from sql/world-data-phase1-2026-09-24.sql;
  // `withCountries`: countries, from sql/venue-countries-2026-09-24.sql.
  const read = (migrated: boolean, withCountries = false) => {
    let q = db
      .from('discovery_venues')
      .select(`name, lat, lng, reservation_platform, reservation_url, phone, opening_hours${migrated ? ', region' : ''}${withCountries ? ', countries' : ''}`)
      .ilike('name', likeExactly(wanted))
      // The weekly map load holds hotels too. A table line is never a
      // hotel's front desk, even when the two share a name.
      .neq('interest', 'places to stay')
      .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
      .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng);
    // A place two weekly loads in a row did not find is not somewhere to ring.
    if (migrated) q = q.is('gone_at', null);
    return q.limit(20) as unknown as Promise<{ data: Row[] | null; error: ReadError }>;
  };
  let { data, error } = await read(true, true);
  // countries arrives in sql/venue-countries-2026-09-24.sql; before it the
  // border check reads the region.
  if (error && (error.code === '42703' || /countries/.test(error.message || ''))) ({ data, error } = await read(true));
  // gone_at and region arrive in sql/world-data-phase1-2026-09-24.sql; before
  // it nothing is gone, and no row has a region (so none is across a border).
  if (error && (error.code === '42703' || /gone_at|region/.test(error.message || ''))) ({ data, error } = await read(false));
  if (error) {
    const pending = /reservation_platform|reservation_url|phone|opening_hours|schema cache/i.test(error.message || '');
    return { venue: null, error: pending ? null : error };
  }

  const best = (data ?? [])
    .filter(r => same(String(r.name || ''), wanted) && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)))
    .filter(r => !acrossTheBorder(r.region, opts.country, r.countries))
    .map(r => ({ r, miles: milesBetween(at.lat, at.lng, Number(r.lat), Number(r.lng)) }))
    .sort((a, b) => a.miles - b.miles)[0]?.r;
  if (!best) return { venue: null, error: null };
  return {
    venue: {
      reservation_platform: best.reservation_platform ?? null,
      reservation_url: best.reservation_url ?? null,
      phone: best.phone ?? null,
      opening_hours: best.opening_hours ?? null,
      lng: Number(best.lng),
    },
    error: null,
  };
}

// ─── The venue a line cites, by the row itself ──────────────────────────
// For booking a table, near the trip and the same name is still not enough:
// a chain's other branch is near the trip and has the same name, and its
// OpenTable or Yelp id would book a table at the wrong address. So the
// platform id, the booking link and the number Reach acts on come only from
// the exact row the line cites (itinerary_items.venue_ref, the
// discovery_venues id the generator's menu named) — never from a name.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A line's venue_ref, if it is one. */
export function venueRefOf(ref: unknown): string | null {
  const s = typeof ref === 'string' ? ref.trim() : '';
  return UUID.test(s) ? s.toLowerCase() : null;
}

/**
 * The live venue row with exactly this id, or null. No ref, no lookup:
 * a line that cites no row has no platform id to book with.
 */
export async function heldVenueByRef(
  db: SupabaseClient,
  ref: unknown,
): Promise<{ venue: (HeldVenue & { id: string; name: string }) | null; error: ReadError }> {
  const id = venueRefOf(ref);
  if (!id) return { venue: null, error: null };
  const read = (migrated: boolean) => {
    let q = db.from('discovery_venues')
      .select('id, name, lng, reservation_platform, reservation_url, phone, opening_hours, website')
      .eq('id', id);
    if (migrated) q = q.is('gone_at', null);
    return q.maybeSingle() as unknown as Promise<{ data: (Row & { id: string }) | null; error: ReadError }>;
  };
  let { data, error } = await read(true);
  if (error && (error.code === '42703' || /gone_at/.test(error.message || ''))) ({ data, error } = await read(false));
  if (error) {
    const pending = /reservation_platform|reservation_url|phone|opening_hours|schema cache/i.test(error.message || '');
    return { venue: null, error: pending ? null : error };
  }
  if (!data) return { venue: null, error: null };
  return {
    venue: {
      id: String(data.id), name: String(data.name ?? ''),
      reservation_platform: data.reservation_platform ?? null,
      reservation_url: data.reservation_url ?? null,
      phone: data.phone ?? null,
      opening_hours: data.opening_hours ?? null,
      lng: data.lng != null && Number.isFinite(Number(data.lng)) ? Number(data.lng) : null,
    },
    error: null,
  };
}
