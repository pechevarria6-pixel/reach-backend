// ─── /api/nearby ─────────────────────────────────────────────────────────
// What there is to do near you, from every source we have, ordered by what
// you told us you are into.
//
// This was one call to Ticketmaster. Ticketmaster sells concerts, sport,
// theatre and film, so Discover could answer "what's on Friday" and could
// not answer "I like pottery" at any radius — a wheel on a Tuesday evening
// is a business that runs a class, not a ticketed event.
//
// Sources are plural now and fail separately. One being unconfigured or down
// costs the others nothing, and the response says which answered so the
// screen can tell the difference between a quiet week and a broken key.
import { NextRequest, NextResponse } from 'next/server';
import { dayWhere } from '@/lib/calendar';
import { requireUser, isFail } from '@/lib/auth';
import { ticketmaster } from '@/lib/discovery/ticketmaster';
import { yelpEvents, yelpPlaces } from '@/lib/discovery/yelp';
import { cachedVenues, cachedEvents, noteArea } from '@/lib/discovery/cache';
import { rank, rotateDaily, seedOf, THIN_POOL } from '@/lib/discovery/rank';
import { tasteFrom } from '@/lib/discovery/taste';
import type { Seeker, SourceResult } from '@/lib/discovery/types';

export const maxDuration = 30;

type Reason = 'ok' | 'no_key' | 'no_location' | 'none_nearby' | 'provider_error';

function empty(reason: Reason, city: string, sources: SourceResult[] = [], personal?: boolean) {
  return NextResponse.json({
    events: [], reason, city, personal,
    sources: sources.map(s => ({ source: s.source, status: s.status, found: s.findings.length })),
  });
}

export async function GET(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  const city = req.nextUrl.searchParams.get('city') || '';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return empty('no_location', city);

  // What they told the quiz — all of it. This used to read the activities
  // question alone, so somebody who said they eat Japanese, drink cocktails
  // and end the night in a proper pub got nothing that knew them. Typed
  // answers count the same as chips.
  const { data: me } = await ctx.db
    .from('users')
    .select('favorite_activities, cuisines, music_genres, nightlife_style, drink_style, no_way_jose')
    .eq('id', ctx.user.id).single();

  const taste = tasteFrom(me);
  const seeker: Seeker = {
    lat, lng, city,
    interests: taste.interests,
    // A bit of everything alongside, so a new person's first screen is their
    // city rather than a prompt to fill in a form.
    browse: taste.browse,
    avoid: (me?.no_way_jose ?? []).filter(Boolean),
  };
  const personal = seeker.interests.length > 0;

  // All three at once. Sequentially this would be three round trips deep
  // inside a request somebody is waiting on with an empty screen.
  const results = await Promise.all([
    ticketmaster(seeker),
    yelpEvents(seeker),
    yelpPlaces(seeker),
    // Open map data: the only source needing no key and no commercial
    // relationship, and the only one that knows about the pottery studio
    // down the road that has never been ticketed or reviewed.
    //
    // Read from the cache, never live. Overpass is run by volunteers, it
    // answers 504 when a city is dense, and when it is merely busy it hangs
    // rather than refusing — three mirrors in sequence took over two minutes
    // in testing, for a screen somebody is staring at. The sweep goes and
    // looks; this reads what it found.
    cachedVenues(ctx.db, seeker),
    // The classes themselves, read off those venues' own pages. This is the
    // whole point: not "there is a pottery near you" but "wheel throwing,
    // Thursday, sixty pounds".
    cachedEvents(ctx.db, seeker),
  ]);

  // Say we were asked about here, so the sweep knows where to go next. Reach
  // cannot sweep the world and does not have to: people say where they are
  // by opening this screen — including people who have not done the quiz.
  await noteArea(ctx.db, seeker);

  // Ranked first, so the best match for this person is still the best match,
  // then rotated within bands so the page is not identical to yesterday's.
  // The seed is the local day and the person: two people in the same town see
  // different orders, and each of them sees a different one tomorrow.
  const ranked = rank(results.flatMap(r => r.findings), seeker.interests);
  const events = rotateDaily(ranked, seedOf(dayWhere(lng), ctx.user.id));
  const sources = results.map(r => ({ source: r.source, status: r.status, found: r.findings.length }));

  // Every source refusing is a different problem from a quiet week, and the
  // screen has to say which. "Nothing on near you" over a dead key is how
  // somebody concludes their city is boring.
  if (!events.length) {
    const configured = results.filter(r => r.status !== 'no_key');
    if (!configured.length) {
      console.error('[nearby] no discovery source is configured');
      return empty('no_key', city, results, personal);
    }
    if (configured.every(r => r.status === 'error')) {
      console.error('[nearby] every configured source failed',
        results.map(r => `${r.source}:${r.status}${r.detail ? `(${r.detail})` : ''}`).join(' '));
      return empty('provider_error', city, results, personal);
    }
    return empty('none_nearby', city, results, personal);
  }

  // How much there actually is. A dozen places shuffled daily is still a
  // dozen places, and the screen says so rather than implying a deep catalogue
  // — the honest answer while the sweep and harvest fill a new area in.
  const thin = events.length < THIN_POOL;

  return NextResponse.json({
    events, reason: 'ok', city, sources, personal,
    pool: events.length,
    thin,
  });
}
