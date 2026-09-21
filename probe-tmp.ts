import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('itinerary_items').select('scheduled_time, title, cost_cents, venue_website')
  .eq('plan_id','30c78ed1-b351-4815-9107-a8ffed264348').order('sort_order');
console.log(`rows: ${data?.length}`);
for (const i of data ?? []) console.log(` ${String(i.scheduled_time).padEnd(18)} $${((i.cost_cents??0)/100).toFixed(0).padStart(3)} ${i.venue_website?'🔗':'  '} ${String(i.title).slice(0,78)}`);
