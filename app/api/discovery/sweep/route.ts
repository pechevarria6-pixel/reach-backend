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
import { openStreetMap, osmRef, tagsFor } from '@/lib/discovery/osm';
import { kindFor } from '@/lib/discovery/taste';
import { shapeBatches } from '@/lib/discovery/ingest';
import type { Finding } from '@/lib/discovery/types';

// Overpass is slow and this loops over areas. Give it room, but not so much
// that a stuck sweep holds a function open for a quarter of an hour.
export const maxDuration = 300;

// How long a swept area stays fresh. The map changes slowly; a studio that
// opened this morning can wait until tomorrow.
const FRESH_HOURS = 24;
// Areas per run. Each is several Overpass calls against a service that hangs
// when busy, and a run that tries every city at once finishes none of them.
const PER_RUN = 8;
// Kinds of place per Overpass request. An area with a dozen interests asked
// in one breath is the query that gets refused; four at a time is not.
const PER_QUERY = 4;
const MAX_KINDS = 24;
// Stop starting new work with a minute in hand, so the run reports what it
// did rather than being killed mid-write at the five minute limit.
const DEADLINE_MS = 240_000;
// No single area may eat the run. Washington had been asked about nineteen
// times and swept none, because it is dense enough that Overpass refuses it,
// it sorted first among the never-swept, and it spent every run's whole
// budget failing — so Charlotte, Seattle, Pittsburgh and Moab queued behind
// it were never reached at all. An area that cannot be done in a minute
// yields to the next one.
const PER_AREA_MS = 60_000;
// How long a failed area waits before it is tried again. Sooner than a
// successful one, which is what the old rule was reaching for; not
// immediately and forever, which is what it actually did.
const RETRY_HOURS = 6;

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

  const started = Date.now();
  const outOfTime = () => Date.now() - started > DEADLINE_MS;
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
    const name = area.city || `${area.lat},${area.lng}`;
    if (outOfTime()) { report.push({ area: name, status: 'next_run' }); continue; }
    // This area's own share, so one unsweepable city cannot starve the rest.
    const areaStarted = Date.now();
    const areaOutOfTime = () => outOfTime() || Date.now() - areaStarted > PER_AREA_MS;

    // Only kinds the map can answer, each once, whatever capitalisation an
    // older row stored them under.
    const wanted = [...new Set<string>((area.interests || []).map((i: string) => kindFor(i).key))]
      .filter(k => tagsFor(k).length);

    // What this area is already missing goes first.
    //
    // A minute is not enough for sixteen kinds — four Overpass calls at up to
    // twenty-five seconds each — so a city with a long list gets through
    // about two batches and stops. That is fine once and useless for ever:
    // every run redid the SAME first two batches, so Puerto Vallarta sat at
    // seven venues, all restaurants and a gallery, while its remaining
    // fourteen kinds were never reached at all. "Ran out of time" was
    // recorded truthfully each night and nothing changed.
    //
    // So each run starts with the kinds we hold nothing for here. The area
    // fills its own gaps over a few nights instead of redoing its first
    // slice, and no new column is needed to remember where it got to — the
    // venue table already knows.
    const { data: held, error: heldErr } = await db
      .from('discovery_venues')
      .select('interest')
      .gte('lat', Number(area.lat) - 0.35).lte('lat', Number(area.lat) + 0.35)
      .gte('lng', Number(area.lng) - 0.35).lte('lng', Number(area.lng) + 0.35);
    if (heldErr) {
      console.error('[discovery/sweep] could not read what this area already holds', { area: name, code: heldErr.code });
    }
    const covered = new Set((held ?? []).map(v => kindFor(String(v.interest)).key));
    const kinds = [
      ...wanted.filter(k => !covered.has(k)),
      ...wanted.filter(k => covered.has(k)),
    ].slice(0, MAX_KINDS);

    const findings: Finding[] = [];
    let failed = 0;
    let detail: string | undefined;
    for (let i = 0; i < kinds.length; i += PER_QUERY) {
      if (areaOutOfTime()) { failed++; detail = 'ran out of time'; break; }
      // A generous budget: nobody is waiting on this, and a mirror that needs
      // twenty seconds is still better than an empty city.
      const found = await openStreetMap({
        lat: Number(area.lat), lng: Number(area.lng), city: area.city || '',
        interests: kinds.slice(i, i + PER_QUERY),
        // The sweep stores everything it finds. Hard nos belong to a person,
        // not to a city, and are applied when Discover reads the cache.
        avoid: [],
      }, 25000);
      if (found.status !== 'ok') { failed++; detail = found.detail; continue; }
      findings.push(...found.findings);
    }

    const now = new Date().toISOString();
    const rows = new Map<string, Record<string, unknown> & { interest: string }>();
    for (const f of findings) {
      // The id carries what the map called it. This used to be read with a
      // pattern expecting a suffix no id has ever had, so every venue parsed
      // as id 0 and was thrown away, and every city swept "ok" with nothing.
      const ref = osmRef(f.id);
      // Without its own point a venue sits at the centre of the area, which
      // makes every distance on the screen the same and wrong.
      if (!ref || f.lat == null || f.lng == null) continue;
      const interest = kindFor(f.because || 'unknown').key;
      // One row per place per kind. Postgres refuses an upsert that names the
      // same row twice, and a whole area's write would go with it.
      rows.set(`${ref.type}/${ref.id}/${interest}`, {
        osm_type: ref.type,
        osm_id: ref.id,
        name: f.title,
        lat: f.lat, lng: f.lng,
        city: area.city || null,
        website: f.url,
        interest,
        kind: f.meta.split(' · ')[0] || null,
        street: f.venue,
        last_seen_at: now,
        // Only when the map has them. An upsert of null would wipe a phone
        // the platforms job found on the venue's own page.
        ...(f.osm?.phone ? { phone: f.osm.phone } : {}),
        ...(f.osm?.hours ? { opening_hours: f.osm.hours } : {}),
        ...(f.osm?.tags && Object.keys(f.osm.tags).length ? { osm_tags: f.osm.tags } : {}),
      });
    }

    // Restaurants, pubs and bars are marked so the harvest never spends its
    // nightly budget reading a menu. Written apart from the rest so a venue
    // worth reading keeps whatever the harvest last recorded about it.
    const all = [...rows.values()];
    const toRead = all.filter(r => kindFor(r.interest).harvest);
    const notToRead = all.filter(r => !kindFor(r.interest).harvest).map(r => ({ ...r, harvest_status: 'skip' }));
    // A write that fails is the difference between "this town has nothing on"
    // and "we could not save what it has". Only one of those is worth acting
    // on, and the area used to be stamped as swept either way — so a failure
    // hid the whole city for a day.
    let wroteAny = false;
    let writeFailed = false;
    // Grouped by which columns each row carries: supabase-js writes a bulk
    // upsert with every key any row has, and NULL where a row lacks one, so
    // one venue with a phone in a batch used to wipe the phone number the
    // platforms job had found for every other venue in it.
    for (const batch of [...shapeBatches(toRead), ...shapeBatches(notToRead)]) {
      if (!batch.length) continue;
      let { error: wrote } = await db
        .from('discovery_venues')
        .upsert(batch, { onConflict: 'osm_type,osm_id,interest' });
      // opening_hours and osm_tags arrive in sql/venue-hours-2026-09-23.sql.
      // Until it runs, save the venues without them rather than not at all.
      if (wrote && (wrote.code === 'PGRST204' || /opening_hours|osm_tags/.test(wrote.message || ''))) {
        console.error('[discovery/sweep] hours not stored — run sql/venue-hours-2026-09-23.sql');
        ({ error: wrote } = await db.from('discovery_venues').upsert(
          (batch as Record<string, unknown>[]).map(r => {
            const { opening_hours: _h, osm_tags: _t, ...rest } = r;
            return rest;
          }),
          { onConflict: 'osm_type,osm_id,interest' }));
      }
      if (wrote) {
        console.error('[discovery/sweep] could not write venues', { area: name, error: wrote.message });
        writeFailed = true;
      } else {
        wroteAny = true;
      }
    }

    // Nothing stored means nothing was learned, whatever the providers said.
    const storedNothing = all.length > 0 && !wroteAny;
    if (failed || writeFailed || storedNothing) {
      const status = writeFailed || storedNothing
        ? (wroteAny ? 'partial' : 'write_failed')
        : (all.length ? 'partial' : 'error');
      // Bookkeeping for a background job: deliberately unchecked, because a
      // note about where somebody looked must never fail the screen they are
      // looking at. The sweep comes round again regardless.
      await db.from('discovery_areas').update({
        sweep_status: status,
        sweep_detail: detail ?? (writeFailed || storedNothing ? 'venues could not be written' : null),
        // Stamped, but backdated so it falls stale again in RETRY_HOURS
        // rather than a full day. Leaving it null was the intent — a failed
        // sweep should come round again quickly — and the effect was that an
        // area which always fails always sorts first and always eats the
        // whole run. Washington starved four other cities for a fortnight
        // that way. Quickly, not forever.
        last_swept_at: new Date(Date.now() - (FRESH_HOURS - RETRY_HOURS) * 3600_000).toISOString(),
      }).eq('id', area.id);
      report.push({ area: name, status, kinds: kinds.length, found: all.length, stored: wroteAny });
      continue;
    }

    const { error: marked } = await db.from('discovery_areas').update({
      last_swept_at: now, sweep_status: 'ok', sweep_detail: null,
    }).eq('id', area.id);
    if (marked) console.error('[discovery/sweep] could not mark the area swept', { area: name, error: marked.message });
    report.push({ area: name, status: 'ok', kinds: kinds.length, found: all.length, stored: wroteAny });
  }

  console.log('[discovery/sweep]', JSON.stringify(report));
  return NextResponse.json({ swept: report.length, areas: report });
}
