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
//   - when a place has gone: missing from two different downloads of the
//     region it was read from, and never on a run that looks broken.
//
// A region is read whole. It used to be read only inside thirty-mile
// circles around the towns people had planned trips to, which meant a town
// nobody had planned yet held nothing, however much the map knew about it.
// Now every qualifying place in the extract is kept, and the seeds only say
// which regions to read and how much each town can see (per_seed).
import { matchesSelector, websiteOf, siteUrl, whatOf, keptTagsOf, streetOf, LODGING } from './osm.ts';
import { mappableKinds, kindFor, QUIZ_CUISINES } from './taste.ts';
import { canTurnUp } from './rules.ts';
import { dialable } from './phone.ts';
import { milesBetween } from './cache.ts';
import { SEED_RADIUS_MILES, type Seed } from './regions.ts';

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

/**
 * The seeds whose circle this point is inside. No longer a filter — a region
 * is read whole — but the count per seed is still the number a person can
 * check against the map: what the menu can see around that town.
 */
export function seedsCovering(at: { lat: number; lng: number }, seeds: Seed[]): Seed[] {
  return seeds.filter(s => milesBetween(s.lat, s.lng, at.lat, at.lng) <= (s.radius_miles ?? SEED_RADIUS_MILES));
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
  /**
   * The countries the place may be in (ISO 3166-1): one almost always, every
   * candidate in the strip where two countries' files overlap and nothing on
   * the feature says which side it is (geofabrik.ts countriesAt). The border
   * check reads this before the region. Left out when the load has no index.
   */
  countries?: string[];
  last_seen_at: string;
  gone_at: null;
  phone?: string;
  opening_hours: string | null;
  osm_tags: Record<string, string> | null;
  harvest_status?: 'skip';
}

export type Skip = 'no_name' | 'no_website' | 'no_point' | 'not_a_kind' | 'cannot_turn_up' | 'no_id';

/**
 * The rows one mapped feature becomes, or why it becomes none.
 *
 * `seenAt` is the run's start, the same instant on every row, so "not seen
 * since the last run started" is a plain comparison when places are retired.
 */
