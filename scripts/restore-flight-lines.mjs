// ─── One-off: give back the flight a rebuild deleted ─────────────────────
// restore-bookable-stays.mjs put back the stay on the trips "Plan my days for
// me" had stripped, and deliberately not the flight: a flight line needs a
// home airport and every traveller's essentials, and a "reach" line nobody
// can quote is the same lie in the other direction.
//
// That is now true of Puerto Vallarta — one traveller, ready, flying from
// RDU — so its flight comes back. Only trips that have not started: Moab
// began on Sep 17, and a flight to a trip already under way is not one.
//
// No airline and no price. The title is the one fixedCostRows writes when it
// knows nothing more, and cost_cents is null: the quote names the real flight
// and the real number, and it is the only place either exists. /bookable
// still checks everybody's essentials before quoting, so a trip that stops
// being ready says who is missing rather than failing at the airline.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Local date, not UTC: the UTC day turns over at 8pm in New York.
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const { data: plans, error } = await db.from('plans')
  .select('id, title, start_date, destination_city, destination_country')
  .eq('type', 'trip')
  .not('status', 'in', '("cancelled","completed")')
  .gt('start_date', today);
if (error) { console.error('could not read plans', error); process.exit(1); }

const { data: items } = await db.from('itinerary_items').select('plan_id, type, sort_order');
const todo = [];
for (const p of plans ?? []) {
  const mine = (items ?? []).filter(i => i.plan_id === p.id);
  // The stripped shape: a restored stay and no flight. A trip with no stay
  // either was never a flying trip that lost its flight.
  if (!mine.some(i => i.type === 'hotel') || mine.some(i => i.type === 'flight')) continue;
  if (!p.destination_city || !p.destination_country) continue;
  const lowest = Math.min(...mine.map(i => i.sort_order ?? 0));
  todo.push({
    planTitle: p.title,
    plan_id: p.id,
    scheduled_time: 'Before you go',
    title: 'Round-trip flights',
    subtitle: '',
    type: 'flight',
    booking_mode: 'reach',
    cost_cents: null,
    payment_note: 'Paid through Reach when the group funds the trip',
    is_confirmed: false,
    sort_order: (Number.isFinite(lowest) ? lowest : 0) - 1,
  });
}

for (const t of todo) console.log(`  ${t.planTitle}\n    + [flight/reach] "${t.title}"`);
console.log(`\nflights to restore: ${todo.length}`);
if (!todo.length || !APPLY) { if (todo.length) console.log('Dry run. Pass --apply to write.'); process.exit(0); }

for (const t of todo) {
  const { planTitle, ...row } = t;
  const { error: wErr } = await db.from('itinerary_items').insert(row);
  if (wErr) console.error('  insert failed', planTitle, wErr.code, wErr.message);
}
const { data: after } = await db.from('itinerary_items').select('plan_id, type').eq('type', 'flight')
  .in('plan_id', todo.map(t => t.plan_id));
console.log(`read back: ${after?.length ?? 0} of ${todo.length} plans now have a flight line`);
