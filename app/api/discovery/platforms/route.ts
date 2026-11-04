// ─── Learning how each restaurant takes bookings ────────────────────────
// Reach has to know where a table is booked before anybody taps — a third
// party in the critical path of a screen somebody is waiting on decides how
// fast the screen is. So this runs on a schedule and keeps what it learns:
//
//   1. the restaurant's OpenStreetMap tags (reservation=no,
//      reservation:website, reservation:phone), which cost no fetch at all;
//   2. the restaurant's own website, read only where its robots.txt allows,
//      with the harvester's User-Agent, timeout and back-off.
//
// Only a link that names the restaurant on a platform, their own booking
// page, their own words about the phone or walking in, or their map entry
// saying so, is stored as an answer. Everything else stays null and is asked
// again after the harvester's back-off — never guessed. OpenTable, Resy and
// the rest are never fetched: only links the restaurant published are read.
//
// The deciding is in lib/discovery/reservation-crawl.ts, where it is tested.
// Protected by CRON_SECRET, like the sweep and the health checks.
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getText, robotsAllows } from '@/lib/discovery/harvest';
import {
  awaitingMigration, inPool, onePerSite, reservationDueFilter, rowUpdate, settleVenue,
  type CrawlVenue, type Settlement,
} from '@/lib/discovery/reservation-crawl';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Sites read in one run. Each is at most three requests to that one site
 * (robots.txt, the front page, the booking page it links to), never two
 * restaurants on one host in a run, four sites at a time. The harvester's
 * eight-second timeout bounds each request, and new sites stop being started
 * well inside the five minutes.
 */
const SITES_PER_RUN = 60;
const AT_ONCE = 4;
const STOP_STARTING_MS = 220_000;
/** Map-tag rows looked at per run. No fetch is made for these unless the tags settle nothing. */
const MAP_ROWS_PER_RUN = 400;

const BASE_COLUMNS = 'id, name, website, phone, osm_tags, countries, reservation_platform, reservation_method';

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[discovery/platforms] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

const missingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /reservation_check|reservation_source|schema cache/i.test(e.message || ''));

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  const started = Date.now();
  const db = createServerClient();
  const asked = Number(req.nextUrl.searchParams.get('limit'));
  const sitesPerRun = Number.isFinite(asked) && asked > 0 ? Math.min(asked, SITES_PER_RUN) : SITES_PER_RUN;

  // Whether sql/reservation-coverage-2026-11-04.sql has run: it adds where
  // a look is recorded, and widens the platforms the column accepts.
  const probe = await db.from('discovery_venues').select('reservation_checked_at').limit(1);
  const migrated = !probe.error;
  if (probe.error && !missingColumn(probe.error)) {
    if (/reservation_platform|reservation_method/i.test(probe.error.message || '')) {
      console.error('[discovery/platforms] the reservation columns are not there yet');
      return NextResponse.json({ error: 'This needs sql/reservation-platform-2026-09-20.sql in Supabase.' }, { status: 503 });
    }
    console.error('[discovery/platforms] could not read venues', { code: probe.error.code });
    return NextResponse.json({ error: 'Could not read the venues' }, { status: 500 });
  }

  // Every restaurant, by kind — the old filter on interest never saw the
  // 176k filed under "places to eat" — and only ones not settled.
  const unsettled = (cols: string) => db.from('discovery_venues').select(cols)
    .eq('kind', 'restaurant').is('reservation_method', null);

  // 1. Restaurants whose map entry may answer it.
  let mapQ = unsettled(BASE_COLUMNS)
    .or('osm_tags->>reservation.eq.no,osm_tags->>"reservation:website".not.is.null,osm_tags->>"reservation:phone".not.is.null');
  if (migrated) mapQ = mapQ.is('reservation_checked_at', null);
  const mapRead = await mapQ.limit(MAP_ROWS_PER_RUN);
  // A slow scan of the tags is not a reason to skip the crawl.
  if (mapRead.error) console.error('[discovery/platforms] could not read the map tags', { code: mapRead.error.code });

  // 2. Restaurants to read: never checked, then past their back-off.
  let siteRows: CrawlVenue[] = [];
  if (migrated) {
    const [fresh, due] = await Promise.all([
      unsettled(BASE_COLUMNS).not('website', 'is', null).is('reservation_checked_at', null).limit(sitesPerRun * 3),
      unsettled(BASE_COLUMNS).not('website', 'is', null).or(reservationDueFilter())
        .order('reservation_checked_at', { ascending: true }).limit(sitesPerRun),
    ]);
    if (fresh.error) console.error('[discovery/platforms] could not read new restaurants', { code: fresh.error.code });
    if (due.error) console.error('[discovery/platforms] could not read due restaurants', { code: due.error.code });
    const half = Math.ceil(sitesPerRun / 2);
    const dueRows = (due.data ?? []) as unknown as CrawlVenue[];
    siteRows = [...dueRows.slice(0, half), ...((fresh.data ?? []) as unknown as CrawlVenue[])];
  } else {
    // Before the migration nothing records a look, so a window that starts
    // in a different place each night is what stops the same rows coming
    // round for ever. It starts at a random id rather than a random offset:
    // an offset of 20,000 into this table times out (measured 2026-11-04),
    // while a start key is one step down the primary key's index.
    const window = await unsettled(BASE_COLUMNS).not('website', 'is', null)
      .gt('id', randomUUID()).order('id').limit(sitesPerRun * 3);
    if (window.error) console.error('[discovery/platforms] could not read restaurants', { code: window.error.code });
    siteRows = (window.data ?? []) as unknown as CrawlVenue[];
  }

  const deps = { allowed: robotsAllows, read: getText };
  const found: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const from: Record<string, number> = { osm: 0, site: 0 };
  let unstored = 0;
  let waiting = 0;

  const store = async (venue: CrawlVenue, s: Settlement): Promise<void> => {
    if (awaitingMigration(s, migrated)) waiting += 1;
    // A map pass that settled nothing has not looked at the site yet; it is
    // not a look to record.
    if (!s.fetched && s.outcome !== 'settled') return;
    const patch = rowUpdate(venue, s, migrated);
    if (!patch) return;
    const { error } = await db.from('discovery_venues').update(patch).eq('id', venue.id).is('reservation_method', null);
    if (error) {
      console.error('[discovery/platforms] could not store what we found', { venue: venue.id, code: error.code });
      unstored += 1;
      return;
    }
    if (patch.reservation_method && s.finding) {
      found[s.finding.method] = (found[s.finding.method] ?? 0) + 1;
      if (s.source) from[s.source] += 1;
    }
  };

  // The map first: no fetch, so these are cheap and never count as sites.
  for (const venue of (mapRead.data ?? []) as unknown as CrawlVenue[]) {
    const s = await settleVenue(venue, deps, { fetch: false });
    if (s.outcome === 'settled') await store(venue, s);
    else siteRows.unshift(venue);
  }

  const sites = onePerSite(siteRows.filter((v, i, all) => all.findIndex(w => w.id === v.id) === i), sitesPerRun);
  const deadline = started + STOP_STARTING_MS;
  const read = await inPool(sites, AT_ONCE, deadline, async ({ rows }) => {
    const s = await settleVenue(rows[0], deps);
    outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
    // One reading of a site answers every row that names it.
    for (const venue of rows) await store(venue, s);
  });

  const body = {
    migrated,
    map_rows: (mapRead.data ?? []).length,
    sites_read: read,
    outcomes,
    found,
    from,
    unstored,
    // Restaurants on SevenRooms, Yelp or TheFork that are left unsettled
    // until the migration lets the column hold those names.
    awaiting_migration: waiting,
    note: 'only settled answers are stored; everything else is asked again after the harvester’s back-off, never guessed',
  };
  console.log('[discovery/platforms]', JSON.stringify(body));
  return NextResponse.json(body);
}
