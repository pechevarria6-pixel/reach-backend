// ─── /api/discovery/sweep — filling the venue cache ──────────────────────
// Goes and looks at the map for the areas people have actually asked about,
// and writes what it finds into discovery_venues. Discover then reads that
// table instead of waiting on Overpass, which is run by volunteers, answers
// 504 when a city is dense, and hangs rather than refusing when it is busy.
//
// Reach cannot sweep the world and does not have to. It sweeps where its
// users are, and they say where that is by opening Discover.
//
// Runs on a schedule (see vercel.json). Can also be triggered by hand with
// the same secret, which is how you warm a city before a launch.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { openStreetMap } from '@/lib/discovery/osm';
import type { Seeker } from '@/lib/discovery/types';

// Overpass is slow and this loops over areas. Give it room, but not so much
// that a stuck sweep holds a function open for a quarter of an hour.
export const maxDuration = 300;

// How long a swept area stays fresh. The map changes slowly; a studio that
// opened this morning can wait until tomorrow.
const FRESH_HOURS = 24;
// Areas per run. Each is several Overpass calls, and a run that tries to do
// every city at once finishes none of them.
// Each is several Overpass calls against a service that hangs when busy, and
// a run that tries every city at once finishes none of them.
const PER_RUN = 8;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when one is set.
  // With no secret configured this endpoint would rewrite the venue cache
  // for anybody who found the URL, so it refuses rather than running open.
  if (!secret) {
    console.error('[discovery/sweep] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const db = createServerClient();
  const staleBefore = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();

  // Never swept first, then longest since. Busiest area breaks the tie, so a
  // city a hundred people opened is warmed before one person's holiday.
  const { data: areas, error } = await db
    .from('discovery_areas')
    .select('id, lat, lng, city, interests, asked_count, last_swept_at')
    .or(`last_swept_at.is.null,last_swept_at.lt.${staleBefore}`)
    .order('last_swept_at', { ascending: true, nullsFirst: true })
    .order('asked_count', { ascending: false })
    .limit(PER_RUN);

  if (error) {
    console.error('[discovery/sweep] could not read areas', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!areas?.length) return NextResponse.json({ swept: 0, message: 'Everywhere is fresh' });

  const report: Array<Record<string, unknown>> = [];

  for (const area of areas) {
    const seeker: Seeker = {
      lat: Number(area.lat), lng: Number(area.lng), city: area.city || '',
      interests: (area.interests || []).slice(0, 6),
      // The sweep stores everything it finds. Hard nos belong to a person,
      // not to a city, and are applied when Discover reads the cache.
      avoid: [],
    };

    // A generous budget: nobody is waiting on this, and a mirror that needs
    // twenty seconds is still better than an empty city.
    const found = await openStreetMap(seeker, 25000);

    if (found.status !== 'ok') {
      await db.from('discovery_areas').update({
        sweep_status: found.status, sweep_detail: found.detail ?? null,
        // Deliberately not stamping last_swept_at: a failed sweep must come
        // round again quickly rather than counting as a day's work done.
      }).eq('id', area.id);
      report.push({ area: area.city || `${area.lat},${area.lng}`, status: found.status, found: 0 });
      continue;
    }

    const rows = found.findings.map(f => {
      // The id carries what the map called it: osm_node_123_pottery & crafts
      const [, osmType, osmId] = /^osm_([a-z]+)_(\d+)_/.exec(f.id) ?? [];
      // Without its own point a venue sits at the centre of the area, which
      // makes every distance on the screen the same and wrong.
      if (f.lat == null || f.lng == null) return null;
      return {
        osm_type: osmType ?? 'node',
        osm_id: Number(osmId ?? 0),
        name: f.title,
        lat: f.lat ?? Number(area.lat), lng: f.lng ?? Number(area.lng),
        city: area.city || null,
        website: f.url,
        interest: f.because || 'unknown',
        kind: f.meta.split(' · ')[0] || null,
        street: f.venue,
        last_seen_at: new Date().toISOString(),
      };
    }).filter((r): r is NonNullable<typeof r> => !!r && r.osm_id > 0);

    if (rows.length) {
      const { error: wrote } = await db
        .from('discovery_venues')
        .upsert(rows, { onConflict: 'osm_type,osm_id,interest' });
      if (wrote) console.error('[discovery/sweep] could not write venues', wrote.message);
    }

    await db.from('discovery_areas').update({
      last_swept_at: new Date().toISOString(),
      sweep_status: 'ok', sweep_detail: null,
    }).eq('id', area.id);

    report.push({ area: area.city || `${area.lat},${area.lng}`, status: 'ok', found: rows.length });
  }

  console.log('[discovery/sweep]', JSON.stringify(report));
  return NextResponse.json({ swept: report.length, areas: report });
}
