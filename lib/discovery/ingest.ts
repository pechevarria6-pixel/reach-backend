// ─── The weekly map load, as decisions rather than plumbing ──────────────
// scripts/ingest/osm-ingest.mjs downloads a state or a country from
// Geofabrik, cuts it down with osmium, and writes what is left into
// discovery_venues. Everything that decides WHAT is written lives here,
// where it can be tested with a handful of made-up features instead of a
// four-hundred-megabyte download:
//
//   - which tags make something a place worth holding, and which interest
//     it is filed under (the same selectors the sweep sends to Overpass);
//   - the name-and-website rule: a place we cannot send anybody to is not a
//     place we name (the owner's rule, and the sweep's);
//   - one row per place per interest, because Postgres refuses an upsert
//     that names the same row twice and takes the whole batch with it;
//   - when a place has gone: missing from two weekly downloads in a row,
//     inside a circle we actually read, and never on a run that looks broken.
import { matchesSelector, websiteOf, siteUrl, whatOf, visitTagsOf, streetOf, LODGING } from './osm.ts';
import { mappableKinds, kindFor, QUIZ_CUISINES } from './taste.ts';
import { canTurnUp } from './rules.ts';
import { dialable } from './phone.ts';
import { milesBetween } from './cache.ts';
import type { Seed } from './regions.ts';

type Tags = Record<string, string>;

const STAY = 'places to stay';

/**
 * The interests a mapped place answers, in the quiz's words — the vocabulary
 * discovery_venues.interest is stored in.
 *
 * Every fixed kind whose selectors match, not only the first: the sweep files
 * a theatre under whichever of "film & theatre" or "comedy" the person asked
 * about, and a bulk load has nobody asking, so it files it under both and
 * Discover finds it either way. The menu de-duplicates by name.
 *
 * Somewhere to sleep is only ever somewhere to sleep. A hotel that also
 * carries `amenity=restaurant` on the same point is still filed as lodging
 * and nothing else, so no menu can offer it as dinner.
 */
export function interestsFor(tags: Tags): string[] {
  if (LODGING.has(tags.tourism ?? '')) return [STAY];
  const found = mappableKinds()
    .filter(k => k.key !== STAY && k.osm.some(sel => matchesSelector(sel, tags)))
    .map(k => k.key);
  // The cuisines the quiz offers, asked exactly as the sweep asks them:
  // kindFor("thai restaurants") is `amenity=restaurant][cuisine~"thai",i`.
  for (const cuisine of QUIZ_CUISINES) {
    const k = kindFor(`${cuisine} restaurants`);
    if (k.osm.some(sel => matchesSelector(sel, tags))) found.push(k.key);
  }
  return [...new Set(found)];
}

/**
 * What osmium keeps from the download before anything else looks at it.
 *
 * Built from the same selectors, first condition only (`amenity=bar` out of
 * `amenity=bar][live_music~"yes"`): osmium cannot evaluate the rest, so it
 * over-keeps and interestsFor() makes the real decision. The expressions are
 * one per key, e.g. `nwr/amenity=arts_centre,bar,cafe,...`.
 */
export function osmiumFilters(): string[] {
  const byKey = new Map<string, Set<string>>();
  const selectors = [
    ...mappableKinds().flatMap(k => k.osm),
    ...QUIZ_CUISINES.flatMap(c => kindFor(`${c} restaurants`).osm),
  ];
  for (const sel of selectors) {
    const first = sel.split('][')[0];
    const m = /^([a-z_:]+)=([a-z_]+)$/.exec(first);
    if (!m) throw new Error(`a selector osmium cannot pre-filter: ${sel}`);
    const values = byKey.get(m[1]) ?? new Set<string>();
    values.add(m[2]);
    byKey.set(m[1], values);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, vs]) => `nwr/${k}=${[...vs].sort().join(',')}`);
}

/** A GeoJSON feature as `osmium export -a type,id` writes it. */
export interface MapFeature {
  type?: string;
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown>;
}

/**
 * A point for a feature: the node itself, or the middle of a way's or an
 * area's extent. The middle of the box rather than a true centroid — a park
 * shaped like a crescent has a centroid in somebody's back garden, and the
 * box's middle is at least inside the park's own bounds.
 */
