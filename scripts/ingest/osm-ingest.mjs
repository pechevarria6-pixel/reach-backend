// ─── The weekly map load: one Geofabrik region into discovery_venues ─────
// The sweep asks Overpass about one town at a time, and Overpass took 72
// seconds to answer "nothing" for Washington. This reads the same map from
// the other end: download a state's extract, cut it down with osmium to the
// places worth going to, and keep the ones inside a seed's circle.
//
// This file is plumbing: the download, the osmium calls, the command line.
// Every decision about WHAT is written — which tags count, the name-and-
// website rule, one row per place per interest, when a place has gone —
// lives in lib/discovery/ingest.ts, where the tests can reach it.
//
//   node scripts/ingest/osm-ingest.mjs --list-regions
//       the regions ingest_seeds names, as a JSON array (the workflow's matrix)
//   node scripts/ingest/osm-ingest.mjs --region north-america/us/north-carolina
//       download, filter, write, retire — the weekly job
//   node scripts/ingest/osm-ingest.mjs --region … --dry-run
//       everything but the writes: reads the seeds, prints what it would keep
//   node scripts/ingest/osm-ingest.mjs --region … --features f.geojsonseq --seeds s.json --dry-run
//       no download, no osmium, no database: a fixture run
//
// Other flags: --pbf-dir <dir> (where downloads are kept; default .pbf),
// --pbf <file> (a download already on disk), --accept-drop (see docs/INGEST.md).
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
import { knownRegions, geofabrikUrl } from '../../lib/discovery/regions.ts';

const MIGRATION = 'sql/world-data-phase1-2026-09-24.sql';
const AGENT = 'ReachIngest/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
};

const die = (why) => { console.error(`✗ ${why}`); process.exit(1); };
const missingTable = (e) => /PGRST205|42P01|42703|ingest_seeds|ingest_runs|gone_at/.test(`${e?.code} ${e?.message}`);

// ── --list-regions ─────────────────────────────────────────────────────
if (flag('list-regions')) {
  const db = rest(credentials());
  const { data, error } = await getAll(db, 'ingest_seeds?select=region&order=region');
  if (error) die(`could not read ingest_seeds: ${error.code}${missingTable(error) ? ` — run ${MIGRATION}` : ''}`);
  const known = new Set(knownRegions());
  const regions = [...new Set((data ?? []).map(r => r.region))].filter(r => known.has(r)).sort();
  // Only the array on stdout: the workflow reads it as JSON.
  process.stdout.write(JSON.stringify(regions));
  process.exit(0);
}

// ── One region ─────────────────────────────────────────────────────────
const region = value('region');
if (!region) die('--region is required, e.g. --region north-america/us/north-carolina');
// Checked against the table, not just for shape: the name reaches a file
// path and a URL, and a workflow_dispatch input is typed by a person.
if (!knownRegions().includes(region)) die(`"${region}" is not a region lib/discovery/regions.ts knows`);

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
if (!seeds.length) die(`no seeds in ${region} — run scripts/ingest/build-seeds.mjs --write first`);
console.log(`${region}: ${seeds.length} seeds (${seeds.map(s => s.name).join(', ')})`);

// Before a download that can take minutes: can this run be recorded at all?
if (db && !dryRun) {
  for (const probe of ['ingest_runs?select=id&limit=1', 'discovery_venues?select=gone_at,region&limit=1']) {
    const { error } = await db.get(probe);
    if (error) die(`the database is not ready (${error.code}) — run ${MIGRATION}`);
  }
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
  });
} catch (e) {
  // osmium dying half way through the export lands here.
  die(e instanceof Error ? e.message : String(e));
}

const skipped = Object.entries(report.skipped).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
console.log(`\n${region}${dryRun ? ' (dry run — nothing written)' : ''}`);
console.log(`  kept ${report.kept} places as ${report.written} rows; ${report.failed} failed; ${report.retired} marked gone`);
console.log(`  skipped: ${skipped}`);
console.log('  per seed:');
for (const s of seeds) console.log(`    ${s.name}: ${report.perSeed[s.name] ?? 0}`);
if (report.problems.length) {
  console.log('  problems:');
  for (const p of report.problems.slice(0, 50)) console.log(`    ${p}`);
  if (report.problems.length > 50) console.log(`    … and ${report.problems.length - 50} more`);
}
if (!report.ok) die(`${region} did not load cleanly`);
console.log('  ok');
