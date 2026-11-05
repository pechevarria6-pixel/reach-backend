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
import { candidates, holdingsFor } from '@/lib/recommendations/holdings';
import { personFor } from '@/lib/recommendations/person';
import { pickTrips } from '@/lib/recommendations/trip-picks';
import { dressPicks } from '@/lib/recommendations/dress';
import { forecastPicks } from '@/lib/recommendations/pick-weather';
import { TripPicksResponse } from '@/lib/contracts/trip-pick';

export const dynamic = 'force-dynamic';
// The limit is a backstop, not the plan: the answer is written to finish in
// about ANSWER_MS. A fresh instance counts the towns nearest the person for
// HOLDINGS_MS and keeps them (lib/recommendations/holdings.ts); a town not
// counted in time is a card fewer, never a slow Home. Counting every town
// first took 30–76s and made this a 504 on every call (2026-11-05).
export const maxDuration = 30;
const ANSWER_MS = 4000;
const HOLDINGS_MS = 2000;
const HOLDINGS_MIN_MS = 500;
/** The least a photo, best-months or forecast read is given. */
const DRESS_MIN_MS = 1000;

export async function GET(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const params = req.nextUrl.searchParams;
  const at = whereFrom(params);
  // A placeholder an older client sends in place of a town is not one.
  const rawCity = String(params.get('city') ?? '').trim().slice(0, 120);
  const city = rawCity && !/^your (location|city)$/i.test(rawCity) ? rawCity : null;
  const airport = String(params.get('airport') ?? '').trim().slice(0, 3) || null;

  const started = Date.now();
  try {
    // The towns and the person are read at once; personFor waits for the
    // towns only where it needs them.
    const loading = candidates(ctx.db);
    loading.catch(() => {}); // awaited below; never an unhandled rejection if personFor throws first
    const { person, from } = await personFor(ctx.db, ctx.user.id, { at, city, airport, candidates: loading });
    const list = await loading;
    // Nowhere to measure from: nothing to count (pickTrips says no_location).
    // Never less than HOLDINGS_MIN_MS, so a slow start still counts a few
    // towns for the next load rather than none, ever.
    const budgetMs = Math.max(HOLDINGS_MIN_MS, Math.min(HOLDINGS_MS, ANSWER_MS - DRESS_MIN_MS - (Date.now() - started)));
    const { holdings, unread } = person.home
      ? await holdingsFor(ctx.db, list, person.home, { budgetMs })
      : { holdings: new Map(), unread: 0 };
    const { picks: bare, reason } = pickTrips(list, holdings, person);
    // Nothing to show while towns are still uncounted is not "nothing
    // held" — that would phrase our own slowness as a fact about where they
    // live. Say it is not ready, and the next load has the counts kept.
    if (!bare.length && unread > 0 && reason !== 'no_location') {
      console.warn('[trip-picks] no card ready yet', { unread, ms: Date.now() - started });
      return NextResponse.json(
        { error: 'Still checking the towns near you. Try again in a moment.' },
        { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'private, no-store' } },
      );
    }
    // The picture of each place and when its weather is usually best. Both are
    // kept answers after the first time, and each has a short deadline, so a
    // slow Wikipedia costs a card its photo, never Home its cards.
    // And, for tonight's night out and this weekend's drive, the forecast —
    // only where the pick is out of doors, and only from the forecast cache.
    const deadlineMs = Math.max(DRESS_MIN_MS, ANSWER_MS - (Date.now() - started));
    const [dressed, forecasts] = await Promise.all([
      dressPicks(ctx.db, bare, { deadlineMs }),
      forecastPicks(ctx.db, bare, { deadlineMs }),
    ]);
    const picks = dressed.map((p, i) => ({ ...p, forecast: forecasts[i].forecast }));

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
