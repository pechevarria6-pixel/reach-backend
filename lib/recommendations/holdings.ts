// ─── What we hold around each town we might suggest ─────────────────────
// The counts behind every recommended trip on Home. Read from our own
// tables only — the weekly map load and the nightly sweep fill them — and
// never from a provider or a model in the request.
//
// Counted in the same twenty-five mile box the itinerary menu reads
// (real-places.ts RINGS_MILES), so "38 places to eat we've checked" on a
// card is the menu the trip would be written from, not a bigger number from
// somewhere nearby.
//
// Shared by everybody, so cached for everybody: the towns and their counts
// change when the weekly load or the nightly sweep runs, not between two
// people opening Home. Six hours, per server instance, with one read in
// flight at a time so a cold start does not send the same sixty queries
// once per visitor.
import type { SupabaseClient } from '@supabase/supabase-js';
import { WORLD_DESTINATIONS } from '../discovery/world-destinations.ts';
import { candidatesFrom, nameTags, type Candidate, type Holdings } from './trip-picks.ts';

/** The menu's widest box (real-places.ts RINGS_MILES). */
const MENU_MILES = 25;
const PAGE = 1000;
/** Past this the count is a floor, and the card says "+". */
const MAX_PAGES = 5;
const BATCH = 8;
const TTL_MS = 6 * 60 * 60 * 1000;

type Snapshot = { at: number; candidates: Candidate[]; holdings: Map<string, Holdings> };
let held: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

function boxAround(lat: number, miles: number) {
  return { dLat: miles / 69, dLng: miles / Math.max(1, 69 * Math.cos((lat * Math.PI) / 180)) };
}

/** Every town worth considering: the world list, the load's seeds, Discover's areas. */
export async function loadCandidates(db: SupabaseClient): Promise<Candidate[]> {
  const [seeds, areas] = await Promise.all([
    db.from('ingest_seeds').select('name, lat, lng, region').limit(2000),
    db.from('discovery_areas').select('city, lat, lng').limit(2000),
  ]);
  // Either table missing is a migration not yet run, not a reason to show
  // nothing: the other two sources still stand.
  if (seeds.error) console.error('[trip-picks] could not read ingest_seeds', { code: seeds.error.code });
  if (areas.error) console.error('[trip-picks] could not read discovery_areas', { code: areas.error.code });
  return candidatesFrom({
    world: [...WORLD_DESTINATIONS],
    seeds: (seeds.data ?? []) as Array<{ name: string | null; lat: number | null; lng: number | null; region: string | null }>,
    areas: (areas.data ?? []) as Array<{ city: string | null; lat: number | null; lng: number | null }>,
  });
}

/**
 * The live venues in one town's box, counted by interest and kind. Null
 * when the read failed — a town we could not count is a town we do not
 * suggest, which is the safe way round.
 */
export async function holdingsAt(db: SupabaseClient, at: { lat: number; lng: number }): Promise<Holdings | null> {
  const { dLat, dLng } = boxAround(at.lat, MENU_MILES);
  const counts: Record<string, number> = {};
  const read = async (live: boolean) => {
    for (const k of Object.keys(counts)) delete counts[k];
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = db.from('discovery_venues')
        .select('id, name, interest, kind')
        .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
        .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng)
        .neq('interest', 'places to stay');
      if (live) q = q.is('gone_at', null);
      const { data, error } = await q.order('id').range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return { error, floor: false };
      for (const r of (data ?? []) as Array<{ name: string | null; interest: string | null; kind: string | null }>) {
        const tags = nameTags(r.name).join(' ');
        const key = `${String(r.interest ?? '').trim()}|${String(r.kind ?? '').replace(/_/g, ' ').trim()}${tags ? `|${tags}` : ''}`;
        if (key.startsWith('|')) continue;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      if ((data ?? []).length < PAGE) return { error: null, floor: false };
    }
    return { error: null, floor: true };
  };
  let r = await read(true);
  // gone_at arrives with sql/world-data-phase1-2026-09-24.sql. Before it,
  // nothing has been retired, so reading without the filter is the same answer.
  if (r.error && (r.error.code === '42703' || /gone_at/.test(r.error.message || ''))) r = await read(false);
  if (r.error) {
    console.error('[trip-picks] could not count venues', { code: r.error.code, message: r.error.message });
    return null;
  }
  return { counts, floor: r.floor };
}

/** Candidates and their counts, cached (see the header). */
export async function snapshot(db: SupabaseClient, now = Date.now()): Promise<Snapshot> {
  if (held && now - held.at < TTL_MS) return held;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const candidates = await loadCandidates(db);
    // Keyed by candidate.key, which candidatesFrom keeps unique (state, then
    // the point) so two same-name towns never write over each other's counts.
    const holdings = new Map<string, Holdings>();
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const got = await Promise.all(batch.map(c => holdingsAt(db, c)));
      batch.forEach((c, j) => { if (got[j]) holdings.set(c.key, got[j]!); });
    }
    held = { at: Date.now(), candidates, holdings };
    return held;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}
