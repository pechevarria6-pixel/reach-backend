// ─── Which Geofabrik files the load may read, and which hold the world list ─
// Reads Geofabrik's own index, which carries every extract's polygon and
// download URL, and writes two generated tables:
//
//   lib/discovery/world-regions.generated.ts
//     for each world destination (lib/discovery/world-destinations.ts), the
//     files its thirty-mile circle reaches inside its own country, and the
//     size of each;
//
//   lib/discovery/geofabrik-regions.generated.ts
//     every file the weekly load may be asked to read — the ones
//     GeofabrikMap.regionAt could pick for some point — with its countries,
//     and the size of every file in the base list (every US state and
//     territory, the UK's nations, Mexico, the Bahamas and the world list's
//     files). osm-ingest.mjs refuses any region not in it, because a wrong
//     Geofabrik path does not 404: it redirects to the home page with a 200.
//
// The lookup itself (smallest extract, the US/UK/Mexico files regions.ts
// always used, no overlays, no continents, no closed borders) is in
// lib/discovery/geofabrik.ts, shared with build-seeds.mjs.
//
// Every base file is checked against the server: its .md5 has to be there
// and its .pbf has to answer as a download, not as a page.
//
//   node scripts/ingest/world-regions.mjs                    # fetch the index, write both files
//   node scripts/ingest/world-regions.mjs --index index.json # use a copy already on disk
//   node scripts/ingest/world-regions.mjs --check            # print, write nothing
//
// Re-run it after changing the destination list (the unit tests fail until
// you do), or when Geofabrik adds an extract a plan needs.
import { readFileSync, writeFileSync } from 'node:fs';
import { WORLD_DESTINATIONS } from '../../lib/discovery/world-destinations.ts';
import { probePoints, SEED_RADIUS_MILES, legacyRegions } from '../../lib/discovery/regions.ts';
import { GeofabrikMap } from '../../lib/discovery/geofabrik.ts';

const INDEX = 'https://download.geofabrik.de/index-v1.json';
const BASE = 'https://download.geofabrik.de/';
const AGENT = 'ReachIngest/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';
const OUT = new URL('../../lib/discovery/world-regions.generated.ts', import.meta.url);
const OUT_ALL = new URL('../../lib/discovery/geofabrik-regions.generated.ts', import.meta.url);

const argv = process.argv.slice(2);
const at = argv.indexOf('--index');
const check = argv.includes('--check');

const index = at > -1
  ? JSON.parse(readFileSync(argv[at + 1], 'utf8'))
  : await (await fetch(INDEX, { headers: { 'User-Agent': AGENT } })).json();

const map = new GeofabrikMap(index, legacyRegions());

// ── The index's own country codes, checked before anything trusts them ──
// Geofabrik gave five Pacific territories Vanuatu's code and Pitcairn the
// Marshall Islands'. A code on two files that are not one inside the other
// is a mistake until somebody checks it against Nominatim and settles it in
// COUNTRY_OF / GEOCODER_ALSO (lib/discovery/geofabrik.ts).
const problems = [];
for (const { code, paths } of map.sharedCodes()) {
  problems.push(`the index gives ${code} to ${paths.join(', ')} — settle it in COUNTRY_OF`);
}

// ── Each destination ────────────────────────────────────────────────────
// A world seed reads only files inside the destination's own country: see
// regionsForTown in geofabrik.ts for why a circle must not cross a border.
const out = {};
for (const d of WORLD_DESTINATIONS) {
  // The destination's own country picks among the files that hold a point:
  // near a border the smallest file is often the neighbour's (see regionAt).
  const centre = map.regionAt(d.lat, d.lng, d.country);
  if (!centre) { problems.push(`${d.name}: no extract holds its centre`); continue; }
  if (!map.countriesOf(centre).includes(d.country)) { problems.push(`${d.name}: its own file ${centre} is not in ${d.country}`); continue; }
  const regions = new Set([centre]);
  const abroad = new Set();
  for (const p of probePoints(d.lat, d.lng, SEED_RADIUS_MILES)) {
    const r = map.regionAt(p.lat, p.lng, d.country);
    if (!r || regions.has(r)) continue;
    if (map.countriesOf(r).includes(d.country)) regions.add(r); else abroad.add(r);
  }
  for (const r of abroad) console.log(`  ${d.name}: not reading ${r}, across the border`);
  // Centre first: it is the file the town is in; the rest are what its circle grazes.
  out[d.name] = [centre, ...[...regions].filter(r => r !== centre).sort()];
  console.log(`  ${d.name.padEnd(18)} ${out[d.name].join(', ')}`);
}

// ── Every file the load may read ────────────────────────────────────────
const loadable = map.loadable();
for (const r of [...legacyRegions(), ...Object.values(out).flat()]) {
  if (!loadable.includes(r)) problems.push(`${r} is in the base list but not a file the lookup could pick`);
}
const countries = Object.fromEntries(loadable.map(p => [p, map.countriesOf(p)]));

// ── Does Geofabrik actually serve each base file? ───────────────────────
const base = [...new Set([...legacyRegions(), ...Object.values(out).flat()])].sort();
const sizes = {};
for (const region of base) {
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
const worldFiles = [...new Set(Object.values(out).flat())].sort();
const worldSizes = Object.fromEntries(worldFiles.map(r => [r, sizes[r]]));
console.log(`\n${base.length} base files, ${loadable.length} loadable in all:`);
for (const r of base) console.log(`  ${String(sizes[r] ?? '?').padStart(6)} MB  ${r}`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
if (check) process.exit(0);

const today = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, `// GENERATED by scripts/ingest/world-regions.mjs from ${INDEX} on ${today}.
// Do not edit by hand: change lib/discovery/world-destinations.ts and re-run it.
//
// For each world destination, the Geofabrik files its thirty-mile circle
// reaches, the town's own file first. Every path here had a checksum on
// Geofabrik and answered as a download when this was written.

/** Destination name → Geofabrik region paths, centre first. */
export const WORLD_REGIONS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(out, null, 2)};

/** Size of each file in megabytes when this was generated, for planning the weekly job. */
export const WORLD_REGION_MB: Readonly<Record<string, number>> = ${JSON.stringify(worldSizes, null, 2)};
`);
writeFileSync(OUT_ALL, `// GENERATED by scripts/ingest/world-regions.mjs from ${INDEX} on ${today}.
// Do not edit by hand: re-run the script.
//
// Every Geofabrik file the load may be asked to read, which is every file
// GeofabrikMap.regionAt (lib/discovery/geofabrik.ts) could pick for some
// point on Earth: never a continent, an overlay such as US Northeast, a
// country Geofabrik splits into pieces, or North Korea. A region not listed
// here is refused before anything is downloaded.

/** Region path → the countries it holds (ISO 3166-1 alpha-2). */
export const GEOFABRIK_REGIONS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(countries, null, 2)};

/**
 * Megabytes of each base file (every US state and territory, the UK's
 * nations, Mexico, the Bahamas and the world list's files) when this was
 * written. The workflow gives a region time by its size; a region not
 * listed (one a plan added) gets the longest.
 */
export const REGION_MB: Readonly<Record<string, number>> = ${JSON.stringify(sizes, null, 2)};
`);
console.log(`\nwrote ${OUT.pathname}\nwrote ${OUT_ALL.pathname}`);
