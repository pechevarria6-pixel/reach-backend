// ─── /api/cron/watches — check every watch that is due ──────────────────
// Run by GitHub Actions every fifteen minutes (.github/workflows/watches.yml),
// not vercel.json: this account is on Hobby, where a cron runs once a day and
// a sub-daily schedule silently rejects the deployment. What a check does and
// how politely it asks is in lib/watch/run.ts and lib/watch/tables.ts.
//
// Guarded by CRON_SECRET. With no secret configured it refuses rather than
// running open: anybody who found the URL could otherwise make it hold tables.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/watches?dry=1
//
// Each run leaves a watch_runs row (counts only), which is how the screens
// know the schedule is really on before they say "Reach checks". The answer
// is counts only — the workflow's log is public.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { pushSender } from '@/lib/push';
import { runWatches } from '@/lib/watch/run';
import { supabaseWatchStore } from '@/lib/watch/store';
import { tableWatcher } from '@/lib/watch/tables';
import { tableWatchDeps } from '@/lib/watch/table-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/watches] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Provider requests one run may make in all. No platform publishes a figure; this is ours. */
function budget(): number {
  const n = Number(process.env.WATCH_CALLS_PER_RUN);
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : 60;
}

async function run(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const db = createServerClient();
  try {
    const report = await runWatches(supabaseWatchStore(db, pushSender()), [tableWatcher(tableWatchDeps(db))], { budget: budget(), dry });
    if (report.stopped) {
      console.error('[cron/watches] stopped before checking', { stopped: report.stopped });
      return NextResponse.json({ error: `Watches stopped: ${report.stopped}`, report }, { status: 503 });
    }
    if (!dry) {
      const { error } = await db.from('watch_runs').insert({ report });
      if (error) console.error('[cron/watches] could not note the run', { code: error.code });
    }
    return NextResponse.json({ dry, report });
  } catch (e) {
    console.error('[cron/watches] run failed', { error: (e as Error).message });
    return NextResponse.json({ error: 'Watches run failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
