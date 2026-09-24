// ─── The map load: one Geofabrik region into discovery_venues ────────────
// The sweep asks Overpass about one town at a time, and Overpass took 72
// seconds to answer "nothing" for Washington. This reads the same map from
// the other end: download a state's extract, cut it down with osmium to the
// places worth going to, and keep every one of them — the whole region, not
// only circles around the towns somebody has already planned.
//
// This file is plumbing: the download, the osmium calls, the command line.
// Every decision about WHAT is written — which tags count, the name-and-
// website rule, one row per place per interest, when a place has gone —
// lives in lib/discovery/ingest.ts, where the tests can reach it; which
// regions run when is lib/discovery/ingest-schedule.ts.
//
//   node scripts/ingest/osm-ingest.mjs --list-regions
//       every region the load reads, as a JSON array
//   node scripts/ingest/osm-ingest.mjs --plan [--due]
//       the workflow's matrix: {"count":N,"batches":[[{region,minutes}],…]},
//       every region, or with --due only those a daily run should load
//   node scripts/ingest/osm-ingest.mjs --region north-america/us/north-carolina
//       download, filter, write, retire — the weekly job
//   node scripts/ingest/osm-ingest.mjs --region … --dry-run
//       everything but the writes: reads the seeds, prints what it would keep
//   node scripts/ingest/osm-ingest.mjs --region … --features f.geojsonseq --seeds s.json --dry-run
//       no download, no osmium, no database: a fixture run
//
// Other flags: --pbf-dir <dir> (where downloads are kept; default .pbf),
// --pbf <file> (a download already on disk), --index <file> (Geofabrik's
// index-v1.json on disk, for the border check), --accept-drop (see docs/INGEST.md),
// --names (print seed names and per-seed counts; never in the public Actions log),
// --published-md5 (print Geofabrik's current checksum for --region and exit).
//
// Exits non-zero on anything that did not work: a download that is not a
// PBF, an osmium failure, a single venue that did not store. A summary that
// says "ok" over a log full of failures is how one venue went unstored for
// weeks; the exit code is what the workflow turns red on.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, openSync, readSync, closeSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { credentials, rest, getAll } from './rest.mjs';
import { ingestRegion, osmiumFilters, looksLikePbf } from '../../lib/discovery/ingest.ts';
import { knownRegions, geofabrikUrl, regionList, legacyRegions } from '../../lib/discovery/regions.ts';
import { GeofabrikMap, countriesAt } from '../../lib/discovery/geofabrik.ts';
import { dueRegions, planBatches } from '../../lib/discovery/ingest-schedule.ts';

const MIGRATION = 'sql/world-data-phase1-2026-09-24.sql';
// discovery_venues.countries, which the border check reads; see countriesAt.
const COUNTRIES_MIGRATION = 'sql/venue-countries-2026-09-24.sql';
const AGENT = 'ReachIngest/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
};

const die = (why) => { console.error(`✗ ${why}`); process.exit(1); };
// By code only. The message of a failed fetch carries the URL, and the URL
// names the table, so a wrong SUPABASE_URL read as "run the migration".
const missingTable = (e) => /^(PGRST205|42P01|42703)$/.test(String(e?.code ?? ''));

