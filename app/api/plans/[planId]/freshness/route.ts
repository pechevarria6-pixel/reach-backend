// ─── GET /api/plans/[planId]/freshness — would a rebuild name real places? ─
// Read only. Says whether this plan's days were built before we held
// verified places for its town (lib/stale-plan.ts), so the plan screen can
// offer a rebuild with the number that makes it worth doing.
import { NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { placesFor } from '@/lib/discovery/real-places';
import { freshness } from '@/lib/stale-plan';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const plan = ctx.plan as { status?: string; destination_city?: string | null; destination_country?: string | null };
  const city = plan.destination_city ?? null;
  if (!city) return NextResponse.json({ stale: false, held: 0, named: 0, lines: 0, city: null });

  const { data: items, error } = await ctx.db
    .from('itinerary_items').select('type, venue_name').eq('plan_id', params.planId);
  if (error) {
    console.error('[freshness] could not read the days', { planId: params.planId, code: error.code });
    return NextResponse.json({ error: "Couldn't check this plan just now." }, { status: 503 });
  }
  // The same menu the generator reads, so the number is the one a rebuild gets.
  const menu = await placesFor(ctx.db, { city, country: plan.destination_country ?? null, interests: [] }, {})
    .catch(e => { console.error('[freshness] menu read failed', { planId: params.planId, e: String(e) }); return []; });
  return NextResponse.json({ ...freshness(items ?? [], menu.length, plan.status), city });
}
