// ─── Which Geofabrik files hold the world destinations ───────────────────
// lib/discovery/world-destinations.ts lists towns outside the countries
// regions.ts was written for. Rather than type a Geofabrik path for each —
// the one path typed by hand in regions.ts that was wrong returned a 200 and
// an HTML page — this reads Geofabrik's own index, which carries every
// extract's polygon and download URL, and asks it:
//
//   for the town's centre and each probe point on its circle (the same
//   probePoints build-seeds.mjs uses), which is the smallest extract whose
//   polygon holds the point?
//
// Smallest, because a country file is often far too big for one job:
// France is four gigabytes, and Paris is in Île-de-France's few hundred
// megabytes. Where a point falls in a country regions.ts already files a
// particular way — US states, the UK's nations, Mexico — the file regions.ts
// would pick is used instead, so a plan to Los Angeles and the world seed
// for it land in one region rather than California and Southern California
// both being read for the same streets.
//
// Then every file chosen is checked against the server: its .md5 has to be
// there and its .pbf has to answer as a download, not as a page. The size
// is recorded, because the weekly job has two hours and about fourteen
// gigabytes of disk.
//
//   node scripts/ingest/world-regions.mjs                    # fetch the index, write the file
//   node scripts/ingest/world-regions.mjs --index index.json # use a copy already on disk
//   node scripts/ingest/world-regions.mjs --check            # print, write nothing
//
// Writes lib/discovery/world-regions.generated.ts. Re-run it after changing
// the destination list; the unit tests fail until you do.
import { readFileSync, writeFileSync } from 'node:fs';
import { WORLD_DESTINATIONS } from '../../lib/discovery/world-destinations.ts';
import { probePoints, SEED_RADIUS_MILES, legacyRegions } from '../../lib/discovery/regions.ts';

const INDEX = 'https://download.geofabrik.de/index-v1.json';
const BASE = 'https://download.geofabrik.de/';
const AGENT = 'ReachIngest/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';
const OUT = new URL('../../lib/discovery/world-regions.generated.ts', import.meta.url);

const argv = process.argv.slice(2);
const at = argv.indexOf('--index');
const check = argv.includes('--check');

const index = at > -1
  ? JSON.parse(readFileSync(argv[at + 1], 'utf8'))
  : await (await fetch(INDEX, { headers: { 'User-Agent': AGENT } })).json();

// ── Polygons ────────────────────────────────────────────────────────────
const pathOf = (f) => String(f.properties?.urls?.pbf || '').replace(BASE, '').replace(/-latest\.osm\.pbf$/, '');

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polygonsOf = (g) => g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];

