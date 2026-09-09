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
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DAY = 86400000;
const periodsBetween = (start: string, end: string, cadence: string) => {
  const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / DAY));
  const len = cadence === 'monthly' ? 30 : cadence === 'biweekly' ? 14 : 7;
  return Math.max(1, Math.floor(days / len));
};

async function planShareCents(planId: string): Promise<number> {
  const db = supabase();
  const { data: bookings } = await db
    .from('bookings').select('price_cents,status').eq('plan_id', planId)
    .not('status', 'in', '("failed","cancelled")');
  const total = (bookings || []).reduce((s, b) => s + (b.price_cents || 0), 0);
  if (total > 0) {
    const { data: goals } = await db.from('savings_goals').select('user_id').eq('plan_id', planId);
    const heads = Math.max(1, new Set((goals || []).map(g => g.user_id)).size);
    return Math.ceil(total / heads);
  }
  // Fall back to the plan's stated budget if nothing is priced yet
  const { data: plan } = await db.from('plans').select('budget_cents').eq('id', planId).single();
  return plan?.budget_cents || 0;
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.targetDate) return NextResponse.json({ error: 'targetDate required (YYYY-MM-DD)' }, { status: 400 });

  const cadence = ['weekly', 'biweekly', 'monthly'].includes(body.cadence) ? body.cadence : 'weekly';
  const targetCents = Number(body.targetCents) || await planShareCents(params.planId);
  if (!targetCents) return NextResponse.json({ error: 'No target — price the plan or pass targetCents' }, { status: 400 });

  const start = new Date().toISOString().split('T')[0];
  const periods = periodsBetween(start, body.targetDate, cadence);
  const perPeriodCents = Math.ceil(targetCents / periods);

  const { data, error } = await supabase().from('savings_goals').upsert({
    plan_id: params.planId,
    group_id: body.groupId || null,
    user_id: userId,
    target_cents: targetCents,
    start_date: start,
    target_date: body.targetDate,
    cadence,
    per_period_cents: perPeriodCents,
  }, { onConflict: 'plan_id,user_id' }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    goal: data,
    schedule: `$${(perPeriodCents / 100).toFixed(2)} ${cadence} for ${periods} periods → $${(targetCents / 100).toFixed(2)} by ${body.targetDate}`,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  if (!amountCents || amountCents <= 0) return NextResponse.json({ error: 'amountCents required' }, { status: 400 });

  const db = supabase();
  const { data: goal } = await db.from('savings_goals')
    .select('id').eq('plan_id', params.planId).eq('user_id', userId).single();
  if (!goal) return NextResponse.json({ error: 'No goal yet — POST to create one' }, { status: 404 });

  const { data, error } = await db.from('savings_checkins')
    .insert({ goal_id: goal.id, amount_cents: amountCents, note: body.note || null })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ checkin: data });
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = supabase();

  const { data: goals } = await db.from('savings_goals')
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
      pctComplete: Math.round((saved / g.target_cents) * 100),
    };
  });

  const mine = members.find(m => m.userId === userId) || null;

  // Affordability guardrail: my target vs my stated comfort zone.
  let affordability: { flag: string; message: string } | null = null;
  if (mine) {
    const { data: me } = await db.from('users').select('budget_range').eq('id', userId).single();
    const ceilings: Record<string, number> = { budget: 100000, mid: 350000, luxury: 1000000 };
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
