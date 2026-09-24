// ─── GET /api/recommendations/trips ──────────────────────────────────────
// Query: ?lat=&lng=&city= (optional — this device's position; the home
// city stands in without it)
//
// A few trips worth taking, for Home: a night out near them, a weekend's
// drive, a flight away. Each one is a town we hold checked venues for,
// ranked by arithmetic over those venues and the quiz answers of this
// person and the people they plan with. No model is called: the same rows
// give the same cards, and every line on a card is a count we hold, a thing
// they told us, or an estimate labelled as one. See
// lib/recommendations/trip-picks.ts for the rules.
//
// Dismissing one goes through /api/recommendations/feedback with
// itemRef "trip:<town>|<country>" and verdict "not_interested"; this route
// reads those back and leaves the town out.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { whereFrom } from '@/lib/discovery/where';
import { snapshot } from '@/lib/recommendations/holdings';
import { personFor } from '@/lib/recommendations/person';
import { pickTrips } from '@/lib/recommendations/trip-picks';
import { TripPicksResponse } from '@/lib/contracts/trip-pick';

export const dynamic = 'force-dynamic';
// A cold instance counts every town once (a few seconds); after that it is
// the cached snapshot and a handful of reads about the person.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const params = req.nextUrl.searchParams;
  const at = whereFrom(params);
  const city = String(params.get('city') ?? '').trim().slice(0, 120) || null;

  try {
    const snap = await snapshot(ctx.db);
    const { person, from } = await personFor(ctx.db, ctx.user.id, { at, city, candidates: snap.candidates });
    const { picks, reason } = pickTrips(snap.candidates, snap.holdings, person);

    // Checked against the same contract the card reads with. A card that
    // fails it is a bug here, not something to send half-formed.
    const body = TripPicksResponse.safeParse({ picks, reason, from });
    if (!body.success) {
      console.error('[trip-picks] the answer broke its contract', body.error.issues.map(i => i.path.join('.')));
      return NextResponse.json({ error: 'Could not put suggestions together just now.' }, { status: 500 });
    }
    return NextResponse.json(body.data, {
      // Per person, and a dismissal must take effect on the next load.
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e: any) {
    console.error('[trip-picks] failed', { message: e?.message });
    return NextResponse.json({ error: 'Could not put suggestions together just now.' }, { status: 500 });
  }
}
