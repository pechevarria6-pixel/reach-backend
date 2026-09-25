// ─── /api/plans/[planId]/notify ──────────────────────────────────────────
// Nudges the people a plan is waiting on.
//
// Until now Reach told nobody anything. A plan could sit needing one vote or
// one person's share for a week, and the only way anyone found out was opening
// the app at the right moment or being chased by text. That is the widest gap
// between what is built and what a group can actually use.
//
// POST { kind: "vote" | "funding" | "prefs" }            → everyone still to do it
// POST { kind: "vote" | "funding" | "prefs", userId }    → just that one person
// GET  ?kind=vote|funding|prefs                          → the faces: who is done,
//                                                           and who can be nudged now
//
// "prefs" is a group trip waiting for everyone's answers before its options
// are built: it nudges whoever has not answered for this trip yet.
//
// Two limits (lib/nudge.ts). Each person on a plan hears at most one nudge in
// twelve hours, whoever sends it and whichever thing it is about. And a
// whole-group press still goes once a minute per plan. A tap on one face is
// held only by that person's twelve hours: tapping Sam and then Jo is two
// different people, and making the second wait a minute would read as broken.
import { notifyUsers, type Delivery } from '@/lib/notify-user';
import { pushSender } from '@/lib/push';
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appUrl } from '@/lib/app-url';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { sendVoteNeeded, sendFundingNeeded, sendAnswersNeeded, type SendResult } from '@/lib/email';
import { planSkips } from '@/lib/participation';
import { claimNudge, releaseNudge, limitsNudge, claimPeople, releasePeople, nudgedUntil, fundingStanding } from '@/lib/nudge';
import { z } from 'zod';
import { readIdeas, shownTitle } from '@/lib/trip-vote';
import { notMigrated, MIGRATION } from '@/lib/trip-ideas-store';

const Kind = z.enum(['vote', 'funding', 'prefs']);
type Kind = z.infer<typeof Kind>;
const Schema = z.object({ kind: Kind, userId: z.string().min(1).max(64).nullish() });

type PlanRow = { id: string; title: string; group_id: string; budget_cents: number | null; vote_options: unknown; type: string | null; status: string | null };

const firstOf = (name: unknown) => String(name || '').trim().split(/\s+/)[0] || 'Someone';

/** What somebody has done once they are done, for "Sam has already voted". */
const DONE: Record<Kind, string> = { vote: 'voted', prefs: 'answered', funding: 'paid' };
/** What everybody still has to do, for "Everyone still to vote…". */
const TODO: Record<Kind, string> = { vote: 'vote', prefs: 'answer', funding: 'pay' };

interface Standing {
  /** Members who have done the thing. */
  done: Set<string>;
  /** Members with nothing to do — sitting all of it out, so nothing to pay. */
  notNeeded: Set<string>;
  /** Each member's share, for the funding email. Never sent to the faces. */
  shares: Record<string, number>;
}

/**
 * Who has already done the thing, so nobody is chased for something they did.
 * A read that fails is an error, not "nobody has": treating it as nobody
 * would nudge everybody who already has.
 */
async function standing(db: SupabaseClient, planId: string, kind: Kind, plan: PlanRow, memberIds: string[]): Promise<Standing | null> {
  const out: Standing = { done: new Set(), notNeeded: new Set(), shares: {} };
  if (kind === 'vote') {
    const { data, error } = await db.from('votes').select('user_id').eq('plan_id', planId);
    if (error) { console.error('[notify] could not read who has voted', { planId, code: error.code }); return null; }
    for (const v of data || []) out.done.add(String(v.user_id));
  } else if (kind === 'prefs') {
    // Having answered for this trip is the thing.
    const { data, error } = await db.from('plan_preferences').select('user_id, submitted_at').eq('plan_id', planId);
    if (error) { console.error('[notify] could not read who has answered', { planId, code: error.code }); return null; }
    for (const r of data || []) if (r.submitted_at) out.done.add(String(r.user_id));
  } else {
    // select('*'), never naming refunded_cents, as checkout reads it: before
    // that migration runs the column is not there and naming it fails the read.
    const [{ data, error }, { data: planBookings, error: bErr }, skips] = await Promise.all([
      db.from('contributions').select('*').eq('plan_id', planId),
      db.from('bookings').select('id,price_cents,status,mode,provider').eq('plan_id', planId).not('status', 'in', NOT_CHARGED),
      planSkips(db, planId),
    ]);
    if (error || bErr) { console.error('[notify] could not read who has paid', { planId, code: (error || bErr)?.code }); return null; }
    // Paid means owing nothing more, by checkout's own sums (lib/nudge.ts):
    // a top-up still owed is pending, not a tick. Somebody sitting all of it
    // out owes nothing and is not chased — this used to email them
    // "your share: $0.00".
    const f = fundingStanding(chargedRows(planBookings), plan.budget_cents, data, memberIds, skips);
    out.done = f.done; out.notNeeded = f.notNeeded; out.shares = f.shares;
  }
  return out;
}

