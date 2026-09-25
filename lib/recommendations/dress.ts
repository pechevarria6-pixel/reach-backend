// ─── A recommended trip, with its picture and its best months ────────────
// The cards had a photo slot nothing filled, and a destination we hold
// weather for said nothing about when to go. Both come from kept answers:
// destination_photos (a photo checked to be OF the place — see
// lib/discovery/destination-photo.ts) and place_climate (NASA POWER
// averages). Neither is fetched per page view after the first time, and
// neither may hold a card up: past its deadline a card goes without.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cachedDestinationPhoto } from '../discovery/destination-photo.ts';
import { climateFor } from '../climate-store.ts';
import type { TripPickData } from '../contracts/trip-pick.ts';

const DEADLINE_MS = 3500;

function within<T>(p: Promise<T>, ms = DEADLINE_MS): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))]);
}

type Deps = {
  photo: (db: SupabaseClient, place: string) => Promise<{ url: string; credit: string } | null>;
  climate: (db: SupabaseClient, place: { name: string; country?: string | null }) => Promise<{ climate: { best: string | null; credit: string } | null } | null>;
  deadlineMs?: number;
};
const LIVE: Deps = {
  photo: (db, place) => cachedDestinationPhoto(db, place),
  climate: (db, place) => climateFor(db, place),
};

export async function dressPicks<P extends Pick<TripPickData, 'destination' | 'title'> & Partial<TripPickData>>(
  db: SupabaseClient, picks: P[], deps: Deps = LIVE,
): Promise<Array<P & { photo: TripPickData['photo']; weather: TripPickData['weather'] }>> {
  const ms = deps.deadlineMs ?? DEADLINE_MS;
  return Promise.all(picks.map(async p => {
    const place = [p.destination.city, p.destination.country].filter(Boolean).join(', ');
    const [photo, weather] = await Promise.all([
      within(deps.photo(db, place), ms),
      // No dates on a suggestion, so no verdict and no vetoes: the best
      // months, as information.
      within(deps.climate(db, { name: p.destination.city, country: p.destination.country }), ms),
    ]);
    const best = weather?.climate?.best ?? null;
    return {
      ...p,
      photo: photo?.url && photo.credit ? { url: photo.url, alt: `A view of ${p.destination.label}`, credit: photo.credit } : (p.photo ?? null),
      weather: best && weather?.climate?.credit ? { line: best, credit: weather.climate.credit } : null,
    };
  }));
}
