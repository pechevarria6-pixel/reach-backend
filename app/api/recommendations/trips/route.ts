// ─── GET /api/recommendations/trips ──────────────────────────────────────
// Query: ?lat=&lng=&city=&airport= (optional — this device's position and
// the airport of that place; the home city and home airport stand in
// without them)
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
// itemRef "trip:<candidate key>" and verdict "not_interested"; this route
// reads those back and leaves the town out.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { whereFrom } from '@/lib/discovery/where';
import { snapshot } from '@/lib/recommendations/holdings';
import { personFor } from '@/lib/recommendations/person';
import { pickTrips } from '@/lib/recommendations/trip-picks';
import { dressPicks } from '@/lib/recommendations/dress';
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
  const airport = String(params.get('airport') ?? '').trim().slice(0, 3) || null;

  try {
    const snap = await snapshot(ctx.db);
    const { person, from } = await personFor(ctx.db, ctx.user.id, { at, city, airport, candidates: snap.candidates });
    const { picks: bare, reason } = pickTrips(snap.candidates, snap.holdings, person);
    // The picture of each place and when its weather is usually best. Both are
    // kept answers after the first time, and each has a short deadline, so a
    // slow Wikipedia costs a card its photo, never Home its cards.
    const picks = await dressPicks(ctx.db, bare);

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
