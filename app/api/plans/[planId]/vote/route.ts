import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { planReadiness, waitingSentence } from '@/lib/plan-readiness';

// POST /api/plans/[id]/vote — cast a vote
//
// requirePlanMember, not requireUser. This used to accept any signed-in
// caller: it loaded the plan's members and never compared them to whoever was
// asking, so anybody holding a plan's id could vote in another group's poll —
// and the poll decides where the group goes and what it spends.
export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const { option } = await req.json().catch(() => ({}));
  if (!option) return NextResponse.json({ error: 'option is required' }, { status: 400 });

  const supabase = ctx.db;
  const user = ctx.user;

  // requirePlanMember has already established the plan exists and that this
  // caller belongs to its group.
  const plan = ctx.plan as { status?: string; vote_options?: string[] };
  if (plan.status !== 'voting') return NextResponse.json({ error: 'Plan is not in voting status' }, { status: 400 });

  // Verify option is valid
  if (!(plan.vote_options || []).includes(option)) return NextResponse.json({ error: 'Invalid vote option' }, { status: 400 });

  // Nobody votes until everybody has had their say. A vote cast before the
  // quiet half of a group answers decides the trip on their behalf, and the
  // first thing they see is a decision they were never asked about.
  //
  // After the membership check above, deliberately: who you are comes before
  // what state the trip is in. The client disables the controls, but the
  // client is a courtesy — this is the rule.
  try {
    const readiness = await planReadiness(
      ctx.db, params.planId, String(ctx.plan.group_id),
      (ctx.plan as { solo_mode?: boolean }).solo_mode === true,
    );
    if (!readiness.allReady) {
      return NextResponse.json({
        error: waitingSentence(readiness.waitingOn) ?? "Votes open when everyone's in",
        // First names, so the organizer knows who to nudge. Never answers.
        waitingOn: readiness.waitingOn,
      }, { status: 403 });
    }
  } catch (e) {
    // planReadiness throws only when it could not read the group. Opening the
    // vote on a failed check would be deciding the trip on a guess.
    console.error('[vote] readiness check failed', { planId: params.planId, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: 'We could not check who is ready just now — try again in a moment.' },
      { status: 503 },
    );
  }

  // Check user hasn't already voted (enforced by DB unique constraint too)
  const { data: existingVote } = await supabase
    .from('votes').select('id').eq('plan_id', params.planId).eq('user_id', user.id).single();
  if (existingVote) return NextResponse.json({ error: 'You have already voted' }, { status: 409 });

  const { data: vote } = await supabase
    .from('votes').insert({ plan_id: params.planId, user_id: user.id, option }).select().single();

  return NextResponse.json({ vote }, { status: 201 });
}

// GET /api/plans/[id]/vote — get current vote tallies
//
// Also members only: a tally is how a group is leaning, and it was readable by
// anybody signed in who had the plan's id.
export async function GET(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const { data: votes } = await supabase.from('votes').select('option').eq('plan_id', params.planId);

  const tally: Record<string, number> = {};
  votes?.forEach(v => { tally[v.option] = (tally[v.option] || 0) + 1; });

  return NextResponse.json({ tally, total: votes?.length || 0 });
}
