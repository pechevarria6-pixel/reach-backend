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
// Shared by everybody, so kept for everybody: the towns and their counts
// change when the weekly load or the nightly sweep runs, not between two
// people opening Home. Six hours, per server instance, per town.
//
// ── Why per town, and why on a budget ──────────────────────────────────
// This used to count every town (83 of them, up to five thousand rows
// each) before answering anybody. That took 30–76 seconds against the live
// table, so on a fresh instance /api/recommendations/trips hit its 30s
// limit on every call — and because the instance was killed mid-count, the
// six-hour cache it was filling never got filled. Home's "Ideas for you"
// was a 504 for everyone, every time (measured 2026-11-05).
//
// Now one request counts the towns that matter to the person asking —
// within a weekend's drive first, nearest first, then the rest in list
// order — for at most `budgetMs` (less, once every town within a drive
// and a dozen flights are in), and every town it finishes is kept for the
// next request. A town not counted in time is not suggested this time
// (fewer cards, never a slow Home), and the route says so honestly rather
// than claiming we hold nothing. A count still going when the budget runs
// out carries on and is kept for whoever asks next; a hard per-read limit
// stops a stuck read lingering.
//
// Pages are read by id (keyset), not by offset: the fifth thousand rows of
// central London by offset made Postgres walk past the first four
// thousand again on every page (5.1s against 1.8s measured).
import type { SupabaseClient } from '@supabase/supabase-js';
import { WORLD_DESTINATIONS } from '../discovery/world-destinations.ts';
import { BANDS, candidatesFrom, milesBetween, nameTags, type Candidate, type Holdings } from './trip-picks.ts';

/** The menu's widest box (real-places.ts RINGS_MILES). */
const MENU_MILES = 25;
const PAGE = 1000;
/** Past this the count is a floor, and the card says "+". */
const MAX_PAGES = 5;
/** Reads in flight at once. More than this and each one slows the others. */
const CONCURRENCY = 8;
const TTL_MS = 6 * 60 * 60 * 1000;
/** One town's count, however slow the table is. Past it, the town is left for later. */
const READ_LIMIT_MS = 12_000;
/** Flights counted before an answer need not wait for more: four cards hold one or two. */
const FAR_ENOUGH = 12;

type Kept<T> = { at: number; value: T };
let candidatesKept: Kept<Candidate[]> | null = null;
let candidatesInFlight: Promise<Candidate[]> | null = null;
const towns = new Map<string, Kept<Holdings>>();
const counting = new Map<string, Promise<Holdings | null>>();

/** For tests: forget everything kept. */
export function forgetHoldings() {
  candidatesKept = null;
  candidatesInFlight = null;
  towns.clear();
  counting.clear();
}

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

/** The candidates, kept six hours, one read in flight at a time. */
export async function candidates(db: SupabaseClient, now = Date.now()): Promise<Candidate[]> {
  if (candidatesKept && now - candidatesKept.at < TTL_MS) return candidatesKept.value;
  if (candidatesInFlight) return candidatesInFlight;
  candidatesInFlight = (async () => {
    const value = await loadCandidates(db);
    candidatesKept = { at: Date.now(), value };
    return value;
  })();
  try { return await candidatesInFlight; } finally { candidatesInFlight = null; }
}

/**
 * The live venues in one town's box, counted by interest and kind. Null
 * when the read failed — a town we could not count is a town we do not
 * suggest, which is the safe way round.
 */
export async function holdingsAt(
  db: SupabaseClient, at: { lat: number; lng: number }, signal?: AbortSignal,
): Promise<Holdings | null> {
  const { dLat, dLng } = boxAround(at.lat, MENU_MILES);
  const counts: Record<string, number> = {};
  const read = async (live: boolean) => {
    for (const k of Object.keys(counts)) delete counts[k];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = db.from('discovery_venues')
        .select('id, name, interest, kind')
        .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
        .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng)
        .neq('interest', 'places to stay');
      if (live) q = q.is('gone_at', null);
      if (after !== null) q = q.gt('id', after);
      let built = q.order('id').limit(PAGE);
      if (signal) built = built.abortSignal(signal);
      const { data, error } = await built;
      if (error) return { error, floor: false };
      const rows = (data ?? []) as Array<{ id: string; name: string | null; interest: string | null; kind: string | null }>;
      for (const r of rows) {
        const tags = nameTags(r.name).join(' ');
        const key = `${String(r.interest ?? '').trim()}|${String(r.kind ?? '').replace(/_/g, ' ').trim()}${tags ? `|${tags}` : ''}`;
        if (key.startsWith('|')) continue;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      if (rows.length < PAGE) return { error: null, floor: false };
      after = String(rows[rows.length - 1].id);
    }
    return { error: null, floor: true };
  };
  let r = await read(true);
  // gone_at arrives with sql/world-data-phase1-2026-09-24.sql. Before it,
  // nothing has been retired, so reading without the filter is the same answer.
  if (r.error && (r.error.code === '42703' || /gone_at/.test(r.error.message || ''))) r = await read(false);
  if (r.error) {
    // An abort is our own limit, not the table failing: said once, quietly.
    if (signal?.aborted) console.warn('[trip-picks] a town took too long to count; left for later', { at });
    else console.error('[trip-picks] could not count venues', { code: r.error.code, message: r.error.message });
    return null;
  }
  return { counts, floor: r.floor };
}

