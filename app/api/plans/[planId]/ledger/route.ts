// ─── /api/plans/[planId]/ledger — trip close-out ─────────────────────────
// GET  → per-person totals (contributions + expenses) and a minimal
//        settle-up plan ("Alex pays Sam $34.50").
// POST { description, amountCents, splitBetween[] } → log an on-trip expense.
//
// Every id here is a `users.id` UUID. `paid_by` used to hold a Clerk id while
// `split_between` held UUIDs from the member list, so the payer and the people
// splitting the bill were never the same person and settle-up was nonsense.
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { apportion, evenSplit, planShares, settleUp } from '@/lib/money';
import { planSkips } from '@/lib/participation';
import { netPaidCents } from '@/lib/refunds';

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  if (!body.description || !Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: 'description and a positive amountCents are required' }, { status: 400 });
  }

  // Default to splitting across the whole group, and reject anyone who isn't
  // in it — an unknown id would sit in the ledger owing money forever.
  const members = await groupMemberIds(ctx.db, ctx.plan.group_id as string);
  const requested: string[] = Array.isArray(body.splitBetween) && body.splitBetween.length
    ? body.splitBetween
    : members;
  const splitBetween = requested.filter(id => members.includes(id));
  if (splitBetween.length === 0) {
    return NextResponse.json({ error: 'splitBetween must name at least one group member' }, { status: 400 });
  }

  const { data, error } = await ctx.db.from('expenses').insert({
    plan_id: params.planId,
    group_id: ctx.plan.group_id,
    paid_by: ctx.user.id,
    description: body.description,
    amount_cents: Math.round(amountCents),
    split_between: splitBetween,
  }).select().single();
  console.error('[plans/planId/ledger] failed', error);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data });
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const [{ data: expenses }, { data: contributions }, { data: bookings }, skips] = await Promise.all([
    ctx.db.from('expenses').select('*').eq('plan_id', params.planId),
    ctx.db.from('contributions').select('*').eq('plan_id', params.planId).eq('status', 'succeeded'),
    ctx.db.from('bookings').select('id,price_cents,status,mode,provider').eq('plan_id', params.planId)
      .not('status', 'in', NOT_CHARGED),
    planSkips(ctx.db, params.planId),
  ]);

  const members = await groupMemberIds(ctx.db, ctx.plan.group_id as string);

  // Net balance per person, in cents: positive = is owed, negative = owes.
  const net: Record<string, number> = Object.fromEntries(members.map(id => [id, 0]));
  const add = (id: string, cents: number) => { net[id] = (net[id] || 0) + cents; };

  for (const e of expenses || []) {
    const parties: string[] = e.split_between || [];
    if (parties.length === 0) continue;
    add(e.paid_by, e.amount_cents);
    evenSplit(e.amount_cents, parties.length).forEach((share, i) => add(parties[i], -share));
  }

  // Contributions were fetched but never counted, so money already collected
  // for the trip did not reduce anyone's balance.
  //
  // Net of refunds: a share Stripe has handed back is not money in the pot,
  // and counting it would show the payer as owed money they already have.
  // netPaidCents reads a missing refunded_cents column as nothing refunded.
  const target = (contributions || []).reduce((s, c) => s + netPaidCents(c), 0);
  if (target > 0 && members.length > 0) {
    // Collected money is owed in proportion to each person's share, so
    // somebody who sat out the dinner is not down for a slice of it. With
    // nobody sitting anything out this is the even split it always was.
    const owed = planShares(chargedRows(bookings), Number(ctx.plan.budget_cents) || 0, members, skips);
    apportion(target, members.map(id => owed[id] || 0)).forEach((share, i) => add(members[i], -share));
    for (const c of contributions || []) add(c.user_id, netPaidCents(c));
  }

  return NextResponse.json({
    contributions: contributions || [],
    expenses: expenses || [],
    netBalances: net,
    settleUp: settleUp(net),
  });
}
