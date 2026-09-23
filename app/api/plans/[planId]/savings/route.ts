// ─── /api/plans/[planId]/savings — trip savings (NO CUSTODY) ─────────────
// Reach plans the money; it never holds it. Members save in their own
// accounts and log check-ins; approval-day funding (contributions) collects
// for real. FLOAT IS PINNED — no yield, no pooled funds, by design.
//
// POST  { targetCents?, targetDate, cadence? }
//        Creates my goal. targetCents defaults to my per-person share of
//        the plan's priced bookings. Computes per-period amount.
// PATCH { amountCents, note? }   → log a savings check-in
// GET   → my goal + pace, every member's pace, group readiness, and the
//         affordability guardrail vs my stated budget_range.
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { evenSplit } from '@/lib/money';
import type { SupabaseClient } from '@supabase/supabase-js';

const DAY = 86400000;
const periodsBetween = (start: string, end: string, cadence: string) => {
  const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / DAY));
  const len = cadence === 'monthly' ? 30 : cadence === 'biweekly' ? 14 : 7;
  return Math.max(1, Math.floor(days / len));
};

async function planShareCents(
  db: SupabaseClient, planId: string, groupId: string, budgetCents: number
): Promise<number> {
  const { data: bookings } = await db
    .from('bookings').select('price_cents,status,mode,provider').eq('plan_id', planId)
    .not('status', 'in', NOT_CHARGED);
  const total = chargedRows(bookings).reduce((s, b) => s + (b.price_cents || 0), 0);

  // Split across the whole group. Dividing by the number of savings_goals rows
  // meant the first member to set a goal was told to save for the entire trip,
  // and every later goal silently changed what a share was worth.
  const heads = Math.max(1, (await groupMemberIds(db, groupId)).length);
  const basis = total > 0 ? total : (budgetCents || 0);
  // Largest share, so nobody is told to save less than they may owe.
  return evenSplit(basis, heads)[0];
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  if (!body.targetDate) return NextResponse.json({ error: 'targetDate required (YYYY-MM-DD)' }, { status: 400 });

  const cadence = ['weekly', 'biweekly', 'monthly'].includes(body.cadence) ? body.cadence : 'weekly';
  const targetCents = Number(body.targetCents) || await planShareCents(
    ctx.db, params.planId, ctx.plan.group_id as string, Number(ctx.plan.budget_cents) || 0
  );
  if (!targetCents) return NextResponse.json({ error: 'No target — price the plan or pass targetCents' }, { status: 400 });

  const start = new Date().toISOString().split('T')[0];
  const periods = periodsBetween(start, body.targetDate, cadence);
  const perPeriodCents = Math.ceil(targetCents / periods);

  const { data, error } = await ctx.db.from('savings_goals').upsert({
    plan_id: params.planId,
    group_id: ctx.plan.group_id,
    user_id: ctx.user.id,
    target_cents: targetCents,
    start_date: start,
    target_date: body.targetDate,
    cadence,
    per_period_cents: perPeriodCents,
  }, { onConflict: 'plan_id,user_id' }).select().single();
  console.error('[plans/planId/savings] failed', error);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    goal: data,
    schedule: `$${(perPeriodCents / 100).toFixed(2)} ${cadence} for ${periods} periods → $${(targetCents / 100).toFixed(2)} by ${body.targetDate}`,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  if (!amountCents || amountCents <= 0) return NextResponse.json({ error: 'amountCents required' }, { status: 400 });

  const { data: goal } = await ctx.db.from('savings_goals')
    .select('id').eq('plan_id', params.planId).eq('user_id', ctx.user.id).maybeSingle();
  if (!goal) return NextResponse.json({ error: 'No goal yet — POST to create one' }, { status: 404 });

  const { data, error } = await ctx.db.from('savings_checkins')
    .insert({ goal_id: goal.id, amount_cents: amountCents, note: body.note || null })
    .select().single();
  console.error('[plans/planId/savings] failed', error);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ checkin: data });
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const { data: goals } = await ctx.db.from('savings_goals')
    .select('*, savings_checkins(amount_cents, created_at)').eq('plan_id', params.planId);

  const now = Date.now();
  const members = (goals || []).map(g => {
    const saved = (g.savings_checkins || []).reduce((s: number, c: { amount_cents: number }) => s + c.amount_cents, 0);
    const totalSpan = new Date(g.target_date).getTime() - new Date(g.start_date).getTime();
    const elapsed = Math.min(1, Math.max(0, (now - new Date(g.start_date).getTime()) / Math.max(totalSpan, DAY)));
    const expectedByNow = Math.round(g.target_cents * elapsed);
    const pace = saved >= g.target_cents ? 'complete'
      : saved >= expectedByNow ? (saved > expectedByNow * 1.15 ? 'ahead' : 'on_pace')
      : 'behind';
    return {
      userId: g.user_id,
      targetCents: g.target_cents,
      savedCents: saved,
      expectedByNowCents: expectedByNow,
      perPeriodCents: g.per_period_cents,
      cadence: g.cadence,
      targetDate: g.target_date,
      pace,
      pctComplete: g.target_cents > 0 ? Math.round((saved / g.target_cents) * 100) : 0,
    };
  });

  const mine = members.find(m => m.userId === ctx.user.id) || null;

  // Affordability guardrail: my target vs my stated comfort zone.
  let affordability: { flag: string; message: string } | null = null;
  if (mine) {
    // `users.id` is a UUID; this used to be queried with the Clerk id, which
    // matched nothing (and errors outright on a uuid column), so the
    // affordability guardrail never fired.
    const { data: me } = await ctx.db
      .from('users').select('budget_range').eq('id', ctx.user.id).maybeSingle();
    // Keys must match the budget_range values the quiz writes: budget/mid/premium/luxury.
    const ceilings: Record<string, number> = { budget: 100000, mid: 350000, premium: 600000, luxury: 1000000 };
    const ceiling = ceilings[me?.budget_range || 'mid'];
    if (mine.targetCents > ceiling) {
      const overPct = Math.round(((mine.targetCents - ceiling) / ceiling) * 100);
      affordability = {
        flag: 'over_comfort_zone',
        message: `This trip is ~${overPct}% above your stated ${me?.budget_range || 'mid'} comfort zone. Consider a longer savings runway or the group's lower-cost option.`,
      };
    }
  }

  const onPaceCount = members.filter(m => m.pace === 'on_pace' || m.pace === 'ahead' || m.pace === 'complete').length;
  return NextResponse.json({
    mine,
    members,
    groupReadiness: {
      onPace: onPaceCount,
      total: members.length,
      summary: members.length ? `${onPaceCount} of ${members.length} members on pace` : 'No goals yet',
    },
    affordability,
    custody: 'none — funds remain in members\u2019 own accounts until approval-day collection',
  });
}
