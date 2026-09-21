import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('itinerary_items')
  .select('scheduled_time, title, type, booking_mode, cost_cents, is_confirmed, venue_website')
  .eq('plan_id','3d686f65-f696-475f-abd7-bd46ff805bbc').order('sort_order');
for (const i of data ?? []) console.log(`${String(i.scheduled_time).padEnd(15)} ${String(i.type).padEnd(10)} mode=${String(i.booking_mode).padEnd(8)} $${(i.cost_cents??0)/100} conf=${i.is_confirmed} ticket=${i.venue_website?'yes':'no'}`);
console.log('sum of all cost_cents:', (data??[]).reduce((a,i)=>a+(i.cost_cents??0),0)/100);
