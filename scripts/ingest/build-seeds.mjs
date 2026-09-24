// ─── (Re)building the towns the weekly map load reads around ─────────────
// A seed is a town somebody plans trips to, placed on the map and matched to
// the Geofabrik download that holds it. They come from four places:
//
//   - every plan's destination_city / destination_country;
//   - every discovery_areas row (where somebody opened Discover);
//   - the destination profiles still queued;
//   - the world list (lib/discovery/world-destinations.ts): the most
//     visited cities and the Seven Wonders' towns. These are placed from
//     the list's own coordinates and already matched to their files, so
//     they cost the geocoder nothing.
//
// A plan the geocoder places in a country regions.ts does not file, but
// which is a world destination (a plan to Paris), joins that destination's
// seeds instead of being skipped.
//
// Each is placed with Nominatim, one request a second as its policy asks,
// then probed at the centre, on the rim of its circle and halfway out, so a
// town near a border gets a row in every file its circle reaches. A place in
// a country regions.ts does not know is logged and skipped, never guessed.
//
//   node scripts/ingest/build-seeds.mjs              # what it would write
//   node scripts/ingest/build-seeds.mjs --write      # upsert into ingest_seeds
//   node scripts/ingest/build-seeds.mjs --only Raleigh
//
// Reads the database either way; writes only with --write. Safe to re-run:
// rows are upserted on (name_key, region) — the name with case and accents
// folded, computed here by nameKey() — radius and last_ingested_at are left
// alone, and nothing is deleted — to stop reading a town, delete its rows by
// hand.
//
// A town is placed the way the menu places it: the name with whatever state
// was typed after it ("Fayetteville, NC"), and the plan's country. Cutting
// the state off put Fayetteville, NC in Arkansas.
import { credentials, rest, getAll } from './rest.mjs';
import { locate, whereIs } from '../../lib/discovery/geocode.ts';
import { regionFor, probePoints, seedCandidates, dedupeSeeds, sameTown, worldSeeds, worldTownFor, nameKey, SEED_RADIUS_MILES } from '../../lib/discovery/regions.ts';

const write = process.argv.includes('--write');
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt > -1 ? String(process.argv[onlyAt + 1] || '').toLowerCase() : null;
const RADIUS = SEED_RADIUS_MILES;

const db = rest(credentials());

const read = async (path) => {
  const { data, error } = await getAll(db, path);
  if (error) { console.error(`could not read ${path.split('?')[0]}: ${error.code} ${error.message}`); process.exit(1); }
  return data;
};
const plans = await read('plans?select=destination_city,destination_country&destination_city=not.is.null&order=id');
const profiles = await read('destination_profiles?select=city,region,country,lat,lng&status=eq.queued&order=id');
const areas = await read('discovery_areas?select=city,lat,lng&order=id');

let candidates = seedCandidates({ plans, profiles, areas });
if (only) candidates = candidates.filter(c => c.name.toLowerCase() === only);
let world = worldSeeds();
if (only) world = world.filter(s => nameKey(s.name) === nameKey(only));
console.log(`${plans.length} plans, ${profiles.length} queued profiles, ${areas.length} areas → ${candidates.length} towns, and ${new Set(world.map(s => s.name)).size} from the world list`);
// Sources that join a world destination: a plan to Paris adds "plan" to the
// world list's Paris rather than being skipped. Keyed by the world name.
const joinsWorld = new Map();

// Nominatim's policy: at most one request a second, from an identified agent.
let last = 0;
const politely = async (fn) => {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  return fn();
};
// A point on the rim is often shared by two towns' circles, so answers are
// kept for the run, keyed to about a kilometre.
const asked = new Map();
const regionAt = async (lat, lng) => {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (!asked.has(key)) asked.set(key, await politely(() => whereIs(lat, lng)));
  const at = asked.get(key);
  return at ? regionFor(at) : null;
};

const seeds = [];
const skipped = [];
// Towns placed so far, so a Discover area can join the plan's town once both
// have a point — on the name AND the distance, never the name alone.
const placed = [];
for (const c of candidates) {
  if (c.sources.length === 1 && c.sources[0] === 'area') {
    const town = placed.find(p => sameTown(c, p));
    if (town) {
      for (const s of seeds) if (s.name === town.name && s.lat === town.lat && s.lng === town.lng) {
        s.source = [...new Set([...s.source.split(','), 'area'])].sort().join(',');
      }
      console.log(`  ${c.name}: the area joins ${town.name}, already placed nearby`);
      continue;
    }
  }
  let lat = c.lat, lng = c.lng, centre = null;
  if (lat == null || lng == null) {
    const hint = [c.region].filter(Boolean).join(', ');
    const found = await politely(() => locate(hint ? `${c.name}, ${hint}` : c.name, c.country ?? null));
    if (!found) { skipped.push(`${c.name} — the geocoder could not place it`); continue; }
    ({ lat, lng } = found);
    centre = regionFor(found);
  }
  const regions = new Set();
  if (centre) regions.add(centre);
  for (const p of probePoints(lat, lng, RADIUS)) {
    const region = await regionAt(p.lat, p.lng);
    if (region) regions.add(region);
  }
  if (!regions.size) {
    const town = worldTownFor({ name: c.name, lat, lng });
    if (town) {
      joinsWorld.set(town.name, [...(joinsWorld.get(town.name) ?? []), ...c.sources]);
      console.log(`  ${c.name}: joins the world list's ${town.name}`);
      continue;
    }
    skipped.push(`${c.name} (${lat}, ${lng}) — in no region regions.ts knows`);
    continue;
  }
  placed.push({ name: c.name, lat, lng });
  for (const region of regions) {
    seeds.push({ name: c.name, lat, lng, region, source: [...c.sources].sort().join(',') });
  }
  console.log(`  ${c.name} (${Number(lat).toFixed(3)}, ${Number(lng).toFixed(3)}) → ${[...regions].join(', ')}`);
}

// The world list last, so where a plan already names the same town in the
// same file, the plan's spelling and point are the ones kept and the
// sources are joined (dedupeSeeds, on seedKey).
for (const w of world) {
  const joined = joinsWorld.get(w.name) ?? [];
  seeds.push({ ...w, source: [...new Set(['world', ...joined])].sort().join(',') });
}
console.log(`  world list: ${world.length} seeds for ${new Set(world.map(s => s.name)).size} towns`);

const rows = dedupeSeeds(seeds);
for (const s of skipped) console.log(`  skipped: ${s}`);
const byRegion = new Map();
for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
console.log(`\n${rows.length} seeds across ${byRegion.size} regions`);
for (const [region, n] of [...byRegion.entries()].sort()) console.log(`  ${region}: ${n}`);

if (!write) { console.log('\n(dry run — pass --write to store)'); process.exit(0); }
if (!rows.length) { console.log('nothing to store'); process.exit(0); }

const { error } = await db.upsert('ingest_seeds', rows, 'name_key,region');
if (error) {
  const missing = /ingest_seeds|name_key|PGRST205|42P01/.test(`${error.code} ${error.message}`);
  console.error(`could not write seeds: ${error.code} ${error.message}`);
  if (missing) console.error('run sql/world-data-phase1-2026-09-24.sql first');
  process.exit(1);
}
console.log(`stored ${rows.length} seeds`);
