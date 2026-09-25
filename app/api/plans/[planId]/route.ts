import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { toDateOrNull } from '@/lib/dates';
import { tidyLegacy } from '@/lib/checkout';
import { holdsSomething } from '@/lib/booking/claim';
import { netCollectedCents } from '@/lib/booking/approval';
import { refundsOpen } from '@/lib/refunds';
import { impactOfDateChange, describeImpact, needsConfirmation, stillWorksFor } from '@/lib/date-change';
import { z } from 'zod';
import { track } from '@/lib/track';
import { cachedDestinationPhoto } from '@/lib/discovery/destination-photo';
import { within } from '@/lib/deadline';
import { UNDECIDED } from '@/lib/group-answers';
import { mayPick, readIdeas, patchDecides, patchCallsOff, calledOffCopy, pickedTitle } from '@/lib/trip-vote';
import { membersOf, organiserOf, firstName, notMigrated, MIGRATION } from '@/lib/trip-ideas-store';
import { notifyUsers } from '@/lib/notify-user';
import { pushSender } from '@/lib/push';
import { pinPlan, pinMoves } from '@/lib/trip-map';
import { readActive, closeStale, refusalBody, refusalFor, ACTIVE_STATUSES } from '@/lib/one-active';

const UpdatePlanSchema = z.object({
  // Sent by the organiser on the second call, having read what moving the
  // dates costs. Never stored — it is a decision about this request.
  confirmDateChange: z.boolean().nullish(),
  title: z.string().min(1).max(200).nullish(),
  status: z.enum(['planning','voting','approved','booked','completed','cancelled']).nullish(),
  start_date: z.string().nullish(),
  destination_city: z.string().trim().max(120).nullish(),
  destination_country: z.string().trim().length(2).nullish(),
  end_date: z.string().nullish(),
  budget_cents: z.number().min(0).nullish(),
  accommodation: z.string().nullish(),
  vibe: z.string().nullish(),
  destination_style: z.string().nullish(),
  dealbreakers: z.array(z.string()).nullish(),
  vote_options: z.array(z.string()).nullish(),
  // What the chosen option does for whom, as the group was shown it.
  why_chosen: z.array(z.string()).nullish(),
  // Picking a group trip's destination. Only lands on a trip that is still
  // waiting for one, checked in the same statement as the write — two people
  // pressing "Pick this" on different options at once is two concurrent
  // requests, and read-then-write would let both through. Never stored.
  only_if_undecided: z.boolean().nullish(),
  // Which of the saved ideas (plans.trip_options) is being picked. The
  // place, the budget and the reasons are then taken from the idea as the
  // group saw it, not from whatever the caller sent. Never stored.
  pick_option: z.string().max(200).nullish(),
  // The caller opens the plan a 409 `one_active` names; without it,
  // reopening a plan is not refused (lib/one-active.ts refusalFor). Never
  // stored.
  accepts_one_active: z.boolean().nullish(),
});

// GET /api/plans/[id] — get a single plan with itinerary and votes
export async function GET(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('*').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Verify user is in the group
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [itineraryRes, votesRes, membersRes] = await Promise.all([
    supabase.from('itinerary_items').select('*').eq('plan_id', params.planId).order('sort_order'),
    supabase.from('votes').select('option, user_id').eq('plan_id', params.planId),
    supabase.from('group_members').select('user_id, users(id, name, email, avatar_url)').eq('group_id', plan.group_id),
  ]);

  // Build vote tally
  const tally: Record<string, number> = {};
  votesRes.data?.forEach(v => { tally[v.option] = (tally[v.option] || 0) + 1; });
  const myVote = votesRes.data?.find(v => v.user_id === user.id)?.option || null;

  const participants = (membersRes.data || []).map(m => m.user_id);

  return NextResponse.json({
    plan: { ...plan, participants },
    participants,
    members: membersRes.data || [],
    itinerary: itineraryRes.data || [],
    votes: tally,
    myVote,
    totalVotes: votesRes.data?.length || 0,
  });
}

