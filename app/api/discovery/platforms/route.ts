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
import { resolveReservation, isCertain } from '@/lib/booking/reservations';

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

  // One reader, used for the front page and for the booking page it links to.
  const read = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Somebody should be able to see who is reading their page.
        headers: { 'User-Agent': 'Reach (hello@alcanzar.io)' },
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  };

  for (const venue of venues ?? []) {
    // The front page often says only "Reservations" and links elsewhere, and
    // that second page is where the widget lives. Reading one page would call
    // Poole's Diner an own form when it is OpenTable.
    const finding = await resolveReservation(venue.website as string, read);

    // A site that is down today is not a restaurant we have learned about, so
    // it is left unanswered and asked again on the next run.
    if (!isCertain(finding) && !finding.phone) {
      unreachable += 1;
      continue;
    }

    // Only a settled answer is stored as one. An unresolved restaurant keeps
    // a null platform so this run picks it up again, and the number is kept
    // either way because it is a fact even when the method is not.
    const { error: wrote } = await db
      .from('discovery_venues')
      .update({
        ...(isCertain(finding)
          ? { reservation_platform: finding.platform, reservation_method: finding.method, reservation_url: finding.url }
          : {}),
        ...(finding.phone ? { phone: finding.phone } : {}),
      })
      .eq('id', venue.id);

    if (wrote) {
      console.error('[discovery/platforms] could not store what we found', { venue: venue.id, code: wrote.code });
      continue;
    }
    found[finding.method] = (found[finding.method] ?? 0) + 1;
  }

  return NextResponse.json({
    looked: (venues ?? []).length,
    found,
    unreachable,
    // Not an error: a town of family restaurants genuinely has no platform
    // between them, and the phone number is the right answer there.
    // "unknown" is not a result to show anybody. It is a restaurant Reach has
    // not settled yet, and it stays in the queue until it has.
    note: 'unknown means we have not settled how this one takes bookings — it is asked again, never guessed at',
  });
}
