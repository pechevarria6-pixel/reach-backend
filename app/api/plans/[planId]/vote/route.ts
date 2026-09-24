import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { planReadiness, waitingSentence } from '@/lib/plan-readiness';
import { track } from '@/lib/track';
import { readIdeas, tallyVotes, mayPick, voteTitles, type SavedIdeas } from '@/lib/trip-vote';
import { readVetoes, membersOf, organiserOf, organisersOf, firstName, notMigrated, MIGRATION } from '@/lib/trip-ideas-store';
import { claimOnce } from '@/lib/everyone-in';
import { notifyUsers } from '@/lib/notify-user';
import { pushSender } from '@/lib/push';

// ─── /api/plans/[id]/vote — the group's vote on where to go ──────────────
// A group trip's three ideas are saved on the plan (plans.trip_options) and
// every member votes here. One vote per member per plan, changeable until
// the organiser picks. Vetoes — "I won't do this one" — are recorded here
// too, and the group is only ever told how many, never whose.
//
// requirePlanMember, not requireUser. This used to accept any signed-in
// caller: it loaded the plan's members and never compared them to whoever was
// asking, so anybody holding a plan's id could vote in another group's poll —
// and the poll decides where the group goes and what it spends.

type PlanRow = {
  id?: string; group_id?: string; status?: string; vote_options?: string[];
  trip_options?: unknown; created_by?: string | null; destination_style?: string | null;
  type?: string | null; title?: string | null; solo_mode?: boolean;
};

// POST { option } — cast or change a vote
// POST { veto, on } — veto an idea, or take the veto back
export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => ({})) as { option?: unknown; veto?: unknown; on?: unknown };
  const vetoing = typeof body.veto === 'string' && body.veto.length > 0;
  const option = vetoing ? String(body.veto) : (typeof body.option === 'string' ? body.option : '');
  if (!option) return NextResponse.json({ error: 'option is required' }, { status: 400 });

  const supabase = ctx.db;
  const user = ctx.user;

  // requirePlanMember has already established the plan exists and that this
  // caller belongs to its group.
  const plan = ctx.plan as PlanRow;
  // After the pick the plan goes back to planning, so a vote on a decided
  // trip is refused here — the vote is changeable until the pick, not after.
  if (plan.status !== 'voting') {
    return NextResponse.json({ error: 'The vote on this trip has closed.' }, { status: 400 });
  }

  // One of the ideas the group was shown: the saved ideas' titles when
  // there are saved ideas, never vote_options over the top of them.
  if (!voteTitles(plan).includes(option)) return NextResponse.json({ error: 'Invalid vote option' }, { status: 400 });

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
      plan.solo_mode === true,
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

  if (vetoing) return veto(ctx.db, params.planId, user.id, option, body.on !== false);

  // One vote per member per plan, and it can change until the pick. The
  // member's row is updated; a row is only inserted when there is none. Two
  // taps at once can both find none — the unique (plan_id, user_id) index
  // refuses the second insert, which then updates the row the first made.
  const now = new Date().toISOString();
  const change = () => supabase.from('votes').update({ option, voted_at: now })
    .eq('plan_id', params.planId).eq('user_id', user.id).select('id, option');
  let { data: changed, error: changeErr } = await change();
  if (!changeErr && !changed?.length) {
    const { error: cast } = await supabase.from('votes').insert({ plan_id: params.planId, user_id: user.id, option });
    if (cast?.code === '23505') ({ data: changed, error: changeErr } = await change());
    else if (cast) changeErr = cast;
  }
  if (changeErr) {
    console.error('[vote] could not record the vote', { plan: params.planId, code: changeErr.code });
    return NextResponse.json({ error: "We couldn't record that vote just now" }, { status: 500 });
  }

  // Voting for an idea takes back your own veto of it: nobody is both for
  // and against the same place.
  const { error: unvetoed } = await supabase.from('trip_vetoes').delete()
    .eq('plan_id', params.planId).eq('user_id', user.id).eq('option', option);
  if (unvetoed && !notMigrated(unvetoed)) {
    console.error('[vote] could not take back the veto on the idea just voted for', { plan: params.planId, code: unvetoed.code });
  }

  // No veto on the vote itself: whether somebody vetoed anything is not a
  // property of their vote, and an analytics row is read by more people
  // than the group.
  void track(supabase, 'vote_cast', { userId: user.id, planId: params.planId });

  // The last vote in tells the organiser, once per set of ideas.
  await tellOrganiserIfEveryoneVoted(supabase, plan, params.planId, user.id);

  return NextResponse.json({ vote: { option } }, { status: 201 });
}

