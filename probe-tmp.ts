import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
// How much of the hourly allowance is spent, so the batch does not walk into a 429.
const since = new Date(Date.now()-3600_000).toISOString();
const { data } = await db.from('audit_logs').select('created_at')
  .eq('action','trip_generated').gte('created_at', since).order('created_at');
console.log(`generations in the last hour: ${data?.length ?? 0} of 10`);
if (data?.length) {
  const oldest = new Date(data[0].created_at as string).getTime();
  console.log(`oldest drops out of the window in ${Math.max(0,Math.ceil((oldest+3600_000-Date.now())/60000))} min`);
}
