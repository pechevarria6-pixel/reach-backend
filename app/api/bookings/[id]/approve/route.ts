// ─── POST /api/bookings/[id]/approve — the human trigger ─────────────────
// Nothing books until this fires. On approval:
//   native lanes (hotel/flight/activity) → provider.book() executes now
//   redirect lane (events)               → returns the prefilled URL to open
//                                          in the in-app browser, where the
//                                          user's own signed-in session
//                                          completes checkout in 1–2 taps
//   concierge lane (restaurants)         → ticket moves to 'pending' for ops
// Body (optional): { note?: string }
import { NOT_CHARGED } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { PROVIDERS } from '@/lib/booking/registry';
import { appUrl } from '@/lib/app-url';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { BookingItemRequest, BookingProvider, Vertical } from '@/lib/booking/types';
import { sendBookingConfirmation } from '@/lib/email';
import { track } from '@/lib/track';

const supabase = createServerClient;

// One list for quoting and booking — see lib/booking/registry.ts.


export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Look the booking up first so we know which plan to authorize against.
  // Approval executes a real purchase, so this endpoint used to let any
  // signed-in user spend another group's money.
  const lookup = supabase();
  const { data: booking, error: fetchErr } = await lookup
    .from('bookings').select('*').eq('id', params.id).single();
  if (fetchErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;

  if (booking.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `Cannot approve a booking in status '${booking.status}'` }, { status: 409 });
  }

  // ── GATE 1: collect-then-approve ──────────────────────────────────────
  // Execution is blocked until every member's share is collected.
  // Override per-call with { skipFundingCheck: true } (e.g. solo trips).
  const body = await req.json().catch(() => ({}));
  if (body.skipFundingCheck !== true) {
    const { data: planBookings } = await db
      .from('bookings').select('price_cents,status').eq('plan_id', booking.plan_id)
      .not('status', 'in', NOT_CHARGED);
    const targetCents = (planBookings || []).reduce((s, b) => s + (b.price_cents || 0), 0);
    const { data: contribs } = await db
      .from('contributions').select('amount_cents,status').eq('plan_id', booking.plan_id);
    const collectedCents = (contribs || [])
      .filter(c => c.status === 'succeeded')
      .reduce((s, c) => s + c.amount_cents, 0);
    if (targetCents > 0 && collectedCents < targetCents) {
      return NextResponse.json({
        error: 'Plan not fully funded',
        funding: { targetCents, collectedCents, shortfallCents: targetCents - collectedCents },
      }, { status: 402 });
    }
  }

  const provider = PROVIDERS[booking.vertical as Vertical];
  const request = booking.request_payload as BookingItemRequest;

  // Who the room is under. A booking created from an itinerary has nobody
  // named on it — the bridge does not hold traveller details and should not —
  // so the person approving stands as the lead guest. They are the one
  // pressing the button and the one the confirmation goes to, and a provider
  // will not take a reservation for nobody.
  if (!request.travelers?.length) {
    const { data: approver } = await db
      .from('users').select('name, email').eq('id', ctx.user.id).maybeSingle();
    const whole = (approver?.name || '').trim();
    const [first, ...rest] = whole ? whole.split(/\s+/) : [];
    request.travelers = first
      ? [{ firstName: first, lastName: rest.join(' ') || first, email: approver?.email ?? '' } as BookingItemRequest['travelers'][number]]
      : [];
    if (!request.travelers.length) {
      console.error('[bookings/approve] nobody to book under', { bookingId: params.id, userId: ctx.user.id });
    }
  }

  // ── GATE 2: quote freshness ───────────────────────────────────────────
  // Prices drift between propose and approve. Re-quote; if the price moved
  // more than 5% or $25, surface it for re-approval instead of silently
  // charging more. Drops just proceed (and show as wins in the detail).
  if (booking.price_cents && body.acceptNewPrice !== true) {
    try {
      const fresh = await provider.quote(request);
      if (fresh.priceCents && fresh.priceCents > booking.price_cents) {
        const driftCents = fresh.priceCents - booking.price_cents;
        const driftPct = driftCents / booking.price_cents;
        if (driftCents > 2500 || driftPct > 0.05) {
          // If this does not stick, the next approval compares against the
          // old price and the rise passes through unnoticed — which is the
          // whole thing this guard exists to catch.
          const { error: drifted } = await db.from('bookings').update({
            price_cents: fresh.priceCents,
            detail: `${booking.detail} · price rose $${(driftCents / 100).toFixed(2)} since proposal`,
            updated_at: new Date().toISOString(),
          }).eq('id', params.id);
          if (drifted) console.error('[approve] could not record a price rise', { bookingId: params.id, code: drifted.code });
          void track(db, 'quote_drift', {
            userId: ctx.user.id, planId: String(booking.plan_id),
            props: {
              delta_cents: driftCents,
              vertical: String(booking.vertical),
              provider: String(booking.provider ?? 'none'),
            },
          });

          return NextResponse.json({
            error: 'Price changed since proposal — re-approve to accept',
            oldPriceCents: booking.price_cents,
            newPriceCents: fresh.priceCents,
            reapproveWith: { acceptNewPrice: true },
          }, { status: 409 });
        }
      }
    } catch { /* quote refresh is best-effort; proceed on failure */ }
  }

  void track(db, 'booking_approved', {
    userId: ctx.user.id, planId: String(booking.plan_id),
    props: { vertical: String(booking.vertical), price_cents: Number(booking.price_cents || 0) },
  });

  try {
    const result = await provider.book(request);
    void track(db, result.status === 'failed' ? 'booking_failed' : 'booking_confirmed', {
      userId: ctx.user.id, planId: String(booking.plan_id),
      props: {
        vertical: String(result.vertical),
        provider: String(result.provider ?? 'none'),
        // The status matters as much as the fact: `redirected` is handed
        // over, not booked, and a funnel that conflates them overstates.
        outcome: String(result.status),
        price_cents: Number(result.priceCents || booking.price_cents || 0),
      },
    });
    const { data: updated, error: updErr } = await db
      .from('bookings')
      .update({
        status: result.status,               // confirmed | pending | redirected | failed
        provider_ref: result.providerRef || booking.provider_ref,
        redirect_url: result.redirectUrl || booking.redirect_url,
        price_cents: result.priceCents ?? booking.price_cents,
        detail: result.detail || booking.detail,
        response_payload: result.raw || booking.response_payload,
        error: result.error || null,
        approved_by: ctx.user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single();
    if (updErr) {
      console.error('[approve] booking update failed', updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // Nothing told anyone their booking had happened. The template for this
    // has existed since the first version and was never called from anywhere.
    if (result.status === 'confirmed') {
      const [{ data: person }, { data: plan }] = await Promise.all([
        db.from('users').select('email').eq('id', ctx.user.id).maybeSingle(),
        db.from('plans').select('title').eq('id', booking.plan_id).maybeSingle(),
      ]);
      if (person?.email) {
        const base = appUrl(req);
        // Best-effort: a mail failure must not turn a successful booking into
        // an error the caller has to interpret.
        const mail = await sendBookingConfirmation(person.email, {
          planTitle: plan?.title || 'your trip',
          items: [{
            label: updated.vertical ? `${updated.vertical[0].toUpperCase()}${updated.vertical.slice(1)}` : 'Booking',
            detail: result.detail || updated.detail || null,
            confirmation: result.providerRef || updated.provider_ref || null,
          }],
          url: `${base.replace(/\/$/, '')}/home`,
        });
        if (!mail.sent) console.error('[approve] confirmation email not sent', mail);
      }
    }

    // ── The plan itself ───────────────────────────────────────────────
    // Every booking on this trip had been actioned and the plan still said
    // "planning". The screen announced "You're all booked!" over a record
    // that disagreed with it, and nothing else — a reminder, a group's list,
    // an email — could tell a booked trip from one still being argued over.
    //
    // A trip is booked when nothing is left awaiting approval, nothing
    // failed, and at least one booking actually came back confirmed. A
    // concierge ticket sitting at 'pending' does not block that: somebody is
    // holding the reservation, which is what the lane means. Anything failed
    // keeps the plan where it is, because it is not booked.
    const { data: siblings, error: siblingError } = await db
      .from('bookings').select('status').eq('plan_id', booking.plan_id);
    if (siblingError) {
      console.error('[approve] could not read the plan\'s other bookings', { planId: booking.plan_id, error: siblingError.message });
    } else {
      const states = (siblings ?? []).map(b => b.status);
      const settled = states.length > 0
        && !states.includes('awaiting_approval')
        && !states.includes('failed')
        && states.some(st => st === 'confirmed' || st === 'redirected');
      if (settled && ctx.plan.status !== 'booked') {
        const { error: planError } = await db.from('plans')
          .update({ status: 'booked', booked_at: new Date().toISOString() })
          .eq('id', booking.plan_id);
        if (planError) console.error('[approve] could not mark the plan booked', { planId: booking.plan_id, error: planError.message });
      }
    }

    return NextResponse.json({ booking: updated, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Execution failed';
    // A booking that fails at the provider is the single most expensive thing
    // to debug after the fact, and it left no trace at all.
    console.error('[approve] provider execution failed', { bookingId: params.id, msg });
    // A booking that failed and does not say so reads as still awaiting
    // approval, so somebody approves it again and the provider is asked to
    // book the same thing twice.
    const { error: notMarked } = await db.from('bookings').update({
      status: 'failed', error: msg,
      approved_by: ctx.user.id, approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', params.id);
    if (notMarked) console.error('[approve] a failed booking could not be marked failed', { bookingId: params.id, code: notMarked.code });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