async function veto(db: import('@supabase/supabase-js').SupabaseClient, planId: string, userId: string, option: string, on: boolean) {
  if (on) {
    // Against the place you voted for is a contradiction the screen would
    // then have to explain. Move the vote first.
    const { data: mine } = await db.from('votes').select('option').eq('plan_id', planId).eq('user_id', userId).maybeSingle();
    if (mine?.option === option) {
      return NextResponse.json({ error: "That's the one you voted for — move your vote first." }, { status: 409 });
    }
    const { error } = await db.from('trip_vetoes').insert({ plan_id: planId, user_id: userId, option });
    // Already vetoed (a double-tap): the veto stands, which is what was asked.
    if (error && error.code !== '23505') {
      if (notMigrated(error)) {
        console.error(`[vote] trip_vetoes is not there yet — run ${MIGRATION}`);
        return NextResponse.json({ error: "Vetoes aren't switched on yet — vote for the one you'd rather." }, { status: 503 });
      }
      console.error('[vote] could not record the veto', { planId, code: error.code });
      return NextResponse.json({ error: "We couldn't record that veto just now" }, { status: 500 });
    }
    return NextResponse.json({ veto: { option, on: true } }, { status: 201 });
  }
  const { error } = await db.from('trip_vetoes').delete().eq('plan_id', planId).eq('user_id', userId).eq('option', option);
  if (error) {
    if (notMigrated(error)) return NextResponse.json({ error: "Vetoes aren't switched on yet." }, { status: 503 });
    console.error('[vote] could not take back the veto', { planId, code: error.code });
    return NextResponse.json({ error: "We couldn't take that veto back just now" }, { status: 500 });
  }
  return NextResponse.json({ veto: { option, on: false } });
}

async function tellOrganiserIfEveryoneVoted(
  db: import('@supabase/supabase-js').SupabaseClient, plan: PlanRow, planId: string, voterId: string,
) {
  const ideas = readIdeas(plan.trip_options);
  const [members, { data: votes, error }] = await Promise.all([
    membersOf(db, String(plan.group_id)),
    db.from('votes').select('user_id, option').eq('plan_id', planId),
  ]);
  if (!members || error) return;
  const view = tallyVotes({
    titles: voteTitles(plan), votes: (votes ?? []) as Array<{ user_id: string; option: string }>,
    vetoes: [], memberIds: members.map(m => m.userId), me: voterId,
  });
  if (!view.everyoneVoted) return;
  const key = `${planId}:${ideas?.set ?? 'votes'}`;
  if (!(await claimOnce(db, planId, voterId, 'everyone_voted', key))) return;
  // Whoever cast the last vote is looking at the count already.
  const told = organisersOf(members, plan.created_by ?? null).filter(id => id !== voterId);
  if (!told.length) return;
  const lead = view.leader
    ? `Most votes: ${view.leader}. The pick is yours.`
    : view.tied.length ? `It's a tie between ${view.tied.join(' and ')} — your call.` : 'The pick is yours.';
  await notifyUsers(db, told, {
    kind: 'everyone_voted',
    title: 'Everyone has voted',
    body: lead,
    url: `/home?vote=${encodeURIComponent(planId)}&group=${encodeURIComponent(String(plan.group_id))}`,
    planId,
  }, pushSender());
}

// GET /api/plans/[id]/vote — where the vote stands, for the caller
//
// Also members only: a tally is how a group is leaning, and it was readable by
// anybody signed in who had the plan's id.
//
// Counts, never names against a choice: how many votes and vetoes each idea
// has, the caller's own vote and vetoes, and who is still to vote — a name
// and a yes or no, the same as readiness.
export async function GET(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const plan = ctx.plan as PlanRow;
  // `select('*')` has no trip_options key until the migration has run.
  const ideasAvailable = Object.prototype.hasOwnProperty.call(plan, 'trip_options');
  const ideas: SavedIdeas | null = readIdeas(plan.trip_options);

  const [members, { data: votes, error: vErr }, vetoRead] = await Promise.all([
    membersOf(supabase, String(plan.group_id)),
    supabase.from('votes').select('user_id, option').eq('plan_id', params.planId),
    readVetoes(supabase, params.planId),
  ]);
  if (!members || vErr) {
    console.error('[vote] could not read where the vote stands', { planId: params.planId, code: vErr?.code });
    return NextResponse.json({ error: "We couldn't read the vote just now — try again in a moment." }, { status: 503 });
  }

  const titles = voteTitles(plan);
  const view = tallyVotes({
    titles, votes: (votes ?? []) as Array<{ user_id: string; option: string }>,
    vetoes: vetoRead.rows, memberIds: members.map(m => m.userId), me: ctx.user.id,
  });
  const organiser = organiserOf(members, plan.created_by ?? null);
  const nameOf = new Map(members.map(m => [m.userId, firstName(m.name)]));

  return NextResponse.json({
    // Kept for older screens: counts by option and how many votes in all.
    tally: view.counts,
    total: view.voted,

    ideas: ideas ? { set: ideas.set, mode: ideas.mode, foundAt: ideas.foundAt, options: ideas.options } : null,
    ideasAvailable,
    vetoesAvailable: vetoRead.available,
    status: plan.status ?? null,
    decided: plan.destination_style !== 'undecided',
    // Where it is going, once picked — so a screen still open on the vote
    // says "<place> it is" rather than "you can change your vote".
    picked: plan.destination_style !== 'undecided' ? (plan.title ?? null) : null,
    counts: view.counts,
    vetoes: view.vetoes,
    myVote: view.myVote,
    myVetoes: view.myVetoes,
    voted: view.voted,
    members: view.total,
    everyoneVoted: view.everyoneVoted,
    stillToVote: view.notVoted.map(id => (id === ctx.user.id ? 'you' : nameOf.get(id) ?? 'Someone')),
    leader: view.leader,
    tied: view.tied,
    organiser: organiser ? { name: firstName(organiser.name), isYou: organiser.userId === ctx.user.id } : null,
    mayPick: mayPick({ role: ctx.role, createdBy: plan.created_by ?? null, userId: ctx.user.id, memberCount: members.length }),
  });
}
