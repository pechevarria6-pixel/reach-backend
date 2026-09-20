// ─── POST /api/bookings — the concierge orchestrator ─────────────────────
// Body: { planId, groupId, travelers: TravelerInfo[], items: BookingItemRequest[] }
// Quotes then books every item through its provider, persists each result
// to Supabase `bookings`, notifies nothing (frontend polls plan status).
// GET /api/bookings?planId=… — list bookings for a plan.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { groupReadiness, withoutTravelerDetails } from '@/lib/essentials-server';
import { BookingItemRequest, BookingItemResult, BookingProvider, Vertical } from '@/lib/booking/types';
import { liteApiHotels } from '@/lib/booking/providers/hotels.liteapi';
import { kiwiFlights, viatorActivities, ticketmasterEvents, tableReservations } from '@/lib/booking/providers/rest';
import { duffelFlights } from '@/lib/booking/providers/flights.duffel';
import { track } from '@/lib/track';

const PROVIDERS: Record<Vertical, BookingProvider> = {
  hotel: liteApiHotels,
  // Duffel, written against a real offer request. Kiwi stays in the file it
  // came from: it is dormant (no TEQUILA_API_KEY) and it invents a date of
  // birth when one is missing, which books a ticket that is refused at the
  // airport. Nothing routes to it.
  flight: duffelFlights,
  activity: viatorActivities,
  event: ticketmasterEvents,
  // The member books their own table, on the platform the restaurant uses
  // and with their own card, so their card's dining benefits survive. No
  // queue, and nothing waiting on Reach staff.
  restaurant: tableReservations,
};

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

  // Default flow is PROPOSE: quote every item and store it as awaiting the
  // group's approval. Nothing books until POST /api/bookings/[id]/approve.
  //
  // Except when there is no group. A solo trip put everything in that queue
  // too and told the one person on it that it was waiting on the others —
  // there are no others, and nothing was ever going to arrive to release it.
  // This was meant to be handled by the caller passing executeNow, and no
  // caller ever did, so it is decided here where the plan is already loaded
  // and the answer cannot be forgotten.
  //
  // Solo by the flag or by arithmetic: a group of one is a group of one
  // whether or not the plan was created through the solo flow.
  const { count: heads } = await ctx.db
    .from('group_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('group_id', ctx.plan.group_id as string);
  const alone = (ctx.plan as { solo_mode?: boolean }).solo_mode === true || (heads ?? 0) <= 1;
  const executeNow = body.executeNow === true || alone;
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

  for (const item of body.items as BookingItemRequest[]) {
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
        const { error: wrote } = await ctx.db.from('bookings').insert({
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
        });

        // Checked, because a booking that was quoted and not stored is a
        // booking nobody can act on, and returning the quote anyway tells the
        // screen it worked. This route reported success on every write
        // regardless of whether one happened.
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
