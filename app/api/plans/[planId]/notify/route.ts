// ─── /api/plans/[planId]/notify ──────────────────────────────────────────
// Emails the people a plan is waiting on.
//
// Until now Reach told nobody anything. A plan could sit needing one vote or
// one person's share for a week, and the only way anyone found out was opening
// the app at the right moment or being chased by text. That is the widest gap
// between what is built and what a group can actually use.
//
// POST { kind: "vote" | "funding" | "prefs" } → emails members who have not yet acted
//
// "prefs" is a group trip waiting for everyone's answers before its options
// are built: it emails whoever has not answered for this trip yet.
import { NOT_CHARGED } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { appUrl } from '@/lib/app-url';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { sendVoteNeeded, sendFundingNeeded, sendAnswersNeeded, type SendResult } from '@/lib/email';
import { planShares } from '@/lib/money';
import { planSkips } from '@/lib/participation';
import { z } from 'zod';

const Schema = z.object({ kind: z.enum(['vote', 'funding', 'prefs']) });

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'kind must be "vote", "funding" or "prefs"' }, { status: 400 });
  }
  const { kind } = parsed.data;
  const db = ctx.db;

  const { data: plan } = await db
    .from('plans')
    .select('id, title, group_id, budget_cents, vote_options')
    .eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: group } = await db.from('groups').select('name').eq('id', plan.group_id).single();
  const memberIds = await groupMemberIds(db, plan.group_id);
  if (!memberIds.length) return NextResponse.json({ error: 'That group has no members' }, { status: 409 });

  // Who has already done the thing, so nobody is chased for something they did.
  let doneIds: string[] = [];
  if (kind === 'vote') {
    const { data } = await db.from('votes').select('user_id').eq('plan_id', params.planId);
    doneIds = (data || []).map(v => v.user_id);
  } else if (kind === 'prefs') {
    // Having answered for this trip is the thing. The read failing must not
    // turn into "nobody has answered" and email everyone who already has.
    const { data, error } = await db.from('plan_preferences')
      .select('user_id, submitted_at').eq('plan_id', params.planId);
    if (error) {
      console.error('[notify] could not read who has answered', { planId: params.planId, code: error.code });
      return NextResponse.json({ error: "Couldn't check who has answered — try again in a moment." }, { status: 503 });
    }
    doneIds = (data || []).filter(r => r.submitted_at).map(r => r.user_id);
  } else {
    const { data } = await db.from('contributions')
      .select('user_id, status').eq('plan_id', params.planId);
    doneIds = (data || []).filter(c => c.status === 'succeeded').map(c => c.user_id);
  }

  // Never email the person who pressed the button about their own outstanding
  // task — they are looking at it.
  const outstanding = memberIds.filter(id => !doneIds.includes(id) && id !== ctx.user.id);
  if (!outstanding.length) {
    return NextResponse.json({
      notified: 0,
      message: kind === 'prefs' ? 'Everyone else has already answered' : 'Everyone has already done this',
    });
  }

  const { data: people } = await db
    .from('users').select('id, email').in('id', outstanding);

  const base = appUrl(req);
  // Straight to the questions for this trip: /home opens them from ?answer=.
  const url = kind === 'prefs'
    ? `${base}/home?answer=${encodeURIComponent(params.planId)}`
    : `${base}/home`;
  // Each person's own share, the same figure checkout will charge them. This
  // used to quote the first person's even split of the budget to everybody,
  // which was wrong for anyone sitting something out and for any priced trip.
  let shares: Record<string, number> = {};
  if (kind === 'funding') {
    const { data: planBookings } = await db
      .from('bookings').select('id,price_cents,status').eq('plan_id', params.planId)
      .not('status', 'in', NOT_CHARGED);
    shares = planShares(planBookings || [], plan.budget_cents || 0, memberIds, await planSkips(db, params.planId));
  }

  let notified = 0;
  const failures: string[] = [];
  for (const person of people || []) {
    if (!person.email) continue;
    const result: SendResult = kind === 'vote'
      ? await sendVoteNeeded(person.email, {
          planTitle: plan.title, groupName: group?.name || 'Your group',
          options: (plan.vote_options as string[]) || [], url,
        })
      : kind === 'prefs'
      ? await sendAnswersNeeded(person.email, {
          // "is planning Where next?" reads as a typo. A trip with no
          // destination yet is just their next trip.
          planTitle: plan.title === 'Where next?' ? 'their next trip' : plan.title,
          groupName: group?.name || 'Your group', url,
        })
      : await sendFundingNeeded(person.email, {
          planTitle: plan.title, groupName: group?.name || 'Your group',
          shareCents: shares[person.id] ?? 0, url,
        });
    if (result.sent) {
      notified++;
    } else {
      failures.push(result.reason || 'error');
    }
  }

  if (!notified && failures.length) {
    // Every send failed for the same reason, and it is almost always the key.
    const reason = failures[0];
    console.error('[notify] nothing sent', { planId: params.planId, kind, reason, attempted: failures.length });
    return NextResponse.json({
      notified: 0,
      error: reason === 'no_key'
        ? 'Email is not switched on for this deployment yet.'
        : 'Could not send those reminders — please try again.',
    }, { status: 503 });
  }

  return NextResponse.json({ notified, attempted: (people || []).length, failed: failures.length });
}
