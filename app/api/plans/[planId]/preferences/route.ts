// ─── Each trip asks for itself ──────────────────────────────────────────
// The taste quiz is a standing profile: what somebody is into, generally.
// That is the right input for Discover, which answers "what is on near you"
// and has no trip to be about.
//
// It is the wrong input for a trip. What you want from a week with your
// family in March is not what you want from a weekend with friends in
// October, and a profile cannot tell the two apart. So every trip asks its
// own members its own questions, and their answers live here — against the
// plan, not against the person.
//
// GET  → what I said about this trip (mine only)
// POST → record what I said, and mark me as having had my say
import { announceIfEveryoneIn } from '@/lib/everyone-in';
import { pushSender } from '@/lib/push';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { z } from 'zod';

const Schema = z.object({
  // The one written answer. Everything else on the form is a list.
  summary: z.string().trim().max(500).nullish(),
  // Whatever the trip quiz collected. Deliberately loose: the quiz's shape
  // is a product decision that changes, and a schema pinned to today's
  // questions would reject tomorrow's answers rather than store them.
  answers: z.record(z.unknown()).nullish(),
});

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  // Mine, by id. Somebody else's answers about this trip are theirs, the
  // same as their standing ones — the group sees readiness, never content.
  const { data, error } = await ctx.db
    .from('plan_preferences')
    .select('summary_text, answers, submitted_at')
    .eq('plan_id', params.planId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();

  if (error) {
    console.error('[plan preferences GET] failed', { planId: params.planId, code: error.code });
    return NextResponse.json({ error: 'Could not read your answers just now.' }, { status: 500 });
  }

  return NextResponse.json({
    summary: data?.summary_text ?? '',
    answers: data?.answers ?? null,
    submitted: !!data?.submitted_at,
  });
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Check the answers and try again', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { error } = await ctx.db.from('plan_preferences').upsert({
    plan_id: params.planId,
    user_id: ctx.user.id,
    summary_text: parsed.data.summary || null,
    answers: parsed.data.answers ?? null,
    // Having been through it counts, whatever was answered — most of the
    // questions can be skipped, and somebody who skipped them all has still
    // had their say. This is what the vote is waiting for.
    submitted_at: now,
    updated_at: now,
  }, { onConflict: 'plan_id,user_id' });

  if (error) {
    // Code and message only: the row is what this person just said they want.
    console.error('[plan preferences POST] failed', { planId: params.planId, code: error.code });
    return NextResponse.json({ error: "Couldn't save your answers — try again" }, { status: 500 });
  }

  // The last answer in: tell the whole group, once. Never fails the save —
  // the answers are what matters and they are stored.
  let everyone = false;
  try {
    const plan = ctx.plan as { id?: string; group_id: string; title?: string; type?: string; destination_style?: string };
    everyone = await announceIfEveryoneIn(ctx.db, { ...plan, id: params.planId }, ctx.user.id, pushSender());
  } catch (e) {
    console.error('[plan preferences POST] could not announce everyone in', { planId: params.planId, error: e instanceof Error ? e.message : String(e) });
  }

  return NextResponse.json({ saved: true, everyoneIn: everyone });
}
