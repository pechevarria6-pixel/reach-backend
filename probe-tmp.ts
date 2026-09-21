import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data: plans } = await db.from('plans')
  .select('id, title, type, destination_city, destination_country, start_date, end_date, budget_cents, status, solo_mode, group_id')
  .order('created_at', { ascending: false });
for (const p of plans ?? []) {
  const { count } = await db.from('itinerary_items').select('id',{count:'exact',head:true}).eq('plan_id', p.id);
  const { data: pref } = await db.from('plan_preferences').select('summary_text').eq('plan_id', p.id).limit(1);
  console.log(`${String(p.title).slice(0,30).padEnd(32)} ${String(p.type).padEnd(10)} city=${String(p.destination_city ?? 'NULL').padEnd(14)} ${p.start_date ?? '—'}→${p.end_date ?? '—'} $${(p.budget_cents??0)/100} items=${count} ${p.status}`);
  if (pref?.[0]?.summary_text) console.log(`    goal: "${String(pref[0].summary_text).slice(0,70)}"`);
}
