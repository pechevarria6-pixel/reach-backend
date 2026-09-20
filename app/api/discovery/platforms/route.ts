// ─── Learning where each restaurant takes bookings ──────────────────────
// The member books their own table, on their own card, so their card's
// dining benefits survive. For that to work Reach has to know which platform
// to send them to — and has to know it before they tap, because a third
// party in the critical path of a screen somebody is waiting on is a third
// party that decides how fast the screen is.
//
// So this runs on a schedule, reads each restaurant's own website, and keeps
// what it finds. A link to resy.com on their page is proof they are on Resy;
// nothing else here is inferred. Places that take bookings by telephone come
// back 'none', which is a real answer and puts the phone number on screen
// rather than a guess.
//
// Protected by CRON_SECRET, like the sweep and the health checks.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { platformFromHtml, phoneFromHtml } from '@/lib/booking/reservations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** How many sites to read in one run. Somebody else's server, so gently. */
const PER_RUN = 12;
const TIMEOUT_MS = 10000;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[discovery/platforms] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });

  const db = createServerClient();

  // Only restaurants, only ones we have not asked about, only ones with a
  // site to read. Re-running is cheap and never re-reads a page it has
  // already understood.
  const { data: venues, error } = await db
    .from('discovery_venues')
    .select('id, name, website, reservation_platform')
    .is('reservation_platform', null)
    .not('website', 'is', null)
    .ilike('interest', '%restaurant%')
    .limit(PER_RUN);

  if (error) {
    // A missing column means sql/reservation-platform-2026-09-20.sql has not
    // been run. Said plainly rather than as a database error.
    if (/reservation_platform|schema cache/i.test(error.message || '')) {
      console.error('[discovery/platforms] the reservation columns are not there yet');
      return NextResponse.json(
        { error: 'This needs sql/reservation-platform-2026-09-20.sql in Supabase.' },
        { status: 503 },
      );
    }
    console.error('[discovery/platforms] could not read venues', { code: error.code });
    return NextResponse.json({ error: 'Could not read the venues' }, { status: 500 });
  }

  const found: Record<string, number> = {};
  let unreachable = 0;

  for (const venue of venues ?? []) {
    let html = '';
    try {
      const res = await fetch(venue.website as string, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Somebody should be able to see who is reading their page.
        headers: { 'User-Agent': 'Reach (hello@alcanzar.io)' },
      });
      if (res.ok) html = await res.text();
      else unreachable += 1;
    } catch {
      // A site that is down today is not a restaurant without a platform, so
      // it is left null and asked again on the next run.
      unreachable += 1;
      continue;
    }
    if (!html) continue;

    const { platform, url } = platformFromHtml(html);
    const phone = platform === 'none' ? phoneFromHtml(html) : null;

    const { error: wrote } = await db
      .from('discovery_venues')
      .update({
        reservation_platform: platform,
        reservation_url: url,
        ...(phone ? { phone } : {}),
      })
      .eq('id', venue.id);

    if (wrote) {
      console.error('[discovery/platforms] could not store what we found', { venue: venue.id, code: wrote.code });
      continue;
    }
    found[platform] = (found[platform] ?? 0) + 1;
  }

  return NextResponse.json({
    looked: (venues ?? []).length,
    found,
    unreachable,
    // Not an error: a town of family restaurants genuinely has no platform
    // between them, and the phone number is the right answer there.
    note: 'none means they take bookings some other way — the app shows their phone number',
  });
}
