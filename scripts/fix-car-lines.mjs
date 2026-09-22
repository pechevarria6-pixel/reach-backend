// ─── One-off: cars that said Reach would book them ───────────────────────
// fixedCostRows marked ground transport as booking_mode 'reach'. Reach has
// no car provider, so "Car rental full week" was skipped at checkout on every
// open and nothing ever booked it — and on Rincón it sat beside a second car
// line, the rental added when the flight went into MAZ.
//
// For each such line: if the plan already has a rental line with a search
// link, the old one goes and its estimate moves onto the one with the link;
// otherwise it becomes the traveller's to book, and the next open of checkout
// attaches the search at their airport. Dry unless --apply.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: lines, error } = await db.from('itinerary_items')
  .select('id, plan_id, title, booking_mode, venue_website, cost_cents').eq('type', 'transport');
if (error) { console.error('could not read', error); process.exit(1); }
const { data: plans } = await db.from('plans').select('id, title');
const T = new Map((plans ?? []).map(p => [p.id, p.title]));

const isCar = t => /\b(car|rental|hire|drive)\b/i.test(t || '');
const plan = [];
for (const l of lines.filter(l => l.booking_mode === 'reach' && isCar(l.title))) {
  const linked = lines.find(o => o.plan_id === l.plan_id && o.id !== l.id && /kayak\.com\/cars\//.test(o.venue_website || ''));
  plan.push(linked
    ? { kind: 'merge', drop: l, keep: linked }
    : { kind: 'yours', line: l });
}
for (const p of plan) {
  if (p.kind === 'merge') console.log(`  ${T.get(p.drop.plan_id)}: drop "${p.drop.title}" ($${(p.drop.cost_cents || 0) / 100}), keep "${p.keep.title}"`);
  else console.log(`  ${T.get(p.line.plan_id)}: "${p.line.title}" → yours to book`);
}
console.log(`\nto fix: ${plan.length}`);
if (!plan.length || !APPLY) { if (plan.length) console.log('Dry run. Pass --apply to write.'); process.exit(0); }

let ok = 0;
for (const p of plan) {
  if (p.kind === 'merge') {
    const { error: u } = await db.from('itinerary_items')
      .update({ cost_cents: p.keep.cost_cents || p.drop.cost_cents || 0 }).eq('id', p.keep.id);
    const { error: d } = u ? { error: u } : await db.from('itinerary_items').delete().eq('id', p.drop.id);
    if (u || d) { console.error('  failed', (u || d).message); continue; }
  } else {
    const { error: u } = await db.from('itinerary_items').update({
      booking_mode: 'ahead',
      payment_note: 'You book this on your own card — the rental search opens at your airport and dates',
    }).eq('id', p.line.id);
    if (u) { console.error('  failed', u.message); continue; }
  }
  ok++;
}
const { data: after } = await db.from('itinerary_items').select('id').eq('type', 'transport').eq('booking_mode', 'reach');
console.log(`fixed ${ok}; transport lines still marked as Reach booking them: ${after?.length ?? '?'}`);
