// ─── /api/plans/[planId]/close — "How was it?" ───────────────────────────
// The close card after a trip (checkout spec 8e). The rules for when it is
// shown are in lib/trip-close.ts; in short: the trip is over by its own
// dates, something on it was actually held, and this person was there.
//
// GET → 200 {
//   ask: boolean,               show the card
//   why: null | 'no_dates' | 'not_over' | 'nothing_held' | 'joined_after' | 'cancelled',
//   endedOn: 'YYYY-MM-DD' | null,
//   answer: 1 | 2 | 3 | null,   this person's answer, if they gave one
//   reviewsAvailable: boolean,  false before sql/post-trip-close-2026-09-25.sql
//   solo: boolean,
//   settle: null | { available, unsettled, youOweCents, owedToYouCents, pending },
//                               null on a solo trip, or when the ledger could
//                               not be read (settleKnown: false says which)
//   settleKnown: boolean,
//   next: null | { groupId, type, fromClose, blockedBy: { id, title } | null }
//                               only alongside the card; pass `fromClose` as
//                               `from_close` to POST /api/plans
// }
//
// POST { score: 1 | 2 | 3 } → 200 { answer } — one per person per trip;
//   tapping again changes it. 409 { why } when the card is not shown for this
//   person, 503 when the table is not there yet.
//
// Nothing here creates a plan or flips a status. "Plan the next one?" is the
// UI's to act on, through POST /api/plans, which counts it once a plan exists.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { loadLedger } from '@/lib/ledger';
import { readActive } from '@/lib/one-active';
import { closeAsk, isCloseScore, loadHeld, nextOffer, settleFor, type ClosePlan, type CloseSettle } from '@/lib/trip-close';

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /trip_reviews/.test(e.message || '') && /schema cache|does not exist/i.test(e.message || ''));

type Ctx = Exclude<Awaited<ReturnType<typeof requirePlanMember>>, { error: unknown }>;

async function gate(ctx: Ctx) {
  const plan = ctx.plan as ClosePlan;
  const [held, joined] = await Promise.all([
    loadHeld(ctx.db, plan.id).catch(() => null),
    ctx.db.from('group_members').select('joined_at').eq('group_id', plan.group_id).eq('user_id', ctx.user.id).maybeSingle(),
  ]);
  if (!held) return null;
  // Membership was checked by requirePlanMember; this is only when they
  // joined. Unread, it is read as "was there" — see closeAsk.
  if (joined.error) console.error('[close] could not read when this member joined', { planId: plan.id, code: joined.error.code });
  return closeAsk({ plan, ...held, joinedAt: (joined.data?.joined_at as string | null | undefined) ?? null });
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const plan = ctx.plan as ClosePlan;

  const asked = await gate(ctx);
  if (!asked) {
    console.error('[close] could not read what this trip held', { planId: params.planId });
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 503 });
  }

  let answer: number | null = null;
  let reviewsAvailable = true;
  {
    const { data, error } = await ctx.db.from('trip_reviews').select('score')
      .eq('plan_id', params.planId).eq('user_id', ctx.user.id).maybeSingle();
    if (error) {
      if (missingTable(error)) reviewsAvailable = false;
      else {
        console.error('[close] could not read the answer', { planId: params.planId, code: error.code });
        return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 503 });
      }
    }
    answer = isCloseScore(data?.score) ? data.score : null;
  }

  // The ledger only matters next to the card. A failed read is said as
  // such — never as "all square", which is what a missing line would read as.
  let settle: CloseSettle | null = null;
  let settleKnown = true;
  let solo = false;
  // The card needs somewhere to keep the answer; without the table it is not shown.
  const show = asked.ask && reviewsAvailable;
  if (show) {
    try {
      const ledger = await loadLedger(ctx.db, ctx.plan as { id: string; group_id: string });
      solo = ledger.solo;
      settle = ledger.solo ? null : settleFor(ctx.user.id, ledger.lines, ledger.settlementsAvailable);
    } catch (e) {
      settleKnown = false;
      console.error('[close] could not read the ledger', { planId: params.planId, error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  let next = null;
  if (show) {
    const active = await readActive(ctx.db, plan.group_id, { type: String(plan.type ?? 'trip'), except: plan.id });
    next = nextOffer(plan, active.live ?? active.waiting);
  }

  return NextResponse.json({
    ask: show,
    why: asked.why,
    endedOn: asked.endedOn,
    answer,
    reviewsAvailable,
    solo,
    settle,
    settleKnown,
    next,
  });
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => null) as { score?: unknown } | null;
  const score = body?.score;
  if (!isCloseScore(score)) return NextResponse.json({ error: 'score must be 1, 2 or 3' }, { status: 400 });

  const asked = await gate(ctx);
  if (!asked) {
    console.error('[close] could not read what this trip held', { planId: params.planId });
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 503 });
  }
  if (!asked.ask) return NextResponse.json({ error: 'This trip is not one to answer for yet.', why: asked.why }, { status: 409 });

  // An upsert on the (plan, user) unique key: a double tap is two concurrent
  // requests, and both land on the one row.
  const { data, error } = await ctx.db.from('trip_reviews')
    .upsert({ plan_id: params.planId, user_id: ctx.user.id, score, updated_at: new Date().toISOString() }, { onConflict: 'plan_id,user_id' })
    .select('score').single();
  if (error) {
    if (missingTable(error)) {
      console.error('[close] no trip_reviews table — run sql/post-trip-close-2026-09-25.sql', { planId: params.planId });
      return NextResponse.json({ error: 'Answers are not saved yet — run sql/post-trip-close-2026-09-25.sql.', reviewsAvailable: false }, { status: 503 });
    }
    console.error('[close] could not save the answer', { planId: params.planId, code: error.code });
    return NextResponse.json({ error: 'Could not save that just now.' }, { status: 500 });
  }
  return NextResponse.json({ answer: data?.score ?? score });
}