// PATCH /api/plans/[id] — update a plan
export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  // safeParse, not parse: a throw here surfaces as an opaque 500 and the
  // client cannot tell bad input from a server fault.
  const parsed = UpdatePlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const supabase = ctx.db;

  const user = ctx.user;

  const { data: plan } = await supabase.from('plans')
    .select('group_id, start_date, end_date, created_by, destination_style, status, title, type, destination_city, destination_country').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // "Booked" is a fact about the bookings, written by the approve route and
  // the payment webhook when they are confirmed. Anyone in the group could
  // set it here, and the trip then read "Booked" with nothing bought.
  if (body.status === 'booked' && plan.status !== 'booked') {
    return NextResponse.json({ error: 'A trip is marked booked once its bookings are confirmed, not by hand.' }, { status: 409 });
  }

  // Handle status-specific timestamps
  // confirmDateChange is a decision about this request, not a column.
  const { confirmDateChange: _confirm, only_if_undecided: onlyIfUndecided, pick_option: pickOption, accepts_one_active: acceptsOneActive, ...fields } = body as Record<string, unknown>;
  const updates: any = { ...fields };

  // ── Deciding where a group trip goes ──────────────────────────────────
  // The pick is made for everybody, so in a group it is the organiser's —
  // whoever set the trip up, or an admin — and nobody else's, whatever
  // their screen offers. It used to be whoever tapped "Pick this" first.
  // Anything that would decide an undecided trip counts: picking, clearing
  // "undecided", moving its status (closing the vote), or rewriting the list
  // the vote is checked and counted against — see patchDecides.
  // Reopening voting on a decided trip is only a pick if it was decided by
  // picking one of the saved ideas — read separately, because the column
  // arrives in a migration and a database without it has no saved ideas.
  let picked = false;
  if (plan.destination_style !== UNDECIDED && updates.status === 'voting') {
    const { data: row, error: readErr } = await supabase.from('plans').select('trip_options').eq('id', params.planId).maybeSingle();
    if (readErr && !notMigrated(readErr)) {
      console.error('[plans PATCH] could not read the saved ideas', { planId: params.planId, code: readErr.code });
      return NextResponse.json({ error: "We couldn't check this trip just now — try again in a moment." }, { status: 503 });
    }
    picked = !readErr && !!readIdeas((row as { trip_options?: unknown } | null)?.trip_options);
  }
  const deciding = patchDecides({
    undecided: plan.destination_style === UNDECIDED,
    fields: updates,
    onlyIfUndecided: onlyIfUndecided === true,
    pickOption,
    picked,
  });
  // Calling a plan off is done for everybody, so it is the organiser's too.
  const callingOff = patchCallsOff(updates) && plan.status !== 'cancelled';
  let others: string[] = [];
  let callerName: string | null = null;
  if (deciding || callingOff) {
    const members = await membersOf(supabase, String(plan.group_id));
    if (!members) {
      // Deciding for a group on a guess about who is in it is not an option.
      console.error('[plans PATCH] refused: could not read the group', { planId: params.planId, callingOff });
      return NextResponse.json({ error: "We couldn't check who is in this group — try again in a moment." }, { status: 503 });
    }
    if (!mayPick({ role: membership.role, createdBy: plan.created_by, userId: user.id, memberCount: members.length })) {
      const organiser = organiserOf(members, plan.created_by ?? null);
      const who = organiser ? firstName(organiser.name) : 'whoever set this trip up';
      return NextResponse.json({
        // A plan still deciding where it goes counts moving its status as
        // deciding too, so calling it off is both; the answer names the act.
        error: callingOff
          ? `Only ${who} can call this off.`
          : `Only ${who} can make the pick — your vote is what counts toward it.`,
        notOrganiser: true,
      }, { status: 403 });
    }
    others = members.map(m => m.userId).filter(id => id !== user.id);
    callerName = firstName(members.find(m => m.userId === user.id)?.name ?? '');
  }

  // A plan holding something real — a confirmed room, a table somebody
  // holds — is not called off from here, for the same reason it is not
  // deleted with one: cancelling the plan does not cancel the booking, and
  // a cancelled plan leaves Home, taking the only way to see it along.
  if (callingOff) {
    // Redirected is a hand-off to somebody else's checkout, not something
    // held — calling the plan off does not touch it either way.
    const { data: held, error: heldErr } = await supabase.from('bookings')
      .select('id, status, vertical, detail').eq('plan_id', params.planId)
      .in('status', ['confirmed', 'pending']);
    if (heldErr) {
      console.error('[plans PATCH] could not read what this plan holds', { planId: params.planId, code: heldErr.code });
      return NextResponse.json({ error: "We couldn't check this plan's bookings — nothing was changed." }, { status: 503 });
    }
    if ((held ?? []).length) {
      // Named, so it is something somebody can act on: there is no cancel
      // screen in the app for them to go and find.
      const what = (held ?? []).map(b => String(b.detail || b.vertical || 'a booking').split(' · ')[0]).slice(0, 3);
      return NextResponse.json({
        error: `This trip still holds ${what.join(', ')}. Calling it off here would not cancel ${what.length === 1 ? 'that' : 'those'} — to ask about cancelling, email hello@alcanzar.io with the trip's name.`,
        holding: what,
      }, { status: 409 });
    }
    // Money paid in is the same: calling the trip off does not give it back.
    // Money still held, that is: `*` so refunded_cents counts from the moment
    // its migration runs, and a trip whose payers have taken their money back
    // can be called off. Any payment was refused for good, even refunded.
    const { data: paid, error: paidErr } = await supabase.from('contributions')
      .select('*').eq('plan_id', params.planId).eq('status', 'succeeded');
    if (paidErr) {
      console.error('[plans PATCH] could not check payments before calling off', { planId: params.planId, code: paidErr.code });
      return NextResponse.json({ error: "We couldn't check this trip's payments — nothing was changed." }, { status: 503 });
    }
    if (netCollectedCents(paid) > 0) {
      // The way to the money, where there is one: the checkout button, once
      // the refunds migration has run; the inbox until then.
      const back = await refundsOpen(supabase, params.planId)
        ? 'Whoever paid can take back what wasn\'t spent from the trip\'s checkout ("Refund what wasn\'t spent"), and then it can be called off.'
        : "Email hello@alcanzar.io with the trip's name to have it refunded.";
      return NextResponse.json({
        error: `Money paid towards this trip is still held, so it can't be called off from here — calling it off wouldn't give it back. ${back}`,
        paidIn: true,
      }, { status: 409 });
    }
  }

  // The idea as the group saw it. When it is saved, it is the source of the
  // place and the budget; the caller's copy is only used on a database that
  // has not had sql/trip-options-2026-09-23.sql yet.
  if (pickOption != null) {
    const { data: row, error: readErr } = await supabase.from('plans').select('trip_options').eq('id', params.planId).maybeSingle();
    if (readErr && !notMigrated(readErr)) {
      console.error('[plans PATCH] could not read the saved ideas for the pick', { planId: params.planId, code: readErr.code });
      return NextResponse.json({ error: "We couldn't read this trip's ideas just now — try again." }, { status: 503 });
    }
    if (readErr) console.error(`[plans PATCH] picking from the caller's copy: plans.trip_options is not there yet — run ${MIGRATION}`);
    const ideas = readIdeas((row as { trip_options?: unknown } | null)?.trip_options);
    if (ideas) {
      const idea = ideas.options.find(o => o.id === String(pickOption));
      if (!idea) return NextResponse.json({ error: "That isn't one of this trip's ideas any more — have a look at the current ones." }, { status: 409 });
      // An evening is named after the venues its days go to, once they are
      // written; otherwise the place.
      updates.title = pickedTitle(idea);
      updates.destination_city = idea.city || null;
      updates.destination_country = idea.country_code ? String(idea.country_code).toUpperCase() : null;
      updates.budget_cents = Math.round((Number(idea.total_per_person) || 0) * 100);
      updates.why_chosen = (idea.used_suggestions || []).length ? idea.used_suggestions : null;
    }
  }
  if (onlyIfUndecided === true) {
    updates.destination_style = null;
    // The vote is over. Back to planning, where the three checks — overview,
    // budget, book — decide when it is ready; "approved" would read as money
    // already in.
    updates.status = 'planning';
  }
  if ('why_chosen' in updates) updates.why_chosen = (updates.why_chosen as string[] | null)?.length ? updates.why_chosen : null;
  if ('destination_country' in updates && updates.destination_country) {
    updates.destination_country = String(updates.destination_country).toUpperCase();
  }

  // The picture of the place, now that there is a place. A group trip was
  // saved before it had one, so it was deliberately given no photograph;
  // this is when it gets the one creating a trip with a destination gets.
  if (onlyIfUndecided === true && updates.destination_city) {
    const photo = await within(
      cachedDestinationPhoto(supabase, [updates.destination_city, updates.destination_country].filter(Boolean).join(', ')),
      3000, 'the destination photo',
    ).catch(() => null);
    // Never the picture without the credit: a photograph is somebody's work.
    if (photo) Object.assign(updates, { image_url: photo.url, image_credit: photo.credit, image_source: photo.source });
  }
  // Same guard as POST /api/plans: never hand Postgres a display string.
  if ('start_date' in updates) updates.start_date = toDateOrNull(updates.start_date);
  if ('end_date' in updates) updates.end_date = toDateOrNull(updates.end_date);
  if (body.status === 'approved') updates.approved_at = new Date().toISOString();
  if (body.status === 'booked') updates.booked_at = new Date().toISOString();

  // ── Moving the dates ──────────────────────────────────────────────────
  // A trip nobody has booked anything for can have its dates edited like any
  // other field. Once there are bookings it is a different act: a hotel is
  // held for particular nights and a table exists at a particular hour, and
  // neither follows the plan when the plan moves.
  const movingStart = 'start_date' in updates && updates.start_date !== plan.start_date;
  const movingEnd = 'end_date' in updates && updates.end_date !== plan.end_date;

  if (movingStart || movingEnd) {
    // Whoever set the trip up moves it. Anybody else in the group asking to
    // is not a bug in their client, it is a decision that is not theirs.
    const organiser = membership.role === 'admin' || plan.created_by === user.id;
    if (!organiser) {
      return NextResponse.json(
        { error: 'Only whoever set this trip up can move its dates.' },
        { status: 403 },
      );
    }

    const nextStart = ('start_date' in updates ? updates.start_date : plan.start_date) ?? null;
    const nextEnd = ('end_date' in updates ? updates.end_date : plan.end_date) ?? null;

    const [{ data: existing }, { data: windows }] = await Promise.all([
      supabase.from('bookings')
        .select('id, vertical, status, mode, provider, detail, fulfilled_by, booked_by')
        .eq('plan_id', params.planId),
      supabase.from('availability_windows')
        .select('user_id, start_date, end_date').eq('plan_id', params.planId),
    ]);

    const impacts = impactOfDateChange(existing ?? []);
    const whoCanCome = nextStart && nextEnd
      ? stillWorksFor(
        (windows ?? []).map(w => ({ userId: String(w.user_id), start: String(w.start_date), end: String(w.end_date) })),
        nextStart, nextEnd,
      )
      : { works: [], out: [] };

    // Shown before anything is written. The organiser confirms with
    // { confirmDateChange: true }, having read what it costs.
    if (needsConfirmation(impacts) && body.confirmDateChange !== true) {
      return NextResponse.json({
        needsConfirmation: true,
        from: { start: plan.start_date, end: plan.end_date },
        to: { start: nextStart, end: nextEnd },
        consequences: describeImpact(impacts),
        worksFor: whoCanCome.works.length,
        outOf: whoCanCome.works.length + whoCanCome.out.length,
        confirmWith: { confirmDateChange: true },
      }, { status: 409 });
    }

    // A price for dates that no longer exist is not a price. Cancelled
    // rather than deleted: the trip's history is worth keeping, and the
    // bridge treats a cancelled row as a line it may quote again.
    const stale = impacts.filter(i => i.consequence === 'requote' && i.bookingId).map(i => i.bookingId as string);
    if (stale.length) {
      const { error: invalidated } = await supabase.from('bookings')
        .update({ status: 'cancelled', itinerary_item_id: null, updated_at: new Date().toISOString() })
        .in('id', stale);
      if (invalidated) {
        console.error('[plans PATCH] could not invalidate quotes for the old dates',
          { planId: params.planId, code: invalidated.code });
      }
    }
  }

  // ── Back into planning ────────────────────────────────────────────────
  // A group may have one trip and one night out being planned at a time
  // (lib/one-active.ts). Reopening a completed or cancelled plan is starting
  // one, so it meets the same rule POST /api/plans applies, with the same
  // answer; plans_one_active (sql/one-active-plan-2026-09-25.sql) refuses it
  // anyway when two arrive together, and that refusal is read below.
  const active = ACTIVE_STATUSES as readonly string[];
  const reopening = typeof updates.status === 'string' && active.includes(updates.status)
    && !active.includes(String(plan.status ?? 'planning'));
  const inTheWay = () => readActive(supabase, String(plan.group_id), { type: String(plan.type ?? 'trip'), except: params.planId });
  if (reopening) {
    const found = await inTheWay();
    if (found.live) {
      const solo = (await membersOf(supabase, String(plan.group_id)))?.length === 1;
      const refused = refusalFor(found, { type: String(plan.type ?? 'trip'), undecided: false, solo, understands: acceptsOneActive === true });
      if (refused) return NextResponse.json(refused, { status: 409 });
    }
    if (found.stale.length) await closeStale(supabase, String(plan.group_id), found.stale);
  }

  // ── Where it is on the map ────────────────────────────────────────────
  // A new destination makes the old point wrong, so it goes in the same
  // write — a pin is never left on the town the trip used to go to — and
  // the new one is looked up after the write, never inside it.
  const repin = pinMoves(plan, updates);
  if (repin) Object.assign(updates, { destination_lat: null, destination_lng: null, destination_label: null });

  // The error used to be discarded here, so a failed or no-op update answered
  // 200 with { plan: null } and anything writing through this route could
  // silently not save.
  const write = () => {
    let q = supabase.from('plans').update(updates).eq('id', params.planId);
    // And only on a trip still waiting: a pick from a stale vote screen must
    // not bring a called-off or closed plan back to planning.
    if (onlyIfUndecided === true) q = q.eq('destination_style', UNDECIDED).in('status', ['planning', 'voting']);
    // Called off once: a double-tap is two requests, and the second must
    // not tell everybody again.
    if (callingOff) q = q.neq('status', 'cancelled');
    return q.select().maybeSingle();
  };
  let attempt = await write();
  // why_chosen and the photograph columns arrive in migrations. A database
  // that has not had one yet should lose the sentence or the picture, not
  // the destination somebody just picked — the same bargain POST makes.
  const UNKNOWN = /could not find the '([a-z_]+)' column|column "?([a-z_]+)"? .*does not exist/i;
  for (let i = 0; i < 8 && attempt.error; i++) {
    const missing = UNKNOWN.exec(attempt.error.message || '');
    const name = missing ? (missing[1] || missing[2]) : null;
    if (!name || !['why_chosen', 'image_url', 'image_credit', 'image_source', 'destination_lat', 'destination_lng', 'destination_label'].includes(name) || !(name in updates)) break;
    console.error('[plans PATCH] retrying without a column this database does not have yet', { column: name });
    delete updates[name];
    attempt = await write();
  }
  const { data: updated, error: writeError } = attempt;
  if (onlyIfUndecided === true && !writeError && updated && others.length) {
    // Everybody hears where they are going — the organiser is looking at it.
    await notifyUsers(supabase, others, {
      kind: 'trip_picked',
      title: `${updated.title} it is`,
      body: 'Picked for the group. Open the trip to see the plan.',
      url: `/home?vote=${encodeURIComponent(params.planId)}&group=${encodeURIComponent(String(plan.group_id))}`,
      planId: params.planId,
    }, pushSender());
  }
  if (callingOff && !writeError && updated && others.length) {
    const copy = calledOffCopy({ organiserName: callerName, title: updated.title ?? plan.title ?? null, night: (updated.type ?? plan.type) === 'restaurant' });
    await notifyUsers(supabase, others, {
      kind: 'plan_called_off',
      title: copy.title,
      body: copy.body,
      url: `/home?group=${encodeURIComponent(String(plan.group_id))}`,
      planId: params.planId,
    }, pushSender());
  }
  if (callingOff && !writeError && !updated) {
    // The other request called it off first. Already done is done.
    const { data: now } = await supabase.from('plans').select('*').eq('id', params.planId).maybeSingle();
    if (now?.status === 'cancelled') return NextResponse.json({ plan: now, alreadyCalledOff: true });
  }
  if (onlyIfUndecided === true && !writeError && !updated) {
    // Nothing matched: somebody else picked first, or the trip was called off
    // meanwhile. Said as whichever it was.
    const { data: now } = await supabase.from('plans').select('status').eq('id', params.planId).maybeSingle();
    if (now?.status === 'cancelled') {
      return NextResponse.json({ error: 'This trip was called off, so nothing can be picked for it.', calledOff: true }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Somebody has already picked where this trip goes.', alreadyDecided: true },
      { status: 409 },
    );
  }
  if (writeError?.code === '23505' && reopening) {
    // Another plan of this kind got in first.
    const found = await inTheWay();
    if (found.live) {
      const solo = (await membersOf(supabase, String(plan.group_id)))?.length === 1;
      return NextResponse.json(refusalBody(found.live, { type: String(plan.type ?? 'trip'), undecided: false, solo }), { status: 409 });
    }
  }
  if (writeError || !updated) {
    console.error('[plans PATCH] update failed', { planId: params.planId, code: writeError?.code });
    return NextResponse.json({ error: 'Could not save that change' }, { status: 500 });
  }

  if (movingStart || movingEnd) {
    // Who moved a trip, when, and from what — the same reason a deletion is
    // written down.
    const { error: logged } = await supabase.from('audit_logs').insert({
      user_id: user.id, action: 'plan_dates_changed', resource: 'plans',
      resource_id: params.planId, success: true,
      metadata: {
        from: { start: plan.start_date, end: plan.end_date },
        to: { start: updated.start_date, end: updated.end_date },
      },
    });
    if (logged) console.error('[plans PATCH] date change not logged', { planId: params.planId, code: logged.code });
  }

  if (repin) {
    const pinned = await within(pinPlan(supabase, { ...updated, id: params.planId }), 2500, 'placing the plan on the map')
      .catch(() => ({ outcome: 'failed' as const }));
    if (pinned.outcome === 'failed' || pinned.outcome === 'write_failed') {
      console.error('[plans PATCH] the new destination has no point on the map yet', { planId: params.planId, ...pinned });
    }
    if (pinned.outcome === 'stored') {
      return NextResponse.json({ plan: { ...updated, destination_lat: pinned.lat, destination_lng: pinned.lng, destination_label: pinned.label } });
    }
  }

  return NextResponse.json({ plan: updated });
}

