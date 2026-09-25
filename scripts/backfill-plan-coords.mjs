// Puts the plans made before the trip map on it: one Nominatim lookup per
// plan, a second apart, and the point kept on the plan
// (plans.destination_lat / _lng / _label, sql/trip-map-2026-09-25.sql).
//
// Prints what it would store, and stores nothing, unless given --write.
// The owner runs it for real, once the SQL has been run:
//
//   node --experimental-strip-types scripts/backfill-plan-coords.mjs            # look
//   node --experimental-strip-types scripts/backfill-plan-coords.mjs --write    # store
//   ... --limit 5                                                               # the first five
//
// Same rules as the write path in POST /api/plans (lib/trip-map.ts): a group
// trip still deciding where to go is skipped, a night out is only looked up
// by its city and never by its title, and anything but a found town — no
// such place, or a lookup that never got an answer — stores nothing.
// Nominatim's policy is one request a second from an identified agent; the
// geocoder sends the agent and this spaces every request, including the
// second one a plan makes when its city finds nothing and its title is tried.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { locatePlanOrFail } from '../lib/discovery/geocode.ts';
import { pinQuestion, pinColumns, pinPlan, columnsMissing } from '../lib/trip-map.ts';

const write = process.argv.includes('--write');
const limitAt = process.argv.indexOf('--limit');
const limit = limitAt > -1 ? Math.max(1, Number(process.argv[limitAt + 1]) || 1) : Infinity;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// One request a second, whoever asks.
let last = 0;
const spaced = async (url, init) => {
  const wait = last + 1000 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  return fetch(url, init);
};

const base = 'id, title, type, status, destination_city, destination_country, destination_style';
let { data: plans, error } = await db.from('plans')
  .select(`${base}, destination_lat`).is('destination_lat', null).neq('status', 'cancelled')
  .order('created_at', { ascending: true });
let migrated = true;
if (error && columnsMissing(error)) {
  migrated = false;
  console.log('plans.destination_lat is not there yet — run sql/trip-map-2026-09-25.sql first. Showing what would be stored.\n');
  ({ data: plans, error } = await db.from('plans').select(base).neq('status', 'cancelled').order('created_at', { ascending: true }));
}
if (error) { console.error('could not read plans', error); process.exit(1); }
if (write && !migrated) { console.error('--write needs the columns. Nothing stored.'); process.exit(1); }

const tally = { stored: 0, would_store: 0, skipped: 0, not_found: 0, failed: 0, moved: 0, other: 0 };
let n = 0;
for (const plan of plans ?? []) {
  if (n >= limit) break;
  const name = `${String(plan.title ?? '').slice(0, 40).padEnd(40)} ${String(plan.destination_city ?? '—').padEnd(18)}`;
  const ask = pinQuestion(plan);
  if (!ask) { tally.skipped++; console.log(`  skip       ${name} nothing honest to ask`); continue; }
  n++;

  if (write) {
    const r = await pinPlan(db, plan, spaced);
    tally[r.outcome === 'stored' ? 'stored' : r.outcome in tally ? r.outcome : 'other']++;
    const said = r.outcome === 'stored' ? `${r.label}  ${r.lat.toFixed(4)},${r.lng.toFixed(4)}` : r.outcome + (r.code ? ` ${r.code}` : '');
    console.log(`  ${r.outcome.padEnd(10)} ${name} ${said}`);
    continue;
  }

  const found = await locatePlanOrFail(plan, spaced, ask);
  if (found === 'failed') { tally.failed++; console.log(`  failed     ${name} no answer — would store nothing`); continue; }
  const cols = found ? pinColumns(found) : null;
  if (!cols) { tally.not_found++; console.log(`  not found  ${name} from "${found?.from ?? plan.destination_city ?? plan.title}"`); continue; }
  tally.would_store++;
  console.log(`  would pin  ${name} ${cols.destination_label}  ${cols.destination_lat.toFixed(4)},${cols.destination_lng.toFixed(4)}  (asked "${found.from}")`);
}

console.log(`\n${write ? 'stored' : 'dry run — nothing stored'}:`, tally);
if (!write) console.log('Read the list above. If every pin is the right town, run again with --write.');
