import { createServerClient } from './lib/supabase.ts';
const db = createServerClient();
const KEEP = ['The Milk Carton Kids','Greek Dinner & Jazz at The Pit','Dinner and Live Jazz in the Warehouse District','Downtown Raleigh Italian Evening','Moab, Utah, USA','Puerto Vallarta, Mexico'];
const { data } = await db.from('plans').select('id, group_id, title, type, destination_city, destination_country, start_date, end_date, vibe');
const mine = (data ?? []).filter(p => KEEP.some(k => String(p.title).startsWith(k.slice(0,20))));
console.log(JSON.stringify(mine.map(p=>({id:p.id,groupId:p.group_id,title:p.title,type:p.type,city:p.destination_city,country:p.destination_country,start:p.start_date,end:p.end_date,vibe:p.vibe}))));
