// ─── /api/plans/[planId]/settlements — "I paid Sam back" ─────────────────
// Reach never moves money between members. This records that one of them
// says they paid another, in their own app or in cash, so the ledger counts
// it. The logic, and why a double tap cannot count twice, is in
// lib/settlements.ts.
//
// GET   → { settlements, available } — the ones this caller is on, either side.
// POST  { toUserId | fromUserId, amountCents, method, status, idempotencyKey }
//         toUserId:   the caller paid them. status 'pending' ("Sent on
//                     Venmo?", after tapping a pay button) or 'paid'
//                     ("Mark as paid").
//         fromUserId: they paid the caller. status 'paid' only ("Mark
//                     received").
//         → { settlement, replay? }; 409 { reason: 'nothing_owed' |
//           'more_than_owed', owedCents } when the screen was out of date.
// PATCH { id, status: 'paid' | 'cancelled' } → close a pending one from
//         either side, or (payee only) withdraw a paid one that never came.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { moveSettlement, mySettlements, recordSettlement, type Outcome } from '@/lib/settlements';

const send = (o: Outcome) => NextResponse.json(o.body, { status: o.status });

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  return send(await mySettlements(ctx.db, params.planId, ctx.user.id));
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  return send(await recordSettlement(ctx.db, ctx.plan, ctx.user.id, body ?? {}));
}

export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const body = await req.json().catch(() => ({}));
  return send(await moveSettlement(ctx.db, ctx.plan, ctx.user.id, body ?? {}));
}
