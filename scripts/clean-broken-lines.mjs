// ─── One-off: itinerary text that came back broken ───────────────────────
// Rows written before the checks in lib/filler.ts (corruptionAt) and the
// line-level wouldMangle existed. Subtitles are cut back to their last whole
// sentence or cleared; a title that softening turned into nonsense ("a local
// spot at Dusk session at …") is listed for the owner rather than rewritten —
// a title is the line, and inventing a new one is the thing we do not do.
// Dry unless --apply.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { corruptionAt, beforeCorruption } from '../lib/filler.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('itinerary_items').select('id, plan_id, title, subtitle').range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
const subs = rows.filter(r => r.subtitle && corruptionAt(r.subtitle) >= 0)
  .map(r => ({ id: r.id, from: r.subtitle, to: beforeCorruption(r.subtitle) }));
const titlesBroken = rows.filter(r => r.title && corruptionAt(r.title) >= 0);
const titlesMangled = rows.filter(r => /^a local spot\b/i.test(r.title || ''));
console.log(`rows: ${rows.length}`);
console.log(`subtitles to fix: ${subs.length}`);
for (const s of subs) console.log(`  ${s.id.slice(0, 8)}  …${JSON.stringify(s.from.slice(-60))}  →  ${s.to === null ? '(cleared)' : '…' + JSON.stringify(s.to.slice(-40))}`);
console.log(`titles with broken text (listed, not changed): ${titlesBroken.length}`);
for (const t of titlesBroken) console.log(`  ${t.id.slice(0, 8)}  ${JSON.stringify(t.title.slice(0, 80))}`);
console.log(`titles softening mangled (listed, not changed): ${titlesMangled.length}`);
for (const t of titlesMangled) console.log(`  ${t.id.slice(0, 8)}  plan ${t.plan_id.slice(0, 8)}  ${JSON.stringify(t.title.slice(0, 80))}`);
if (!subs.length || !APPLY) { if (subs.length) console.log('Dry run. Pass --apply to write the subtitle fixes.'); process.exit(0); }

let ok = 0;
for (const s of subs) {
  const { error } = await db.from('itinerary_items').update({ subtitle: s.to }).eq('id', s.id);
  if (error) console.error('  failed', s.id, error.message); else ok++;
}
console.log(`fixed ${ok} of ${subs.length}`);
