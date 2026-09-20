// ─── Warming one city's venue cache by hand ─────────────────────────────
// /api/discovery/sweep runs nightly and is gated by CRON_SECRET, which is a
// Vercel environment variable and not something a laptop has. This drives
// the same modules against the same table so a city can be warmed now —
// which the route's own comment names as a real use: "how you warm a city
// before a launch".
//
// Nothing here reimplements the sweep's judgement. It calls openStreetMap(),
// keys rows the same way, and writes to the same conflict target, so a run
// from here and a run from the cron leave the database in the same state.
//
//   node --experimental-strip-types scripts/sweep-area.mjs Raleigh
//   node --experimental-strip-types scripts/sweep-area.mjs Raleigh --write
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { openStreetMap, osmRef, tagsFor } from '../lib/discovery/osm.ts';
import { kindFor } from '../lib/discovery/taste.ts';

const wanted = process.argv[2];
const write = process.argv.includes('--write');
if (!wanted) { console.log('which city?'); process.exit(1); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: areas } = await db.from('discovery_areas').select('*').ilike('city', wanted);
if (!areas?.length) { console.log(`no area called "${wanted}" — somebody has to open Discover there first`); process.exit(1); }

for (const area of areas) {
  const name = area.city || `${area.lat},${area.lng}`;
  const kinds = [...new Set((area.interests || []).map(i => kindFor(i).key))]
    .filter(k => tagsFor(k).length)
    .slice(0, 24);
  console.log(`\n${name} (${area.lat},${area.lng}) — ${kinds.length} kinds, last swept ${area.last_swept_at ?? 'never'}`);
  if (!kinds.length) { console.log('  nothing anybody has asked for here yet'); continue; }

  const findings = [];
  let failed = 0;
  // Four at a time: an area asking a dozen interests in one breath is the
  // query Overpass refuses.
  for (let i = 0; i < kinds.length; i += 4) {
    const slice = kinds.slice(i, i + 4);
    const found = await openStreetMap(
      { lat: Number(area.lat), lng: Number(area.lng), city: area.city || '', interests: slice, avoid: [] },
      25000,
    );
    if (found.status !== 'ok') { failed++; console.log(`  ${slice.join(', ')} → ${found.status} ${found.detail ?? ''}`); continue; }
    console.log(`  ${slice.join(', ')} → ${found.findings.length}`);
    findings.push(...found.findings);
  }

  const now = new Date().toISOString();
  const rows = new Map();
  for (const f of findings) {
    const ref = osmRef(f.id);
    // Without its own point a venue sits at the centre of the area, which
    // makes every distance on the screen the same and wrong.
    if (!ref || f.lat == null || f.lng == null) continue;
    const interest = kindFor(f.because || 'unknown').key;
    rows.set(`${ref.type}/${ref.id}/${interest}`, {
      osm_type: ref.type, osm_id: ref.id, name: f.title,
      lat: f.lat, lng: f.lng, city: area.city || null,
      website: f.url, interest, kind: f.meta.split(' · ')[0] || null,
      street: f.venue, last_seen_at: now,
    });
  }

  const all = [...rows.values()];
  const withSite = all.filter(r => r.website).length;
  console.log(`  ${all.length} venues, ${withSite} with a website, ${failed} query failures`);

  if (!write) { console.log('  (dry run — pass --write to store)'); continue; }
  if (!all.length) { console.log('  nothing to store'); continue; }

  // Restaurants and bars are marked so the nightly harvest never spends its
  // budget reading a menu, exactly as the route does.
  const toRead = all.filter(r => kindFor(r.interest).harvest);
  const notToRead = all.filter(r => !kindFor(r.interest).harvest).map(r => ({ ...r, harvest_status: 'skip' }));
  let wroteAny = false;
  for (const batch of [toRead, notToRead]) {
    if (!batch.length) continue;
    const { error } = await db.from('discovery_venues').upsert(batch, { onConflict: 'osm_type,osm_id,interest' });
    if (error) { console.log('  write failed:', error.message); continue; }
    wroteAny = true;
  }

  // A failed sweep must come round again quickly rather than counting as a
  // day's work done, so the stamp only goes on when something was stored.
  if (wroteAny && !failed) {
    const { error } = await db.from('discovery_areas')
      .update({ last_swept_at: now, sweep_status: 'ok', sweep_detail: null }).eq('id', area.id);
    if (error) console.log('  could not mark it swept:', error.message);
    else console.log('  stored, and the area is marked swept');
  } else {
    console.log(`  stored=${wroteAny}, not marking it swept (${failed} query failures)`);
  }
}
