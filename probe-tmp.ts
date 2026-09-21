import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const since = new Date(Date.now()-3600_000).toISOString();
const { data } = await db.from('audit_logs').select('created_at').eq('action','trip_generated').gte('created_at',since).order('created_at');
const used = data?.length ?? 0;
console.log(`allowance: ${used}/10`);
if (used >= 10) {
  const oldest = new Date(data![0].created_at as string).getTime();
  console.log(`next slot in ${Math.max(0,Math.ceil((oldest+3600_000-Date.now())/60000))} min`);
} else console.log(`${10-used} available now`);