async function loadPlan(db: SupabaseClient, planId: string): Promise<PlanRow | null> {
  const { data } = await db
    .from('plans')
    .select('id, title, group_id, budget_cents, vote_options, type, status')
    .eq('id', planId).single();
  return (data as PlanRow | null) ?? null;
}

const hours = (seconds: number) => {
  const h = Math.max(1, Math.ceil(seconds / 3600));
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
};

// GET ?kind= — the faces where the group is waiting. A name, a picture, done
// or not, and when a grey face can next be nudged. Never an amount and never
// what anybody voted for: done or pending is all the group is shown.
export async function GET(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const kind = Kind.safeParse(req.nextUrl.searchParams.get('kind'));
  if (!kind.success) return NextResponse.json({ error: 'kind must be "vote", "funding" or "prefs"' }, { status: 400 });

  const db = ctx.db;
  const plan = await loadPlan(db, params.planId);
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  const memberIds = await groupMemberIds(db, plan.group_id);
  const [who, { data: users, error: uErr }] = await Promise.all([
    standing(db, params.planId, kind.data, plan, memberIds),
    db.from('users').select('id, name, avatar_url').in('id', memberIds),
  ]);
  if (!who || uErr) {
    if (uErr) console.error('[notify] could not read the group for its faces', { planId: params.planId, code: uErr.code });
    return NextResponse.json({ error: "We couldn't check who is done just now — try again in a moment." }, { status: 503 });
  }
  const pending = memberIds.filter(id => !who.done.has(id) && !who.notNeeded.has(id));
  const until = await nudgedUntil(db, params.planId, pending.filter(id => id !== ctx.user.id));
  const byId = new Map((users || []).map(u => [String(u.id), u as { name?: string | null; avatar_url?: string | null }]));
  const closed = plan.status === 'cancelled' || plan.status === 'completed';

  return NextResponse.json({
    kind: kind.data,
    people: memberIds.map(id => {
      const isYou = id === ctx.user.id;
      const done = who.done.has(id);
      const needed = !who.notNeeded.has(id);
      return {
        userId: id,
        name: isYou ? 'You' : firstOf(byId.get(id)?.name),
        avatarUrl: byId.get(id)?.avatar_url ?? null,
        isYou,
        done,
        // False for somebody with nothing to do here (nothing to pay).
        needed,
        // When this face can next be nudged; null when it can be now. Only
        // for somebody else who is still to do it.
        nudgedUntil: !isYou && !done && needed ? (until[id] ?? null) : null,
        canNudge: !closed && !isYou && !done && needed && !until[id],
      };
    }),
    everyoneDone: pending.length === 0,
  });
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'kind must be "vote", "funding" or "prefs"' }, { status: 400 });
  }
  const kind = parsed.data.kind;
  const target = parsed.data.userId || undefined;
  const db = ctx.db;

  const plan = await loadPlan(db, params.planId);
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Nobody is nudged about a trip that was called off or is over.
  if (plan.status === 'cancelled' || plan.status === 'completed') {
    return NextResponse.json({ notified: 0, message: plan.status === 'cancelled' ? 'This trip was called off.' : 'This trip is over.' }, { status: 409 });
  }
  const { data: group } = await db.from('groups').select('name').eq('id', plan.group_id).single();
  const memberIds = await groupMemberIds(db, plan.group_id);
  if (!memberIds.length) return NextResponse.json({ error: 'That group has no members' }, { status: 409 });

  if (target === ctx.user.id) {
    return NextResponse.json({ error: "That's you — nobody needs nudging for your part." }, { status: 400 });
  }
  if (target && !memberIds.includes(target)) {
    return NextResponse.json({ error: "They aren't in this group." }, { status: 404 });
  }

  const who = await standing(db, params.planId, kind, plan, memberIds);
  if (!who) {
    console.error('[notify] not nudging: could not tell who is done', { planId: params.planId, kind });
    return NextResponse.json({ error: "Couldn't check who is done — try again in a moment." }, { status: 503 });
  }

  // Never nudge the person who pressed the button about their own
  // outstanding task — they are looking at it.
  const outstanding = memberIds.filter(id => !who.done.has(id) && !who.notNeeded.has(id) && id !== ctx.user.id);

  if (target && !outstanding.includes(target)) {
    const { data: them } = await db.from('users').select('name').eq('id', target).maybeSingle();
    const first = firstOf(them?.name);
    return NextResponse.json({
      notified: 0,
      message: who.notNeeded.has(target) ? `${first} has nothing to pay.` : `${first} has already ${DONE[kind]}.`,
    });
  }
  if (!outstanding.length) {
    return NextResponse.json({
      notified: 0,
      message: kind === 'prefs' ? 'Everyone else has already answered'
        : kind === 'funding' ? 'Everyone has already paid' : 'Everyone has already done this',
    });
  }
  const aimedAt = target ? [target] : outstanding;

  // Once a minute per trip for a whole-group press, whoever presses it.
  // Claimed here, after we know there is somebody to nudge, so a press that
  // would send nothing does not use up the minute.
  let claimId: string | null = null;
  if (!target && limitsNudge(kind)) {
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

  // Then each person's twelve hours. Whoever was nudged lately is left out;
  // if that is everybody, nothing goes and the minute is given back.
  const people = await claimPeople(db, params.planId, ctx.user.id, aimedAt);
  const { data: named } = await db.from('users').select('id, email, name').in('id', aimedAt);
  const nameOf = new Map((named || []).map(u => [String(u.id), firstOf(u.name)]));
  const held = people.held.map(h => ({ userId: h.userId, name: nameOf.get(h.userId) ?? 'Someone', retryAfterSeconds: h.retryAfterSeconds }));
  if (!people.claimed.length) {
    await releaseNudge(db, claimId);
    const wait = Math.min(...people.held.map(h => h.retryAfterSeconds));
    console.log('[notify] everyone asked for was nudged lately', { planId: params.planId, kind, held: held.length });
    return NextResponse.json({
      error: target
        ? `${nameOf.get(target) ?? 'They'} was nudged in the last 12 hours — you can nudge them again in ${hours(wait)}.`
        : `Everyone still to ${TODO[kind]} was nudged in the last 12 hours — you can nudge them again in ${hours(wait)}.`,
      retryAfterSeconds: wait,
      held,
    }, { status: 429, headers: { 'Retry-After': String(wait) } });
  }
  const sendTo = people.claimed.map(c => c.userId);
  const recipients = (named || []).filter(p => sendTo.includes(String(p.id)));

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
  // A share to pay opens on the trip's checkout once /home reads ?pay=; until
  // then the ?group= in it still opens the group the trip is in, rather than
  // leaving them on Home looking for it.
  const payUrl = `/home?pay=${encodeURIComponent(params.planId)}&group=${encodeURIComponent(String(plan.group_id))}`;
  const url = kind === 'prefs'
    ? `${base}/home?answer=${encodeURIComponent(params.planId)}`
    : kind === 'vote' ? `${base}${voteUrl}` : `${base}${payUrl}`;

  const what = plan.title === 'Where next?'
    ? (plan.type === 'restaurant' ? 'your next night out' : 'your next trip')
    : plan.title;

  // Every nudge goes in the app first: everybody's bell, and their phone if
  // they have let Reach notify it. Email is the fallback only for people no
  // phone notification reached — the owner's rule. The funding nudge used to
  // be email only, so with email switched off it could reach nobody.
  let delivery: Delivery;
  if (kind === 'prefs') {
    const organiser = (await db.from('users').select('name').eq('id', ctx.user.id).maybeSingle()).data?.name;
    const first = String(organiser || '').trim().split(/\s+/)[0] || 'Your group';
    delivery = await notifyUsers(db, sendTo, {
      kind: 'prefs',
      title: `${first} is waiting on you`,
      body: `Say what you want from ${what} — the ideas are built once everyone has answered.`,
      url: `/home?answer=${encodeURIComponent(params.planId)}`,
      planId: params.planId,
    }, pushSender());
  } else if (kind === 'vote') {
    // Never says who has voted for what.
    const options = voteNames.slice(0, 3);
    delivery = await notifyUsers(db, sendTo, {
      kind: 'vote',
      title: 'Your vote is still to come',
      body: `${options.length ? `${options.join(' · ')} — ` : ''}vote on ${what}.`,
      url: voteUrl,
      planId: params.planId,
    }, pushSender());
  } else {
    // No amount in the bell or on the lock screen: the figure is on the
    // checkout, where it is worked out, and a phone is read over shoulders.
    delivery = await notifyUsers(db, sendTo, {
      kind: 'funding',
      title: 'Your share is still to pay',
      body: `Open ${what} to pay your share.`,
      url: payUrl,
      planId: params.planId,
    }, pushSender());
  }
  const emailTo = recipients.filter(p => delivery.unreached.includes(String(p.id)));

  const reached = new Set<string>(delivery.stored ? sendTo : []);
  for (const id of delivery.pushed) reached.add(id);
  let emailed = 0;
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
          shareCents: who.shares[String(person.id)] ?? 0, url,
        });
    if (result.sent) {
      emailed++;
      reached.add(String(person.id));
    } else {
      failures.push(result.reason || 'error');
    }
  }

  // Whoever nothing reached was not nudged: their twelve hours go back, and
  // if nobody was reached the minute goes back too.
  await releasePeople(db, people.claimed.filter(c => !reached.has(c.userId)).map(c => c.claimId));
  if (!reached.size) await releaseNudge(db, claimId);

  if (!reached.size && failures.length) {
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
    notified: reached.size,
    inApp: delivery.inApp, pushed: delivery.pushed.length, emailed,
    attempted: sendTo.length, failed: failures.length,
    // By first name, for "Nudged Sam". Held: nudged in the last 12 hours,
    // so left out of this one.
    nudged: sendTo.filter(id => reached.has(id)).map(id => ({ userId: id, name: nameOf.get(id) ?? 'Someone' })),
    held,
  });
}
