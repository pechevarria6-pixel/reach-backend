import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('itinerary_items')
  .select('scheduled_time, title, type, booking_mode, cost_cents, venue_website, venue_name')
  .eq('plan_id','3d686f65-f696-475f-abd7-bd46ff805bbc').order('sort_order');
for (const i of data ?? []) {
  console.log(`${String(i.scheduled_time).padEnd(15)} ${String(i.type).padEnd(10)} $${(i.cost_cents??0)/100}`);
  console.log(`   ${String(i.title).slice(0,90)}`);
  console.log(`   → ${i.venue_name ?? '—'} · ${i.venue_website ?? 'NO LINK'}`);
}
