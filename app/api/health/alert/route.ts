// ─── /api/health/alert — the providers check, with somebody told ─────────
// Calls /api/health/providers on this same deployment, decides what is
// broken (lib/observe/health-alert.ts) and emails it via Resend.
//
// Scheduled from GitHub Actions (.github/workflows/health-alert.yml), not
// vercel.json: this account is on Hobby, where a cron runs once a day at
// most and a sub-daily schedule silently rejects the deployment.
//
// Answers 200 with counts and provider names whenever the check itself ran,
// and says in `failing` how many lanes are broken; the workflow fails its own
// run when that is above zero, so a broken Resend — which cannot email about
// itself — still reaches somebody through GitHub's failure notice.
//
// Protected by CRON_SECRET, like the check it wraps. Nothing here books,
// charges or writes.
import { NextRequest, NextResponse } from 'next/server';
import { NON_CRITICAL_LANES, failuresOf, sendHealthAlert, type LaneReport } from '@/lib/observe/health-alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[health/alert] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });

  const dry = req.nextUrl.searchParams.get('dry') === '1';
  let lanes: LaneReport[];
  try {
    const res = await fetch(`${req.nextUrl.origin}/api/health/providers`, {
      headers: { authorization: req.headers.get('authorization') ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.error('[health/alert] the providers check answered', { status: res.status });
      return NextResponse.json({ error: `providers check answered ${res.status}` }, { status: 502 });
    }
    const body = await res.json();
    lanes = Array.isArray(body?.lanes) ? body.lanes : [];
  } catch (e) {
    console.error('[health/alert] could not run the providers check', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json({ error: 'providers check did not answer' }, { status: 502 });
  }
  if (!lanes.length) {
    // An empty report is not "all well"; it is a check that did not run.
    console.error('[health/alert] the providers check returned no lanes');
    return NextResponse.json({ error: 'providers check returned no lanes' }, { status: 502 });
  }

  const expected = process.env.STRIPE_EXPECTED_MODE === 'live' ? 'live' : 'test';
  const failures = failuresOf(lanes, expected);
  const now = new Date();
  const mail = failures.length && !dry ? await sendHealthAlert(failures, now) : null;
  if (failures.length) console.error('[health/alert] failing', { failures: failures.map(f => `${f.provider}:${f.status}`) });

  return NextResponse.json({
    checked: lanes.length,
    failing: failures.length,
    failures: failures.map(f => ({ provider: f.provider, status: f.status })),
    // Discovery and weather sources that are down: reported, never paged.
    warnings: lanes.filter(l => NON_CRITICAL_LANES.has(l.lane) && ['refused', 'unreachable'].includes(l.status))
      .map(l => ({ provider: l.provider, status: l.status })),
    emailed: mail?.sent ?? false,
    ...(mail && !mail.sent ? { email_problem: mail.reason } : {}),
    dry,
    at: now.toISOString(),
  });
}
