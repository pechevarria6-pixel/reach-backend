// ─── Two Duffel orders nothing can reach ─────────────────────────────────
// Puerto Vallarta held two CONFIRMED flight bookings for one journey:
//
//   MHW2Y3  American Airlines · RDU → PVR · 2026-11-02   $138.09
//   SFYVFK  Duffel Airways   · RDU → PVR · 2026-11-02    $135.02
//
// The plan's funding target was the sum, $273.11, so somebody would have
// been charged for two flights to take one. These are also the two orders
// that have been blocking the booking idempotency migration.
//
// They cannot be cancelled at the airline. POST /api/bookings/<id>/cancel
// returns Duffel's own 404 — "The resource you are trying to access does not
// exist" — consistently, for both, so the key production uses cannot see
// them. SFYVFK is flight ZZ6351 on Duffel Airways, which is Duffel's
// test-only carrier and exists in no other mode, and both orders were
// written seconds apart by the same key.
//
// Orphaned test artefacts, then. The owner chose to delete both rather than
// record a cancellation that did not happen.
//
// Only these two ids, named explicitly. Dry by default; --apply writes and
// reads back.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const IDS = [
  'e8a47917-cf95-46ef-906c-16db355214f3', // MHW2Y3
  '31cb8b7b-cdec-49d3-adbf-36070375bdf0', // SFYVFK
];

const { data: before, error: readErr } = await db.from('bookings')
  .select('id, plan_id, provider_ref, status, price_cents, detail').in('id', IDS);
if (readErr) { console.error('could not read', readErr); process.exit(1); }

console.log(`rows found: ${before?.length ?? 0} of ${IDS.length}`);
for (const b of before ?? []) {
  console.log(`  ${b.provider_ref}  ${b.status}  $${((b.price_cents ?? 0) / 100).toFixed(2)}  ${b.detail}`);
}
// Refuse to touch anything that is not one of the two described above.
const wrong = (before ?? []).filter(b => !['MHW2Y3', 'SFYVFK'].includes(String(b.provider_ref)));
if (wrong.length) { console.error('refusing: an id does not match its expected reference'); process.exit(1); }

if (!APPLY) { console.log('\nDry run. Pass --apply to delete.'); process.exit(0); }

const { error, count } = await db.from('bookings').delete({ count: 'exact' }).in('id', IDS);
if (error) { console.error('delete failed', error.code, error.message); process.exit(1); }

const { data: after } = await db.from('bookings').select('id').in('id', IDS);
const planId = before?.[0]?.plan_id;
const { data: rest } = await db.from('bookings').select('status, vertical').eq('plan_id', planId);
const by = {};
for (const r of rest ?? []) { const k = `${r.vertical}/${r.status}`; by[k] = (by[k] || 0) + 1; }
console.log(`\ndeleted: ${count} | rows still present: ${after?.length ?? 0}`);
console.log('what is left on that plan:', by);
