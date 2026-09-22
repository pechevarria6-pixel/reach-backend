// ─── One-off: the journey home, filed as a restaurant ────────────────────
// Every evening slot was typed as a restaurant, so the last evening of a trip
// could read "Flight home." with "book ahead" beside it. The typing is fixed
// in itineraryRows (lib/travel-slot.ts); these are the lines already saved.
//
// Retyped, not deleted: the tip under the line ("traffic toward the airport
// builds in the late afternoon") is still worth reading. Only the claim that
// this is something to reserve goes.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { isJourney } from '../lib/travel-slot.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: items, error } = await db.from('itinerary_items')
  .select('id, plan_id, type, booking_mode, scheduled_time, title')
  .neq('type', 'transport').neq('type', 'flight');
if (error) { console.error('could not read itinerary', error); process.exit(1); }

const todo = (items ?? []).filter(i => isJourney(i.title));
for (const t of todo) console.log(`  ${t.plan_id.slice(0, 8)} ${t.type}/${t.booking_mode} → transport/null | ${t.scheduled_time} | ${t.title}`);
console.log(`\nto retype: ${todo.length}`);
if (!todo.length || !APPLY) { if (todo.length) console.log('Dry run. Pass --apply to write.'); process.exit(0); }

const ids = todo.map(t => t.id);
const { error: wErr } = await db.from('itinerary_items')
  .update({ type: 'transport', booking_mode: null }).in('id', ids);
if (wErr) { console.error('update failed', wErr.code, wErr.message); process.exit(1); }
const { data: after } = await db.from('itinerary_items').select('id, type, booking_mode').in('id', ids);
const right = (after ?? []).filter(a => a.type === 'transport' && a.booking_mode === null).length;
console.log(`read back: ${right} of ${ids.length} are transport with no booking mode`);
