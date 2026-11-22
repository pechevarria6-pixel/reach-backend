// ─── The places the selector may choose from (Task 3, the database half) ──
// Reads destination_profiles, what each one holds (destination_venue_tags),
// and how often each has been offered lately (destination_exposure), and
// shapes them as lib/destination-select.ts Candidates. Writes one thing: the
// exposure count for the places just offered.
//
// Everything here can be missing on a given deployment — the migrations are
// run by hand — and each gap is said, never papered over:
//   · no destination_venue_tags view  → selection is unavailable (no tags,
//     no tag match, so every pick would be a guess);
//   · no popularity/crowd columns     → those are null (unknown), as they
//     would be for a place with no figure anyway;
//   · no destination_exposure table   → nothing has been served, said in the log.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Candidate } from '@/lib/destination-select';
import { tagsFromCounts } from '@/lib/destination-context';

const MISSING_COLUMN = new Set(['42703', 'PGRST204']);
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

type ProfileRow = {
  id: string; city: string; region: string | null; country: string | null;
  lat: number | null; lng: number | null;
  popularity_score?: number | null; crowd_by_month?: Record<string, unknown> | null;
};

const key = (r: { city: string; country: string | null }) => `${r.city.trim().toLowerCase()}|${(r.country ?? '').toLowerCase()}`;

/**
 * One row per place. Cancun, Nassau and San Juan are each three rows today
 * (a NULL region defeats the unique key); the one with a region wins, then
 * the lowest id, so the pick is the same row every time.
 */
export function oneRowPerPlace<T extends ProfileRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    if (!r?.id || !r.city) continue;
    const k = key(r);
    const had = best.get(k);
    if (!had) { best.set(k, r); continue; }
    const better = (!had.region && r.region) || (!!had.region === !!r.region && r.id < had.id);
    if (better) best.set(k, r);
  }
  return [...best.values()];
}

export type Loaded =
  | { ok: true; candidates: Candidate[]; notes: string[] }
  | { ok: false; why: string };

/** The 1–12 figure for a month from crowd_by_month, or null. */
export function crowdFor(byMonth: unknown, month: number): number | null {
  if (!byMonth || typeof byMonth !== 'object') return null;
  const v = Number((byMonth as Record<string, unknown>)[String(month)]);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

export async function loadCandidates(db: SupabaseClient, opts: { month: number; todayISO: string }): Promise<Loaded> {
  const notes: string[] = [];

  let profiles: ProfileRow[] | null = null;
  const full = await db.from('destination_profiles').select('id, city, region, country, lat, lng, popularity_score, crowd_by_month');
  if (full.error && MISSING_COLUMN.has(String(full.error.code))) {
    notes.push('popularity and crowd columns not migrated: both unknown');
    const base = await db.from('destination_profiles').select('id, city, region, country, lat, lng');
    if (base.error) return { ok: false, why: `destination_profiles unreadable (${base.error.code})` };
    profiles = base.data as ProfileRow[];
  } else if (full.error) {
    return { ok: false, why: `destination_profiles unreadable (${full.error.code})` };
  } else {
    profiles = full.data as ProfileRow[];
  }
  const places = oneRowPerPlace(profiles ?? []);
  if (!places.length) return { ok: false, why: 'no destination profiles' };

  const tags = await db.from('destination_venue_tags').select('destination_id, interest, venues').in('destination_id', places.map(p => p.id));
  if (tags.error) {
    return { ok: false, why: MISSING_TABLE.has(String(tags.error.code)) ? 'destination_venue_tags not created yet' : `destination_venue_tags unreadable (${tags.error.code})` };
  }
  const byPlace = new Map<string, Record<string, number>>();
  for (const t of (tags.data ?? []) as { destination_id: string; interest: string; venues: number }[]) {
    const m = byPlace.get(t.destination_id) ?? {};
    m[String(t.interest).toLowerCase()] = Number(t.venues) || 0;
    byPlace.set(t.destination_id, m);
  }

  const since = new Date(`${opts.todayISO}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 30);
  const served = new Map<string, number>();
  const exp = await db.from('destination_exposure').select('destination_id, served_count')
    .gte('served_on', since.toISOString().slice(0, 10)).in('destination_id', places.map(p => p.id));
  if (exp.error) {
    notes.push(MISSING_TABLE.has(String(exp.error.code)) ? 'destination_exposure not created yet: nothing counted as served' : `destination_exposure unreadable (${exp.error.code}): nothing counted as served`);
  } else {
    for (const e of (exp.data ?? []) as { destination_id: string; served_count: number }[]) {
      served.set(e.destination_id, (served.get(e.destination_id) ?? 0) + (Number(e.served_count) || 0));
    }
  }

  const candidates: Candidate[] = places.map(p => {
    const counts = byPlace.get(p.id) ?? {};
    return {
      id: p.id,
      name: p.city,
      region: p.region ?? null,
      lat: Number.isFinite(p.lat) ? (p.lat as number) : null,
      lng: Number.isFinite(p.lng) ? (p.lng as number) : null,
      popularity: p.popularity_score == null ? null : Number(p.popularity_score),
      crowdThisMonth: crowdFor(p.crowd_by_month, opts.month),
      servedLast30d: served.get(p.id) ?? 0,
      // Priced by the model once the places are fixed; travel needs
      // coordinates nobody has loaded yet. Unknown, not zero.
      pricedPerPersonCents: null,
      travelMinutes: null,
      tags: tagsFromCounts(counts),
      verifiedVenueCount: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  });
  return { ok: true, candidates, notes };
}

/** The group's past trips, as candidate ids: somewhere they have been is not a new idea. */
export async function visitedIds(db: SupabaseClient, groupId: string, todayISO: string, candidates: Candidate[]): Promise<string[]> {
  const { data, error } = await db.from('plans').select('destination_city, status, end_date')
    .eq('group_id', groupId).lt('end_date', todayISO).neq('status', 'cancelled');
  if (error) { console.error('[destinations] could not read where this group has been', { groupId, code: error.code }); return []; }
  const been = new Set((data ?? []).map(r => String(r.destination_city ?? '').trim().toLowerCase()).filter(Boolean));
  return candidates.filter(c => been.has(c.name.trim().toLowerCase())).map(c => c.id);
}

/** Count the places just offered. One statement in the database; a failure is logged, not thrown. */
export async function recordServed(db: SupabaseClient, ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const { error } = await db.rpc('bump_destination_exposure', { ids });
  if (error) {
    console.error('[destinations] could not count the places offered', { code: error.code, count: ids.length });
    return false;
  }
  return true;
}
