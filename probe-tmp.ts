import { createServerClient } from './lib/supabase.ts';
import { writeFileSync } from 'node:fs';
const db = createServerClient();
const { data: items } = await db.from('itinerary_items').select('*');
writeFileSync('/tmp/itinerary-backup-2026-09-21.json', JSON.stringify(items, null, 1));
console.log(`backed up ${items?.length} itinerary items to /tmp/itinerary-backup-2026-09-21.json`);

// The cities these plans are actually about, read from their own titles.
const FIX: Record<string,{city:string;country:string}> = {
  'Moab, Utah, USA': { city: 'Moab', country: 'US' },
  'Puerto Vallarta, Mexico': { city: 'Puerto Vallarta', country: 'MX' },
  'The Milk Carton Kids': { city: 'Washington', country: 'US' },
};
const { data: plans } = await db.from('plans').select('id, title, destination_city');
for (const p of plans ?? []) {
  const fix = FIX[p.title as string];
  if (!fix || p.destination_city) continue;
  const { error } = await db.from('plans')
    .update({ destination_city: fix.city, destination_country: fix.country }).eq('id', p.id);
  console.log(`${p.title}: city ← ${fix.city}, ${fix.country} ${error ? 'FAILED '+error.message : ''}`);
}
