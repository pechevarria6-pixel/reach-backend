// ─── /api/plans/[planId]/debrief — the organiser's post-trip debrief ────
// REACH-PILOT-GATE-2026-11-08.md A7, business-model §4G M2. After a trip
// that happened, the person who organised it says roughly how many hours it
// took, how many messages, how likely they are to recommend Reach (0–10),
// whether they would run the next one, and — if they want — what almost made
// them quit. Three of those are the pilot's pre-registered readouts
// (docs/pilot/READOUTS.md): hours vs 19, messages vs 83, NPS vs 50.
//
// GET → 200 {
//   ask: boolean,          show the form
//   why: null | 'not_organiser' | 'cancelled' | 'not_over' | 'nothing_held'
//        | 'no_dates' | 'submitted' | 'not_stored',
//   submitted: boolean,    this person has already answered for this trip
//   noteAvailable: boolean false before sql/pilot-debrief-2026-11-08.sql:
//                          the numbers are kept, the free text cannot be
// }
//
// POST { hours, messages?, nps, would_run_again, almost_quit? } — the choice
//   ids from components/pilot/rules.ts, not free numbers.
//   → 200 { saved: true, noteSaved: boolean }
//   → 400 a value that is not one of the choices
//   → 409 { why } not asked for this trip, or already answered (once only)
//   → 503 nowhere to keep it: neither the events table nor pilot_debriefs
//
// Where it goes. The numbers go to `events` as `debrief_submitted`, through
// track(), with props that are numbers and booleans only. The free text never
// goes there — scrubProps drops prose, correctly — and is kept, with the
// numbers beside it, in pilot_debriefs. That table may not exist yet; the
// numbers are still recorded without it, and the answer says the note was
// not.
//
// Once per person per trip. The events table is read first; pilot_debriefs
// carries a unique (plan_id, user_id), so two requests at the same instant
// cannot both write a row there. Before that migration runs, a double tap
// could record two events — the readout SQL takes the earliest per person
// per plan for exactly that reason.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { track } from '@/lib/track';
import { isOrganiser } from '@/lib/trip-vote';
import { closeAsk, loadHeld, somethingHeld, type ClosePlan } from '@/lib/trip-close';
import { debriefEventProps, debriefGate, parseDebrief, refused, tableMissing } from '@/components/pilot/rules';

const EVENT = 'debrief_submitted';
const TABLE = 'pilot_debriefs';

type Ctx = Exclude<Awaited<ReturnType<typeof requirePlanMember>>, { error: unknown }>;

/** Whether this person has answered already, and where it could be kept. */
async function priorAnswer(ctx: Ctx, planId: string) {
  const [ev, row] = await Promise.all([
    ctx.db.from('events').select('id').eq('name', EVENT).eq('plan_id', planId).eq('user_id', ctx.user.id).limit(1),
    ctx.db.from(TABLE).select('id').eq('plan_id', planId).eq('user_id', ctx.user.id).limit(1),
  ]);
  const eventsAvailable = !ev.error;
  const tableAvailable = !row.error;
  if (ev.error && !tableMissing(ev.error, 'events')) return { failed: true as const };
  if (row.error && !tableMissing(row.error, TABLE)) return { failed: true as const };
  const submitted = (ev.data?.length ?? 0) > 0 || (row.data?.length ?? 0) > 0;
  return { failed: false as const, submitted, eventsAvailable, tableAvailable };
}

async function gate(ctx: Ctx, submitted: boolean) {
  const plan = ctx.plan as ClosePlan & { created_by?: string | null };
  const held = await loadHeld(ctx.db, plan.id).catch(() => null);
  if (!held) return null;
  const close = closeAsk({ plan, ...held });
  return debriefGate({
    organiser: isOrganiser({ role: ctx.role, createdBy: plan.created_by ?? null, userId: ctx.user.id }),
    status: plan.status ?? null,
    closeWhy: close.why,
    held: somethingHeld(held.lines, held.bookings),
    submitted,
  });
}

// Every caller has logged what it could not read, with the plan, just above.
const unreadable = () => {
  console.error('[debrief] answering 503: could not read this trip');
  return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 503 });
};

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const prior = await priorAnswer(ctx, params.planId);
  if (prior.failed) {
    console.error('[debrief] could not read earlier answers', { planId: params.planId });
    return unreadable();
  }
  const asked = await gate(ctx, prior.submitted);
  if (!asked) {
    console.error('[debrief] could not read what this trip held', { planId: params.planId });
    return unreadable();
  }
  // Never ask a question whose answer has nowhere to go.
  const stored = prior.eventsAvailable || prior.tableAvailable;
  return NextResponse.json({
    ask: asked.ask && stored,
    why: asked.ask && !stored ? 'not_stored' : asked.why,
    submitted: prior.submitted,
    noteAvailable: prior.tableAvailable,
  });
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const parsed = parseDebrief(await req.json().catch(() => null));
  if (refused(parsed)) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const d = parsed.value;

  // Checked first, before anything is written: once per person per trip.
  const prior = await priorAnswer(ctx, params.planId);
  if (prior.failed) {
    console.error('[debrief] could not read earlier answers', { planId: params.planId });
    return unreadable();
  }
  if (prior.submitted) {
    return NextResponse.json({ error: 'You have already answered for this trip — thank you.', why: 'submitted' }, { status: 409 });
  }

  const asked = await gate(ctx, false);
  if (!asked) {
    console.error('[debrief] could not read what this trip held', { planId: params.planId });
    return unreadable();
  }
  if (!asked.ask) return NextResponse.json({ error: 'This trip is not one to answer for.', why: asked.why }, { status: 409 });

  if (!prior.eventsAvailable && !prior.tableAvailable) {
    console.error('[debrief] neither events nor pilot_debriefs exists — nothing can be kept', { planId: params.planId });
    return NextResponse.json({ error: "Couldn't save that just now." }, { status: 503 });
  }

  const plan = ctx.plan as { id: string; group_id: string; solo_mode?: boolean | null };
  const solo = plan.solo_mode === true;

  let noteSaved = false;
  if (prior.tableAvailable) {
    const { error } = await ctx.db.from(TABLE).insert({
      plan_id: params.planId,
      group_id: plan.group_id,
      user_id: ctx.user.id,
      hours: d.hours,
      messages: d.messages,
      nps: d.nps,
      would_run_again: d.would_run_again,
      almost_quit: d.almost_quit,
      solo,
    });
    if (error) {
      // The unique (plan_id, user_id): the other half of a double tap got
      // there first. Already answered is answered.
      if (error.code === '23505') {
        return NextResponse.json({ error: 'You have already answered for this trip — thank you.', why: 'submitted' }, { status: 409 });
      }
      if (!tableMissing(error, TABLE)) {
        console.error('[debrief] could not save the answer', { planId: params.planId, code: error.code });
        return NextResponse.json({ error: "Couldn't save that just now." }, { status: 500 });
      }
    } else {
      noteSaved = d.almost_quit !== null;
    }
  }

  // Awaited, so the event is written before the screen says thanks. track()
  // never throws and never fails a request.
  await track(ctx.db, EVENT, {
    userId: ctx.user.id,
    groupId: plan.group_id,
    planId: params.planId,
    props: debriefEventProps(d, { solo }),
  });

  return NextResponse.json({ saved: true, noteSaved: d.almost_quit === null ? true : noteSaved });
}
