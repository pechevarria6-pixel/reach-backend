import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('audit_logs').select('action, created_at')
  .in('action',['trip_generated','itinerary_rebuilt'])
  .gte('created_at', new Date(Date.now()-1800_000).toISOString()).order('created_at');
console.log(`generations in the last 30 min: ${data?.length ?? 0}`);
for (const d of (data??[]).slice(-8)) console.log(` ${String(d.created_at).slice(11,19)} ${d.action}`);
const { data: it } = await db.from('itinerary_items').select('plan_id')
  .gte('created_at', new Date(Date.now()-1800_000).toISOString());
console.log(`itinerary items written: ${it?.length ?? 0}`);