// ── --list-regions / --plan ────────────────────────────────────────────
// The list builds itself: every US state and territory, the UK's nations,
// Mexico, the world list's files, and the region of every seed
// (regionList). --plan cuts it into the workflow's batches; with --due, only
// the regions a daily run should load (dueRegions).
if (flag('list-regions') || flag('plan')) {
  const db = rest(credentials());
  const { data, error } = await getAll(db, 'ingest_seeds?select=region&order=region');
  if (error) die(`could not read ingest_seeds: ${error.code}${missingTable(error) ? ` — run ${MIGRATION}` : ''}`);
  const seedRegions = new Set((data ?? []).map(r => r.region));
  let regions = regionList(seedRegions);
  // One region by hand (workflow_dispatch). Checked against the table, not
  // just for shape: the name reaches a file path and a URL, and it was
  // typed by a person — trimmed, because "puerto-rico " was once a region
  // nothing knew.
  const one = value('region')?.trim();
  if (one) {
    if (!knownRegions().includes(one)) die(`"${one}" is not a region lib/discovery/geofabrik-regions.generated.ts knows`);
    regions = [one];
  }
  if (flag('list-regions')) {
    // Only the array on stdout: a caller reads it as JSON.
    process.stdout.write(JSON.stringify(regions));
    process.exit(0);
  }
  if (flag('due') && !one) {
    const runs = await getAll(db, 'ingest_runs?select=region,status,started_at,per_seed&status=eq.ok&order=started_at');
    if (runs.error) die(`could not read ingest_runs: ${runs.error.code}${missingTable(runs.error) ? ` — run ${MIGRATION}` : ''}`);
    const due = dueRegions({ regions, seedRegions, runs: runs.data ?? [] });
    const why = {};
    for (const d of due) why[d.why] = (why[d.why] ?? 0) + 1;
    console.error(`${due.length} of ${regions.length} regions due: ${Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`);
    regions = due.map(d => d.region);
  } else {
    console.error(`${regions.length} regions`);
  }
  let batches;
  try { batches = planBatches(regions); } catch (e) { die(e instanceof Error ? e.message : String(e)); }
  // Only the plan on stdout, as JSON; the counts above went to stderr.
  process.stdout.write(JSON.stringify({ count: regions.length, batches }));
  process.exit(0);
}

// ── One region ─────────────────────────────────────────────────────────
const region = value('region')?.trim() || null;
if (!region) die('--region is required, e.g. --region north-america/us/north-carolina');
// Checked against the table, not just for shape: the name reaches a file
// path and a URL, and a workflow_dispatch input is typed by a person.
if (!knownRegions().includes(region)) die(`"${region}" is not a region lib/discovery/regions.ts knows`);

// ── --published-md5 ────────────────────────────────────────────────────
// The checksum of the extract Geofabrik serves right now, or "none". The
// workflow keys its download cache on it: Geofabrik rebuilds every night, so
// a cache keyed on the week restored Monday's file on Tuesday, failed the
// checksum, downloaded it again and never kept the new copy. Keyed on the
// file itself, a restored copy is always the one being served.
if (flag('published-md5')) {
  process.stdout.write((await publishedMd5(geofabrikUrl(region))) ?? 'none');
  process.exit(0);
}

const dryRun = flag('dry-run');
const featuresFile = value('features');
const seedsFile = value('seeds');
const db = seedsFile && dryRun ? null : rest(credentials());

// The seeds for this region, from the table or a fixture file.
let seeds;
if (seedsFile) {
  seeds = JSON.parse(readFileSync(seedsFile, 'utf8')).filter(s => s.region === region);
} else {
  const { data, error } = await getAll(db, `ingest_seeds?select=name,lat,lng,region,radius_miles,source&region=eq.${encodeURIComponent(region)}&order=name`);
  if (error) die(`could not read the seeds: ${error.code}${missingTable(error) ? ` — run ${MIGRATION}` : ''}`);
  seeds = data ?? [];
}
// No seeds is fine: the region is read whole either way. The seeds only
// give the per-town counts.
// Counts, not names. The Actions log is public, and a seed is a town
// somebody put in a private plan or opened Discover in: a small town's name
// beside a count points at a person's trip. The names and counts per seed
// are in ingest_runs.per_seed, which only the service role can read.
// --names prints them, for a run on your own machine.
const showNames = flag('names');
console.log(`${region}: ${seeds.length} seeds${showNames ? ` (${seeds.map(s => s.name).join(', ')})` : ''}`);

