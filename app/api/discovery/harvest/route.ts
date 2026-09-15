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

export const maxDuration = 300;

// Venues per run. Each is up to two page fetches and one extraction, and a
// run that tries to read a whole city at once finishes none of it.
const PER_RUN = 12;
// How long a reading stands before we go back. A class list read in
// September is not to be trusted in December.
const FRESH_DAYS = 14;
// A site that cannot be rendered will not render next week either. Come back
// eventually in case they move off Wix, but not tomorrow.
const RETRY_DAYS: Record<string, number> = {
  ok: FRESH_DAYS, nothing_found: 21, needs_render: 45, blocked: 90, unreachable: 7,
};

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
  const due = new Date(Date.now() - FRESH_DAYS * 86400_000).toISOString();

  const { data: venues, error } = await db
    .from('discovery_venues')
    .select('id, name, website, interest, last_harvested_at, harvest_status')
    .or(`last_harvested_at.is.null,last_harvested_at.lt.${due}`)
    .order('last_harvested_at', { ascending: true, nullsFirst: true })
    .limit(PER_RUN * 3);

  if (error) {
    console.error('[discovery/harvest] could not read venues', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!venues?.length) return NextResponse.json({ read: 0, message: 'Everything is fresh' });

  // A site read last week and found unreadable does not need reading again
  // this week. Honouring its own back-off is what keeps us welcome.
  const ready = venues.filter(v => {
    if (!v.last_harvested_at) return true;
    const wait = RETRY_DAYS[v.harvest_status ?? 'unreachable'] ?? FRESH_DAYS;
    return Date.now() - new Date(v.last_harvested_at).getTime() > wait * 86400_000;
  }).slice(0, PER_RUN);

  const tally: Record<string, number> = {};
  let events = 0;

  for (const venue of ready) {
    const result = await harvestVenue({ name: venue.name, website: venue.website });
    tally[result.status] = (tally[result.status] ?? 0) + 1;

    if (result.events.length) {
      // Replace rather than accumulate: a class that came off the page has
      // stopped running, and leaving it would send somebody to a door that
      // is not open. This is also why events carry a staleness date — a
      // harvest that fails must not leave last month's list standing.
      await db.from('discovery_events').delete().eq('venue_id', venue.id);
      const { error: wrote } = await db.from('discovery_events').insert(
        result.events.map(e => ({
          venue_id: venue.id,
          title: e.title,
          starts_on: e.starts_on,
          when_text: e.when_text || null,
          price_text: e.price_text || null,
          booking_url: e.booking_url,
          interest: venue.interest,
          stale_after: new Date(Date.now() + FRESH_DAYS * 2 * 86400_000).toISOString(),
        })),
      );
      if (wrote) console.error('[discovery/harvest] could not write events', venue.name, wrote.message);
      else events += result.events.length;
    }

    await db.from('discovery_venues').update({
      last_harvested_at: new Date().toISOString(),
      harvest_status: result.status,
    }).eq('id', venue.id);
  }

  console.log('[discovery/harvest]', JSON.stringify({ read: ready.length, events, tally }));
  return NextResponse.json({ read: ready.length, events, tally });
}
