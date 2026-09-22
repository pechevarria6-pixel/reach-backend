// ─── One-off: bookings for lines that no longer exist ────────────────────
// Every itinerary save gave every line a new id, and bookings kept pointing
// at the old ones (lib/itinerary-bookings.ts has the story, and the fix for
// saves from now on). This is for the rows stranded before it.
//
// Only rows nobody has made anywhere are retired — quoted, awaiting
// approval, pending, redirected. A confirmed booking is a real reservation
// and is listed, never touched. Dry unless --apply.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const UNMADE = ['quoted', 'awaiting_approval', 'pending', 'redirected'];

const { data: rows, error } = await db.from('bookings')
  .select('id, plan_id, vertical, status, detail, itinerary_item_id')
  .not('itinerary_item_id', 'is', null)
  .not('status', 'in', '("failed","cancelled")');
if (error) { console.error('could not read bookings', error); process.exit(1); }
const { data: lines } = await db.from('itinerary_items').select('id');
const exists = new Set((lines ?? []).map(l => l.id));
const { data: plans } = await db.from('plans').select('id, title');
const title = new Map((plans ?? []).map(p => [p.id, p.title]));

const orphans = (rows ?? []).filter(r => !exists.has(r.itinerary_item_id));
const retire = orphans.filter(r => UNMADE.includes(r.status));
const kept = orphans.filter(r => !UNMADE.includes(r.status));
for (const r of retire) console.log(`  retire  ${r.vertical}/${r.status} | ${title.get(r.plan_id)} | ${(r.detail ?? '').slice(0, 70)}`);
for (const r of kept) console.log(`  KEEP    ${r.vertical}/${r.status} | ${title.get(r.plan_id)} | ${(r.detail ?? '').slice(0, 70)}`);
console.log(`\nto retire: ${retire.length}   confirmed and kept: ${kept.length}`);
if (!retire.length || !APPLY) { if (retire.length) console.log('Dry run. Pass --apply to write.'); process.exit(0); }

const ids = retire.map(r => r.id);
const { error: wErr } = await db.from('bookings').update({ status: 'cancelled', itinerary_item_id: null }).in('id', ids);
if (wErr) { console.error('update failed', wErr.code, wErr.message); process.exit(1); }
const { data: after } = await db.from('bookings').select('id, status').in('id', ids);
console.log(`read back: ${(after ?? []).filter(a => a.status === 'cancelled').length} of ${ids.length} retired`);
