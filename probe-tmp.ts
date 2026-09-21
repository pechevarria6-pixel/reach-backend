import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('itinerary_items').select('scheduled_time, is_confirmed, venue_website, type')
  .eq('plan_id','3d686f65-f696-475f-abd7-bd46ff805bbc').order('sort_order');
for (const i of data ?? []) console.log(`${String(i.scheduled_time).padEnd(15)} ${String(i.type).padEnd(10)} confirmed=${i.is_confirmed} ticket=${i.venue_website?'yes':'no'}`);
const since = new Date(Date.now()-3600_000).toISOString();
const { data: gen } = await db.from('audit_logs').select('created_at').eq('action','trip_generated').gte('created_at',since).order('created_at');
console.log(`\nallowance: ${gen?.length ?? 0}/10 used`);
if (gen?.length) console.log(`next slot in ${Math.max(0,Math.ceil((new Date(gen[0].created_at as string).getTime()+3600_000-Date.now())/60000))} min`);
