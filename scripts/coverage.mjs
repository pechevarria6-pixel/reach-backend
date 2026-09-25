// ─── npm run coverage — how much we hold around each beta tester's town ──
// Read-only. For every town in scripts/beta-towns.txt: checked venues within
// 2, 5, 12 and 25 miles, dated events in the next 14 days within 25 miles,
// and PASS at 20 or more checked venues within 25 miles, else THIN. The
// counting rules are lib/coverage.ts.
//
// A report, not a gate: it always exits 0, and it is not part of verify.
// Towns are placed with the same geocoder the app uses (lib/discovery/
// geocode.ts). Nothing is written anywhere.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { locate } from '../lib/discovery/geocode.ts';
import { countCoverage, parseTowns, boxAround, formatTable, addDays, RINGS, EVENT_DAYS } from '../lib/coverage.ts';

const TOWNS_FILE = 'scripts/beta-towns.txt';

function done(message) {
  if (message) console.log(message);
  process.exit(0);
}

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  done('No .env.local here — nothing to read the venue table with.');
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) done('NEXT_PUBLIC_SUPABASE_URL and a Supabase key are needed in .env.local.');
if (!existsSync(TOWNS_FILE)) done(`No ${TOWNS_FILE}. One town per line, e.g. "Raleigh, NC".`);

const towns = parseTowns(readFileSync(TOWNS_FILE, 'utf8'));
if (!towns.length) done(`${TOWNS_FILE} has no towns in it yet. Add one per line and run again.`);

const db = createClient(url, key, { auth: { persistSession: false } });
const d = new Date();
// Local, never UTC: the UTC day rolls over at 8pm in New York.
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = d.toISOString();
const outer = RINGS[RINGS.length - 1];
const PAGE = 1000;

async function all(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || error.code || 'read failed');
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

const results = [];
for (const town of towns) {
  const at = await locate(town).catch(() => null);
  if (!at) { results.push({ town, error: 'could not place' }); continue; }
  const { dLat, dLng } = boxAround(at, outer);
  try {
    const venues = await all(() => db.from('discovery_venues')
      .select('id, name, website, interest, lat, lng, gone_at')
      .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
      .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng)
      .order('id'));
    // Events carry their own point, or their venue's. Read by date and
    // freshness here and placed in lib/coverage.ts.
    const events = await all(() => db.from('discovery_events')
      .select('id, starts_on, stale_after, lat, lng, discovery_venues(lat, lng)')
      .gte('starts_on', today).lte('starts_on', addDays(today, EVENT_DAYS))
      .gt('stale_after', now)
      .order('id'));
    results.push(countCoverage(town, at, venues, events, { today, now }));
  } catch (e) {
    // gone_at arrives in sql/world-data-phase1-2026-09-24.sql; before it, read without.
    if (/gone_at/.test(String(e?.message))) {
      try {
        const venues = await all(() => db.from('discovery_venues')
          .select('id, name, website, interest, lat, lng')
          .gte('lat', at.lat - dLat).lte('lat', at.lat + dLat)
          .gte('lng', at.lng - dLng).lte('lng', at.lng + dLng)
          .order('id'));
        const events = await all(() => db.from('discovery_events')
          .select('id, starts_on, stale_after, lat, lng, discovery_venues(lat, lng)')
          .gte('starts_on', today).lte('starts_on', addDays(today, EVENT_DAYS))
          .gt('stale_after', now)
          .order('id'));
        results.push(countCoverage(town, at, venues, events, { today, now }));
        continue;
      } catch (e2) { e = e2; }
    }
    console.error(`[coverage] could not read what we hold for ${town}:`, e?.message || e);
    results.push({ town, error: 'read failed' });
  }
  // Nominatim asks for one request a second.
  await new Promise(r => setTimeout(r, 1100));
}

console.log(`\nBeta coverage, ${today} — checked venues (name and own website), events dated in the next ${EVENT_DAYS} days\n`);
console.log(formatTable(results));
const thin = results.filter(r => 'verdict' in r && r.verdict === 'THIN').length;
const failed = results.filter(r => 'error' in r).length;
console.log(`\n${results.length - thin - failed} PASS · ${thin} THIN${failed ? ` · ${failed} not checked` : ''} — PASS is 20+ checked venues within ${outer} miles.`);
console.log('THIN towns need a sweep (/api/discovery/sweep or scripts/sweep-area.mjs) before their testers start.\n');
done();
