// ─── POST /api/bookings/[id]/approve — the human trigger ─────────────────
// Contract:
//   200 { status, booking }
//   400 { code: 'travellers_missing', who: string[] }      names, never details
//   402 { code: 'not_funded', funding: { targetCents, collectedCents, shortfallCents, funded } }
//   409 { code: 'already_in_progress', status }             somebody else has it, or it is done
//   409 { code: 'changed' }                                 the row moved while this ran; reopen it
//   409 { code: 'price_changed', oldCents, newCents }       accept with { acceptNewPrice: true, acceptedCents: newCents }
//   409 { code: 'party_changed', quoted, now }              price it again for who is going
//   409 { code: 'unavailable', error }                      cannot be booked as it stands
//   502 { code: 'provider_failed', error }                  the provider refused; nothing was bought
//   502 { code: 'outcome_unknown', error }                  sent, and no answer: it MAY be bought
// and 401/403/404 from sign-in and lookup, 500 when our own database fails.
// Every response except 200 and outcome_unknown means nothing was bought.
//
// Body (optional): { acceptNewPrice?: true, acceptedCents: number } — only
// counts when this route has told somebody about a new price
// (bookings.pending_price_cents) and acceptedCents is that price exactly. A
// price that moved again since is answered as price_changed with the new one.
//
// Nothing books until this fires. In order:
//   1. who is on it — every member of the group except anybody sitting this
//      booking out, with their saved details, and exactly as many as it was
//      priced for;
//   2. the price — re-quoted, and a rise waits for somebody to accept it;
//   3. the money — what the group has actually paid in, net of refunds,
//      covers the total with this booking at the higher of its stored price
//      and the price just checked — and the provider is told that is the
//      most it may charge;
//   4. the claim — one conditional update on the row as it was read, so two
//      presses cannot both book and a change made meanwhile is not booked
//      over;
//   5. the provider — and only a row this claim still holds is written.
//
// Redirects (a table, a ticket, a flight handed to the airline's own site)
// skip 1 and 2: nobody's passport goes anywhere and Reach charges nothing.
import { NOT_CHARGED, chargedRows } from '@/lib/booking/charged';
import { NextRequest, NextResponse } from 'next/server';
import { PROVIDERS } from '@/lib/booking/registry';
import { appUrl } from '@/lib/app-url';
import { report } from '@/lib/report';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { isOutcomeUnknown, type BookingItemRequest, type BookingItemResult, type TravelerInfo, type Vertical } from '@/lib/booking/types';
import { readSkips } from '@/lib/participation';
import { travellersFor } from '@/lib/essentials-server';
import {
  acceptedPrice, acceptedStale, airlineOnly, fundingAt, fundingOf, isPurchase, planBooked, priceRose,
  repriceAdvice, travellersMissing, unpriced, type Person,
} from '@/lib/booking/approval';
import { partyChange } from '@/lib/booking/party';
import { atVersion, claimBooking, finishClaim, midClaim, M1 } from '@/lib/booking/claim';
import { cancelDuffelOrder } from '@/lib/booking/providers/flights.duffel';
import { sendBookingConfirmation } from '@/lib/email';
import { bookingSummary } from '@/lib/booking/summary';
import { track } from '@/lib/track';
import { reportPaidFailure } from '@/lib/paid-failure';
import { pinQuoted, termsChanged } from '@/lib/booking/pin';
import { withClaims, isMissingTable, type ContributionRow, type RefundClaim } from '@/lib/refunds';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabase = createServerClient;

// A re-quote and a booking are two provider calls, and a function killed
// between the claim and the final write leaves a row in 'booking' that
// nothing retries. As long as the plan allows, so that happens as rarely
// as it can.
export const maxDuration = 60;

