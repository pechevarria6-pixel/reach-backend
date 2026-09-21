import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('itinerary_items').select('plan_id, title').limit(300);
const hits = (data ?? []).filter(i => /a local spot|another nearby/.test(String(i.title)));
console.log(`${hits.length} of ${data?.length} items carry a softened name\n`);
for (const h of hits.slice(0,10)) console.log(` ${String(h.title).slice(0,100)}`);
