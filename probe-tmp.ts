import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('bookings').select('id, status, provider, provider_ref')
  .eq('plan_id','30c78ed1-b351-4815-9107-a8ffed264348')
  .in('status',['quoted','awaiting_approval','pending','confirmed']).order('created_at');
console.log('live on that plan right now:');
for (const b of data ?? []) console.log(`  ${b.provider_ref ?? '—'}  ${b.status}  (${b.provider})`);
const { data: c } = await db.from('contributions').select('stripe_payment_intent, user_id, status');
const dup=new Map<string,number>();
for (const x of c ?? []) { if(!x.stripe_payment_intent) continue; const k=`${x.stripe_payment_intent}|${x.user_id}`; dup.set(k,(dup.get(k)??0)+1); }
console.log(`\ncontribution duplicates that would block index 2: ${[...dup.values()].filter(n=>n>1).length}`);
