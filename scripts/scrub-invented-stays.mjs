// ─── One-off: take out the hotels nobody booked ──────────────────────────
// The generator defaulted accommodation to 'hotel' when a group had not said
// what they wanted, so it wrote days around a stay that does not exist. That
// default is gone and lib/stay-claims.ts now catches it at generation, but
// the lines already written are still in the table telling people to check
// into a reception desk that is not expecting them.
//
// Reads every itinerary item, removes the clause and nothing else, and says
// exactly what it did. Dry by default: pass --apply to write.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { stayClaim, withoutStayClaim } from '../lib/stay-claims.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Only plans with no hotel of their own. A trip that really did book one is
// entitled to talk about it.
const { data: hotelItems, error: hErr } = await db
  .from('itinerary_items').select('plan_id').eq('type', 'hotel');
if (hErr) { console.error('could not read hotel items', hErr); process.exit(1); }
const staysSomewhere = new Set((hotelItems ?? []).map(r => r.plan_id));

const { data: items, error } = await db
  .from('itinerary_items').select('id, plan_id, title, subtitle');
if (error) { console.error('could not read items', error); process.exit(1); }

let changed = 0, emptied = 0, skippedRealHotel = 0;
const edits = [];
for (const item of items ?? []) {
  for (const field of ['title', 'subtitle']) {
    const before = item[field];
    if (!stayClaim(before)) continue;
    if (staysSomewhere.has(item.plan_id)) { skippedRealHotel++; continue; }
    const { text, removed } = withoutStayClaim(before);
    // Nothing true left. The title is the line itself, so emptying it would
    // leave a blank row; those are reported and left for a person.
    if (text === null && field === 'title') { emptied++; edits.push({ item, field, before, after: null, removed }); continue; }
    edits.push({ item, field, before, after: text ?? '', removed });
    changed++;
  }
}

console.log(`items read: ${items?.length ?? 0}`);
console.log(`plans that really do have a hotel, left alone: ${staysSomewhere.size} (${skippedRealHotel} lines)`);
console.log(`lines to rewrite: ${changed}`);
console.log(`lines where nothing true would be left: ${emptied}\n`);
for (const e of edits) {
  console.log(`  [${e.removed}]`);
  console.log(`   -  ${e.before}`);
  console.log(`   +  ${e.after === null ? '*** NOTHING LEFT — needs a person ***' : e.after}\n`);
}

if (!APPLY) { console.log('Dry run. Pass --apply to write.'); process.exit(0); }

let written = 0, failed = 0;
for (const e of edits) {
  if (e.after === null) continue;
  const { error: wErr } = await db.from('itinerary_items').update({ [e.field]: e.after }).eq('id', e.item.id);
  if (wErr) { failed++; console.error('  write failed', e.item.id, wErr.code); continue; }
  written++;
}
console.log(`\nwritten: ${written}, failed: ${failed}, left for a person: ${emptied}`);

// Read it back. A write that reports success and changes nothing is the
// thing every guard in this repo exists to catch.
const { data: after } = await db.from('itinerary_items').select('id, title, subtitle');
const left = (after ?? []).filter(i => !staysSomewhere.has(i.plan_id)
  && (stayClaim(i.title) || stayClaim(i.subtitle)));
console.log(`stay claims still in the table: ${left.length}`);
for (const l of left) console.log('   still there:', String(l.title).slice(0, 70));