const extracts = index.features
  .filter(f => f.properties?.urls?.pbf && f.geometry)
  .map(f => {
    const polys = polygonsOf(f.geometry);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polys) for (const [x, y] of p[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const area = polys.reduce((s, p) => s + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
    return { id: f.properties.id, parent: f.properties.parent ?? null, path: pathOf(f), polys, box: [minX, minY, maxX, maxY], area };
  });
const byId = new Map(extracts.map(e => [e.id, e]));

const holds = (e, lat, lng) => lng >= e.box[0] && lng <= e.box[2] && lat >= e.box[1] && lat <= e.box[3]
  && e.polys.some(p => inRing(p[0], lng, lat) && !p.slice(1).some(h => inRing(h, lng, lat)));

const legacy = new Set(legacyRegions());

// Files never read for a world seed, whatever a circle grazes. Seoul's
// thirty miles cross the DMZ; nothing on the far side can be visited, and
// a venue there must never reach a Seoul itinerary.
const NEVER = new Set(['asia/north-korea']);

// Nesting is read from the download paths, not the index's `parent` field:
// Geofabrik files New York's parent as "north-america", beside the whole-US
// file, although its path says it is a piece of it.
const byPath = new Map(extracts.map(e => [e.path, e]));
const within = (inner, outer) => inner.path.startsWith(`${outer.path}/`);
const hasPieces = (e) => extracts.some(x => within(x, e));
const isCountry = (e) => Boolean(index.features.find(f => f.properties.id === e.id)?.properties?.['iso3166-1:alpha2']);
/** A continent: a top-level file that is not a country (Russia is both). */
const isContinent = (e) => !e.path.includes('/') && !isCountry(e);
/** Not a country and not a piece of one: US Northeast, Alps, DACH. */
const isOverlay = (e) => !isCountry(e) && !extracts.some(k => isCountry(k) && within(e, k));

/**
 * The file for one point: regions.ts's own where it has one, else the
 * smallest extract — or null when the point is in no file worth reading.
 *
 * Two things a plain "smallest polygon" got wrong, both seen on the first run:
 *   - Geofabrik also serves overlays that cut across countries: US
 *     Northeast, Alps, DACH, Britain and Ireland. A probe point in Long
 *     Island Sound fell only in US Northeast, 1.8 GB, and New York would
 *     have read it. An overlay — a file that is neither a country nor a
 *     piece of one — is only used where no country holds the point.
 *     Continents are never used.
 *   - A point inside a country Geofabrik splits, but in none of its pieces
 *     (water, mostly), is not a reason to read the whole country.
 */
function regionAt(lat, lng) {
  const holders = extracts.filter(e => holds(e, lat, lng));
  const inCountry = holders.some(isCountry);
  const all = holders
    .filter(h => !isContinent(h) && !(inCountry && isOverlay(h)))
    .sort((a, b) => a.area - b.area);
  if (!all.length) return null;
  const smallest = all[0];
  if (isCountry(smallest) && hasPieces(smallest)) return null;
  // Walk up the path from the smallest: the first file regions.ts already
  // knows wins, so the US, the UK and Mexico keep the files they always had.
  for (let path = smallest.path; path.includes('/'); path = path.slice(0, path.lastIndexOf('/'))) {
    if (legacy.has(path) && byPath.has(path)) return path;
  }
  return NEVER.has(smallest.path) ? null : smallest.path;
}

// ── Each destination ────────────────────────────────────────────────────
const out = {};
const problems = [];
for (const d of WORLD_DESTINATIONS) {
  const centre = regionAt(d.lat, d.lng);
  if (!centre) { problems.push(`${d.name}: no extract holds its centre`); continue; }
  const regions = new Set([centre]);
  for (const p of probePoints(d.lat, d.lng, SEED_RADIUS_MILES)) {
    const r = regionAt(p.lat, p.lng);
    if (r) regions.add(r);
  }
  // Centre first: it is the file the town is in; the rest are what its circle grazes.
  out[d.name] = [centre, ...[...regions].filter(r => r !== centre).sort()];
  console.log(`  ${d.name.padEnd(18)} ${out[d.name].join(', ')}`);
}

// ── Does Geofabrik actually serve each one? ─────────────────────────────
const every = [...new Set(Object.values(out).flat())].sort();
const sizes = {};
for (const region of every) {
  const url = `${BASE}${region}-latest.osm.pbf`;
  const md5 = await fetch(`${url}.md5`, { headers: { 'User-Agent': AGENT } });
  const body = md5.ok ? (await md5.text()).trim() : '';
  if (!/^[0-9a-f]{32}\b/.test(body)) { problems.push(`${region}: no checksum at ${url}.md5 (${md5.status})`); continue; }
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': AGENT } });
  const type = head.headers.get('content-type') || '';
  const bytes = Number(head.headers.get('content-length'));
  if (!head.ok || /html/i.test(type) || !Number.isFinite(bytes) || bytes < 1000) {
    problems.push(`${region}: ${head.status} ${type} ${bytes} — not a download`);
    continue;
  }
  sizes[region] = Math.round(bytes / 1e6);
  await new Promise(r => setTimeout(r, 250));
}
console.log(`\n${every.length} files:`);
for (const r of every) console.log(`  ${String(sizes[r] ?? '?').padStart(6)} MB  ${r}`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
if (check) process.exit(0);

const today = new Date().toISOString().slice(0, 10);
const body = `// GENERATED by scripts/ingest/world-regions.mjs from ${INDEX} on ${today}.
// Do not edit by hand: change lib/discovery/world-destinations.ts and re-run it.
//
// For each world destination, the Geofabrik files its thirty-mile circle
// reaches, the town's own file first. Every path here had a checksum on
// Geofabrik and answered as a download when this was written.

/** Destination name → Geofabrik region paths, centre first. */
export const WORLD_REGIONS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(out, null, 2)};

/** Size of each file in megabytes when this was generated, for planning the weekly job. */
export const WORLD_REGION_MB: Readonly<Record<string, number>> = ${JSON.stringify(sizes, null, 2)};
`;
writeFileSync(OUT, body);
console.log(`\nwrote ${OUT.pathname}`);
