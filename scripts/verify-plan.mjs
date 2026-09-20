// Runs the same modules the route runs, against the live database, so the
// first real verification pass can be watched rather than trusted.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { checkAll, tally } from '../lib/discovery/verify.ts';
import { attributedNote } from '../lib/discovery/wikivoyage.ts';
import { locatePlan } from '../lib/discovery/geocode.ts';

const planId = process.argv[2];
const write = process.argv.includes('--write');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: plan } = await db.from('plans')
  .select('id, title, destination_city, destination_country').eq('id', planId).maybeSingle();
if (!plan) { console.log('no such plan'); process.exit(1); }

const where = await locatePlan(plan);
console.log(`${plan.title} — ${plan.destination_city}`);
console.log(`located: ${where ? `${where.name} ${where.lat.toFixed(4)},${where.lng.toFixed(4)}` : 'NOT FOUND'}\n`);
if (!where) process.exit(1);

const { data: rows } = await db.from('itinerary_items')
  .select('id, title, subtitle').eq('plan_id', planId).order('created_at', { ascending: true }).limit(60);

const said = rows.map(r => [r.title, r.subtitle].filter(Boolean).join(' · '));
const checked = await checkAll(said, where);

for (let i = 0; i < rows.length; i++) {
  const c = checked[i];
  const v = c.verification;
  const mark = v.status === 'confirmed' ? 'REAL  ' : v.status === 'not_found' ? 'ABSENT' : '??    ';
  console.log(`${mark} ${rows[i].title.slice(0, 56)}`);
  if (v.status === 'confirmed') {
    console.log(`         ${v.facts.name} | ${v.facts.phone || 'no phone'} | pay: ${c.payment || '—'}`);
  }
  if (c.advice?.note) console.log(`         "${c.advice.note.slice(0, 66)}"`);
}

console.log('\n', tally(checked));

if (!write) { console.log('\n(dry run — pass --write to store)'); process.exit(0); }

const now = new Date().toISOString();
let stored = 0, failed = 0;
for (let i = 0; i < rows.length; i++) {
  const c = checked[i];
  const f = c.verification.status === 'confirmed' ? c.verification.facts : null;
  const { error } = await db.from('itinerary_items').update({
    verified_at: now,
    verified_status: c.verification.status,
    verified_source: f ? f.source : null,
    venue_name: f?.name ?? null,
    venue_phone: f?.phone ?? null,
    venue_website: f?.website ?? null,
    venue_note: c.advice ? attributedNote(c.advice) : null,
    venue_note_credit: c.advice?.credit.url ?? null,
    payment_note: c.payment,
  }).eq('id', rows[i].id);
  if (error) { console.log('  write failed', rows[i].id, error.message); failed++; continue; }
  stored++;
}
console.log(`\nstored ${stored}, failed ${failed}`);
