// ─── Where you're going, and where you've been ──────────────────────────
// A plan holds its destination as words. The trip map needs a point, so a
// plan is geocoded once — after it is saved, never as part of saving it —
// and the point is kept on the plan (plans.destination_lat / _lng / _label,
// sql/trip-map-2026-09-25.sql).
//
// The rule the point carries is the app's rule: it is stated only when it
// was found. A lookup that failed stores nothing and is asked again; a
// lookup that found no town stores nothing either; nothing is ever placed
// at a default, from the country alone, or at 0,0.
//
// The pure half (what to ask, which pins go where) is here so it can be
// tested; `pinPlan` is the one call that writes.

import type { SupabaseClient } from '@supabase/supabase-js';
import { locatePlanOrFail, type Located } from './discovery/geocode.ts';
import { dayWhere, tripTiming } from './calendar.ts';

/** The plan fields a pin is decided from. */
export interface PinnablePlan {
  id: string;
  title?: string | null;
  type?: string | null;
  destination_city?: string | null;
  destination_country?: string | null;
  destination_style?: string | null;
}

/**
 * What to ask the geocoder about this plan, or null when there is nothing
 * honest to ask.
 *
 * A group trip still deciding where to go has a title like "Where next?"
 * and no destination; any point for it would be of somewhere nobody is
 * going. The title stands in for a missing destination_city only on a trip
 * or a weekend — "Moab, Utah" is a real place to hand a geocoder — and never
 * on a night out, whose title is "Friday drinks" and which a geocoder would
 * still happily find a hamlet for.
 */
export function pinQuestion(plan: PinnablePlan): { titleFallback: boolean } | null {
  if (plan.destination_style === 'undecided') return null;
  const city = String(plan.destination_city ?? '').trim();
  const away = plan.type == null || plan.type === 'trip' || plan.type === 'weekend';
  if (city) return { titleFallback: away };
  if (away && String(plan.title ?? '').trim()) return { titleFallback: true };
  return null;
}

/**
 * Whether a change moves the plan somewhere else on the map: a new city or
 * country, a picked destination, or — for a trip that has no city and is
 * pinned from its title — a new title. Renaming "Moab" to "Moab with the
 * cousins" on a trip whose city is Moab moves nothing.
 */
export function pinMoves(before: PinnablePlan | Omit<PinnablePlan, 'id'>, updates: Record<string, unknown>): boolean {
  const next = (k: 'destination_city' | 'destination_country' | 'title' | 'destination_style') =>
    (k in updates ? updates[k] : before[k]) ?? null;
  const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  if (!same(next('destination_city'), before.destination_city)) return true;
  if (!same(next('destination_country'), before.destination_country)) return true;
  if (before.destination_style === 'undecided' && next('destination_style') !== 'undecided') return true;
  if (!String(next('destination_city') ?? '').trim() && !same(next('title'), before.title)) return true;
  return false;
}

/** The three columns, from a lookup that found somewhere — or null if the point is not one. */
export function pinColumns(found: Located): { destination_lat: number; destination_lng: number; destination_label: string } | null {
  const lat = Number(found.lat);
  const lng = Number(found.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  const label = String(found.label || found.name || '').trim();
  if (!label) return null;
  return { destination_lat: lat, destination_lng: lng, destination_label: label.slice(0, 200) };
}

export type PinOutcome =
  | { outcome: 'stored'; lat: number; lng: number; label: string }
  | { outcome: 'skipped' }        // nothing honest to ask
  | { outcome: 'not_found' }      // asked, and it is not a town
  | { outcome: 'failed' }         // never answered — stored nothing, ask again
  | { outcome: 'moved' }          // the plan's destination changed meanwhile
  | { outcome: 'not_migrated' }   // the columns are not there yet
  | { outcome: 'write_failed'; code?: string };

/** The columns are not there yet, or PostgREST's cache has not heard of them. */
export function columnsMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42703' || e.code === 'PGRST204'
    || (/destination_(lat|lng|label)/.test(e.message || '') && /does not exist|could not find/i.test(e.message || ''));
}

/**
 * Geocode one plan and keep the point. Called after the plan is written.
 *
 * The write is conditional on the plan still describing the place that was
 * looked up: a PATCH that moved the trip to another town while Nominatim was
 * answering would otherwise have the old town's pin written over the new
 * destination.
 */
