// ─── /api/discovery/harvest — turning places into classes ────────────────
// The sweep finds that Doodles is a pottery on Broughton Street with a
// website. This reads that website and finds "Wheel Throwing Taster
// Sessions, £60 per individual, £85 for 2 people".
//
// Measured on five real Edinburgh studios before this was written: three
// gave up real bookable classes with real prices, one had none listed and
// said so, and one was a Wix site with nothing in the HTML to read. That
// last one still shows as a venue with a link, which is all it ever was.
//
// Runs on a schedule (see vercel.json), after the sweep.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { harvestVenue } from '@/lib/discovery/harvest';
import { kindFor, mappableKinds } from '@/lib/discovery/taste';
import { FRESH_DAYS, dueFilter, harvestQueue } from '@/lib/discovery/harvest-queue';

export const maxDuration = 300;

// Venues per run. Each is up to two page fetches and one extraction, and a
// run that tries to read a whole city at once finishes none of it.
// Measured: five to fourteen seconds a venue, so twenty fits comfortably in
// the five minutes this function is allowed. A manual run can ask for fewer.
const PER_RUN = 20;
// How long a reading stands (FRESH_DAYS), how long each outcome is left
// alone, and how the night is shared between re-reads and venues never read:
// lib/discovery/harvest-queue.ts.

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[discovery/harvest] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });

  const db = createServerClient();
  // Warming one city by hand is a different job from the nightly pass.
  const asked = Number(req.nextUrl.searchParams.get('limit'));
  const perRun = Number.isFinite(asked) && asked > 0 ? Math.min(asked, PER_RUN) : PER_RUN;

  // The interests worth reading, as the table may spell them. Asked in the
  // query rather than filtered afterwards, so a window of rows the harvest
  // would skip anyway cannot fill the night.
  const worthReading = [...new Set(mappableKinds().filter(k => k.harvest)
    .flatMap(k => [k.key, k.key.charAt(0).toUpperCase() + k.key.slice(1)]))];

  // Two queues, read separately, because one queue sorted never-read first
  // put every place the weekly map load added ahead of every venue due a
  // re-read — and the listings on screens today would have expired behind
  // them. See lib/discovery/harvest-queue.ts for how the night is shared.
  const queue = (which: 'due' | 'new', live: boolean) => {
    let q = db
      .from('discovery_venues')
      .select('id, name, website, interest, last_harvested_at, harvest_status, image_source')
      .in('interest', worthReading);
    // Read long enough ago, by each venue's own back-off — and never a venue
    // the sweep marked as not worth reading. A skipped venue is never stamped
    // as harvested, so without this it would sit at the front of the queue
    // every night and starve the studios behind it.
    q = which === 'due'
      ? q.or(dueFilter())
      : q.is('last_harvested_at', null).is('harvest_status', null);
    // A venue the map loads have retired is not read again: its site staying
    // up would keep renewing classes at a place that has gone.
    if (live) q = q.is('gone_at', null);
    return which === 'due'
      ? q.order('last_harvested_at', { ascending: true }).limit(perRun * 3)
      : q.order('id').limit(perRun * 3);
  };
  const read = async (which: 'due' | 'new') => {
    const first = await queue(which, true);
    // gone_at arrives in sql/world-data-phase1-2026-09-24.sql; until then
    // nothing is gone, and the queue reads as it did before.
    if (first.error && (first.error.code === '42703' || /gone_at/.test(first.error.message || ''))) {
      return queue(which, false);
    }
    return first;
  };
  const [dueRead, newRead] = await Promise.all([read('due'), read('new')]);
  const error = dueRead.error ?? newRead.error;

  if (error) {
    console.error('[discovery/harvest] could not read venues', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ready = harvestQueue(dueRead.data ?? [], newRead.data ?? [], perRun, i => kindFor(i).harvest);
  if (!ready.length) return NextResponse.json({ read: 0, message: 'Everything is fresh' });

  const tally: Record<string, number> = {};
  let events = 0;
  // Venues whose classes could not be stored, so a run that wrote nothing is
  // visible in the response rather than looking like a quiet night.
  let unstored = 0;

  for (const venue of ready) {
    const result = await harvestVenue({ name: venue.name, website: venue.website });
    tally[result.status] = (tally[result.status] ?? 0) + 1;

    // Whether this venue's classes are safely on disk. A write that failed
    // must not be recorded as a successful harvest: the venue would then sit
    // out its whole back-off period — up to a fortnight — with nothing in the
    // table, and Discover would show the city as having nothing on.
    let stored = true;

    if (result.events.length) {
      // Replace rather than accumulate: a class that came off the page has
      // stopped running, and leaving it would send somebody to a door that
      // is not open. This is also why events carry a staleness date — a
      // harvest that fails must not leave last month's list standing.
      //
      // Insert first, then drop the old rows. The other way round left a
      // venue with no events at all whenever the insert failed — and because
      // the unique rule is (venue_id, title, when_text), a partial run could
      // collide with itself and fail the whole batch. Writing first means the
      // worst case is last week's list surviving one more night, which is
      // what stale_after already guards.
      const stamp = new Date().toISOString();
      // One row per (title, when_text), because that is what the upsert
      // conflicts on and Postgres refuses a statement naming the same row
      // twice — it fails the WHOLE write with "ON CONFLICT DO UPDATE
      // command cannot affect row a second time".
      //
      // Maryland Meadworks lists two things with the same name at the same
      // time on its own page. So that venue failed to store on every run,
      // every night, and would have gone on failing for ever: the error was
      // logged, the venue was marked read, and nothing was ever kept. The
      // sweep already dedupes for exactly this reason; the harvester did
      // not.
      const seen = new Set<string>();
      const unique = result.events.filter(e => {
        const key = `${e.title}|${e.when_text || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (unique.length !== result.events.length) {
        console.log('[discovery/harvest] the page listed the same thing twice', {
          venue: venue.name, listed: result.events.length, kept: unique.length,
        });
      }

      const { error: wrote } = await db.from('discovery_events').upsert(
        unique.map(e => ({
          venue_id: venue.id,
          title: e.title,
          starts_on: e.starts_on,
          when_text: e.when_text || null,
          price_text: e.price_text || null,
          booking_url: e.booking_url,
          interest: venue.interest,
          found_at: stamp,
          stale_after: new Date(Date.now() + FRESH_DAYS * 2 * 86400_000).toISOString(),
        })),
        { onConflict: 'venue_id,title,when_text' },
      );
      if (wrote) {
        console.error('[discovery/harvest] could not write events', venue.name, wrote.message);
        stored = false;
      } else {
        events += unique.length;
        // Anything from an earlier run that this one did not see again has
        // come off the page. Removed only now that the new list is stored.
        const { error: pruned } = await db.from('discovery_events')
          .delete().eq('venue_id', venue.id).lt('found_at', stamp);
        if (pruned) console.error('[discovery/harvest] could not prune old events', venue.name, pruned.message);
      }
    }

    // A failed write is left un-stamped, so the next run picks this venue up
    // again instead of treating it as done.
    if (!stored) { unstored += 1; continue; }

    const { error: marked } = await db.from('discovery_venues').update({
      last_harvested_at: new Date().toISOString(),
      harvest_status: result.status,
      // The venue's own picture, read from the page this already fetched —
      // no extra request, and only when they publish one. Left alone rather
      // than overwritten with null, so a site that stops serving og:image
      // for a week does not blank a card that was working.
      //
      // Never over a Wikimedia photo. That one came from the venue's own map
      // entry and carries an author and a licence (lib/discovery/photo-job);
      // the share image is the lesser source and waits behind it.
      ...(result.imageUrl && (venue as { image_source?: string | null }).image_source !== 'wikimedia'
        ? { image_url: result.imageUrl, image_source: 'og' } : {}),
    }).eq('id', venue.id);
    if (marked) console.error('[discovery/harvest] could not mark the venue harvested', venue.name, marked.message);
  }

  console.log('[discovery/harvest]', JSON.stringify({ read: ready.length, events, tally, unstored }));
  return NextResponse.json({ read: ready.length, events, tally, unstored });
}
