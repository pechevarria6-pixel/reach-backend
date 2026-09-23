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
import { notifyUsers } from '@/lib/notify-user';
import { pushSender } from '@/lib/push';
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { appUrl } from '@/lib/app-url';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { sendVoteNeeded, sendFundingNeeded, sendAnswersNeeded, type SendResult } from '@/lib/email';
import { planShares } from '@/lib/money';
import { planSkips } from '@/lib/participation';
import { claimNudge, releaseNudge, limitsNudge } from '@/lib/nudge';
import { z } from 'zod';
import { readIdeas, shownTitle } from '@/lib/trip-vote';
import { notMigrated, MIGRATION } from '@/lib/trip-ideas-store';

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
    .select('id, title, group_id, budget_cents, vote_options, type, status')
    .eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Nobody is nudged about a trip that was called off or is over.
  if (plan && (plan.status === 'cancelled' || plan.status === 'completed')) {
    return NextResponse.json({ notified: 0, message: plan.status === 'cancelled' ? 'This trip was called off.' : 'This trip is over.' }, { status: 409 });
  }
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

  // Once a minute per trip, whoever presses it: every press is an email in
  // somebody's inbox. Claimed here, after we know there is somebody to email,
  // so a press that would send nothing does not use up the minute.
  //
  // A vote nudge too. It used to be unguarded, and since it learned to reach
  // phones every press of "Nudge whoever hasn't voted" was a push on every
  // phone still to vote, as often as anybody cared to press it.
  let claimId: string | null = null;
  if (limitsNudge(kind)) {
    const claim = await claimNudge(db, params.planId, ctx.user.id);
    if (!claim.allowed) {
      console.log('[notify] nudged less than a minute ago', { planId: params.planId, retryAfter: claim.retryAfterSeconds });
      return NextResponse.json({
        error: 'They were just nudged — you can nudge them again in a minute.',
        retryAfterSeconds: claim.retryAfterSeconds,
      }, { status: 429, headers: { 'Retry-After': String(claim.retryAfterSeconds) } });
    }
    claimId = claim.claimId ?? null;
  }

  const { data: people } = await db
    .from('users').select('id, email').in('id', outstanding);

  // What the ideas are called where the group votes on them. A group trip's
  // ideas are saved on the plan, and an evening's are named after the venues
  // its days go to once they are written (shownTitle) — vote_options holds
  // the first step's working titles, which the generator itself calls "not a
  // fact", and a push is no place to put a venue nobody vouches for. Read on
  // its own because the column arrives in a migration: before it, there are
  // no saved ideas and vote_options is the vote.
  let voteNames: string[] = ((plan.vote_options as string[]) || []).filter(t => typeof t === 'string');
  if (kind === 'vote') {
    const { data: saved, error: savedErr } = await db.from('plans').select('trip_options').eq('id', params.planId).maybeSingle();
    if (savedErr && !notMigrated(savedErr)) {
      console.error('[notify] could not read the saved ideas — naming none', { planId: params.planId, code: savedErr.code });
      voteNames = [];
    } else if (savedErr) {
      console.error(`[notify] plans.trip_options is not there yet — run ${MIGRATION}`);
    } else {
      const ideas = readIdeas((saved as { trip_options?: unknown } | null)?.trip_options);
      if (ideas) voteNames = ideas.options.map(o => shownTitle(ideas.options, o.title));
    }
  }

  const base = appUrl(req);
  // Straight to the questions for this trip: /home opens them from ?answer=.
  // A vote opens on the trip's Vote tab: /home opens it from ?vote=.
  const voteUrl = `/home?vote=${encodeURIComponent(params.planId)}&group=${encodeURIComponent(String(plan.group_id))}`;
  const url = kind === 'prefs'
    ? `${base}/home?answer=${encodeURIComponent(params.planId)}`
    : kind === 'vote' ? `${base}${voteUrl}` : `${base}/home`;
  // Each person's own share, the same figure checkout will charge them. This
  // used to quote the first person's even split of the budget to everybody,
  // which was wrong for anyone sitting something out and for any priced trip.
  let shares: Record<string, number> = {};
  if (kind === 'funding') {
    const { data: planBookings } = await db
      .from('bookings').select('id,price_cents,status,mode,provider').eq('plan_id', params.planId)
      .not('status', 'in', NOT_CHARGED);
    shares = planShares(chargedRows(planBookings), plan.budget_cents || 0, memberIds, await planSkips(db, params.planId));
  }

  // A trip waiting on answers nudges in the app: everybody's bell, and their
  // phone if they have let Reach notify it. Email is the fallback only for
  // people no phone notification reached — the owner's rule.
  let inApp = 0, pushed = 0;
  let emailTo = people || [];
  if (kind === 'prefs') {
    const organiser = (await db.from('users').select('name').eq('id', ctx.user.id).maybeSingle()).data?.name;
    const first = String(organiser || '').trim().split(/\s+/)[0] || 'Your group';
    const what = plan.title === 'Where next?'
      ? (plan.type === 'restaurant' ? 'your next night out' : 'your next trip')
      : plan.title;
    const delivery = await notifyUsers(db, outstanding, {
      kind: 'prefs',
      title: `${first} is waiting on you`,
      body: `Say what you want from ${what} — the ideas are built once everyone has answered.`,
      url: `/home?answer=${encodeURIComponent(params.planId)}`,
      planId: params.planId,
    }, pushSender());
    inApp = delivery.inApp;
    pushed = delivery.pushed.length;
    emailTo = (people || []).filter(p => delivery.unreached.includes(p.id));
  } else if (kind === 'vote') {
    // The same for a vote: in the app first, email only for whoever no
    // phone notification reached. Never says who has voted for what.
    const what = plan.title === 'Where next?'
      ? (plan.type === 'restaurant' ? 'your next night out' : 'your next trip')
      : plan.title;
    const options = voteNames.slice(0, 3);
    const delivery = await notifyUsers(db, outstanding, {
      kind: 'vote',
      title: 'Your vote is still to come',
      body: `${options.length ? `${options.join(' · ')} — ` : ''}vote on ${what}.`,
      url: voteUrl,
      planId: params.planId,
    }, pushSender());
    inApp = delivery.inApp;
    pushed = delivery.pushed.length;
    emailTo = (people || []).filter(p => delivery.unreached.includes(p.id));
  }

  let notified = 0;
  const failures: string[] = [];
  for (const person of emailTo) {
    if (!person.email) continue;
    const result: SendResult = kind === 'vote'
      ? await sendVoteNeeded(person.email, {
          planTitle: plan.title, groupName: group?.name || 'Your group',
          options: voteNames, url,
        })
      : kind === 'prefs'
      ? await sendAnswersNeeded(person.email, {
          // "is planning Where next?" reads as a typo. A trip with no
          // destination yet is just their next trip.
          planTitle: plan.title === 'Where next?'
            ? (plan.type === 'restaurant' ? 'their next night out' : 'their next trip')
            : plan.title,
          groupName: group?.name || 'Your group', url,
          night: plan.type === 'restaurant',
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

  // Nothing went, so nothing was nudged: the next press may try again now.
  if (!notified && !pushed && !inApp) await releaseNudge(db, claimId);

  if (!notified && !pushed && !inApp && failures.length) {
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

  return NextResponse.json({
    // People reached by anything at all, and how: bell, phone, email.
    notified: kind === 'prefs' || (kind === 'vote' && inApp) ? outstanding.length : notified,
    inApp, pushed, emailed: notified,
    attempted: (people || []).length, failed: failures.length,
  });
}
