// ─── /api/plans/[planId]/participation — who's in for what ──────────────
// Flights and somewhere to sleep are the trip. A dinner, a show or a day out
// is something one person can sit out, and when they do, its cost is shared
// among the people going instead of charged to somebody who stayed in.
//
// GET  → the optional bookings, how many are going to each, and what that
//        leaves you paying — the same figure checkout charges, from the same
//        function.
// POST { itemRef, optOut, confirm? } → sit one out, or come back in. A
//        flight is one too: "I'll drive / already have a flight" takes that
//        person off it while nobody holds a seat on it — proposed, or held
//        back with Hold (lib/participation.ts optOutRefusal). The last
//        person off a flight takes the flight off the plan (lastOut) — for
//        everybody, so it is said first (409 needsConfirm, DROP_WARNING) and
//        done only with `confirm`. It is not the end of the flight: until
//        anybody pays, "I'm flying" on it puts it back, with its lines.
//
// A flight's fare is for the seats it was quoted for. Until checkout prices
// it again for whoever is still flying, what a flyer reads here is the
// quote's own per-seat price times the seats now flying — said as an
// estimate (`repriced`) — not the old party's fare split among fewer.
//
// Shares lock the moment anybody on the plan pays. Moving them after money has
// moved leaves one person overpaid and another short, and Reach does not hold
// money to even that out.
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePlanMember, groupMemberIds, isFail } from '@/lib/auth';
import { evenSplit, planShares } from '@/lib/money';
import {
  readSkips, readTimedSkips, memberJoins, joinedLate, partySize, canOptOut, optOutRefusal, lastOut, flightNow, FLIGHT_OPEN,
  droppedFlight, wouldDropFlight, DROP_WARNING, type DroppedFlight,
} from '@/lib/participation';
import { partyFor } from '@/lib/booking/resize';
import { nobodyFlyingLine, flightOnlyLine } from '@/lib/away-lines';
import { itemFromRow } from '@/lib/contracts/itinerary-item';

