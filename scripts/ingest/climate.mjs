// ─── Climate normals for every place Reach knows ────────────────────────
// Fills place_climate (sql/climate-2026-09-24.sql) from NASA POWER's
// climatology for every seed and world destination that has none, or whose
// row is over a year old. Forty-year averages do not move; asking yearly at
// most is plenty.
//
// Politely: one request at a time with a pause between, retries with backoff
// on a 429, a 5xx or a dropped connection, a cap per run, and a User-Agent
// naming Reach. A place POWER cannot answer for is logged and skipped —
// never written, because a failure stored as data is a place that "averages"
// -999 °C.
//
//   node scripts/ingest/climate.mjs                 # fill what is missing, up to --cap (150)
//   node scripts/ingest/climate.mjs --dry-run       # count what would be fetched; no requests to POWER, no writes
//   node scripts/ingest/climate.mjs --sample "Moab,Cusco"   # fetch and print, never write
//   node scripts/ingest/climate.mjs --cap 20
//
// Exits non-zero when any place failed, so the workflow step shows red; the
// map load is a separate job and does not wait on this one.
import { credentials, rest, getAll } from './rest.mjs';
import { parsePower, POWER_PARAMETERS, POWER_START, POWER_END, monthSummary, bestMonthsLine, wettestMonths, monthRanges } from '../../lib/climate.ts';
import { climatePlaces, climateKey, isStale } from '../../lib/climate-places.ts';
import { nameKey } from '../../lib/discovery/regions.ts';

const MIGRATION = 'sql/climate-2026-09-24.sql';
const AGENT = 'ReachClimate/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';
const API = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
const PAUSE_MS = 1500;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const value = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const die = (why) => { console.error(`✗ ${why}`); process.exit(1); };
const missingTable = (e) => /^(PGRST205|42P01|42703)$/.test(String(e?.code ?? ''));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const cap = Math.max(1, Math.min(1000, Number(value('cap')) || 150));

/** POWER's answer for one point, retried on what is worth retrying. */
export async function fetchPower(place, { attempts = 4, fetcher = fetch, wait = sleep } = {}) {
  const url = `${API}?parameters=${POWER_PARAMETERS.join(',')}&community=RE&longitude=${place.lng}&latitude=${place.lat}`
    + `&format=JSON&start=${POWER_START}&end=${POWER_END}`;
  let last = 'no attempt';
  for (let i = 0; i < attempts; i++) {
    if (i) await wait(2000 * 2 ** (i - 1));
    try {
      const res = await fetcher(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = null; }
      if (res.ok) {
        const parsed = parsePower(body, place);
        return 'error' in parsed ? { error: parsed.error } : { normals: parsed.normals };
      }
      last = `HTTP ${res.status}`;
      // A 4xx other than a rate limit is our request being wrong; asking
      // again says the same thing.
      if (res.status !== 429 && res.status < 500) return { error: `${last}: ${String(body?.messages?.[0] ?? text).slice(0, 160)}` };
    } catch (e) {
      last = e instanceof Error ? e.message : 'request failed';
    }
  }
  return { error: `gave up after ${attempts} tries: ${last}` };
}

function rowFor(n, place) {
  return {
    name: place.name, name_key: place.name_key, country: place.country, lat: place.lat, lng: place.lng,
    t2m: n.t2m, t2m_range: n.t2mRange, precip_mm_day: n.precipMmDay,
    rh2m: n.rh2m, cloud_pct: n.cloudPct ?? null, wind_ms: n.windMs ?? null,
    grid_elevation_m: n.gridElevationM ?? null, source: n.source, period: n.period,
    fetched_at: new Date().toISOString(),
  };
}

function describe(n) {
  const oct = monthSummary(n, 10), jan = monthSummary(n, 1), jul = monthSummary(n, 7);
  const m = (s) => `${s.monthName.slice(0, 3)} ${s.highC}/${s.lowC}°C (${s.highF}/${s.lowF}°F) ${s.rainMm} mm, ${s.label}`;
  const wet = monthRanges(wettestMonths(n));
  return [
    `${n.name} (${n.country ?? '??'}) ${n.lat},${n.lng} — cell ${n.gridElevationM ?? '?'} m, ${n.period}`,
    `  ${m(jan)} | ${m(jul)} | ${m(oct)}`,
    `  ${bestMonthsLine(n) ?? 'no month scores 50 or more'}${wet ? ` · wettest: ${wet}` : ''}`,
  ].join('\n');
}

async function main() {
  const db = rest(credentials());
  const seeds = await getAll(db, 'ingest_seeds?select=name,lat,lng,region&order=name');
  if (seeds.error) die(`could not read ingest_seeds: ${seeds.error.code}`);
  const places = climatePlaces(seeds.data ?? []);

  // ── --sample: fetch and print, never write ──
  const sample = value('sample');
  if (sample) {
    const want = sample.split(',').map(s => nameKey(s)).filter(Boolean);
    const chosen = places.filter(p => want.includes(p.name_key));
    for (const w of want) if (!chosen.some(p => p.name_key === w)) console.log(`- ${w}: not a seed or world destination`);
    for (const p of chosen) {
      const got = await fetchPower(p);
      console.log('error' in got ? `✗ ${p.name}: ${got.error}` : describe(got.normals));
      await sleep(PAUSE_MS);
    }
    return 0;
  }

  const held = await getAll(db, 'place_climate?select=name,lat,lng,fetched_at');
  if (held.error && missingTable(held.error) && flag('dry-run')) {
    // Counting only: before the migration, nothing is held.
    console.log(`(place_climate is not there yet — run ${MIGRATION}; counting as if nothing is held)`);
    held.error = null; held.data = [];
  }
  if (held.error) {
    if (missingTable(held.error)) die(`place_climate is not there yet — run ${MIGRATION}`);
    die(`could not read place_climate: ${held.error.code}`);
  }
  const fresh = new Set((held.data ?? []).filter(r => !isStale(r.fetched_at)).map(r => climateKey(r)));
  const todo = places.filter(p => !fresh.has(climateKey(p)));
  console.log(`${places.length} places (${(seeds.data ?? []).length} seed rows + the world list); ${fresh.size} held and fresh; ${todo.length} to fetch; this run takes up to ${cap}`);
  if (flag('dry-run')) {
    for (const p of todo.slice(0, cap)) console.log(`  would fetch ${p.name} (${p.country ?? 'country unknown'}) ${p.lat},${p.lng}`);
    return 0;
  }

  let wrote = 0, failed = 0;
  for (const p of todo.slice(0, cap)) {
    const got = await fetchPower(p);
    if ('error' in got) {
      failed++;
      console.error(`✗ ${p.name} ${p.lat},${p.lng}: ${got.error}`);
    } else {
      const { error } = await db.upsert('place_climate', [rowFor(got.normals, p)], 'name_key,lat,lng');
      if (error) { failed++; console.error(`✗ ${p.name}: could not store — ${error.code} ${error.message}`); }
      else { wrote++; console.log(`✓ ${p.name} — ${got.normals.period}, cell ${got.normals.gridElevationM ?? '?'} m`); }
    }
    await sleep(PAUSE_MS);
  }
  const left = Math.max(0, todo.length - cap);
  console.log(`\nwrote ${wrote}, failed ${failed}${left ? `, ${left} left for the next run` : ''}`);
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(code => process.exit(code), (e) => die(e instanceof Error ? e.message : 'failed'));
}