export async function pinPlan(
  db: SupabaseClient, plan: PinnablePlan, fetchImpl: typeof fetch = fetch,
): Promise<PinOutcome> {
  const ask = pinQuestion(plan);
  if (!ask) return { outcome: 'skipped' };

  const found = await locatePlanOrFail(plan, fetchImpl, ask);
  if (found === 'failed') return { outcome: 'failed' };
  if (!found) return { outcome: 'not_found' };
  const cols = pinColumns(found);
  if (!cols) return { outcome: 'not_found' };

  let q = db.from('plans').update(cols).eq('id', plan.id);
  const city = plan.destination_city ?? null;
  q = city == null ? q.is('destination_city', null) : q.eq('destination_city', city);
  if (plan.title != null) q = q.eq('title', plan.title);
  const { data, error } = await q.select('id');
  if (error) {
    if (columnsMissing(error)) return { outcome: 'not_migrated' };
    return { outcome: 'write_failed', code: error.code };
  }
  if (!data?.length) return { outcome: 'moved' };
  return { outcome: 'stored', lat: cols.destination_lat, lng: cols.destination_lng, label: cols.destination_label };
}

// ─── The map's two lists ────────────────────────────────────────────────

export interface MapPlan {
  id: string;
  group_id: string;
  title?: string | null;
  type?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  destination_lat?: number | string | null;
  destination_lng?: number | string | null;
  destination_label?: string | null;
}

export interface MapPin {
  planId: string;
  label: string;
  lat: number;
  lng: number;
  dates: { start: string | null; end: string | null };
  emoji: string;
}

const EMOJI: Record<string, string> = { trip: '✈️', weekend: '🏡', restaurant: '🍽️', concert: '🎵' };

/**
 * A stored coordinate, or null. PostgREST hands numeric back as a string, and
 * Number(null) is 0 — which is finite, and is the Gulf of Guinea.
 */
function coord(v: unknown, limit: number): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * Upcoming and past, from the plans in my groups and which of them have a
 * confirmed booking.
 *
 * Upcoming: not called off or closed, and not over by its dates (undated
 *   plans are still coming, as everywhere else in the app).
 * Past: over by its dates at the destination, and at least one confirmed
 *   booking. A trip nobody booked anything for is not somewhere we can say
 *   you went.
 *
 * "Over" is judged by the calendar day at the destination's own longitude,
 * not the server's UTC day: a night out in Los Angeles is still tonight at
 * 6pm there, when UTC has already moved on.
 *
 * `myGroups` is checked again here even though the route only asks for my
 * groups' plans: a pin from somebody else's group is the one thing this
 * endpoint must never show, and one filter costs nothing.
 */
export function tripsMap(
  plans: MapPlan[],
  p: { myGroups: Iterable<string>; confirmedPlans: Iterable<string>; now?: Date },
): { upcoming: MapPin[]; past: MapPin[] } {
  const mine = new Set(p.myGroups);
  const confirmed = new Set(p.confirmedPlans);
  const upcoming: MapPin[] = [];
  const past: MapPin[] = [];
  for (const plan of plans) {
    if (!mine.has(String(plan.group_id))) continue;
    const lat = coord(plan.destination_lat, 90);
    const lng = coord(plan.destination_lng, 180);
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    const label = String(plan.destination_label || '').trim();
    if (!label) continue;
    if (plan.status === 'cancelled') continue;

    const pin: MapPin = {
      planId: String(plan.id),
      label,
      lat, lng,
      dates: { start: plan.start_date ?? null, end: plan.end_date ?? null },
      emoji: EMOJI[String(plan.type ?? 'trip')] ?? EMOJI.trip,
    };
    const today = dayWhere(lng, p.now);
    const over = tripTiming({ startDate: plan.start_date, endDate: plan.end_date }, today) === 'over';
    if (over) {
      if (confirmed.has(String(plan.id))) past.push(pin);
    } else if (plan.status !== 'completed') {
      upcoming.push(pin);
    }
  }
  const byStart = (a: MapPin, b: MapPin) => String(a.dates.start ?? '9999').localeCompare(String(b.dates.start ?? '9999'));
  upcoming.sort(byStart);
  past.sort((a, b) => -byStart(a, b));
  return { upcoming, past };
}
