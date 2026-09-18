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

export async function GET(_req: Request, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const readiness = await groupReadiness(ctx.db, ctx.plan.group_id as string);

  return NextResponse.json({
    ...readiness,
    // Whether the person asking still owes us anything, so the screen can put
    // the prompt in front of them rather than in front of the group.
    you: readiness.travelers.find(t => t.userId === ctx.user.id) ?? null,
  });
}