export function featureCentre(geometry: MapFeature['geometry']): { lat: number; lng: number } | null {
  if (!geometry) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      const [lng, lat] = c as number[];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      return;
    }
    for (const inner of c) walk(inner);
  };
  walk(geometry.coordinates);
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  const lat = Number(((minLat + maxLat) / 2).toFixed(7));
  const lng = Number(((minLng + maxLng) / 2).toFixed(7));
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** The seeds whose circle this point is inside. */
export function seedsCovering(at: { lat: number; lng: number }, seeds: Seed[]): Seed[] {
  return seeds.filter(s => milesBetween(s.lat, s.lng, at.lat, at.lng) <= (s.radius_miles ?? 100));
}

export interface VenueRow {
  osm_type: string;
  osm_id: number;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  website: string;
  interest: string;
  kind: string | null;
  street?: string;
  region: string;
  last_seen_at: string;
  gone_at: null;
  phone?: string;
  opening_hours: string | null;
  osm_tags: Record<string, string> | null;
  harvest_status?: 'skip';
}

export type Skip = 'no_name' | 'no_website' | 'no_point' | 'outside' | 'not_a_kind' | 'cannot_turn_up' | 'no_id';

/**
 * The rows one mapped feature becomes, or why it becomes none.
 *
 * `seenAt` is the run's start, the same instant on every row, so "not seen
 * since the last run started" is a plain comparison when places are retired.
 */
export function rowsFor(
  feature: MapFeature,
  seeds: Seed[],
  region: string,
  seenAt: string,
): { rows: VenueRow[]; seeds: Seed[] } | { skip: Skip } {
  const props = feature.properties ?? {};
  const tags: Tags = {};
  for (const [k, v] of Object.entries(props)) {
    if (!k.startsWith('@') && typeof v === 'string') tags[k] = v;
  }
  const osmType = String(props['@type'] ?? '');
  const osmId = Number(props['@id']);
  if (!['node', 'way', 'relation'].includes(osmType) || !Number.isInteger(osmId) || osmId <= 0) return { skip: 'no_id' };

  // Name AND website, the owner's rule: no name is a fence somebody mapped,
  // no website is a place we cannot send anybody to.
  const name = (tags.name || '').trim();
  if (!name) return { skip: 'no_name' };
  const site = websiteOf(tags);
  if (!site) return { skip: 'no_website' };

  const at = featureCentre(feature.geometry);
  if (!at) return { skip: 'no_point' };
  const covering = seedsCovering(at, seeds);
  if (!covering.length) return { skip: 'outside' };

  const interests = interestsFor(tags);
  if (!interests.length) return { skip: 'not_a_kind' };
  const kind = whatOf(tags) || null;
  // A caterer or a campus can carry a tag we asked for. Neither is a night out.
  if (!canTurnUp(name, [kind ?? ''])) return { skip: 'cannot_turn_up' };

  // Two kinds of column here. The phone, the town and the street have other
  // writers — the platforms job finds phone numbers on venues' own pages,
  // the sweep files a venue under the town it swept — so they are written
  // only when the map has them, and a key left out of the write is a column
  // left alone (see shapeBatches for why that needs care). The website is
  // always present: without one the place is not written at all.
  //
  // The hours and the visit tags have one writer, the map, and the menu
  // quotes the hours as "per OpenStreetMap". So those are written as the
  // map has them now, null included: hours a mapper has since removed are
  // no longer the map's to quote.
  const phone = dialable(tags.phone || tags['contact:phone'], tags['addr:country'] || null);
  const hours = (tags.opening_hours || '').trim();
  const visit = visitTagsOf(tags);
  // The map's own town, or nothing. The nearest seed's name would put a
  // Baltimore bar "in Washington".
  const city = tags['addr:city']?.trim();
  const street = streetOf(tags);

  const base = {
    osm_type: osmType,
    osm_id: osmId,
    name,
    lat: at.lat,
    lng: at.lng,
    website: siteUrl(site),
    kind,
    region,
    last_seen_at: seenAt,
    gone_at: null,
    opening_hours: hours || null,
    osm_tags: Object.keys(visit).length ? visit : null,
    ...(city ? { city } : {}),
    ...(street ? { street } : {}),
    ...(phone ? { phone } : {}),
  };
  const rows: VenueRow[] = interests.map(interest => ({
    ...base,
    interest,
    // A restaurant's site is a menu; the harvest should spend its nightly
    // budget on the studio. Same marking the sweep applies. Left out rather
    // than nulled for the rest, so whatever the harvest recorded survives.
    ...(kindFor(interest).harvest ? {} : { harvest_status: 'skip' as const }),
  }));
  return { rows, seeds: covering };
}