const Schema = z.object({ itemRef: z.string().uuid(), optOut: z.boolean(), confirm: z.boolean().nullish() });

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
    const [bookingsRes, heldRes, droppedRes, memberIds, { skips, ready }, locked, timed, joins, party] = await Promise.all([
      ctx.db.from('bookings')
        .select('id, vertical, detail, price_cents, status, mode, provider, request_payload')
        .eq('plan_id', params.planId)
        .not('status', 'in', NOT_CHARGED)
        .order('created_at', { ascending: true }),
      // And a flight held back with Hold: in nobody's total (NOT_CHARGED)
      // until it is let go, and a driver can still come off it.
      ctx.db.from('bookings')
        .select('id, vertical, detail, price_cents, status, mode, provider, request_payload')
        .eq('plan_id', params.planId).eq('vertical', 'flight').eq('status', 'quoted')
        .order('created_at', { ascending: true }),
      // And a flight taken off because nobody was flying: still listed, so
      // "I'm flying" can put it back (lib/participation.ts droppedFlight).
      ctx.db.from('bookings')
        .select('id, vertical, detail, price_cents, status, mode, provider, request_payload')
        .eq('plan_id', params.planId).eq('vertical', 'flight').eq('status', 'cancelled')
        .order('created_at', { ascending: true }),
      groupMemberIds(ctx.db, ctx.plan.group_id),
      readSkips(ctx.db, params.planId),
      anyonePaid(ctx.db, params.planId),
      readTimedSkips(ctx.db, params.planId),
      // Unreadable is not "nobody joined late": then nobody off a flight is
      // told why (joinedLate null), rather than told they are driving.
      memberJoins(ctx.db, String(ctx.plan.group_id)).catch(() => null),
      partySize(ctx.db, ctx.plan),
    ]);
    if (bookingsRes.error) throw new Error(bookingsRes.error.message);
    if (heldRes.error) console.error('[participation] could not read the held flights', { planId: params.planId, code: heldRes.error.code });
    if (droppedRes.error) console.error('[participation] could not read the flights taken off', { planId: params.planId, code: droppedRes.error.code });
    // Nowhere to keep who is going yet, so there is nothing to show.
    if (!ready) return NextResponse.json({ ready: false });

    const chargedNow = chargedRows(bookingsRes.data);
    const live = [...chargedNow, ...chargedRows(heldRes.error ? [] : heldRes.data)];
    const me = ctx.user.id;
    const now = new Map(live.map(b => [String(b.id), flightNow(b, partyFor(party, memberIds, skips, String(b.id)))]));
    // Exactly the rows funding charges, at what they cost the people on them now.
    const charged = chargedNow.map(b => ({ ...b, price_cents: now.get(String(b.id))!.priceCents }));
    const shares = planShares(charged, Number(ctx.plan.budget_cents) || 0, memberIds, skips);

    const items = live
      .filter(b => canOptOut(b.vertical) && (b.price_cents || 0) > 0)
      .map(b => {
        const ref = String(b.id);
        const out = new Set(skips.filter(s => s.ref === ref).map(s => s.userId));
        const going = memberIds.filter(id => !out.has(id));
        const mine = going.indexOf(me);
        const held = b.status === 'quoted';
        const { priceCents, repriced } = now.get(ref)!;
        const myRow = timed.find(s => s.ref === ref && s.userId === me);
        return {
          ref,
          title: titleOf(b),
          dropped: false,
          vertical: b.vertical,
          // A flight's seats can only be given up while nobody holds them.
          open: b.vertical !== 'flight' || FLIGHT_OPEN.has(String(b.status)),
          priceCents,
          inCount: going.length,
          imIn: mine >= 0,
          // Held back with Hold: in nobody's total until it is let go.
          held,
          // Priced for more seats than are flying; checkout quotes it again.
          repriced,
          // Off a flight because they joined after its seats were booked —
          // not because they said they were driving (lib/participation.ts).
          // Null when when they joined could not be read: neither is said.
          joinedLate: mine < 0 && !!myRow ? (joins ? joinedLate(myRow, joins.get(me)) : null) : false,
          // What this one costs you as things stand. The total below is the
          // exact figure; this is per item, for deciding.
          myCents: mine >= 0 && !held ? evenSplit(priceCents, going.length)[mine] : 0,
        };
      });

    // Taken off because nobody was flying. Nobody is on it and nobody pays
    // for it; it is here for the way back — "I'm flying", until anybody pays.
    const offPlan = (droppedRes.error ? [] : droppedRes.data ?? [])
      .filter(b => droppedFlight(b))
      .map(b => ({
        ref: String(b.id), title: titleOf(b), vertical: b.vertical, dropped: true,
        open: true, priceCents: 0, inCount: 0, imIn: false, held: false, repriced: false,
        joinedLate: false, myCents: 0,
      }));

    return NextResponse.json({
      ready: true,
      items: [...items, ...offPlan],
      yourShare_cents: shares[me] ?? 0,
      // Some of it is a flight awaiting its new fare: an estimate till then.
      estimate: items.some(i => i.repriced && i.imIn),
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
  const { itemRef, optOut, confirm } = parsed.data;
  const me = ctx.user.id;

  const { data: booking } = await ctx.db
    .from('bookings').select('id, vertical, status, itinerary_item_id, request_payload')
    .eq('id', itemRef).eq('plan_id', params.planId).maybeSingle();
  // "I'm flying" on a flight taken off because nobody was: it comes back.
  const off = booking ? droppedFlight(booking) : null;
  if (booking && off && !optOut) {
    if (await anyonePaid(ctx.db, params.planId)) {
      return NextResponse.json({ error: "Someone has already paid, so who's in for what is set now." }, { status: 409 });
    }
    try {
      const back = await reopenFlight(ctx.db, params.planId, booking, off, me);
      return NextResponse.json({
        ok: true, flightBack: true,
        notice: "You're flying — the flight is back on the plan. Checkout prices it for whoever is flying.",
        items: back,
      });
    } catch (e) {
      console.error('[participation] could not put the flight back', { planId: params.planId, itemRef, error: e instanceof Error ? e.message : e });
      return NextResponse.json({ error: "That didn't save — try again." }, { status: 500 });
    }
  }
  if (!booking || ['failed', 'cancelled'].includes(booking.status)) {
    return NextResponse.json({ error: "That isn't part of this plan" }, { status: 404 });
  }
  // Enforced here, not only by which buttons the screen shows.
  const refused = optOutRefusal({
    vertical: booking.vertical, status: booking.status,
    anyonePaid: await anyonePaid(ctx.db, params.planId),
  });
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });

  let dropped: Record<string, unknown> | null = null;
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
      // last person in cannot leave it — except a flight (lastOut).
      const out = new Set(skips.filter(s => s.ref === itemRef).map(s => s.userId));
      const wasOff = out.has(me);
      out.add(me);
      if (memberIds.every(id => out.has(id))) {
        const last = lastOut(booking.vertical);
        if (last.action === 'refuse') return NextResponse.json({ error: last.error }, { status: 409 });
      }
      // It ends the flight for everybody: said before it happens, never as
      // a surprise after one tap that read like coming off alone.
      if (wouldDropFlight(booking.vertical, memberIds, out) && !confirm) {
        return NextResponse.json({ error: DROP_WARNING, needsConfirm: true, warning: DROP_WARNING }, { status: 409 });
      }
      const { error } = await ctx.db.from('item_optouts').upsert(
        { plan_id: params.planId, item_ref: itemRef, user_id: me },
        { onConflict: 'plan_id,item_ref,user_id' },
      );
      if (error) throw new Error(error.message);

      // Decided on what is written, not on what was read: two people coming
      // off at once each read the other as still flying, and the flight
      // stayed on for nobody.
      if (booking.vertical === 'flight') {
        const after = await readSkips(ctx.db, params.planId);
        const offNow = new Set(after.skips.filter(s => s.ref === itemRef).map(s => s.userId));
        if (wouldDropFlight(booking.vertical, memberIds, offNow) && !confirm) {
          // Two at once, each read the other as flying, and neither was
          // asked. Their own row comes back off and they are asked first.
          if (!wasOff) {
            const { error: undoErr } = await ctx.db.from('item_optouts').delete()
              .eq('plan_id', params.planId).eq('item_ref', itemRef).eq('user_id', me);
            if (undoErr) console.error('[participation] could not take back an unconfirmed last opt-out', { planId: params.planId, itemRef, code: undoErr.code });
          }
          return NextResponse.json({ error: DROP_WARNING, needsConfirm: true, warning: DROP_WARNING }, { status: 409 });
        }
        if (wouldDropFlight(booking.vertical, memberIds, offNow)) {
          dropped = await dropFlight(ctx.db, params.planId, booking, memberIds.length <= 1);
          if (!dropped.ok) {
            // It moved on under us (somebody is booking it now): this person
            // is not off a flight being bought, so their row goes too.
            const { error: undoErr } = await ctx.db.from('item_optouts').delete()
              .eq('plan_id', params.planId).eq('item_ref', itemRef).eq('user_id', me);
            if (undoErr) console.error('[participation] could not put them back on a flight being booked', { planId: params.planId, itemRef, code: undoErr.code });
            return NextResponse.json({ error: String(dropped.error) }, { status: Number(dropped.status) || 409 });
          }
        }
      }
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

  if (dropped) {
    return NextResponse.json({
      ok: true, flightOff: true,
      notice: "Nobody's flying now, so the flight is off the plan and nobody is charged for it.",
      ...(dropped.item ? { item: dropped.item } : {}),
      // The car and transfers from the airport, off with the flight.
      removed: Array.isArray(dropped.removed) ? dropped.removed : [],
    });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Nobody is on the flight any more: the booking is cancelled — only while it
 * is still open, so a flight somebody started booking a moment ago is never
 * cancelled from here — and its line says nobody is flying, so checkout has
 * no flight to quote again. The rental car from the airport and the airport
 * transfers come off with it: nobody lands there.
 *
 * What it was is kept on the booking (`nobody_flying`, droppedFlight): the
 * record a rebuild reads to keep it off, and what "I'm flying" puts back.
 *
 * Two last flyers at once: the second finds it already taken off. That is
 * what they asked for, so it is an answer, not a 409 that took their row back.
 */
async function dropFlight(
  db: SupabaseClient, planId: string,
  booking: { id: string; status: string; itinerary_item_id?: string | null; request_payload?: unknown }, solo: boolean,
): Promise<Record<string, unknown>> {
  if (!FLIGHT_OPEN.has(String(booking.status))) {
    return { ok: false, status: 409, error: 'This flight is already being booked or is booked, so who is flying is set now.' };
  }
  const [lineRes, plansLines] = await Promise.all([
    booking.itinerary_item_id
      ? db.from('itinerary_items').select('*').eq('id', booking.itinerary_item_id).eq('plan_id', planId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('itinerary_items').select('*').eq('plan_id', planId).eq('type', 'transport'),
  ]);
  if (lineRes.error) throw new Error(lineRes.error.message);
  if (plansLines.error) throw new Error(plansLines.error.message);
  const removed = (plansLines.data ?? []).filter(r => flightOnlyLine(r));
  const was = lineRes.data as Record<string, unknown> | null;
  const record: DroppedFlight = {
    from: String(booking.status),
    item_id: booking.itinerary_item_id ?? null,
    line: was ? {
      type: was.type, title: was.title, subtitle: was.subtitle, cost_cents: was.cost_cents,
      booking_mode: was.booking_mode ?? null, payment_note: was.payment_note ?? null,
      scheduled_time: was.scheduled_time ?? null,
    } : null,
    removed,
    at: new Date().toISOString(),
  };
  const payload = booking.request_payload && typeof booking.request_payload === 'object'
    ? booking.request_payload as Record<string, unknown> : {};
  const { data: gone, error } = await db.from('bookings')
    .update({
      status: 'cancelled', itinerary_item_id: null, updated_at: new Date().toISOString(),
      request_payload: { ...payload, nobody_flying: record },
    })
    .eq('id', booking.id).eq('status', booking.status)
    .select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!gone) {
    const { data: now } = await db.from('bookings').select('id, vertical, status, request_payload')
      .eq('id', booking.id).eq('plan_id', planId).maybeSingle();
    if (now && droppedFlight(now)) return { ok: true, item: null, already: true };
    return { ok: false, status: 409, error: 'This flight changed while you were looking — reopen the plan.' };
  }
  console.log('[participation] nobody is flying — the flight is off the plan', { planId, booking: booking.id, removed: removed.length });

  if (removed.length) {
    const { error: rmErr } = await db.from('itinerary_items').delete()
      .eq('plan_id', planId).in('id', removed.map(r => String(r.id)));
    if (rmErr) console.error('[participation] the flight is off and the car or transfers from the airport are still on the plan', { planId, code: rmErr.code });
  }

  if (!booking.itinerary_item_id) return { ok: true, item: null };
  const line = nobodyFlyingLine(solo);
  const { data: row, error: lineErr } = await db.from('itinerary_items')
    .update({
      type: line.type, title: line.title, subtitle: line.subtitle, cost_cents: 0,
      booking_mode: line.booking_mode, payment_note: line.payment_note,
    })
    .eq('id', booking.itinerary_item_id).eq('plan_id', planId)
    .select('*').maybeSingle();
  if (lineErr) {
    // The flight is cancelled either way, so nobody is charged for it; the
    // line still reading "Round-trip flights" is what this log is for.
    console.error('[participation] the flight is off and its line still names it', { planId, item: booking.itinerary_item_id, code: lineErr.code });
    return { ok: true, item: null };
  }
  return { ok: true, item: row ? itemFromRow(row) : null, removed: removed.map(r => String(r.id)) };
}

/**
 * "I'm flying" on a flight taken off because nobody was: the booking opens
 * again as it was, its line names the flight again, and the car and
 * transfers it took come back. Everyone who came off it is still off; this
 * person is on, and checkout prices it for whoever is flying (flightNow).
 *
 * Two at once: the second finds it open already, and is simply back on.
 * Returns the lines as they now read, for the screen.
 */
async function reopenFlight(
  db: SupabaseClient, planId: string,
  booking: { id: string; request_payload?: unknown }, off: DroppedFlight, me: string,
): Promise<unknown[]> {
  const payload = { ...(booking.request_payload as Record<string, unknown>) };
  delete payload.nobody_flying;

  // The flight's own line: the one it had, else the nobody-flying line a
  // rebuild wrote in its place, else a new one from what it said.
  let itemId: string | null = null;
  if (off.item_id) {
    const { data } = await db.from('itinerary_items').select('id').eq('id', off.item_id).eq('plan_id', planId).maybeSingle();
    if (data) itemId = String(data.id);
  }
  if (!itemId) {
    const { data } = await db.from('itinerary_items').select('id, title').eq('plan_id', planId).eq('type', 'transport');
    const titles = new Set([nobodyFlyingLine(false).title, nobodyFlyingLine(false, false).title, nobodyFlyingLine(true).title]);
    const held = (data ?? []).find(r => titles.has(String(r.title)));
    if (held) itemId = String(held.id);
  }

  const { data: back, error } = await db.from('bookings')
    .update({ status: off.from, itinerary_item_id: itemId, request_payload: payload, updated_at: new Date().toISOString() })
    .eq('id', booking.id).eq('status', 'cancelled')
    .select('id').maybeSingle();
  if (error) throw new Error(error.message);

  const lines: unknown[] = [];
  if (back) {
    console.log('[participation] somebody is flying — the flight is back on the plan', { planId, booking: booking.id });
    const line = off.line ?? { type: 'flight', title: 'Round-trip flights', subtitle: 'Priced live at Lock it in.', cost_cents: 0, booking_mode: 'reach', payment_note: null };
    const fields = {
      type: line.type, title: line.title, subtitle: line.subtitle ?? null, cost_cents: Number(line.cost_cents) || 0,
      booking_mode: line.booking_mode ?? null, payment_note: line.payment_note ?? null,
    };
    const { data: row, error: lineErr } = itemId
      ? await db.from('itinerary_items').update(fields).eq('id', itemId).eq('plan_id', planId).select('*').maybeSingle()
      : await db.from('itinerary_items').insert({ ...fields, plan_id: planId, scheduled_time: line.scheduled_time ?? 'Before you go' }).select('*').maybeSingle();
    if (lineErr) console.error('[participation] the flight is back and its line does not say so', { planId, code: lineErr.code });
    if (row) {
      lines.push(itemFromRow(row));
      if (!itemId) {
        const { error: linkErr } = await db.from('bookings').update({ itinerary_item_id: row.id }).eq('id', booking.id);
        if (linkErr) console.error('[participation] the flight is back without its line', { planId, code: linkErr.code });
      }
    }
    if (off.removed.length) {
      const { data: restored, error: rErr } = await db.from('itinerary_items').upsert(off.removed, { onConflict: 'id' }).select('*');
      if (rErr) console.error('[participation] the flight is back and the car or transfers are not', { planId, code: rErr.code });
      for (const r of restored ?? []) lines.push(itemFromRow(r));
    }
  }

  const { error: delErr } = await db.from('item_optouts').delete()
    .eq('plan_id', planId).eq('item_ref', booking.id).eq('user_id', me);
  if (delErr) throw new Error(delErr.message);
  return lines;
}
