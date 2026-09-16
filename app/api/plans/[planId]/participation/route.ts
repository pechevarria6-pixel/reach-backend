// ─── /api/plans/[planId]/participation — who's in for what ──────────────
// Flights and somewhere to sleep are the trip. A dinner, a show or a day out
// is something one person can sit out, and when they do, its cost is shared
// among the people going instead of charged to somebody who stayed in.
//
// GET  → the optional bookings, how many are going to each, and what that
//        leaves you paying — the same figure checkout charges, from the same
//        function.
// POST { itemRef, optOut } → sit one out, or come back in.
//
// Shares lock the moment anybody on the plan pays. Moving them after money has
// moved leaves one person overpaid and another short, and Reach does not hold
// money to even that out.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { canSkip, evenSplit, planShares } from '@/lib/money';
import { readSkips } from '@/lib/participation';

const Schema = z.object({ itemRef: z.string().uuid(), optOut: z.boolean() });

const FALLBACK_TITLE: Record<string, string> = { activity: 'Activity', event: 'Event', restaurant: 'Dinner' };

/** A booking's name as people know it. `detail` is JSON on some rows and prose on others. */
function titleOf(b: { vertical: string; detail: unknown }): string {
  let detail: unknown = b.detail;
  if (typeof b.detail === 'string') {
    const text = b.detail;
    try {
      detail = JSON.parse(text);
    } catch {
      return text.trim().slice(0, 80) || FALLBACK_TITLE[b.vertical] || 'Booking';
    }
  }
  const name = detail && typeof detail === 'object'
    ? (detail as { title?: unknown; name?: unknown }).title ?? (detail as { name?: unknown }).name
    : null;
  return (typeof name === 'string' && name.trim()) || FALLBACK_TITLE[b.vertical] || 'Booking';
}

async function anyonePaid(db: SupabaseClient, planId: string): Promise<boolean> {
  const { data, error } = await db
    .from('contributions').select('id').eq('plan_id', planId).eq('status', 'succeeded').limit(1);
  // Unknown is treated as paid: the safe answer for a lock is "locked".
  if (error) {
    console.error('[participation] could not check payments', { planId, error: error.message });
    return true;
  }
  return !!data?.length;
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  try {
    const [bookingsRes, memberIds, { skips, ready }, locked] = await Promise.all([
      ctx.db.from('bookings')
        .select('id, vertical, detail, price_cents, status')
        .eq('plan_id', params.planId)
        .not('status', 'in', '("failed","cancelled")')
        .order('created_at', { ascending: true }),
      groupMemberIds(ctx.db, ctx.plan.group_id),
      readSkips(ctx.db, params.planId),
      anyonePaid(ctx.db, params.planId),
    ]);
    if (bookingsRes.error) throw new Error(bookingsRes.error.message);
    // Nowhere to keep who is going yet, so there is nothing to show.
    if (!ready) return NextResponse.json({ ready: false });

    const bookings = bookingsRes.data || [];
    const me = ctx.user.id;
    const shares = planShares(bookings, Number(ctx.plan.budget_cents) || 0, memberIds, skips);

    const items = bookings
      .filter(b => canSkip(b.vertical) && (b.price_cents || 0) > 0)
      .map(b => {
        const ref = String(b.id);
        const out = new Set(skips.filter(s => s.ref === ref).map(s => s.userId));
        const going = memberIds.filter(id => !out.has(id));
        const mine = going.indexOf(me);
        return {
          ref,
          title: titleOf(b),
          vertical: b.vertical,
          priceCents: b.price_cents || 0,
          inCount: going.length,
          imIn: mine >= 0,
          // What this one costs you as things stand. The total below is the
          // exact figure; this is per item, for deciding.
          myCents: mine >= 0 ? evenSplit(b.price_cents || 0, going.length)[mine] : 0,
        };
      });

    return NextResponse.json({
      ready: true,
      items,
      yourShare_cents: shares[me] ?? 0,
      locked,
      travellers: memberIds.length,
    });
  } catch (e) {
    console.error('[participation] could not load', { planId: params.planId, error: e instanceof Error ? e.message : e });
    return NextResponse.json({ error: 'Could not load who is in for what' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'itemRef and optOut are required' }, { status: 400 });
  }
  const { itemRef, optOut } = parsed.data;
  const me = ctx.user.id;

  const { data: booking } = await ctx.db
    .from('bookings').select('id, vertical, status')
    .eq('id', itemRef).eq('plan_id', params.planId).maybeSingle();
  if (!booking || ['failed', 'cancelled'].includes(booking.status)) {
    return NextResponse.json({ error: "That isn't part of this plan" }, { status: 404 });
  }
  // Enforced here, not only by which buttons the screen shows.
  if (!canSkip(booking.vertical)) {
    return NextResponse.json({ error: "Everyone's in for getting there and somewhere to stay." }, { status: 400 });
  }
  if (await anyonePaid(ctx.db, params.planId)) {
    return NextResponse.json({ error: "Someone has already paid, so who's in for what is set now." }, { status: 409 });
  }

  try {
    if (optOut) {
      const [memberIds, { skips, ready }] = await Promise.all([
        groupMemberIds(ctx.db, ctx.plan.group_id),
        readSkips(ctx.db, params.planId),
      ]);
      if (!ready) {
        // Not a fault in the request: sql/preferences-v1.sql has not been run
        // on this deployment. Said plainly here so it is one line to diagnose.
        console.error('[participation] item_optouts is missing — run sql/preferences-v1.sql', { planId: params.planId });
        return NextResponse.json({ error: 'Sitting things out is not switched on yet.' }, { status: 503 });
      }
      // A booking nobody is going to still gets paid for, by everybody, so the
      // last person in cannot leave it.
      const out = new Set(skips.filter(s => s.ref === itemRef).map(s => s.userId));
      out.add(me);
      if (memberIds.every(id => out.has(id))) {
        return NextResponse.json({ error: 'Someone has to be in for this one.' }, { status: 409 });
      }
      const { error } = await ctx.db.from('item_optouts').upsert(
        { plan_id: params.planId, item_ref: itemRef, user_id: me },
        { onConflict: 'plan_id,item_ref,user_id' },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await ctx.db
        .from('item_optouts').delete()
        .eq('plan_id', params.planId).eq('item_ref', itemRef).eq('user_id', me);
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    console.error('[participation] could not save', { planId: params.planId, itemRef, error: e instanceof Error ? e.message : e });
    return NextResponse.json({ error: "That didn't save — try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
