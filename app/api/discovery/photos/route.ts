// ─── /api/discovery/photos — a picture of each place, from its own entry ──
// Runs on a schedule (see vercel.json), after the sweep and the harvest.
// Looks up the photograph a venue's own OpenStreetMap entry names — its
// wikidata item's image, or the Commons file it points at — and keeps the
// thumbnail with its author and licence on the row. Discover reads the row;
// no screen ever waits on Wikimedia. See lib/discovery/photo-job.ts.
//
// Protected by CRON_SECRET, like the sweep and the harvest.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { resolvePhotos, PHOTO_PER_RUN } from '@/lib/discovery/photo-job';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[discovery/photos] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });

  // A manual run can ask for fewer; never more than a night's share.
  const asked = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, PHOTO_PER_RUN) : PHOTO_PER_RUN;

  try {
    const run = await resolvePhotos(createServerClient(), { limit });
    // The log carries the whole tally, including requests that did not
    // answer — a quiet night and a night Wikimedia refused look the same in
    // a count of photos stored.
    console.log('[discovery/photos]', JSON.stringify(run));
    if (run.pending) {
      console.error('[discovery/photos] waiting on a migration', { run: run.pending });
      return NextResponse.json({ ...run, error: `Run ${run.pending} first` }, { status: 503 });
    }
    return NextResponse.json(run);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'failed';
    console.error('[discovery/photos] could not run', detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
