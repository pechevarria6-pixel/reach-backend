// ─── POST /api/bookings — price everything, book nothing ────────────────
// Body: { planId, items: BookingItemRequest[], dryRun?: boolean }
// Quotes every item through its provider and stores each one awaiting
// approval. Nothing is bought here: POST /api/bookings/[id]/approve does
// that, after the money is in. Each result echoes the itineraryItemId it was
// asked for, so a caller names a failure by what it was and not by where it
// sat in the list.
// GET /api/bookings?planId=… — list bookings for a plan.
import { NextRequest, NextResponse } from 'next/server';
import { PROVIDERS } from '@/lib/booking/registry';
import { report } from '@/lib/report';
import { requirePlanMember, isFail } from '@/lib/auth';
import { groupReadiness, withoutTravelerDetails, travellersFor, tripTravellerIds } from '@/lib/essentials-server';
import { partySize } from '@/lib/participation';
import { airlineOnly } from '@/lib/booking/approval';
import { airlineHandoff } from '@/lib/booking/duffel-map';
import { BookingItemRequest, BookingItemResult, BookingProvider, Vertical } from '@/lib/booking/types';
import { findDuplicate, findStale, identityOf as findKey } from '@/lib/booking/duplicate';
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
  //
  // `executeNow` went too. No client sent it, and it booked straight from
  // here with no funding check at all.
  const results: BookingItemResult[] = [];
  // Every result carries the line it was asked for, set on the object itself
  // because the write below may still turn it into a failure.
  const keep = (item: BookingItemRequest, r: BookingItemResult) => {
    const line = (item as { itineraryItemId?: unknown }).itineraryItemId;
    if (typeof line === 'string' && line) r.itineraryItemId = line;
    results.push(r);
  };

  // How many people this is for, decided here rather than taken from the
  // client: it is what every provider sizes the price from, and approval
  // refuses to book a different number.
  const party = await partySize(ctx.db, ctx.plan as { group_id?: unknown; solo_mode?: boolean | null });

  // No airline issues a ticket without a legal name, a date of birth and a
  // gender for every passenger. Checked once, before anything is quoted, so
  // a group is told who is missing rather than watching a flight fail at the
  // provider — and so nobody's card is touched for a seat that cannot exist.
  let flightsBlocked: string | null = null;
  if ((body.items as BookingItemRequest[]).some(i => i.vertical === 'flight')) {
    // Whoever the trip is for — on a solo plan, its own traveller only.
    const { ready, blocking } = await groupReadiness(ctx.db, ctx.plan.group_id as string, tripTravellerIds(ctx.plan));
    if (!ready) flightsBlocked = blocking;
  }

  // Whether any flight must go to the airline's own site: somebody carries a
  // passport marker automatic booking cannot send. Decided at the quote, so
  // the flight never enters the total and nobody pays a share of a seat
  // Reach cannot buy. It used to be discovered at booking, after the money.
  let toAirline = false;
  if (!flightsBlocked && (body.items as BookingItemRequest[]).some(i => i.vertical === 'flight')) {
    try {
      toAirline = airlineOnly(await travellersFor(ctx.db, ctx.plan));
    } catch {
      flightsBlocked = 'We could not check who is travelling just now.';
    }
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

  // Whether a quote sized for a different number of people may be replaced.
  // Not once anybody has paid: what they paid against is the total, and the
  // same lock holds sitting things out and holding them. Asked once, and only
  // if some item needs it; unknown is treated as paid.
  let paidInto: boolean | null = null;
  const anyonePaid = async () => {
    if (paidInto !== null) return paidInto;
    const { data, error } = await ctx.db.from('contributions')
      .select('id').eq('plan_id', body.planId).eq('status', 'succeeded').limit(1);
    if (error) console.error('[bookings] could not check payments before re-pricing', { plan: body.planId, code: error.code });
    paidInto = !!error || !!data?.length;
    return paidInto;
  };

  for (const item of body.items as BookingItemRequest[]) {
    // The same flight or hotel, quoted for a different number of people and
    // not yet bought — a trip for one that somebody has since joined. It is
    // replaced by the quote this request makes, never handed back: a one-seat
    // price shown to two people is a wrong number. On a plan somebody has paid
    // into it stays exactly as it is, and is handed back like any duplicate.
    //
    // Already booked, and still live. Hand back what is there rather than
    // making a second one. A failed or cancelled booking is deliberately not
    // a duplicate — it is the reason somebody is pressing the button again.
    // A live row of the right size wins over replacing one of the wrong size.
    const dup = dryRun ? null : findDuplicate(existing, item as unknown as Record<string, unknown>);
    const unsized = dryRun || dup ? null : findStale(existing, item as unknown as Record<string, unknown>);
    const stale = unsized && !(await anyonePaid()) ? unsized : null;
    const twin = dup ?? (stale ? null : unsized);
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
      keep(item, {
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

    // Takes the wrongly sized quote off the list, and only while it is still
    // unbought — if somebody approved it in the meantime it is a real booking
    // and is left alone. Unlinked from its itinerary line, so the next open of
    // checkout can quote that line afresh if this attempt does not replace it.
    const retireStale = async (): Promise<boolean> => {
      if (!stale?.id) return true;
      const { data: retired, error: retireErr } = await ctx.db.from('bookings')
        .update({ status: 'cancelled', itinerary_item_id: null, updated_at: new Date().toISOString() })
        .eq('id', stale.id).in('status', ['awaiting_approval', 'quoted'])
        .select('id');
      if (retireErr || !retired?.length) {
        console.error('[bookings] could not retire a quote sized for a different party', {
          plan: body.planId, vertical: item.vertical, code: retireErr?.code ?? 'changed',
        });
        return false;
      }
      stale.status = 'cancelled';
      return true;
    };
    // A re-price that did not work still takes the old quote off: left there,
    // it is one person's fare split between two, and paying against it would
    // lock that in. The line is quoted again on the next open of checkout,
    // which is what happens to any line that could not be priced.
    const staleFailed = async (why?: string) => {
      const gone = await retireStale();
      return gone
        ? `This was priced for a different number of people and couldn't be re-priced for everyone going${why ? ` — ${why}` : ''}. It's off the total until it can be; reopen checkout to try again.`
        : (why ?? 'This could not be re-priced just now.');
    };

    if (item.vertical === 'flight' && flightsBlocked) {
      keep(item, {
        vertical: 'flight', mode: 'native', status: 'failed', provider: 'none',
        // Names, not details: who to go and ask.
        error: stale ? await staleFailed(flightsBlocked) : flightsBlocked,
      });
      continue;
    }
    const provider = PROVIDERS[item.vertical];
    if (!provider) {
      // The enum is ours. "Unknown vertical activity" is not a sentence.
      console.error('[bookings] no provider for vertical', { vertical: item.vertical });
      keep(item, { vertical: item.vertical, mode: 'redirect', status: 'failed', provider: 'none', error: "Reach can't book this kind of thing yet" });
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
    //
    // Nobody is named at quote time any more: approval names everybody on the
    // booking from their saved details, so nothing sent here is trusted to
    // stand for who is going.
    item.travelers = [];
    item.party = party;
    if (item.flight) item.flight = { ...item.flight, seats: party };
    if (item.restaurant) item.restaurant = { ...item.restaurant, partySize: party };

    try {
      let result = await provider.quote(item);
      if (item.vertical === 'flight' && toAirline && result.status === 'quoted' && item.flight) {
        result = airlineHandoff(result, item.flight);
      }
      if (!dryRun && result.status === 'quoted') {
        result.status = 'awaiting_approval' as BookingItemResult['status'];
      }
      keep(item, result);

      if (stale?.id) {
        if (result.status === 'failed') {
          result.error = await staleFailed(result.error);
          continue;
        }
        // Retired before the new row is written: both may carry the same
        // idempotency key, and the database allows one live row per key.
        const heldBefore = stale.status === 'quoted';
        if (!await retireStale()) {
          result.status = 'failed' as BookingItemResult['status'];
          result.error = "This changed while we were re-pricing it — reopen checkout to see where it stands.";
          continue;
        }
        // Somebody holding it (lib/booking/charged.ts) still is. Only a
        // proposal becomes a hold again: anything the provider has already
        // answered for is what it is.
        if (heldBefore && result.status === 'awaiting_approval') result.status = 'quoted' as BookingItemResult['status'];
      }

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
      keep(item, { vertical: item.vertical, mode: 'native', status: 'failed', provider: provider.name, error: msg });
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
