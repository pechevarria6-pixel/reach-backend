// ─── GET /api/plans/[planId]/readiness — who can be put on a flight ──────
// A group needs to know whether everyone is ready to be ticketed. It does not
// need to know anyone's date of birth to know that, and one person's document
// details are not group business — so this returns status and nothing else:
// a name the group can already see, a yes or no, and the names of the fields
// still outstanding.
//
// The values themselves go to one place only: /api/profile, to their owner.
import { NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { groupReadiness } from '@/lib/essentials-server';
import { planReadiness, waitingSentence, answersSentence } from '@/lib/plan-readiness';

export async function GET(_req: Request, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const readiness = await groupReadiness(ctx.db, ctx.plan.group_id as string);

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
    const options = (ctx.plan as { vote_options?: unknown }).vote_options;
    const hasOptions = Array.isArray(options) && options.length > 0;
    preferences = {
      ...p,
      waiting: hasOptions ? waitingSentence(p.waitingOn) : answersSentence(p.waitingOn),
    };
  } catch {
    // Reported as absent rather than as "everyone is ready", which would
    // enable a vote the server is about to refuse.
    preferences = null;
  }

  return NextResponse.json({
    ...readiness,
    preferences,
    // Whether the person asking still owes us anything, so the screen can put
    // the prompt in front of them rather than in front of the group.
    you: readiness.travelers.find(t => t.userId === ctx.user.id) ?? null,
  });
}
