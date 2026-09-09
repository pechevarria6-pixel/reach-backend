// ─── /api/plans/[planId]/ledger — trip close-out ─────────────────────────
// GET  → per-person totals (contributions + expenses) and a minimal
//        settle-up plan ("Alex pays Sam $34.50").
// POST { description, amountCents, splitBetween[] } → log an on-trip expense.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.description || !body.amountCents || !Array.isArray(body.splitBetween) || body.splitBetween.length === 0) {
    return NextResponse.json({ error: 'description, amountCents, splitBetween[] required' }, { status: 400 });
  }
  const { data, error } = await supabase().from('expenses').insert({
    plan_id: params.planId,
    group_id: body.groupId || null,
    paid_by: userId,
    description: body.description,
    amount_cents: Number(body.amountCents),
    split_between: body.splitBetween,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data });
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = supabase();
  const [{ data: expenses }, { data: contributions }] = await Promise.all([
    db.from('expenses').select('*').eq('plan_id', params.planId),
    db.from('contributions').select('*').eq('plan_id', params.planId).eq('status', 'succeeded'),
  ]);

  // Net balance per person: positive = is owed money, negative = owes.
  const net: Record<string, number> = {};
  for (const e of expenses || []) {
    const share = Math.round(e.amount_cents / e.split_between.length);
    net[e.paid_by] = (net[e.paid_by] || 0) + e.amount_cents;
    for (const uid of e.split_between) net[uid] = (net[uid] || 0) - share;
  }

  // Minimal-transfer settle-up (greedy: biggest debtor pays biggest creditor)
  const debtors = Object.entries(net).filter(([, v]) => v < 0).map(([id, v]) => ({ id, amt: -v })).sort((a, b) => b.amt - a.amt);
  const creditors = Object.entries(net).filter(([, v]) => v > 0).map(([id, v]) => ({ id, amt: v })).sort((a, b) => b.amt - a.amt);
  const settleUp: { from: string; to: string; amountCents: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) settleUp.push({ from: debtors[i].id, to: creditors[j].id, amountCents: pay });
    debtors[i].amt -= pay; creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }

  return NextResponse.json({
    contributions: contributions || [],
    expenses: expenses || [],
    netBalances: net,
    settleUp,
  });
}
