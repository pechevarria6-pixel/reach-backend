import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('bookings').select('plan_id, vertical, status, price_cents, detail, itinerary_item_id, created_at').order('created_at');
const byKey = new Map<string, any[]>();
for (const b of data ?? []) {
  const d = b.detail as any;
  const name = typeof d === 'string' ? d : (d?.title || d?.name || '(empty detail)');
  const key = `${b.plan_id?.slice(0,8)} | ${b.vertical} | ${String(name).slice(0,38)}`;
  (byKey.get(key) ?? byKey.set(key, []).get(key))!.push(b);
}
console.log('duplicate groups (same plan + vertical + name, more than one row):\n');
let dupes = 0;
for (const [k, rows] of byKey) {
  if (rows.length < 2) continue;
  dupes++;
  console.log(`${rows.length}×  ${k}`);
  console.log(`     statuses: ${rows.map(r=>r.status).join(', ')}`);
  console.log(`     itinerary_item_id set on ${rows.filter(r=>r.itinerary_item_id).length}/${rows.length}`);
}
console.log(`\n${dupes} duplicated groups out of ${byKey.size}`);