/** One row per (osm_type, osm_id, interest), the table's own unique rule. */
export function dedupeRows<T extends { osm_type: string; osm_id: number; interest: string }>(rows: T[]): T[] {
  const kept = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.osm_type}/${r.osm_id}/${r.interest}`;
    if (!kept.has(key)) kept.set(key, r);
  }
  return [...kept.values()];
}

/**
 * Rows grouped so every row in a write has the same columns, then chunked.
 *
 * supabase-js sends a bulk upsert with the union of every row's keys, and a
 * row missing one of them is written as NULL (`defaultToNull` is on by
 * default, and `missing=default` would still overwrite on conflict). So one
 * venue with a phone in a batch of five hundred without used to wipe the
 * phone number of every other venue in it. Grouped by shape, a column a row
 * does not carry is not in its write at all.
 */
export function shapeBatches<T extends object>(rows: T[], size = 500): T[][] {
  const byShape = new Map<string, T[]>();
  for (const r of rows) {
    const shape = Object.keys(r).sort().join(',');
    const list = byShape.get(shape) ?? [];
    list.push(r);
    byShape.set(shape, list);
  }
  const batches: T[][] = [];
  for (const list of byShape.values()) {
    for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  }
  return batches;
}

// ─── When a place has gone ───────────────────────────────────────────────

export interface HeldVenue {
  id: string;
  lat: number;
  lng: number;
  last_seen_at: string | null;
}

/**
 * The venues to mark gone after a good run.
 *
 * Gone means: not in this week's download and not in last week's either —
 * its last sighting is older than the start of the previous good run. One
 * missed week is a mapper mid-edit or a flaky extract, and the place stays.
 *
 * And only inside a circle this run actually read. A seed that was removed
 * or shrunk stops the job looking there, and not looking is not evidence
 * that anything closed.
 */
export function goneVenues(held: HeldVenue[], previousRunStartedAt: string | null, seeds: Seed[]): string[] {
  if (!previousRunStartedAt) return [];
  const before = Date.parse(previousRunStartedAt);
  if (!Number.isFinite(before)) return [];
  return held
    .filter(v => {
      const seen = v.last_seen_at ? Date.parse(v.last_seen_at) : NaN;
      // Never seen by any run is not "seen and then missing". Leave it.
      if (!Number.isFinite(seen)) return false;
      return seen < before && seedsCovering({ lat: Number(v.lat), lng: Number(v.lng) }, seeds).length > 0;
    })
    .map(v => v.id);
}

/**
 * Whether this run is healthy enough to retire anything on its word.
 *
 * A truncated download, a Geofabrik hiccup or an osmium flag gone wrong all
 * look like "most of the state closed this week". A run that kept less than
 * half of what the last good run kept is treated as broken: it stores what
 * it found and retires nothing.
 */
export function trustworthyRun(keptNow: number, keptLastTime: number | null): boolean {
  if (keptNow <= 0) return false;
  if (!keptLastTime) return true;
  return keptNow >= keptLastTime * 0.5;
}

/**
 * Whether the first bytes of a download are an OpenStreetMap PBF.
 *
 * A wrong Geofabrik path does not 404: it redirects to the home page and
 * answers 200 with HTML. Every PBF opens with a blob header whose type is
 * the string "OSMHeader", so that is what is looked for — not the status
 * code and not the file's size.
 */
export function looksLikePbf(head: Uint8Array): boolean {
  if (!head || head.length < 15) return false;
  const tag = String.fromCharCode(...head.slice(6, 15));
  return head[4] === 0x0a && head[5] === 0x09 && tag === 'OSMHeader';
}

/**
 * Places kept per seed, each place counted once however many interests it
 * was filed under. The number a person reading the log can check against
 * the map: "Raleigh 812" means 812 places, not 812 rows.
 */
export function countPerSeed(kept: Array<{ key: string; seeds: Seed[] }>): Record<string, number> {
  const bySeed = new Map<string, Set<string>>();
  for (const { key, seeds } of kept) {
    for (const s of seeds) {
      const set = bySeed.get(s.name) ?? new Set<string>();
      set.add(key);
      bySeed.set(s.name, set);
    }
  }
  return Object.fromEntries([...bySeed.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, set]) => [n, set.size]));
}

// ─── One region's run, start to finish ───────────────────────────────────
// The script does the downloading and the osmium; this does the rest, over a
// database it is handed, so the whole run — the write, the retiring, the
// bookkeeping and the exit code — can be driven by a test with a fake.

/** What a PostgREST call came back with. Never thrown: always looked at. */
export interface DbResult {
  data: any;
  error: { code?: string; message?: string } | null;
}

/** The four calls a run makes. scripts/ingest/rest.mjs is the real one. */
export interface IngestDb {
  get(path: string): Promise<DbResult>;
  upsert(table: string, rows: object[], onConflict: string): Promise<DbResult>;
  insert(table: string, row: object): Promise<DbResult>;
  patch(pathWithFilter: string, body: object): Promise<DbResult>;
}

export interface IngestReport {
  region: string;
  startedAt: string;
  /** Places kept, each counted once however many interests it has. */
  kept: number;
  /** Rows written: one per place per interest. */
  written: number;
  /** Rows that did not store. Any at all fails the run. */
  failed: number;
  retired: number;
  perSeed: Record<string, number>;
  skipped: Partial<Record<Skip, number>>;
  /** Whether this run was sound enough to retire anything on its word. */
  trusted: boolean;
  /** Everything that went wrong, in words, for the log. */
  problems: string[];
  ok: boolean;
}

const enc = encodeURIComponent;
const describe = (e: DbResult['error']) => `${e?.code ?? '?'} ${e?.message ?? ''}`.trim();

/** Every row a GET would return, a thousand at a time. */
async function readAll(db: IngestDb, path: string, page = 1000): Promise<DbResult> {
  const out: unknown[] = [];
  for (let offset = 0; ; offset += page) {
    const { data, error } = await db.get(`${path}&limit=${page}&offset=${offset}`);
    if (error) return { data: null, error };
    out.push(...(data ?? []));
    if (!data || data.length < page) return { data: out, error: null };
  }
}

/**
 * Read one region's features, write what they hold, retire what has gone.
 *
 * In order, because the order is the safety:
 *   1. find the last good run, and record that this one has started;
 *   2. write every row, and when a batch fails, write its rows one at a
 *      time so the log names the venue that would not store;
 *   3. only if nothing failed and the run kept a believable number of
 *      places, mark gone what two runs in a row did not see;
 *   4. record how it went. A run that failed says so in ingest_runs, and
 *      does not count as "the last good run" for next week.
 */
export async function ingestRegion(input: {
  db: IngestDb | null;
  region: string;
  seeds: Seed[];
  features: AsyncIterable<MapFeature> | Iterable<MapFeature>;
  now?: Date;
  log?: (line: string) => void;
  batchSize?: number;
  /**
   * Accept a run that kept under half of last time's places. Only for the
   * week after seeds were deliberately removed or shrunk; see docs/INGEST.md.
   */
  acceptDrop?: boolean;
}): Promise<IngestReport> {
  const { db, region, seeds } = input;
  const log = input.log ?? (line => console.log(line));
  const startedAt = (input.now ?? new Date()).toISOString();
  const report: IngestReport = {
    region, startedAt, kept: 0, written: 0, failed: 0, retired: 0,
    perSeed: {}, skipped: {}, trusted: false, problems: [], ok: false,
  };
  const fail = (why: string) => { report.problems.push(why); log(`  ✗ ${why}`); return report; };

  // 1. The last good run, and this one's row.
  let previous: { started_at: string; kept: number | null } | null = null;
  let runId: string | null = null;
  if (db) {
    const prev = await db.get(`ingest_runs?select=started_at,kept&region=eq.${enc(region)}&status=eq.ok&order=started_at.desc&limit=1`);
    if (prev.error) return fail(`could not read the last run: ${describe(prev.error)}`);
    previous = prev.data?.[0] ?? null;
    const run = await db.insert('ingest_runs', { region, started_at: startedAt, status: 'running' });
    if (run.error) return fail(`could not record the run: ${describe(run.error)}`);
    runId = run.data?.[0]?.id ?? null;
  }

  // 2. What the download holds.
  const rows: VenueRow[] = [];
  const kept: Array<{ key: string; seeds: Seed[] }> = [];
  const places = new Set<string>();
  for await (const feature of input.features) {
    const out = rowsFor(feature, seeds, region, startedAt);
    if ('skip' in out) {
      report.skipped[out.skip] = (report.skipped[out.skip] ?? 0) + 1;
      continue;
    }
    const key = `${out.rows[0].osm_type}/${out.rows[0].osm_id}`;
    // osmium can export a closed way twice, as a line and as an area.
    if (!places.has(key)) {
      places.add(key);
      kept.push({ key, seeds: out.seeds });
    }
    rows.push(...out.rows);
  }
  report.kept = places.size;
  report.perSeed = countPerSeed(kept);
  const unique = dedupeRows(rows);

  if (db) {
    for (const batch of shapeBatches(unique, input.batchSize ?? 500)) {
      const { error } = await db.upsert('discovery_venues', batch, 'osm_type,osm_id,interest');
      if (!error) { report.written += batch.length; continue; }
      log(`  batch of ${batch.length} did not store (${describe(error)}) — writing them one at a time`);
      for (const row of batch) {
        const one = await db.upsert('discovery_venues', [row], 'osm_type,osm_id,interest');
        if (one.error) {
          report.failed++;
          report.problems.push(`${row.osm_type}/${row.osm_id} "${row.name}" (${row.interest}): ${describe(one.error)}`);
        } else {
          report.written++;
        }
      }
    }
  } else {
    report.written = unique.length;
  }

  // 3. What has gone. Never on a run that lost a write or kept too little.
  //
  // A run that kept too little is not only barred from retiring: it fails,
  // so it is never "the last good run" whose start next week's run measures
  // from. A broken download recorded as good would make one real miss look
  // like two.
  const believable = input.acceptDrop ? report.kept > 0 : trustworthyRun(report.kept, previous?.kept ?? null);
  report.trusted = report.failed === 0 && believable;
  if (!believable) {
    fail(`kept ${report.kept} places against ${previous?.kept ?? 0} last time — a broken download looks like this, so nothing is retired and the run is not counted as good`);
  }
  if (db && report.trusted && previous?.started_at) {
    const held = await readAll(db,
      `discovery_venues?select=id,lat,lng,last_seen_at&region=eq.${enc(region)}&gone_at=is.null&last_seen_at=lt.${enc(previous.started_at)}&order=id`);
    if (held.error) {
      report.problems.push(`could not read what might have gone: ${describe(held.error)}`);
    } else {
      const gone = goneVenues(held.data ?? [], previous.started_at, seeds);
      for (let i = 0; i < gone.length; i += 100) {
        const ids = gone.slice(i, i + 100);
        const { error } = await db.patch(`discovery_venues?id=in.(${ids.join(',')})&gone_at=is.null`, { gone_at: startedAt });
        if (error) {
          report.failed += ids.length;
          report.problems.push(`could not mark ${ids.length} venues gone: ${describe(error)}`);
        } else {
          report.retired += ids.length;
        }
      }
    }
  } else if (db && report.failed) {
    log(`  retiring nothing: ${report.failed} rows did not store`);
  }

  // 4. How it went.
  report.ok = report.failed === 0 && report.problems.length === 0;
  if (db && report.ok) {
    const { error } = await db.patch(`ingest_seeds?region=eq.${enc(region)}`, { last_ingested_at: startedAt });
    if (error) { report.problems.push(`could not stamp the seeds: ${describe(error)}`); report.ok = false; }
  }
  if (db && runId) {
    const { error } = await db.patch(`ingest_runs?id=eq.${enc(runId)}`, {
      finished_at: new Date().toISOString(),
      status: report.ok ? 'ok' : 'failed',
      kept: report.kept, written: report.written, retired: report.retired,
      per_seed: report.perSeed,
      detail: report.problems.slice(0, 20).join('\n') || null,
    });
    if (error) { report.problems.push(`could not record how the run went: ${describe(error)}`); report.ok = false; }
  }
  return report;
}
