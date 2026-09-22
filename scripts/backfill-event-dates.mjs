// ─── The dates that were only ever prose ─────────────────────────────────
// 183 harvested events carry a date in their own words — "Fri, Sep 25" —
// and starts_on is null, so no screen can sort them, filter them or put them
// on a calendar. Another 114 are genuinely weekly: "Mondays, 7:00-8:30pm".
//
// parseWhen reads both, and refuses anything it cannot check: a candidate
// date is only taken when the weekday it falls on is the weekday the text
// names. Sep 25 is a Friday in 2026 and a Thursday in 2025.
//
// Dry by default. --apply writes starts_on, and reads it back.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { parseWhen } from '../lib/discovery/when.ts';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const TODAY = new Date().toISOString().slice(0, 10);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: events, error } = await db.from('discovery_events')
  .select('id, title, when_text, starts_on, city').is('starts_on', null);
if (error) { console.error('could not read events', error); process.exit(1); }

const dated = [], weekly = [], refused = [];
for (const e of events ?? []) {
  const p = parseWhen(e.when_text, TODAY);
  if (p.on) dated.push({ e, on: p.on, confirmed: p.confirmed });
  else if (p.everyWeekdayIndex !== null) weekly.push(e);
  else refused.push(e);
}

console.log(`events with no date: ${events?.length ?? 0}`);
console.log(`  a date recoverable from the text: ${dated.length}`);
console.log(`    of which the weekday confirms:  ${dated.filter(d => d.confirmed).length}`);
console.log(`  weekly, so no single date belongs: ${weekly.length}`);
console.log(`  nothing a date could be read from: ${refused.length}\n`);

for (const d of dated.slice(0, 12)) {
  console.log(`  ${d.on}  ${d.confirmed ? '✓' : '·'}  "${String(d.e.when_text).slice(0, 26)}"  ${String(d.e.title).slice(0, 40)}`);
}
if (dated.length > 12) console.log(`  … and ${dated.length - 12} more`);
console.log('\n  refused, for the record:');
for (const r of refused.slice(0, 6)) console.log(`    "${String(r.when_text).slice(0, 44)}"`);

if (!APPLY) { console.log('\nDry run. Pass --apply to write.'); process.exit(0); }

// Only the ones a weekday agreed with.
//
// An unconfirmed date is a guess at the year: "August 12 - August 27, 202"
// is a truncated year and nothing in the line contradicts any reading of
// it. A guessed date on a listing is the same fault as a guessed venue, and
// this repo's rule is that a field which cannot be answered honestly stays
// empty. The unconfirmed ones are printed above and left alone.
const sure = dated.filter(d => d.confirmed);
console.log(`\nwriting ${sure.length} confirmed, leaving ${dated.length - sure.length} unconfirmed alone`);

let written = 0;
for (const d of sure) {
  const { error: wErr } = await db.from('discovery_events').update({ starts_on: d.on }).eq('id', d.e.id);
  if (wErr) { console.error('  write failed', d.e.id, wErr.code); continue; }
  written++;
}
const { count: stillNull } = await db.from('discovery_events')
  .select('id', { count: 'exact', head: true }).is('starts_on', null);
console.log(`\nwritten: ${written} | events still without a date: ${stillNull}`);
