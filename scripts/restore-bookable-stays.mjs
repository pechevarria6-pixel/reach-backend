// ─── One-off: give back the stay a rebuild deleted ───────────────────────
// "Plan my days for me" rebuilt an itinerary without fixedCostRows, and
// saving an itinerary replaces it — so the flight, the stay and the transfers
// were deleted. They carry booking_mode 'reach', and /bookable considers
// nothing else, so those trips stopped being bookable at all. Moab: 39 lines,
// none of them bookable, $893 of its own budget unaccounted for.
//
// The rebuild is fixed. This is for the plans already stripped, which cannot
// rebuild their way back.
//
// Only the stay, and only where Reach can genuinely quote one: a hotel quote
// needs dates, a city and a country and nothing else, and LiteAPI answers —
// there are confirmed hotel bookings in the table at real prices.
//
// Flights are deliberately not restored. That needs a home airport and every
// traveller's essentials, and Moab has no airport a provider will sell to. A
// "reach" line nobody can quote is the same lie in the other direction.
//
// No price is invented. cost_cents is null: the number comes from the quote,
// which is the only place a true one exists.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: plans, error } = await db.from('plans')
  .select('id, title, type, status, start_date, end_date, destination_city, destination_country')
  .eq('type', 'trip')
  .not('status', 'in', '("cancelled","completed")');
if (error) { console.error('could not read plans', error); process.exit(1); }

const { data: items } = await db.from('itinerary_items').select('plan_id, type, sort_order');
const hasHotel = new Set((items ?? []).filter(i => i.type === 'hotel').map(i => i.plan_id));
const hasAny = new Set((items ?? []).map(i => i.plan_id));

const nightsBetween = (a, b) => {
  const d = (Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
  return Number.isFinite(d) && d > 0 ? d : null;
};

const todo = [];
for (const p of plans ?? []) {
  if (hasHotel.has(p.id)) continue;
  if (!hasAny.has(p.id)) continue;          // no itinerary at all is not this bug
  const nights = nightsBetween(p.start_date, p.end_date);
  if (!nights || !p.destination_city || !p.destination_country) continue;
  const lowest = Math.min(...(items ?? []).filter(i => i.plan_id === p.id).map(i => i.sort_order ?? 0));
  todo.push({
    plan_id: p.id,
    planTitle: p.title,
    scheduled_time: 'Before you go',
    // Nights and a city, both read off the plan. No hotel is named, because
    // no hotel has been chosen — the quote names the real one.
    title: `${nights} ${nights === 1 ? 'night' : 'nights'} in ${p.destination_city}`,
    subtitle: 'Reach finds this and books it',
    type: 'hotel',
    booking_mode: 'reach',
    cost_cents: null,
    payment_note: 'Paid through Reach when the group funds the trip',
    is_confirmed: false,
    sort_order: (Number.isFinite(lowest) ? lowest : 0) - 1,
  });
}

console.log(`trip plans: ${plans?.length ?? 0}`);
console.log(`stays to restore: ${todo.length}\n`);
for (const t of todo) console.log(`  ${t.planTitle}\n    + [${t.type}/${t.booking_mode}] "${t.title}" — ${t.subtitle}\n`);
if (!todo.length) { console.log('nothing to do'); process.exit(0); }
if (!APPLY) { console.log('Dry run. Pass --apply to write.'); process.exit(0); }

let written = 0;
for (const t of todo) {
  const { planTitle, ...row } = t;
  const { error: wErr } = await db.from('itinerary_items').insert(row);
  if (wErr) { console.error('  insert failed', planTitle, wErr.code, wErr.message); continue; }
  written++;
}
// Read it back. A write that reports success and changes nothing is what
// every guard in this repo exists to catch.
const { data: after } = await db.from('itinerary_items').select('plan_id, type, booking_mode');
for (const t of todo) {
  const mine = (after ?? []).filter(i => i.plan_id === t.plan_id);
  const reach = mine.filter(i => i.booking_mode === 'reach').length;
  console.log(`  ${t.planTitle}: ${mine.length} lines, ${reach} that "Book everything" will now quote`);
}
console.log(`\nwritten: ${written}`);
