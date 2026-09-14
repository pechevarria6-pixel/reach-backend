// ─── POST /api/bookings — the concierge orchestrator ─────────────────────
// Body: { planId, groupId, travelers: TravelerInfo[], items: BookingItemRequest[] }
// Quotes then books every item through its provider, persists each result
// to Supabase `bookings`, notifies nothing (frontend polls plan status).
// GET /api/bookings?planId=… — list bookings for a plan.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { BookingItemRequest, BookingItemResult, BookingProvider, Vertical } from '@/lib/booking/types';
import { liteApiHotels } from '@/lib/booking/providers/hotels.liteapi';
import { kiwiFlights, viatorActivities, ticketmasterEvents, conciergeRestaurants } from '@/lib/booking/providers/rest';

const PROVIDERS: Record<Vertical, BookingProvider> = {
  hotel: liteApiHotels,
  flight: kiwiFlights,
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

  for (const item of body.items as BookingItemRequest[]) {
    const provider = PROVIDERS[item.vertical];
    if (!provider) {
      results.push({ vertical: item.vertical, mode: 'concierge', status: 'failed', provider: 'none', error: `Unknown vertical ${item.vertical}` });
      continue;
    }
    // Attach shared context
    item.planId = body.planId;
    // Trust the plan's own group, not whatever the client claimed.
    item.groupId = ctx.plan.group_id as string;
    item.travelers = item.travelers?.length ? item.travelers : body.travelers;

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
          request_payload: item,
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
