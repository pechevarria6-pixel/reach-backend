import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const { data } = await db.from('discovery_venues').select('city, name, website');
const total = data?.length ?? 0;
const withSite = (data??[]).filter(v=>v.website).length;
console.log(`venues: ${total} · with a website: ${withSite} (${Math.round(withSite/total*100)}%)`);
const byCity=new Map<string,{n:number;w:number}>();
for (const v of data??[]) { const c=String(v.city); const e=byCity.get(c)??{n:0,w:0}; e.n++; if(v.website)e.w++; byCity.set(c,e); }
for (const [c,e] of [...byCity.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,6)) console.log(`  ${c.padEnd(18)} ${e.w}/${e.n}`);
console.log('\nexamples:');
for (const v of (data??[]).filter(v=>v.website).slice(0,4)) console.log(`  ${String(v.name).slice(0,28).padEnd(30)} ${String(v.website).slice(0,48)}`);