// Before a download that can take minutes: can this run be recorded at all?
if (db && !dryRun) {
  for (const probe of ['ingest_runs?select=id&limit=1', 'discovery_venues?select=gone_at,region&limit=1']) {
    const { error } = await db.get(probe);
    if (error) die(`the database is not ready (${error.code}) — run ${MIGRATION}`);
  }
  // Every row carries its countries. Written without them, a venue in the
  // strip where two countries' files overlap would be judged by its region
  // again — whichever file was loaded last — so the load waits for the column.
  const { error } = await db.get('discovery_venues?select=countries&limit=1');
  if (error) die(`the database is not ready (${error.code}) — run ${COUNTRIES_MIGRATION}`);
}

// ── Download ───────────────────────────────────────────────────────────

function md5Of(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(path).on('data', d => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function headOf(path, n = 32) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return new Uint8Array(buf.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}

/** Geofabrik's published checksum for the file, or null when it would not say. */
// A function declaration, so --published-md5 above can call it before this line.
async function publishedMd5(url) {
  try {
    const res = await fetch(`${url}.md5`, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const m = /^([0-9a-f]{32})\b/i.exec((await res.text()).trim());
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The region's PBF on disk, downloaded only when the copy we have is not
 * this week's. Checked three ways, because a wrong path answers 200 with
 * Geofabrik's home page: the first bytes are a PBF header, the checksum is
 * the one Geofabrik publishes, and the file is not empty.
 */
async function download(region) {
  const dir = value('pbf-dir') || '.pbf';
  mkdirSync(dir, { recursive: true });
  const url = geofabrikUrl(region);
  const file = join(dir, `${region.replace(/\//g, '_')}.osm.pbf`);
  const want = await publishedMd5(url);

  if (existsSync(file) && looksLikePbf(headOf(file))) {
    if (want && (await md5Of(file)) === want) {
      console.log(`  using the cached download (${(statSync(file).size / 1e6).toFixed(0)} MB, checksum matches)`);
      return file;
    }
    if (!want && Date.now() - statSync(file).mtimeMs < 7 * 86400_000) {
      console.log('  Geofabrik gave no checksum; using the cached download, which is under a week old');
      return file;
    }
  }

  console.log(`  downloading ${url}`);
  const started = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': AGENT }, redirect: 'follow' });
  if (!res.ok || !res.body) die(`download failed: HTTP ${res.status}`);
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  if (!looksLikePbf(headOf(part))) {
    rmSync(part, { force: true });
    die(`${url} did not return a PBF (a wrong path redirects to an HTML page with a 200)`);
  }
  if (want) {
    const got = await md5Of(part);
    if (got !== want) { rmSync(part, { force: true }); die(`checksum mismatch for ${url}: the download is incomplete`); }
  } else {
    console.log('  Geofabrik gave no checksum; the header is a PBF, going on');
  }
  renameSync(part, file);
  console.log(`  downloaded ${(statSync(file).size / 1e6).toFixed(0)} MB in ${Math.round((Date.now() - started) / 1000)}s`);
  return file;
}

// ── osmium ─────────────────────────────────────────────────────────────

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited ${code}`))));
  });
}

/**
 * Cut the download to the places worth reading, in three passes because
 * tags-filter ORs its expressions and each pass is one AND: a travel kind,
 * then a website under any of its three tags, then a name. What is left is
 * small enough to export whole. Referenced nodes and members are kept, so a
 * restaurant mapped as a building still has its outline.
 */
async function filtered(pbf) {
  const dir = value('pbf-dir') || '.pbf';
  const base = join(dir, region.replace(/\//g, '_'));
  await run('osmium', ['tags-filter', pbf, ...osmiumFilters(), '-o', `${base}.kinds.pbf`, '--overwrite', '--no-progress']);
  await run('osmium', ['tags-filter', `${base}.kinds.pbf`, 'nwr/website', 'nwr/contact:website', 'nwr/url', '-o', `${base}.sites.pbf`, '--overwrite', '--no-progress']);
  await run('osmium', ['tags-filter', `${base}.sites.pbf`, 'nwr/name', '-o', `${base}.named.pbf`, '--overwrite', '--no-progress']);
  return `${base}.named.pbf`;
}

/** GeoJSON features, one per line, from a geojsonseq stream. */
async function* featuresFrom(input) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const raw of lines) {
    // geojsonseq may open each record with an ASCII record separator.
    const line = raw.replace(/^\x1e/, '').trim();
    if (!line) continue;
    yield JSON.parse(line);
  }
}

/** osmium export, streamed: the features never sit in memory as one string. */
async function* exported(pbf) {
  const child = spawn('osmium', [
    'export', pbf, '-f', 'geojsonseq', '-x', 'print_record_separator=false',
    '-a', 'type,id', '-o', '-', '--no-progress',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`osmium export exited ${code}`))));
  });
  yield* featuresFrom(child.stdout);
  await done;
}

// ── Which side of a border each point is on ───────────────────────────
// Geofabrik's polygons overlap at borders (Mexico's reaches over San Luis,
// Arizona; Poland's Lubuskie over central Frankfurt (Oder)), so the file a
// venue was read from does not say which country it is in. countriesAt asks
// the polygons where there is a question and the feature's own tags for the
// answer. The index is one request; a load that cannot read it does not
// guess, it goes red. --index <file> uses a copy on disk; a --features
// fixture run without one writes no countries and says so.
let countriesOfPoint = null;
const indexFile = value('index');
if (indexFile || !featuresFile) {
  let index;
  try {
    index = indexFile
      ? JSON.parse(readFileSync(indexFile, 'utf8'))
      : await (await fetch('https://download.geofabrik.de/index-v1.json', { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(120_000) })).json();
  } catch (e) {
    die(`could not read Geofabrik's index, so could not tell which side of a border a place is on: ${e instanceof Error ? e.message : e}`);
  }
  const map = new GeofabrikMap(index, legacyRegions());
  if (map.extracts.length < 100) die(`Geofabrik's index holds ${map.extracts.length} extracts — not believing it`);
  if (!map.has(region)) die(`${region} is not in Geofabrik's index`);
  countriesOfPoint = countriesAt(map, region);
} else {
  console.log('  (fixture run without --index: no countries written; the border check falls back to the region)');
}

// ── The run ────────────────────────────────────────────────────────────

let features;
try {
  if (featuresFile) {
    features = featuresFrom(createReadStream(featuresFile));
  } else {
    const pbf = value('pbf') || await download(region);
    if (!looksLikePbf(headOf(pbf))) die(`${pbf} is not a PBF`);
    features = exported(await filtered(pbf));
  }
} catch (e) {
  die(e instanceof Error ? e.message : String(e));
}

let report;
try {
  report = await ingestRegion({
    db: dryRun ? null : db,
    region,
    seeds,
    features,
    acceptDrop: flag('accept-drop'),
    ...(countriesOfPoint ? { countriesAt: countriesOfPoint } : {}),
  });
} catch (e) {
  // osmium dying half way through the export lands here.
  die(e instanceof Error ? e.message : String(e));
}

const skipped = Object.entries(report.skipped).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
console.log(`\n${region}${dryRun ? ' (dry run — nothing written)' : ''}`);
console.log(`  kept ${report.kept} places as ${report.written} rows; ${report.failed} failed; ${report.retired} marked gone`);
console.log(`  skipped: ${skipped}`);
const perSeed = seeds.map(s => report.perSeed[s.name] ?? 0);
console.log(`  seeds that kept nothing: ${perSeed.filter(n => n === 0).length} of ${seeds.length}`);
if (showNames) {
  console.log('  per seed:');
  for (const s of seeds) console.log(`    ${s.name}: ${report.perSeed[s.name] ?? 0}`);
}
if (report.problems.length) {
  console.log('  problems:');
  for (const p of report.problems.slice(0, 50)) console.log(`    ${p}`);
  if (report.problems.length > 50) console.log(`    … and ${report.problems.length - 50} more`);
}
if (!report.ok) die(`${region} did not load cleanly`);
console.log('  ok');
