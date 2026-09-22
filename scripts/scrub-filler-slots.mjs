// ─── One-off: take out the lines that describe the form ──────────────────
// Two itinerary lines, both in the "main event" slot of a night out, are the
// model talking about the slot instead of filling it. Neither is a plan.
//
// There is nothing to rescue in them — unlike a stay claim, which sits
// inside a sentence with true things around it — and writing somebody's
// evening for them is not on offer. So the line goes, and the evening is the
// two real things that are left.
//
// Dry by default. --apply writes, and reads back.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fillerClaim } from '../lib/filler.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: items, error } = await db.from('itinerary_items')
  .select('id, plan_id, scheduled_time, title, sort_order');
if (error) { console.error('could not read items', error); process.exit(1); }

const bad = (items ?? []).filter(i => fillerClaim(i.title));
console.log(`items read: ${items?.length ?? 0}`);
console.log(`lines that describe the slot rather than fill it: ${bad.length}\n`);

const { data: plans } = await db.from('plans').select('id, title');
const planName = new Map((plans ?? []).map(p => [p.id, p.title]));
for (const b of bad) {
  const siblings = (items ?? []).filter(i => i.plan_id === b.plan_id).length;
  console.log(`  ${planName.get(b.plan_id)}`);
  console.log(`    [${b.scheduled_time}] ${b.title}`);
  console.log(`    ↳ deleting leaves ${siblings - 1} real things on that evening\n`);
}
if (!bad.length) { console.log('nothing to do'); process.exit(0); }
if (!APPLY) { console.log('Dry run. Pass --apply to write.'); process.exit(0); }

let gone = 0;
for (const b of bad) {
  const { error: dErr } = await db.from('itinerary_items').delete().eq('id', b.id);
  if (dErr) { console.error('  delete failed', b.id, dErr.code); continue; }
  gone++;
}
const { data: after } = await db.from('itinerary_items').select('id, title');
const left = (after ?? []).filter(i => fillerClaim(i.title));
console.log(`deleted: ${gone}`);
console.log(`lines still describing the slot: ${left.length}`);
