// ─── POST /api/plans/[planId]/celebrated — the booked moment, once ───────
// The celebration is for one moment: the last booking on the trip coming
// back confirmed. It must not come again after a refresh or on a second
// phone, so whether this person has seen it is held here, not in the
// browser — a once-only claim in audit_logs, keyed on plan and person
// (claimOnceOutcome in lib/everyone-in.ts).
//
// → 200 { first: true }    show it: this is the first time for this person
// → 200 { first: false }   already shown, here or on another device
// → 409 { first: false, reason: 'not_all_booked' }
//       the rows do not say every booking is confirmed, so nothing is spent:
//       a screen that asked too early cannot use up the one celebration on
//       a trip that still has a gap in it (celebrationDue, lib/wallet.ts)
// → 503 the claim could not be read or written; nothing to show
//
// A double tap is two requests at once. Both insert, both read back the
// earliest row, and only the one that wrote it answers first: true.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { claimOnceOutcome } from '@/lib/everyone-in';
import { readSkips, partySize } from '@/lib/participation';
import { itemFromRow, ITEM_COLUMNS } from '@/lib/contracts/itinerary-item';
import { celebrationDue, type CelebrationInput } from '@/lib/wallet';

const CELEBRATED_ACTION = 'celebrated_booked';

export async function POST(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;
  const plan = ctx.plan as { id: string; status?: string | null; group_id?: unknown; solo_mode?: boolean | null };

  if (plan.status === 'cancelled') {
    return NextResponse.json({ first: false, reason: 'not_all_booked' }, { status: 409 });
  }

  const [{ data: bookings, error: bErr }, { data: rows, error: iErr }] = await Promise.all([
    db.from('bookings').select('*').eq('plan_id', params.planId),
    db.from('itinerary_items').select(ITEM_COLUMNS).eq('plan_id', params.planId).order('sort_order'),
  ]);
  if (bErr || iErr) {
    console.error('[celebrated] could not read the plan', { planId: params.planId, bookings: bErr?.code, items: iErr?.code });
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 503 });
  }

  let skips: CelebrationInput['skips'];
  try {
    skips = (await readSkips(db, params.planId)).skips;
  } catch {
    return NextResponse.json({ error: 'Could not read this trip just now.' }, { status: 503 });
  }

  const lines = ((rows ?? []) as unknown as Record<string, unknown>[]).flatMap(r => {
    try { return [itemFromRow(r)]; } catch { return []; }
  });
  const due = celebrationDue({
    bookings: (bookings ?? []) as CelebrationInput['bookings'],
    lines, skips,
    memberCount: await partySize(db, plan),
  });
  if (!due) return NextResponse.json({ first: false, reason: 'not_all_booked' }, { status: 409 });

  const outcome = await claimOnceOutcome(db, params.planId, ctx.user.id, CELEBRATED_ACTION, `${params.planId}:${ctx.user.id}`);
  if (outcome === 'error') {
    console.error('[celebrated] the once-only claim could not be read or written', { planId: params.planId });
    return NextResponse.json({ error: 'Could not check that just now.' }, { status: 503 });
  }
  return NextResponse.json({ first: outcome === 'first' });
}
