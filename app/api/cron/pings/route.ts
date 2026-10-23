// ─── /api/cron/pings — the countdown pings, hourly ──────────────────────
// T-7 packing list, T-1 flight check-in, the morning-of flight status and
// "Tonight: <line>, <time>". What each one needs behind it, and why a second
// run sends nothing, is in lib/pings.ts.
//
// Run by GitHub Actions (.github/workflows/pings.yml), not vercel.json: this
// account is on Hobby, where a cron runs once a day and a sub-daily schedule
// silently rejects the deployment. "Tonight" has to go out in the evening of
// whichever zone the trip is in, so once a day cannot do it.
//
// Guarded by CRON_SECRET. With no secret configured it refuses rather than
// running open, since anybody who found the URL could otherwise make it send.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/pings?dry=1
//
// The answer is counts only — the workflow's log is public, so it never
// names a plan, a person or a place.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { pushSender } from '@/lib/push';
import { runPings, aeroLookup } from '@/lib/pings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/pings] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  try {
    const report = await runPings(createServerClient(), {
      send: pushSender(),
      aero: aeroLookup(process.env.AEROAPI_KEY),
      dry,
    });
    // A run that could not read what it needs, or has no ping_log to claim
    // in, is a failure the workflow should show red — not a quiet 200.
    if (report.stopped) {
      console.error('[cron/pings] stopped before sending', { stopped: report.stopped });
      return NextResponse.json({ error: `Pings stopped: ${report.stopped}`, report }, { status: 503 });
    }
    return NextResponse.json({ dry, report });
  } catch (e) {
    console.error('[cron/pings] run failed', { error: (e as Error).message });
    return NextResponse.json({ error: 'Pings run failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
