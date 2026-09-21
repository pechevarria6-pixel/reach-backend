import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('itinerary_items').select('scheduled_time, title, cost_cents, venue_website')
  .eq('plan_id','30c78ed1-b351-4815-9107-a8ffed264348').order('sort_order');
console.log(`${data?.length} rows\n`);
for (const i of (data??[]).slice(0,9)) console.log(`${String(i.scheduled_time).padEnd(18)} ${i.venue_website?'🔗':'  '} ${String(i.title).slice(0,86)}`);
console.log('\n— days with no link (should read as real days, not gaps) —');
for (const i of (data??[]).filter(x=>!x.venue_website).slice(0,4)) console.log(`  ${String(i.title).slice(0,92)}`);
