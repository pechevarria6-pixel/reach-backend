import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('audit_logs').select('created_at').eq('action','trip_generated')
  .gte('created_at', new Date(Date.now()-3600_000).toISOString()).order('created_at');
console.log(`allowance ${data?.length ?? 0}/10`);
console.log('last few:', (data??[]).slice(-4).map(d=>String(d.created_at).slice(11,19)).join(', '));
const { data: it } = await db.from('itinerary_items').select('plan_id, created_at')
  .gte('created_at', new Date(Date.now()-1800_000).toISOString());
console.log(`itinerary items written in the last 30 min: ${it?.length ?? 0}`);
