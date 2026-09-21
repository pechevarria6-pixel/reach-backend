import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data: plans } = await db.from('plans')
  .select('id, title, type, destination_city, start_date, end_date, budget_cents, created_at')
  .ilike('title', '%milk carton%');
for (const p of plans ?? []) {
  console.log(`plan "${p.title}" type=${p.type} city=${p.destination_city ?? 'NULL'} ${p.start_date}→${p.end_date} budget=${p.budget_cents} created=${String(p.created_at).slice(0,16)}`);
  const { data: items } = await db.from('itinerary_items')
    .select('title, scheduled_time, booking_mode, cost_cents, created_at')
    .eq('plan_id', p.id).order('sort_order');
  console.log(`  ${items?.length} items, created ${String(items?.[0]?.created_at).slice(0,16)}`);
  for (const i of (items ?? []).slice(0,3)) console.log(`   ${i.scheduled_time} · ${String(i.title).slice(0,60)} · ${i.booking_mode} · $${(i.cost_cents??0)/100}`);
}
