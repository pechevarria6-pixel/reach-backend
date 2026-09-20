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
import { kiwiFlights, viatorActivities, ticketmasterEvents, conciergeRestaurants } from '@/lib/booking/providers/rest';
import { duffelFlights } from '@/lib/booking/providers/flights.duffel';

const PROVIDERS: Record<Vertical, BookingProvider> = {
  hotel: liteApiHotels,
  // Duffel, written against a real offer request. Kiwi stays in the file it
  // came from: it is dormant (no TEQUILA_API_KEY) and it invents a date of
  // birth when one is missing, which books a ticket that is refused at the
  // airport. Nothing routes to it.
  flight: duffelFlights,
  activity: viatorActivities,
  event: ticketmasterEvents,
  restaurant: conciergeRestaurants,
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.planId || !Array.isArray(body?.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'planId and items[] required' }, { status: 400 });
  }

  // Booking spends money against a plan; only members of its group may do it.
  const ctx = await requirePlanMember(body.planId);
  if (isFail(ctx)) return ctx.error;

  const dryRun = body.dryRun === true;      // quote-only pass for the review screen
  // Default flow is now PROPOSE: quote every item and store it as
  // awaiting_approval. Nothing books until POST /api/bookings/[id]/approve.
  // Pass executeNow: true to skip approval (e.g. solo trips).
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
        await ctx.db.from('bookings').insert({
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
