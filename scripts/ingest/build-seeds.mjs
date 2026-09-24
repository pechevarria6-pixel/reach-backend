// ─── (Re)building the towns and regions the map load reads ───────────────
// Runs every day in GitHub Actions (.github/workflows/osm-ingest.yml), before
// the load, and can be run by hand. A seed is a town somebody plans trips
// to, placed on the map and matched to every Geofabrik file its circle
// reaches. They come from four places:
//
//   - every plan's destination_city / destination_country — and a plan to a
//     wonder ("Machu Picchu", "Petra") joins the towns people sleep in to see
//     it (siteBase in world-destinations.ts) instead of being geocoded;
//   - every discovery_areas row (where somebody opened Discover);
//   - the destination profiles still queued;
//   - the world list (world-destinations.ts), placed from its own
//     coordinates.
//
// The region list the load works through is every US state and territory,
// the UK's nations, Mexico and the world list's files, plus every region a
// seed lands in (regionList in lib/discovery/regions.ts). So a plan to Lyon
// puts Rhône-Alpes on the list tomorrow, without anybody typing a path.
//
// Nominatim is asked only for a town's centre, once ever: the answer — found
// or not — is kept in ingest_places and read back on every later run. Which
// files a circle reaches is answered from Geofabrik's own polygons. At most
// one request a second, at most --cap a run (default 100), and a 429 stops
// the asking without failing: what was placed is written, the rest wait.
//
//   node scripts/ingest/build-seeds.mjs                  # what it would write (asks Nominatim for new towns)
//   node scripts/ingest/build-seeds.mjs --cap 0          # what it would write, asking nobody
//   node scripts/ingest/build-seeds.mjs --write          # upsert into ingest_seeds / ingest_places
//   node scripts/ingest/build-seeds.mjs --only Raleigh --names
//   node scripts/ingest/build-seeds.mjs --index index-v1.json   # a copy of Geofabrik's index on disk
//
// Town names are printed only with --names. The Actions log is public, and
// a seed is a town somebody put in a private plan.
//
// Safe to re-run: rows are upserted on (name_key, region), radius and
// last_ingested_at are left alone, and nothing is deleted.
import { readFileSync } from 'node:fs';
import { credentials, rest, getAll } from './rest.mjs';
import { locate } from '../../lib/discovery/geocode.ts';
import { GeofabrikMap } from '../../lib/discovery/geofabrik.ts';
import { seedCandidates, worldSeeds, nameKey, legacyRegions, knownRegions, regionList } from '../../lib/discovery/regions.ts';
import { placeSeeds, politeGeocoder, memoFromSeeds, DEFAULT_GEOCODE_CAP } from '../../lib/discovery/seed-build.ts';

const MIGRATION = 'sql/ingest-every-region-2026-09-24.sql';
const INDEX = 'https://download.geofabrik.de/index-v1.json';
const AGENT = 'ReachIngest/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

const argv = process.argv.slice(2);
const value = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] !== undefined && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
};
const write = argv.includes('--write');
const showNames = argv.includes('--names');
const only = value('only')?.toLowerCase() ?? null;
const capArg = value('cap');
const cap = capArg == null ? DEFAULT_GEOCODE_CAP : Math.max(0, Math.floor(Number(capArg)) || 0);
const name = (n) => (showNames ? n : '·');

const db = rest(credentials());
const missingTable = (e) => /^(PGRST205|42P01|42703)$/.test(String(e?.code ?? ''));

const read = async (path) => {
  const { data, error } = await getAll(db, path);
  if (error) { console.error(`✗ could not read ${path.split('?')[0]}: ${error.code}`); process.exit(1); }
  return data;
};
const plans = await read('plans?select=destination_city,destination_country&destination_city=not.is.null&order=id');
const profiles = await read('destination_profiles?select=city,region,country,lat,lng&status=eq.queued&order=id');
const areas = await read('discovery_areas?select=city,lat,lng&order=id');
const stored = await read('ingest_seeds?select=name,name_key,lat,lng,region&order=id');

// What the geocoder has already said, so no town is asked about twice.
const memo = new Map();
let memoTable = true;
{
  const { data, error } = await getAll(db, 'ingest_places?select=query_key,name,lat,lng,country_code,asked_at&order=query_key');
  if (error && missingTable(error)) {
    memoTable = false;
    console.log(`::warning::ingest_places is not there yet — towns are remembered from ingest_seeds until ${MIGRATION} runs`);
  } else if (error) {
    console.error(`✗ could not read ingest_places: ${error.code}`);
    process.exit(1);
  } else {
    for (const r of data) memo.set(r.query_key, r);
  }
}

