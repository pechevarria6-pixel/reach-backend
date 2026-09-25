// ─── GET /api/plans/[planId]/readiness — who can be put on a flight ──────
// A group needs to know whether everyone is ready to be ticketed. It does not
// need to know anyone's date of birth to know that, and one person's document
// details are not group business — so this returns status and nothing else:
// a name the group can already see, a yes or no, and the names of the fields
// still outstanding. On a trip with a flight it adds the airport each person
// leaves from — a three-letter code the group plans the flights around, one
// booking per airport — and never the home city it was worked out from.
//
// The values themselves go to one place only: /api/profile, to their owner.
import { NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { groupReadiness, tripTravellerIds, travellerOrigins } from '@/lib/essentials-server';
import { byDepartureAirport, travelDetails } from '@/lib/airports';
import { planReadiness, waitingSentence, answersSentence } from '@/lib/plan-readiness';
import { voteTitles } from '@/lib/trip-vote';

export async function GET(_req: Request, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  // Who can be ticketed for this trip: a solo plan's own traveller, not
  // everybody who happens to be in the group it sits in.
  const readiness = await groupReadiness(ctx.db, ctx.plan.group_id as string, tripTravellerIds(ctx.plan));

  // Two different questions about the same group, answered together because
  // a screen asking one usually wants the other: who can be ticketed, and
  // who has had their say about where to go. Both are status only.
  let preferences = null;
  try {
    const p = await planReadiness(
      ctx.db, params.planId, String(ctx.plan.group_id),
      (ctx.plan as { solo_mode?: boolean }).solo_mode === true,
    );
    // A vote is only promised where there is something to vote on. A trip
    // with no options yet is waiting for the answers its options are built
    // from, and says that instead.
    const hasOptions = voteTitles(ctx.plan as { trip_options?: unknown; vote_options?: unknown }).length > 0;
    preferences = {
      ...p,
      waiting: hasOptions ? waitingSentence(p.waitingOn) : answersSentence(p.waitingOn),
    };
  } catch {
    // Reported as absent rather than as "everyone is ready", which would
    // enable a vote the server is about to refuse.
    preferences = null;
  }

  // Where each traveller flies from, and whether this trip has a flight to
  // put them on. Only asked when it does: a night out needs nobody's airport,
  // and "needs details" over a dinner would be asking for something the plan
  // will never use. Each person gets their own origin — never the
  // organiser's — and a worked-out one says so (lib/airports.ts originOf).
  const { data: flightLines, error: flightErr } = await ctx.db.from('itinerary_items')
    .select('id').eq('plan_id', params.planId).eq('type', 'flight').limit(1);
  if (flightErr) console.error('[readiness] could not tell whether this trip has a flight', { planId: params.planId, code: flightErr.code });
  const flies = !!flightLines?.length;
  const origins = flies ? await travellerOrigins(ctx.db, ctx.plan) : null;
  const originOfUser = new Map((origins ?? []).map(o => [o.userId, o]));
  const split = origins ? byDepartureAirport(origins) : null;

  const travelers = readiness.travelers.map(t =>
    travelDetails(t, { flies, originsRead: !!origins, origin: originOfUser.get(t.userId) ?? null }));

  return NextResponse.json({
    ...readiness,
    travelers,
    preferences,
    flights: flies ? {
      // One flight booking per departure airport (owner, 2026-09-25).
      airports: split?.groups.map(g => ({ airport: g.airport, userIds: g.userIds })) ?? null,
      unplaced: split?.unknown.map(o => o.userId) ?? null,
    } : null,
    // Whether the person asking still owes us anything, so the screen can put
    // the prompt in front of them rather than in front of the group.
    you: travelers.find(t => t.userId === ctx.user.id) ?? null,
  });
}
