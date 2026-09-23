// ─── One-off: events that have already happened ──────────────────────────
// 348 of 639 dated events had passed, some in 2020 (see stillToCome in
// lib/discovery/when.ts). Discover already hid them; the menu the itinerary
// is written from did not. Expired, not deleted: stale_after is set to now,
// which every reader already respects, and the row stays as a record of what
// the page said. Weekly events stay. Dry unless --apply.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { stillToCome } from '../lib/discovery/when.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date().toISOString();

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('discovery_events')
    .select('id, title, starts_on, when_text, source, stale_after').gt('stale_after', now).range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
const gone = rows.filter(e => !stillToCome(e, today));
const kept = rows.filter(e => e.starts_on && e.starts_on < today && stillToCome(e, today));
console.log(`live events: ${rows.length}`);
console.log(`past, to expire: ${gone.length}`);
console.log(`past-dated but weekly, kept: ${kept.length}`);
for (const e of gone.slice(0, 5)) console.log('  expire', e.starts_on, '|', e.source, '|', e.title.slice(0, 50));
for (const e of kept.slice(0, 3)) console.log('  keep  ', e.starts_on, '|', e.when_text, '|', e.title.slice(0, 50));
if (!gone.length || !APPLY) { if (gone.length) console.log('Dry run. Pass --apply to write.'); process.exit(0); }

for (let i = 0; i < gone.length; i += 200) {
  const { error } = await db.from('discovery_events').update({ stale_after: now }).in('id', gone.slice(i, i + 200).map(e => e.id));
  if (error) { console.error('update failed', error.message); process.exit(1); }
}
const { count } = await db.from('discovery_events').select('id', { count: 'exact', head: true })
  .gt('stale_after', new Date().toISOString()).lt('starts_on', today);
console.log(`read back: live events dated before today: ${count}`);