export function rowsFor(
  feature: MapFeature,
  region: string,
  seenAt: string,
): { rows: VenueRow[] } | { skip: Skip } {
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
  // The visit tags, and the ones naming a photograph of the place.
  const visit = keptTagsOf(tags);
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
  return { rows };
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
 * Gone means: not in this download and not in the previous one either — its
 * last sighting is older than the start of the previous good run from an
 * earlier download (see earlierDownloadBefore). One missed week is a mapper
 * mid-edit or a flaky extract, and the place stays.
 *
 * `held` is only ever the region's own rows (region = the file being read),
 * and the whole file was read, so every one of them was looked for. That is
 * what the seed circles used to have to guarantee: when only the circles
 * were read, a place outside every circle had not been looked for, and not
 * looking is not evidence that anything closed. A row filed under another
 * region, or under none (the sweep's), is never passed here.
 */
export function goneVenues(held: HeldVenue[], previousRunStartedAt: string | null): string[] {
  if (!previousRunStartedAt) return [];
  const before = Date.parse(previousRunStartedAt);
  if (!Number.isFinite(before)) return [];
  return held
    .filter(v => {
      const seen = v.last_seen_at ? Date.parse(v.last_seen_at) : NaN;
      // Never seen by any run is not "seen and then missing". Leave it.
      if (!Number.isFinite(seen)) return false;
      return seen < before;
    })
    .map(v => v.id);
}

/**
 * How old a good run must be to count as a different download.
 *
 * Retiring needs two downloads that missed a place, not two runs. A re-run
 * of a region that already succeeded this week — "Re-run all jobs" after
 * another region failed, or a dispatch with the region left empty — reads
 * the same cached extract, and measuring from this morning's run would count
 * one missed download as two. The load is weekly, so the previous download
 * is the good run that started at least six days before this one; a day's
 * slack covers a late cron.
 */
export const PREVIOUS_DOWNLOAD_MIN_DAYS = 6;

/** The instant a good run must have started before to be an earlier download than this one. */
export function earlierDownloadBefore(startedAt: string): string {
  return new Date(Date.parse(startedAt) - PREVIOUS_DOWNLOAD_MIN_DAYS * 86400_000).toISOString();
}

/**
 * Whether this run is healthy enough to retire anything on its word.
 *
 * A truncated download, a Geofabrik hiccup or an osmium flag gone wrong all
 * look like "most of the state closed this week". A run that kept less than
 * half of what the last good run kept is treated as broken: it stores what
 * it found and retires nothing. With whole regions nothing done to the
 * seeds can halve a region's count; only a change to the rules in this file
 * (or Geofabrik re-cutting a file) should, and that is what --accept-drop
 * is for.
 */
export function trustworthyRun(keptNow: number, keptLastTime: number | null): boolean {
  if (keptNow <= 0) return false;
  if (!keptLastTime) return true;
  return keptNow >= keptLastTime * 0.5;
}

/**
 * What a run's count means: whether it is recorded as good, and whether
 * anything may be retired on its word.
 *
 * A region can honestly hold nothing — a small territory whose mappers have
 * recorded no websites. So nothing kept, where the last good run also kept
 * nothing (or there was none), is good. Nothing kept after a run that kept
 * something is a broken download, --accept-drop or not: the region is read
 * whole, so no change of seeds can empty it, and a region that is run and
 * keeps nothing has lost its extract, not its places.
 *
 * Retiring needs the run before to have seen something. A good run that
 * kept nothing is no evidence of what was there, and counting it as the
 * first of two misses would retire places on one download.
 */
export function runVerdict(
  keptNow: number,
  keptLastTime: number | null,
  acceptDrop = false,
): { good: boolean; mayRetire: boolean } {
  if (keptNow <= 0) return { good: !keptLastTime, mayRetire: false };
  const good = acceptDrop || trustworthyRun(keptNow, keptLastTime);
  return { good, mayRetire: good && !!keptLastTime };
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
 * Places kept within each seed's circle, each place counted once however
 * many interests it was filed under: what the menu can see around that town
 * from this file. "Raleigh 812" means 812 places, not 812 rows.
 *
 * Every seed passed as `allSeeds` is in the answer, a town with nothing near
 * it as 0, so "seeds that kept nothing" counts the towns that would get an
 * itinerary naming no venues, and an empty object means the region had no
 * seeds at all when it ran (see dueRegions).
 */
export function countPerSeed(kept: Array<{ key: string; seeds: Seed[] }>, allSeeds: Seed[] = []): Record<string, number> {
  const bySeed = new Map<string, Set<string>>();
  for (const s of allSeeds) if (!bySeed.has(s.name)) bySeed.set(s.name, new Set<string>());
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

/**
 * Rows that may fail one at a time before a run stops writing. One venue
 * that will not store is worth naming; two hundred is the database saying
 * no, and asking it row by row through the rest of England would outlast
 * the job's timeout while telling us nothing new.
 */
export const MAX_FAILED_ROWS = 200;
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
   * Accept a run that kept under half of last time's places. Only after a
   * deliberate change to what the load keeps; see docs/INGEST.md.
   */
  acceptDrop?: boolean;
  /**
   * The countries a point may be in: geofabrik.ts's countriesAt. Written on
   * every row as `countries`, which the border check reads, so a venue's
   * country is what the map says of it — never the file that happened to be
   * loaded last, and never "the smallest file", which put central
   * Frankfurt (Oder) in Poland.
   */
  countriesAt?: (at: { lat: number; lng: number }, tags?: Record<string, unknown>) => string[];
}): Promise<IngestReport> {
  const { db, region, seeds } = input;
  const log = input.log ?? (line => console.log(line));
  const startedAt = (input.now ?? new Date()).toISOString();
  const report: IngestReport = {
    region, startedAt, kept: 0, written: 0, failed: 0, retired: 0,
    perSeed: {}, skipped: {}, trusted: false, problems: [], ok: false,
  };
  const fail = (why: string) => { report.problems.push(why); log(`  ✗ ${why}`); return report; };

  // 1. The last good run from an earlier download, and this one's row. Not
  // simply the newest good run: a same-week re-run read the same extract,
  // and it would make one missed download look like two.
  let previous: { started_at: string; kept: number | null } | null = null;
  let runId: string | null = null;
  if (db) {
    const prev = await db.get(`ingest_runs?select=started_at,kept&region=eq.${enc(region)}&status=eq.ok&started_at=lt.${enc(earlierDownloadBefore(startedAt))}&order=started_at.desc&limit=1`);
    if (prev.error) return fail(`could not read the last run: ${describe(prev.error)}`);
    previous = prev.data?.[0] ?? null;
    const run = await db.insert('ingest_runs', { region, started_at: startedAt, status: 'running' });
    if (run.error) return fail(`could not record the run: ${describe(run.error)}`);
    runId = run.data?.[0]?.id ?? null;
  }

  // 2. What the download holds, written as it is read.
  //
  // A whole region is tens of thousands of places (England is the largest),
  // so rows are written in batches while the export streams rather than held
  // until the end. Each row key is remembered, so a place osmium exports
  // twice (a closed way, as a line and as an area) is written once: Postgres
  // refuses an upsert naming one row twice, and takes the batch with it.
  const size = input.batchSize ?? 500;
  const pending: VenueRow[] = [];
  const rowKeys = new Set<string>();
  const places = new Set<string>();
  const kept: Array<{ key: string; seeds: Seed[] }> = [];
  let abandoned = false;
  const writeOut = async (rows: VenueRow[]) => {
    if (!db) { report.written += rows.length; return; }
    for (const batch of shapeBatches(rows, size)) {
      if (abandoned) { report.failed += batch.length; continue; }
      const { error } = await db.upsert('discovery_venues', batch, 'osm_type,osm_id,interest');
      if (!error) { report.written += batch.length; continue; }
      log(`  batch of ${batch.length} did not store (${describe(error)}) — writing them one at a time`);
      for (const row of batch) {
        if (abandoned) { report.failed++; continue; }
        const one = await db.upsert('discovery_venues', [row], 'osm_type,osm_id,interest');
        if (one.error) {
          report.failed++;
          report.problems.push(`${row.osm_type}/${row.osm_id} "${row.name}" (${row.interest}): ${describe(one.error)}`);
          // A database that refuses everything is not a venue that will not
          // store. Row by row through a whole region would take all day, and
          // the answer is already known: the run has failed.
          if (report.failed >= MAX_FAILED_ROWS) {
            abandoned = true;
            report.problems.push(`stopped writing after ${MAX_FAILED_ROWS} rows failed; the rest are counted as failed`);
          }
        } else {
          report.written++;
        }
      }
    }
  };

  for await (const feature of input.features) {
    const out = rowsFor(feature, region, startedAt);
    if ('skip' in out) {
      report.skipped[out.skip] = (report.skipped[out.skip] ?? 0) + 1;
      continue;
    }
    const first = out.rows[0];
    if (input.countriesAt) {
      const countries = input.countriesAt({ lat: first.lat, lng: first.lng }, feature.properties ?? {});
      for (const row of out.rows) row.countries = countries;
    }
    const key = `${first.osm_type}/${first.osm_id}`;
    if (!places.has(key)) {
      places.add(key);
      const near = seedsCovering({ lat: first.lat, lng: first.lng }, seeds);
      if (near.length) kept.push({ key, seeds: near });
    }
    for (const row of out.rows) {
      const rowKey = `${row.osm_type}/${row.osm_id}/${row.interest}`;
      if (rowKeys.has(rowKey)) continue;
      rowKeys.add(rowKey);
      pending.push(row);
    }
    if (pending.length >= size * 4) await writeOut(pending.splice(0, pending.length));
  }
  await writeOut(pending.splice(0, pending.length));
  report.kept = places.size;
  report.perSeed = countPerSeed(kept, seeds);

  // 3. What has gone. Never on a run that lost a write or kept too little.
  //
  // A run that kept too little is not only barred from retiring: it fails,
  // so it is never "the last good run" whose start next week's run measures
  // from. A broken download recorded as good would make one real miss look
  // like two.
  const verdict = runVerdict(report.kept, previous?.kept ?? null, !!input.acceptDrop);
  const believable = verdict.good;
  report.trusted = report.failed === 0 && verdict.mayRetire;
  if (believable && report.kept === 0) {
    log('  kept nothing, as last time — recorded as good, nothing retired');
  }
  if (!believable) {
    fail(`kept ${report.kept} places against ${previous?.kept ?? 0} last time — a broken download looks like this, so nothing is retired and the run is not counted as good`);
  }
  if (db && report.trusted && previous?.started_at) {
    const held = await readAll(db,
      `discovery_venues?select=id,lat,lng,last_seen_at&region=eq.${enc(region)}&gone_at=is.null&last_seen_at=lt.${enc(previous.started_at)}&order=id`);
    if (held.error) {
      report.problems.push(`could not read what might have gone: ${describe(held.error)}`);
    } else {
      const gone = goneVenues(held.data ?? [], previous.started_at);
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