// DELETE /api/plans/[id] — delete a plan
export async function DELETE(_: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const supabase = ctx.db;
  const user = ctx.user;

  const { data: plan } = await supabase.from('plans').select('group_id, created_by').eq('id', params.planId).single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Only creator or group admin can delete
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', plan.group_id).eq('user_id', user.id).single();
  if (!membership || (membership.role !== 'admin' && plan.created_by !== user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── What the plan is holding ──────────────────────────────────────────
  // Deleting a trip used to take its bookings with it in the sense that
  // nothing looked at them again: the rows stayed, pointing at a plan that
  // no longer existed, reachable from no screen and impossible to approve or
  // cancel. There is one such row in this database — a table at Poole's
  // Diner, stuck awaiting approval against a plan that is gone.
  //
  // A row is the lesser problem. A confirmed hotel or a table somebody holds
  // on their own account is a real thing in the world, and deleting the trip
  // does not un-book it. So a plan that is holding one says so and refuses,
  // rather than quietly leaving somebody with a reservation they no longer
  // have any way to see.
  const { data: held, error: readErr } = await supabase
    .from('bookings')
    .select('id, status, vertical, detail, approved_at, updated_at')
    .eq('plan_id', params.planId)
    .not('status', 'in', '("failed","cancelled")');

  if (readErr) {
    console.error('[plans] could not read what this plan is holding', { plan: params.planId, code: readErr.code });
    return NextResponse.json({ error: "We couldn't check this trip's bookings — nothing was deleted" }, { status: 500 });
  }

  // Including a booking at the provider this minute ('booking', or before
  // M1 the stamp on an awaiting row): deleting the trip under it left an
  // order nobody could see.
  const real = (held ?? []).filter(holdsSomething);
  if (real.length) {
    return NextResponse.json({
      error: 'This trip still has something booked. Cancel those first and the trip will delete cleanly.',
      holding: real.map(b => ({ what: tidyLegacy(String(b.detail ?? '')) || String(b.vertical), status: b.status })),
    }, { status: 409 });
  }

  // Money still held stops a delete, as it stops calling off: the in-app
  // refund needs the trip to exist, so deleting it would leave the payer an
  // email as the only way to their money.
  const { data: paid, error: paidErr } = await supabase.from('contributions')
    .select('*').eq('plan_id', params.planId).eq('status', 'succeeded');
  if (paidErr) {
    console.error('[plans] could not check payments before deleting', { plan: params.planId, code: paidErr.code });
    return NextResponse.json({ error: "We couldn't check this trip's payments — nothing was deleted" }, { status: 500 });
  }
  if (netCollectedCents(paid) > 0) {
    const back = await refundsOpen(supabase, params.planId)
      ? 'Whoever paid can take back what wasn\'t spent from the trip\'s checkout ("Refund what wasn\'t spent"), and then it can be deleted.'
      : "Email hello@alcanzar.io with the trip's name to have it refunded.";
    return NextResponse.json({
      error: `Money paid towards this trip is still held, so it can't be deleted — that would leave nowhere to get it back from. ${back}`,
      paidIn: true,
    }, { status: 409 });
  }

  // Quotes and proposals are not things in the world, so they go with the
  // plan — but as cancelled rows rather than as rows nobody can reach.
  const loose = (held ?? []).map(b => b.id);
  if (loose.length) {
    const { error: cancelled } = await supabase.from('bookings')
      .update({ status: 'cancelled' }).in('id', loose);
    if (cancelled) {
      console.error('[plans] could not cancel this plan’s quotes', { plan: params.planId, code: cancelled.code });
      return NextResponse.json({ error: "We couldn't tidy this trip's quotes — nothing was deleted" }, { status: 500 });
    }
  }

  const { error: removed } = await supabase.from('plans').delete().eq('id', params.planId);
  if (removed) {
    console.error('[plans] could not delete the plan', { plan: params.planId, code: removed.code });
    return NextResponse.json({ error: "We couldn't delete that just now" }, { status: 500 });
  }

  // `planId` is deliberately not passed, and the id goes in the props bag.
  //
  // events.plan_id is `references plans(id) on delete set null`, and the row
  // this names was deleted four lines up — so naming it in that column makes
  // the insert violate the constraint (23503) and the event is refused. This
  // is the one event in the table that could never be written: the thing it
  // describes has to be gone before it can be true. Reproduced against the
  // real database before changing anything.
  //
  // Nothing is lost by moving it. `on delete set null` would have blanked the
  // column the moment the plan went anyway, so the props bag is the only
  // place this id was ever going to survive.
  void track(supabase, 'plan_deleted', {
    userId: user.id, groupId: String(plan.group_id),
    props: { cancelled_quotes: loose.length, plan: params.planId },
  });

  // Nine plans once vanished with nothing to read afterwards. This is what
  // makes the next disappearance answerable.
  const { error: audit } = await supabase.from('audit_logs').insert({
    user_id: user.id, action: 'plan_deleted', resource: 'plans', resource_id: params.planId, success: true,
    metadata: { group_id: plan.group_id, cancelled_quotes: loose.length },
  });
  if (audit) console.error('[audit] could not record plan_deleted', { plan: params.planId, code: audit.code });

  return NextResponse.json({ success: true, cancelledQuotes: loose.length });
}