/**
 * The order to count towns in for somebody at `home`: within a weekend's
 * drive first, nearest first — that is the night out and the drives, and
 * there are few of them — then everything else in list order (the world
 * list comes first, by rank). No home: list order.
 */
export function countOrder(list: Candidate[], home: { lat: number; lng: number } | null): Candidate[] {
  if (!home) return [...list];
  const withMiles = list.map((c, i) => ({ c, i, d: milesBetween(home, c) }));
  const near = withMiles.filter(x => x.d <= BANDS.weekendMax).sort((a, b) => a.d - b.d || a.i - b.i);
  const far = withMiles.filter(x => x.d > BANDS.weekendMax);
  return [...near, ...far].map(x => x.c);
}

export interface HeldFor {
  holdings: Map<string, Holdings>;
  /** Towns not counted in time (or whose read failed) this request. */
  unread: number;
}

/**
 * The counts for these candidates, from what is kept and what can be
 * counted within `budgetMs`. Never waits past the budget.
 */
export async function holdingsFor(
  db: SupabaseClient,
  list: Candidate[],
  home: { lat: number; lng: number } | null,
  opts: { budgetMs: number; now?: () => number; concurrency?: number; readLimitMs?: number; farEnough?: number },
): Promise<HeldFor> {
  const now = opts.now ?? Date.now;
  const holdings = new Map<string, Holdings>();
  const todo: Candidate[] = [];
  for (const c of countOrder(list, home)) {
    const kept = towns.get(c.key);
    if (kept && now() - kept.at < TTL_MS) holdings.set(c.key, kept.value);
    else todo.push(c);
  }
  if (!todo.length) return { holdings, unread: 0 };

  const start = now();
  let answered = false;
  let next = 0;
  // Enough to answer before the budget is spent: every town within a
  // drive settled (counted, or its read failed), and FAR_ENOUGH flights
  // to choose among. The workers carry on counting the rest until the
  // budget is spent, for the next load; this one does not wait for them.
  const near = new Set(list.filter(c => home && milesBetween(home, c) <= BANDS.weekendMax).map(c => c.key));
  const nearOpen = new Set(todo.filter(c => near.has(c.key)).map(c => c.key));
  const farHeld = () => [...holdings.keys()].filter(k => !near.has(k)).length;
  let enough: () => void = () => {};
  const enoughNow = new Promise<void>(resolve => { enough = resolve; });
  const check = () => { if (!nearOpen.size && farHeld() >= (opts.farEnough ?? FAR_ENOUGH)) enough(); };
  check();
  const countOne = (c: Candidate): Promise<Holdings | null> => {
    const going = counting.get(c.key);
    if (going) return going;
    const p = holdingsAt(db, c, AbortSignal.timeout(opts.readLimitMs ?? READ_LIMIT_MS))
      .catch(() => null)
      .then(h => {
        if (h) towns.set(c.key, { at: now(), value: h });
        return h;
      })
      .finally(() => counting.delete(c.key));
    counting.set(c.key, p);
    return p;
  };
  const worker = async () => {
    while (next < todo.length && now() - start < opts.budgetMs) {
      const c = todo[next++];
      const h = await countOne(c);
      // Only what landed before the answer goes on it; anything later is
      // kept for the next one.
      if (answered) continue;
      if (h) holdings.set(c.key, h);
      nearOpen.delete(c.key);
      check();
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(opts.concurrency ?? CONCURRENCY, todo.length) }, worker));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    workers,
    enoughNow,
    new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, opts.budgetMs)); }),
  ]);
  clearTimeout(timer);
  answered = true;
  const unread = list.filter(c => !holdings.has(c.key)).length;
  return { holdings, unread };
}