// Geofabrik's polygons: one request a run, and the answer to every "which
// file holds this point?" after it.
const indexFile = value('index');
let index;
try {
  index = indexFile
    ? JSON.parse(readFileSync(indexFile, 'utf8'))
    : await (await fetch(INDEX, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(120_000) })).json();
} catch (e) {
  console.error(`✗ could not read Geofabrik's index: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
const map = new GeofabrikMap(index, legacyRegions());
if (map.extracts.length < 100) { console.error(`✗ Geofabrik's index holds ${map.extracts.length} extracts — not believing it`); process.exit(1); }

let candidates = seedCandidates({ plans, profiles, areas });
if (only) candidates = candidates.filter(c => c.name.toLowerCase() === only);
let world = worldSeeds();
if (only) world = world.filter(s => nameKey(s.name) === nameKey(only));
console.log(`${plans.length} plans, ${profiles.length} queued profiles, ${areas.length} areas → ${candidates.length} towns; ${memo.size} remembered; ${new Set(world.map(s => s.name)).size} from the world list`);

// Answers are written as they arrive, twenty at a time, so a run that is
// stopped half way keeps what it learned.
const pending = [];
let memoFailed = 0;
const flush = async () => {
  if (!write || !memoTable || !pending.length) return;
  const rows = pending.splice(0, pending.length);
  const { error } = await db.upsert('ingest_places', rows, 'query_key');
  if (error) { memoFailed += rows.length; console.log(`::warning::could not remember ${rows.length} places: ${error.code}`); }
};

const geocoder = politeGeocoder({ locate: (city, country, fetchImpl) => locate(city, country, fetchImpl), cap });
const placed = await placeSeeds({
  candidates,
  memo,
  fromSeeds: memoTable ? undefined : memoFromSeeds(stored),
  map,
  geocode: geocoder.geocode,
  world,
  log: (line) => { if (showNames) console.log(line); },
  remember: async (row) => { pending.push(row); if (pending.length >= 20) await flush(); },
});
await flush();

// Only regions the committed list knows. A file Geofabrik added since
// geofabrik-regions.generated.ts was written is named, not guessed at.
const known = new Set(knownRegions());
const unknown = [...new Set(placed.seeds.filter(s => !known.has(s.region)).map(s => s.region))];
const rows = placed.seeds.filter(s => known.has(s.region));
for (const r of unknown) console.log(`::warning::${r} is not in lib/discovery/geofabrik-regions.generated.ts — re-run scripts/ingest/world-regions.mjs`);

const byRegion = new Map();
for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
const regions = regionList(byRegion.keys());
console.log(`\n${rows.length} seeds in ${byRegion.size} regions; ${placed.fromMemory} towns placed from memory, ${geocoder.asked()} asked of Nominatim`);
console.log(`${regions.length} regions on the load's list`);
if (showNames) for (const [region, n] of [...byRegion.entries()].sort()) console.log(`  ${region}: ${n}`);
console.log(`skipped ${placed.skipped.length}`);
if (showNames) for (const s of placed.skipped) console.log(`  ${s}`);
if (geocoder.stopped()) {
  // Not a failure: everything placed so far is written below, and the rest
  // are asked about tomorrow. A red run here would lose nothing but would
  // teach the owner to ignore red.
  console.log(`::warning::stopped asking Nominatim (${geocoder.stopped()}); ${placed.waiting} towns wait for the next run`);
}

if (!write) { console.log('\n(dry run — pass --write to store)'); process.exit(0); }

let failed = 0;
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500);
  const { error } = await db.upsert('ingest_seeds', batch, 'name_key,region');
  if (error) {
    failed += batch.length;
    console.error(`✗ could not write ${batch.length} seeds: ${error.code}${missingTable(error) ? ' — run sql/world-data-phase1-2026-09-24.sql' : ''}`);
  }
}
if (memoFailed) console.log(`::warning::${memoFailed} geocoder answers were not remembered; they will be asked again`);
if (failed) process.exit(1);
console.log(`stored ${rows.length} seeds${memoTable ? `, remembered ${placed.remembered.length - memoFailed} places` : ''}`);
