// ─── POST /api/bookings — the concierge orchestrator ─────────────────────
// Body: { planId, groupId, travelers: TravelerInfo[], items: BookingItemRequest[] }
// Quotes then books every item through its provider, persists each result
// to Supabase `bookings`, notifies nothing (frontend polls plan status).
// GET /api/bookings?planId=… — list bookings for a plan.
import { NextRequest, NextResponse } from 'next/server';
import { PROVIDERS } from '@/lib/booking/registry';
import { report } from '@/lib/report';
import { requirePlanMember, isFail } from '@/lib/auth';
import { groupReadiness, withoutTravelerDetails } from '@/lib/essentials-server';
import { BookingItemRequest, BookingItemResult, BookingProvider, Vertical } from '@/lib/booking/types';
import { findDuplicate, identityOf as findKey } from '@/lib/booking/duplicate';
import { bookingFacts } from '@/lib/contracts/booking';
import { track } from '@/lib/track';

// One list for quoting and booking — see lib/booking/registry.ts.


/**
 * What kind of failure, never the sentence.
 *
 * A provider's message carries names, references and sometimes a whole
 * request — none of which belongs in a table people build charts from.
 */
function classOfError(error?: string): string {
  const e = String(error ?? '').toLowerCase();
  if (/phone|date of birth|gender|passenger|traveller|traveler/.test(e)) return 'missing_traveller_details';
  if (/expired|no longer available|sold out/.test(e)) return 'offer_expired';
  if (/key|credential|unauthor/.test(e)) return 'provider_credentials';
  if (/timeout|timed out|network/.test(e)) return 'provider_timeout';
  if (/price|amount/.test(e)) return 'price_changed';
  return 'other';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.planId || !Array.isArray(body?.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'planId and items[] required' }, { status: 400 });
  }

  // Booking spends money against a plan; only members of its group may do it.
  const ctx = await requirePlanMember(body.planId);
  if (isFail(ctx)) return ctx.error;

  const dryRun = body.dryRun === true;      // quote-only pass for the review screen

  // Default flow is PROPOSE: quote every item and store it as awaiting
  // approval. Nothing books until POST /api/bookings/[id]/approve, for a
  // group of one as much as a group of ten.
  //
  // A solo plan used to book here, on the grounds that there was nobody to
  // wait for. But this route is what checkout calls to *price* a trip, on
  // opening, before anybody has paid — so a solo trip with its traveller
  // details filled in would have bought its flight the moment the screen
  // loaded, with Reach's money and no approval, and the hotel failed on every
  // solo trip because the lead guest is only named at approval. What a solo
  // trip was actually waiting on was the one person on it pressing Book after
  // paying, which approval already is. The "waiting on the others" wording
  // was fixed where it was said.
  const executeNow = body.executeNow === true;
  const results: BookingItemResult[] = [];

  // No airline issues a ticket without a legal name, a date of birth and a
  // gender for every passenger. Checked once, before anything is quoted, so
  // a group is told who is missing rather than watching a flight fail at the
  // provider — and so nobody's card is touched for a seat that cannot exist.
  let flightsBlocked: string | null = null;
  if ((body.items as BookingItemRequest[]).some(i => i.vertical === 'flight')) {
    const { ready, blocking } = await groupReadiness(ctx.db, ctx.plan.group_id as string);
    if (!ready) flightsBlocked = blocking;
  }

  // What this plan already has in play, read once. A double-tapped "Book
  // everything", a retry after a dropped connection, or a refresh at the
  // wrong moment all arrive here as a fresh request, and this route ended in
  // a plain insert — so each one created another row. The bookings table
  // shows the result: the same RDU → PVR flight on the same date four times,
  // two of them pending behind one already confirmed.
  //
  // For a table that is a duplicated reservation. For a flight it is a
  // second order with a real fare on it.
  const { data: already, error: readBack } = await ctx.db
    .from('bookings')
    // `*`, deliberately. This list used to be written out here and it left
    // out `response_payload` — where the venue's phone number and the
    // provider's own note live — so the twin below was handed back thinner
    // than the booking it stands for. A column list is a place to drop a
    // fact; one read per POST is cheaper than doing that again.
    .select('*')
    .eq('plan_id', body.planId);
  if (readBack) {
    // Not fatal. Failing the whole request because we could not check for
    // duplicates would turn a rare double-booking into a total outage; the
    // insert below is still the behaviour we have always had.
    console.error('[bookings] could not read what this plan already has', { code: readBack.code });
  }
  const existing = already ?? [];

  for (const item of body.items as BookingItemRequest[]) {
    // Already booked, and still live. Hand back what is there rather than
    // making a second one. A failed or cancelled booking is deliberately not
    // a duplicate — it is the reason somebody is pressing the button again.
    const twin = dryRun ? null : findDuplicate(existing, item as unknown as Record<string, unknown>);
    if (twin) {
      console.log('[bookings] already booked — returning the existing one', {
        plan: body.planId, vertical: item.vertical, status: twin.status,
      });
      // Read through the contract rather than field by field. Written out
      // here, this dropped `response_payload` — so a second press of "Book
      // everything" described the same restaurant with no number to ring and
      // none of the provider's own wording, while the first press had both.
      const f = bookingFacts(twin as unknown as Record<string, unknown>);
      // How often this actually happens, which nothing has ever recorded. The
      // bookings table holds the same RDU → PVR flight four times because
      // this route used to end in a plain insert; whether that has stopped is
      // currently a matter of opinion.
      void track(ctx.db, 'booking_duplicate_blocked', {
        userId: ctx.user.id, groupId: String(ctx.plan.group_id), planId: body.planId,
        props: {
          vertical: String(f.vertical ?? 'unknown'),
          provider: String(f.provider ?? 'none'),
          status: String(f.status ?? 'unknown'),
          price_cents: Number(f.priceCents || 0),
        },
      });
      results.push({
        vertical: f.vertical as BookingItemResult['vertical'],
        mode: f.mode as BookingItemResult['mode'],
        status: f.status as BookingItemResult['status'],
        provider: f.provider as string,
        providerRef: f.providerRef || undefined,
        redirectUrl: f.href || undefined,
        priceCents: f.priceCents ?? undefined,
        currency: f.currency,
        detail: (f.detail as string) ?? undefined,
        // `raw` is the field an insert writes to `response_payload`, so
        // handing it back here means a duplicate answers with exactly what
        // the first one answered with. A round trip, not a copy.
        raw: f.payload ?? undefined,
      } as BookingItemResult);
      continue;
    }

    if (item.vertical === 'flight' && flightsBlocked) {
      results.push({
        vertical: 'flight', mode: 'native', status: 'failed', provider: 'none',
        // Names, not details: who to go and ask.
        error: flightsBlocked,
      });
      continue;
    }
    const provider = PROVIDERS[item.vertical];
    if (!provider) {
      // The enum is ours. "Unknown vertical activity" is not a sentence.
      console.error('[bookings] no provider for vertical', { vertical: item.vertical });
      results.push({ vertical: item.vertical, mode: 'concierge', status: 'failed', provider: 'none', error: "Reach can't book this kind of thing yet" });
      continue;
    }
    // Attach shared context
    item.planId = body.planId;
    // Trust the plan's own group, not whatever the client claimed.
    item.groupId = ctx.plan.group_id as string;
    // Never undefined: providers read this to work out occupancy, and an
    // undefined array crashed the hotel quote with "cannot read properties of
    // undefined" — a five-hundred error for a trip nobody had named anyone on
    // yet. Who is travelling is settled at approval; a quote needs a count.
    item.travelers = item.travelers?.length ? item.travelers : (body.travelers ?? []);

    try {
      const result = (dryRun || !executeNow)
        ? await provider.quote(item)
        : await provider.book(item);
      if (!dryRun && !executeNow && (result.status === 'quoted')) {
        result.status = 'awaiting_approval' as BookingItemResult['status'];
      }
      results.push(result);

      if (!dryRun) {
        // The identity of the thing booked, so the database can refuse a
        // second live one. Two requests in flight at the same moment — which
        // is what a fast double-tap sends — both read nothing above and both
        // arrive here; only a unique index settles that.
        const row: Record<string, unknown> = {
          idempotency_key: findKey(item as unknown as Record<string, unknown>),
          plan_id: body.planId,
          group_id: ctx.plan.group_id,
          booked_by: ctx.user.id,
          vertical: result.vertical,
          provider: result.provider,
          mode: result.mode,
          status: result.status,
          provider_ref: result.providerRef || null,
          redirect_url: result.redirectUrl || null,
          price_cents: result.priceCents || null,
          currency: result.currency || 'USD',
          detail: result.detail || null,
          // Without dates of birth: this column comes back from
          // GET /api/bookings to every member of the plan.
          request_payload: withoutTravelerDetails(item),
          response_payload: result.raw || null,
          error: result.error || null,
        };

        // The hotel that was priced is the hotel that gets booked. The request
        // named only a city, so approval searched again and would book
        // whatever came back first — possibly not the one on the screen at
        // the price on the screen. Pinned after the key is taken, so a
        // double-tap still matches the first request.
        const pinnedHotel = result.vertical === 'hotel' ? (result.raw as { hotelId?: string } | undefined)?.hotelId : undefined;
        if (pinnedHotel && item.hotel) {
          row.request_payload = { ...(row.request_payload as Record<string, unknown>), hotel: { ...item.hotel, hotelId: pinnedHotel } };
        }

        let { error: wrote } = await ctx.db.from('bookings').insert(row);

        // The column arrives in a migration the owner runs. Until then
        // PostgREST fails the whole insert on a column it does not know, and
        // losing the booking to keep the key would be the wrong trade.
        if (wrote && /idempotency_key/.test(wrote.message || '')) {
          console.error('[bookings] writing without the idempotency key — migration not run yet');
          delete row.idempotency_key;
          ({ error: wrote } = await ctx.db.from('bookings').insert(row));
        }
        // The index did its job: somebody else booked this in the moment
        // between our read and our write. Not an error to show anybody.
        if (wrote && wrote.code !== '23505') {
          // A booking that was made and not recorded is the one fault here
          // nobody can recover from by retrying: the provider holds an order
          // and we have no row pointing at it.
          report(new Error(wrote.message), {
            where: 'bookings/write', extra: { plan: body.planId, vertical: result.vertical, code: wrote.code },
          });
        }
        if (wrote && wrote.code === '23505') {
          console.log('[bookings] a duplicate was refused by the database', { plan: body.planId, vertical: result.vertical });
          wrote = null;
        }

        // Checked, because a booking that was quoted and not stored is a
        // booking nobody can act on, and returning the quote anyway tells the
        // screen it worked. This route reported success on every write
        // regardless of whether one happened.
        // Also visible to the rest of this same request: a payload carrying
        // the same flight twice would otherwise write it twice.
        existing.push({
          id: '', vertical: result.vertical, status: result.status,
          price_cents: result.priceCents ?? null, provider: result.provider,
          mode: result.mode, provider_ref: result.providerRef ?? null,
          redirect_url: result.redirectUrl ?? null, currency: result.currency ?? 'USD',
          detail: result.detail ?? null, request_payload: withoutTravelerDetails(item),
        } as typeof existing[number]);

        if (!wrote) {
          // Money always travels, so GMV is summable from events alone.
          void track(ctx.db, result.status === 'failed' ? 'booking_failed' : 'booking_created', {
            userId: ctx.user.id, groupId: String(ctx.plan.group_id), planId: body.planId,
            props: {
              vertical: String(result.vertical),
              provider: String(result.provider ?? 'none'),
              mode: String(result.mode ?? 'native'),
              price_cents: Number(result.priceCents || 0),
              ...(result.status === 'failed' ? { why: classOfError(result.error) } : {}),
            },
          });
        }

        if (wrote) {
          console.error('[bookings] quoted but could not store', {
            planId: body.planId, vertical: result.vertical, code: wrote.code,
          });
          result.status = 'failed' as BookingItemResult['status'];
          result.error = "We priced this but couldn't save it — try again in a moment";
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Provider error';
      results.push({ vertical: item.vertical, mode: 'native', status: 'failed', provider: provider.name, error: msg });
    }
  }

  const summary = {
    total: results.length,
    confirmed: results.filter(r => r.status === 'confirmed').length,
    pending: results.filter(r => r.status === 'pending').length,
    redirected: results.filter(r => r.status === 'redirected').length,
    failed: results.filter(r => r.status === 'failed').length,
    totalPriceCents: results.reduce((s, r) => s + (r.priceCents || 0), 0),
  };
  return NextResponse.json({ summary, results });
}

export async function GET(req: NextRequest) {
  const planId = req.nextUrl.searchParams.get('planId');
  if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 });
  const ctx = await requirePlanMember(planId);
  if (isFail(ctx)) return ctx.error;
  const { data, error } = await ctx.db
    .from('bookings').select('*').eq('plan_id', planId).order('created_at', { ascending: true });
  if (error) {
    console.error('[bookings GET] query failed', { planId, error });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ bookings: data });
}