type Row = Record<string, unknown> & {
  id: string; plan_id: string; vertical: string; status: string; mode?: string | null;
  provider?: string | null; price_cents?: number | null; pending_price_cents?: number | null;
  request_payload?: unknown; response_payload?: unknown; detail?: string | null;
  provider_ref?: string | null; redirect_url?: string | null;
  approved_at?: string | null; updated_at?: string | null; itinerary_item_id?: string | null;
};

const refuse = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });
const unavailable = (error: string) => refuse(409, { code: 'unavailable', error });

function asTraveler(p: Person): TravelerInfo {
  return {
    firstName: p.firstName ?? '', lastName: p.lastName ?? '', email: p.email ?? '',
    phone: p.phone ?? undefined, dateOfBirth: p.dateOfBirth ?? undefined, gender: p.gender ?? undefined,
  };
}

/** PostgREST's answers for a column it does not know: the migration has not run. */
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST204' || error.code === '42703' || /pending_price_cents/.test(error.message ?? ''));
}

/**
 * A price rise, kept aside until somebody accepts it. Writing it into
 * price_cents at once raised the total under a group that had paid the old
 * one; before M2 that is still what happens, as it always did.
 */
async function recordRise(db: SupabaseClient, booking: Row, newCents: number): Promise<void> {
  const now = new Date().toISOString();
  if ('pending_price_cents' in booking) {
    const { error } = await db.from('bookings')
      .update({ pending_price_cents: newCents, updated_at: now })
      .eq('id', booking.id).eq('status', 'awaiting_approval');
    if (!error) return;
    if (!missingColumn(error)) {
      console.error('[approve] could not record a price rise', { bookingId: booking.id, code: error.code });
      return;
    }
  }
  console.error(`[approve] no pending_price_cents column — writing the new price into price_cents as before; run M2 in ${M1}`);
  const { error } = await db.from('bookings')
    .update({ price_cents: newCents, updated_at: now })
    .eq('id', booking.id).eq('status', 'awaiting_approval');
  if (error) console.error('[approve] could not record a price rise', { bookingId: booking.id, code: error.code });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Looked up first so we know which plan to authorize against. Approval
  // executes a real purchase, so this endpoint once let any signed-in user
  // spend another group's money.
  const { data: found, error: fetchErr } = await supabase()
    .from('bookings').select('*').eq('id', params.id).maybeSingle();
  if (fetchErr) {
    console.error('[approve] could not read the booking', { bookingId: params.id, code: fetchErr.code });
    return refuse(500, { error: 'Could not read that booking just now. Nothing was booked.' });
  }
  if (!found) return refuse(404, { error: 'Booking not found' });
  const booking = found as Row;

  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;
  const body = await req.json().catch(() => ({}));

  // Before M1 a row mid-booking still reads awaiting_approval; its stamp
  // says otherwise (midClaim).
  if (booking.status !== 'awaiting_approval' || midClaim(booking)) {
    const busy = midClaim(booking);
    return refuse(409, {
      code: 'already_in_progress', status: busy ? 'booking' : booking.status,
      error: busy ? 'Somebody is booking this right now.' : 'This one has already been dealt with.',
    });
  }
  // The row as it was read. The claim is only taken on this version, so a
  // change made while the price is checked is not booked over.
  let version: string | null = booking.updated_at ?? null;

  const vertical = booking.vertical as Vertical;
  const provider = PROVIDERS[vertical];
  if (!provider) return unavailable("Reach can't book this kind of thing.");

  const request = { ...((booking.request_payload ?? {}) as BookingItemRequest) };
  request.vertical = vertical;
  request.planId = booking.plan_id;
  request.groupId = String(ctx.plan.group_id);
  request.reference = booking.id;
  request.travelers = [];
  const purchase = isPurchase(booking);
  // Handed to the airline when it was quoted. Duffel must never be asked to
  // buy it: nobody paid a share of it.
  const handedOff = vertical === 'flight' && booking.mode === 'redirect';

  // ── 1. Who is on it ───────────────────────────────────────────────────
  if (purchase) {
    // The provider that priced it is the one that books it. A row priced by
    // an integration that has since gone (Kiwi) is priced again, not handed
    // to whatever now sits under the same vertical.
    const advice = repriceAdvice(vertical, !!booking.itinerary_item_id);
    // Hotels and flights are priced again from their own panel; nothing does
    // that for an activity.
    const hasPanel = ['hotel', 'flight'].includes(vertical);
    if (booking.provider && booking.provider !== provider.name) {
      return unavailable(`This was priced with a provider Reach no longer books through, so it can't be booked as it is. ${advice}`);
    }
    if (unpriced(booking)) {
      if (!hasPanel) {
        // No panel prices an activity again. Set aside as failed — which it
        // is, as a quote — so /bookable prices its line afresh next time.
        const { error } = await atVersion(db.from('bookings')
          .update({ status: 'failed', error: 'It had no price when it was quoted.', updated_at: new Date().toISOString() })
          .eq('id', booking.id).eq('status', 'awaiting_approval'), version);
        if (error) console.error('[approve] could not set aside an unpriced booking', { bookingId: booking.id, code: error.code });
      }
      return unavailable(`This has no price, so nobody has paid a share of it and Reach can't book it. ${advice}`);
    }
    if (vertical === 'hotel' && !request.hotel?.hotelId) {
      // Without the hotel's id, booking would search the city again and take
      // whichever hotel came first — not the one anybody agreed to.
      return unavailable(`We did not keep which hotel this was when it was priced. ${advice}`);
    }
    if (vertical === 'flight') {
      // The flight is pinned by default, as the hotel is. A row stored before
      // /api/bookings pinned it still carries the quote's own offerKey, and
      // is held to that; without one, Duffel's quote would take the cheapest
      // fare on the route at this moment — flights nobody was shown.
      Object.assign(request, pinQuoted(request as unknown as Record<string, unknown>, vertical, booking.response_payload));
      if (!request.flight?.offerKey) {
        return unavailable(`We did not keep which flights these were when they were priced. ${advice}`);
      }
    }

    let people: Person[];
    try {
      const { skips } = await readSkips(db, booking.plan_id);
      const out = skips.filter(s => s.ref === booking.id).map(s => s.userId);
      // Who the trip is for: the group, less anybody sitting this out — or a
      // solo plan's own traveller, whoever else has joined the group since.
      people = await travellersFor(db, ctx.plan, out);
    } catch {
      return refuse(500, { error: 'Could not check who is travelling just now. Nothing was booked.' });
    }
    if (!people.length) {
      return unavailable('Nobody on this trip can be named on the booking, so nothing was booked.');
    }
    const who = travellersMissing(vertical, people);
    if (who.length) {
      return refuse(400, {
        code: 'travellers_missing', who,
        error: `${who.join(', ')} ${who.length === 1 ? 'needs' : 'need'} to add their travel details before this can be booked.`,
      });
    }
    const change = partyChange(request, people.length);
    if (change) {
      return refuse(409, {
        code: 'party_changed', ...change,
        error: `This was priced for ${change.quoted} and ${change.now} ${change.now === 1 ? 'is' : 'are'} going. Price it again for everyone.`,
      });
    }
    if (vertical === 'flight' && airlineOnly(people)) {
      // A marker changed after the quote. Nobody is named: the group reads this.
      return unavailable("Automatic booking only carries a male or female passport marker, so Reach can't buy this flight. Book it with the airline directly.");
    }
    request.travelers = people.map(asTraveler);
    request.party = people.length;
    if (request.flight) request.flight = { ...request.flight, seats: people.length };
  }

  // ── 2. The price ──────────────────────────────────────────────────────
  let priceCents = Number(booking.price_cents) || 0;
  if (acceptedStale(body, booking)) {
    return refuse(409, {
      code: 'price_changed', oldCents: priceCents, newCents: Number(booking.pending_price_cents),
      error: 'The price moved again after you saw it. Nothing was booked.',
    });
  }
  const accepted = acceptedPrice(body, booking);
  if (accepted !== null) {
    const { data: moved, error } = await atVersion(db.from('bookings')
      .update({ price_cents: accepted, pending_price_cents: null, updated_at: new Date().toISOString() })
      .eq('id', booking.id).eq('status', 'awaiting_approval').eq('pending_price_cents', accepted), version)
      .select('id, updated_at');
    if (error) {
      console.error('[approve] could not accept the new price', { bookingId: booking.id, code: error.code });
      return refuse(500, { error: 'Could not save that just now. Nothing was booked.' });
    }
    if (!moved?.length) return refuse(409, { code: 'changed', error: 'This changed while you were looking — nothing was booked. Reopen it.' });
    priceCents = accepted;
    // Our own write moved the version; the claim is taken on this one.
    version = (moved[0] as { updated_at?: string | null }).updated_at ?? null;
  }

  // The most this may cost: the price agreed, or the one the provider gives
  // now if that is higher and small enough not to ask about. Funding is
  // checked at this, and the provider may not charge more.
  let checkedCents = priceCents;

  if (purchase) {
    let fresh: BookingItemResult;
    try {
      fresh = await provider.quote(request);
    } catch (e) {
      // This used to shrug and carry on, and a rise nobody had seen went
      // through with the booking.
      console.error('[approve] could not re-check the price', { bookingId: booking.id, error: e instanceof Error ? e.message : String(e) });
      return refuse(502, { code: 'provider_failed', error: "We couldn't check the price just now, so nothing was booked. Try again in a moment." });
    }
    if (fresh.status === 'failed' || !fresh.priceCents) {
      return unavailable(fresh.error || 'This is no longer on sale at any price we can read.');
    }
    // The terms shown before anybody paid are the terms bought. A flight's
    // fare is pinned already (lib/booking/pin.ts) and its quote refuses any
    // other; a hotel books the first rate the hotel offers now, and a room
    // shown as refundable must not quietly become one that is not. Rows
    // priced before pinning are held to what they showed the same way.
    if (termsChanged(vertical, booking.response_payload, fresh.raw)) {
      return unavailable(vertical === 'hotel'
        ? "That room is no longer offered on the cancellation terms you were shown, so nothing was booked. Pick it again or another hotel from the options."
        : 'That fare is no longer on sale on the terms you were shown, so nothing was booked. Pick another from the options.');
    }
    if (vertical === 'hotel') {
      const hotelId = (fresh.raw as { hotelId?: string } | undefined)?.hotelId;
      if (hotelId !== request.hotel?.hotelId) return unavailable('That hotel has no rooms left for these dates.');
      // Book the room just priced, not whichever a third search turns up.
      if (request.hotel && fresh.providerRef) request.hotel = { ...request.hotel, rateId: fresh.providerRef };
    }
    if (priceRose(priceCents, fresh.priceCents)) {
      await recordRise(db, booking, fresh.priceCents);
      void track(db, 'quote_drift', {
        userId: ctx.user.id, planId: String(booking.plan_id),
        props: { delta_cents: fresh.priceCents - priceCents, vertical: String(vertical), provider: String(booking.provider ?? 'none') },
      });
      return refuse(409, {
        code: 'price_changed', oldCents: priceCents, newCents: fresh.priceCents,
        error: 'The price has gone up since this was priced. Nothing was booked.',
      });
    }
    checkedCents = Math.max(priceCents, fresh.priceCents);
    request.maxPriceCents = checkedCents;
  }

  // A refund being paid out on this plan right now: wait for it. Its money is
  // not money to book with, and reading the payments mid-refund could buy a
  // small price rise with the very money on its way back.
  {
    const { data: lock, error: lockErr } = await db.from('refund_locks').select('taken_at')
      .eq('plan_id', booking.plan_id).gt('taken_at', new Date(Date.now() - 120_000).toISOString()).limit(1);
    if (lockErr && !isMissingTable(lockErr)) {
      console.error('[approve] could not check for a refund in progress', { planId: booking.plan_id, code: lockErr.code });
    }
    if (lock?.length) {
      return NextResponse.json({ code: 'already_in_progress', error: 'A refund is going through on this trip — try booking again in a minute.' }, { status: 409 });
    }
  }

  // ── 3. The money ──────────────────────────────────────────────────────
  // After the price, so a plan funded for the old price is not waved through
  // at the new one. There is no way round it: `skipFundingCheck` let any
  // member spend Reach's money on a trip nobody had paid for.
  const [charged, paid, refunding] = await Promise.all([
    db.from('bookings').select('id, price_cents, status, mode, provider').eq('plan_id', booking.plan_id).not('status', 'in', NOT_CHARGED),
    // `*` so refunded_cents is read from the moment its migration runs.
    db.from('contributions').select('*').eq('plan_id', booking.plan_id),
    // Refunds claimed and not yet recorded on the payment: money on its way
    // back is not money to book with (withClaims in lib/refunds.ts). Before
    // the refunds migration there is no table and nothing is being refunded.
    db.from('refunds').select('*').eq('plan_id', booking.plan_id),
  ]);
  const refundsError = refunding.error && !isMissingTable(refunding.error) ? refunding.error : null;
  if (charged.error || paid.error || refundsError) {
    console.error('[approve] could not read what the plan owes and holds', { planId: booking.plan_id, code: charged.error?.code ?? paid.error?.code ?? refundsError?.code });
    return refuse(500, { error: 'Could not check the payments just now. Nothing was booked.' });
  }
  // Only what Reach buys is owed (chargedRows) — the same total checkout
  // shows and funding charges.
  const owed = chargedRows(charged.data);
  const held = withClaims((paid.data ?? []) as ContributionRow[], (refunding.error ? [] : refunding.data ?? []) as RefundClaim[]);
  const funding = purchase ? fundingAt(owed, held, booking.id, checkedCents) : fundingOf(owed, held);
  if (funding.targetCents > 0 && !funding.funded) {
    const rise = purchase ? checkedCents - priceCents : 0;
    if (rise > 0) {
      // A rise too small to ask about is still money. Written onto the row so
      // funding's shares include it and somebody can pay it in — otherwise
      // funding says nothing is left to pay and this refuses for ever.
      const { error } = await atVersion(db.from('bookings')
        .update({ price_cents: checkedCents, updated_at: new Date().toISOString() })
        .eq('id', booking.id).eq('status', 'awaiting_approval'), version);
      if (error) console.error('[approve] could not record a small rise', { bookingId: booking.id, code: error.code });
      return refuse(402, {
        code: 'not_funded', funding,
        error: `The price went up by $${(rise / 100).toFixed(2)} since it was priced, so there is $${(funding.shortfallCents / 100).toFixed(2)} more to pay in before it can be booked.`,
      });
    }
    // Worded for a trip of one as much as a group: whose money is missing is
    // the funding figures' to say, and checkout says it from them.
    return refuse(402, { code: 'not_funded', funding, error: "The money paid in doesn't cover this yet, so nothing was booked." });
  }

  // ── 4. The claim ──────────────────────────────────────────────────────
  const claimed = await claimBooking(db, booking.id, ctx.user.id, version);
  if (claimed.ok === false) {
    if (claimed.taken) {
      // Either another approval has it, or somebody changed it — picked
      // another flight, held it — while the price was being checked. Which,
      // is worth saying: one is wait, the other is look again.
      const { data: now } = await db.from('bookings').select('status, approved_at, updated_at').eq('id', booking.id).maybeSingle();
      if (now && midClaim(now)) return refuse(409, { code: 'already_in_progress', status: 'booking', error: 'Somebody is booking this right now.' });
      return refuse(409, { code: 'changed', error: 'This changed while you were looking — nothing was booked. Reopen it.' });
    }
    console.error('[approve] could not claim the booking', { bookingId: booking.id, error: claimed.error });
    return refuse(500, { error: 'Could not start this booking just now. Nothing was booked.' });
  }
  const claim = claimed.claim;

  void track(db, 'booking_approved', {
    userId: ctx.user.id, planId: String(booking.plan_id),
    props: { vertical: String(vertical), price_cents: priceCents },
  });

  // ── 5. The provider ───────────────────────────────────────────────────
  let result: BookingItemResult;
  try {
    result = handedOff
      ? {
          vertical: 'flight', mode: 'redirect', status: 'redirected', provider: String(booking.provider ?? 'airline'),
          redirectUrl: booking.redirect_url ?? undefined, detail: booking.detail ?? undefined,
          raw: booking.response_payload ?? undefined,
        }
      : await provider.book(request);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'The provider did not answer.';
    // A booking that fails at the provider is the single most expensive thing
    // to debug after the fact, and it left no trace at all.
    console.error('[approve] provider execution failed', { bookingId: booking.id, msg });
    if (isOutcomeUnknown(e)) {
      // Sent, and no answer. The order may exist. Marking this failed took it
      // out of every total and let it be booked again — a second order if
      // the first went through. It stays claimed (mid-booking, which every
      // other route refuses to touch) with the reason on it, until somebody
      // has checked with the provider. updated_at is left alone, so a stamp
      // before M1 still reads as mid-booking.
      const { error } = await finishClaim(db, booking.id, claim, { error: `outcome unknown: ${msg}` });
      if (error) console.error('[approve] could not note an unknown outcome', { bookingId: booking.id, error });
      report(new Error(`booking outcome unknown: ${msg}`), {
        where: 'bookings/approve', extra: { bookingId: booking.id, planId: booking.plan_id, vertical, provider: provider.name, claim: claim.how },
      });
      return refuse(502, {
        code: 'outcome_unknown',
        error: "We asked for this to be booked and never heard back, so we can't tell yet whether it went through. Don't book it again. It stays on hold here until it has been checked with the provider — write to hello@alcanzar.io with this trip's name if you need it sooner.",
      });
    }
    // Marked failed, not left awaiting approval: a failure that does not say
    // so is approved again, and the provider asked to book the same thing twice.
    const { error } = await finishClaim(db, booking.id, claim, {
      status: 'failed', error: msg, updated_at: new Date().toISOString(),
    });
    if (error) console.error('[approve] a failed booking could not be marked failed', { bookingId: booking.id, error });
    await reportPaidFailure(db, booking, msg);
    return refuse(502, { code: 'provider_failed', error: msg });
  }

  void track(db, result.status === 'failed' ? 'booking_failed' : 'booking_confirmed', {
    userId: ctx.user.id, planId: String(booking.plan_id),
    props: {
      vertical: String(result.vertical),
      provider: String(result.provider ?? 'none'),
      // `redirected` is handed over, not booked, and a funnel that
      // conflates them overstates.
      outcome: String(result.status),
      price_cents: Number(result.priceCents || priceCents || 0),
    },
  });

  // A provider that answers 200 with `failed` inside has not booked anything.
  // This used to return 200 with the failure tucked in the body, and the
  // screen read the status code.
  if (result.status === 'failed') {
    const { error } = await finishClaim(db, booking.id, claim, {
      status: 'failed', error: result.error || 'The provider refused this booking.',
      response_payload: result.raw ?? booking.response_payload ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error('[approve] a failed booking could not be marked failed', { bookingId: booking.id, error });
    await reportPaidFailure(db, booking, result.error);
    return refuse(502, { code: 'provider_failed', error: result.error || 'The provider refused this booking.' });
  }

  const { row: updated, error: updErr } = await finishClaim(db, booking.id, claim, {
    status: result.status,               // confirmed | pending | redirected
    provider_ref: result.providerRef || booking.provider_ref || null,
    redirect_url: result.redirectUrl || booking.redirect_url || null,
    price_cents: handedOff ? null : (result.priceCents ?? booking.price_cents ?? null),
    detail: result.detail || booking.detail || null,
    response_payload: result.raw ?? booking.response_payload ?? null,
    error: null,
    ...('pending_price_cents' in booking ? { pending_price_cents: null } : {}),
    updated_at: new Date().toISOString(),
  });
  if (updErr || !updated) {
    // The provider holds an order our table does not point at — the one
    // fault here nobody can recover from by retrying.
    report(new Error(updErr ? `booked but not recorded: ${updErr}` : 'booked, and the claim was lost before it could be recorded'), {
      where: 'bookings/approve', extra: { bookingId: booking.id, provider: result.provider, ref: result.providerRef ?? null, claim: claim.how },
    });
    if (!updErr) {
      // Somebody else moved this row while we were at the provider, so this
      // order is a second one. Undone where the provider lets us.
      const orderId = (result.raw as { orderId?: string } | undefined)?.orderId;
      if (result.provider === 'duffel' && orderId) {
        const undone = await cancelDuffelOrder(orderId, { confirm: true });
        console.error('[approve] cancelled an order whose claim was lost', { bookingId: booking.id, orderId, outcome: undone.status, error: undone.error });
      } else {
        console.error('[approve] an order whose claim was lost could not be cancelled from here', { bookingId: booking.id, provider: result.provider, ref: result.providerRef ?? null });
      }
      return refuse(409, { code: 'already_in_progress', status: 'booking', error: 'Somebody else was booking this at the same moment.' });
    }
    return refuse(500, { error: 'This was booked but we could not save it. Do not book it again — we have been told.' });
  }

  // ── The plan itself ─────────────────────────────────────────────────
  // Booked when nothing is waiting, mid-booking, pending or failed, and at
  // least one thing came back done. `pending` used to pass: a flight the
  // priced-concierge lane had taken money for, with nobody booking it, read
  // as a booked trip.
  const { data: siblings, error: siblingError } = await db
    .from('bookings').select('status, vertical, detail, provider_ref').eq('plan_id', booking.plan_id);
  if (siblingError) {
    console.error('[approve] could not read the plan\'s other bookings', { planId: booking.plan_id, error: siblingError.message });
  } else if (planBooked((siblings ?? []).map(b => b.status)) && ctx.plan.status !== 'booked') {
    const { error: planError } = await db.from('plans')
      .update({ status: 'booked', booked_at: new Date().toISOString() })
      .eq('id', booking.plan_id);
    if (planError) console.error('[approve] could not mark the plan booked', { planId: booking.plan_id, error: planError.message });
  }

  // One email for the round, sent by whichever approval leaves nothing
  // waiting — not one per booking, each headed as if it were the lot. Two
  // approvals finishing in the same instant can both see nothing waiting and
  // both send; none finishing can leave it unsent, because the last to write
  // reads everyone else's row.
  const summary = !siblingError && result.status === 'confirmed' ? bookingSummary(siblings ?? []) : null;
  if (summary) {
    const [{ data: person }, { data: plan }] = await Promise.all([
      db.from('users').select('email').eq('id', ctx.user.id).maybeSingle(),
      db.from('plans').select('title').eq('id', booking.plan_id).maybeSingle(),
    ]);
    if (person?.email) {
      // Best-effort: a mail failure must not turn a successful booking into
      // an error the caller has to interpret.
      const mail = await sendBookingConfirmation(person.email, {
        planTitle: plan?.title || 'your trip', ...summary,
        url: `${appUrl(req).replace(/\/$/, '')}/home`,
      });
      if (!mail.sent) console.error('[approve] confirmation email not sent', mail);
    }
  }

  return NextResponse.json({ status: updated.status, booking: updated });
}
