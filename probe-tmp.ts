import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('discovery_areas').select('id, city, interests');
for (const a of data ?? []) {
  const list = (a.interests as string[]) ?? [];
  if (list.includes('places to eat')) continue;
  const { error } = await db.from('discovery_areas')
    .update({ interests: ['places to eat', ...list], last_swept_at: null, sweep_status: null })
    .eq('id', a.id);
  console.log(`${String(a.city).padEnd(20)} ${error ? 'FAILED '+error.message : 'now asks for places to eat, queued'}`);
}
