// ─── /api/plans/[planId]/live — live trip mode ───────────────────────────
// Day-of surface: flight status (gate, delay, departure times) for every
// captured/booked flight on the plan, via FlightAware AeroAPI.
// Set AEROAPI_KEY (flightaware.com/commercial/aeroapi — personal tier is
// cheap and fine for launch). Degrades gracefully without the key.
// GET → { flights: [{ ident, status, gate, scheduled, estimated, delayMin }] }
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;

  // Flight idents come from bookings (native) and captured confirmations.
  const { data: bookings } = await ctx.db
    .from('bookings')
    .select('vertical, provider_ref, detail, response_payload, request_payload')
    .eq('plan_id', params.planId)
    .eq('vertical', 'flight')
    .in('status', ['confirmed', 'pending']);

  if (!process.env.AEROAPI_KEY) {
    return NextResponse.json({
      flights: (bookings || []).map(b => ({ detail: b.detail, status: 'live status unavailable — AEROAPI_KEY not set' })),
      degraded: true,
    });
  }

  const results = [];
  for (const b of bookings || []) {
    // Ident (e.g. "UA1234") from the stored payloads; fall back to skipping.
    // Providers write `flightIdent` into response_payload at book() time; older
    // rows predate that field, so fall back to the request's own flight number.
    const payload = (b.response_payload || {}) as Record<string, unknown>;
    const request = (b.request_payload || {}) as { flight?: { flightNumber?: string } };
    const ident = (payload.flightIdent as string) || request.flight?.flightNumber || null;
    if (!ident) { results.push({ detail: b.detail, status: 'unknown ident' }); continue; }
    try {
      const res = await fetch(`https://aeroapi.flightaware.com/aeroapi/flights/${ident}`, {
        headers: { 'x-apikey': process.env.AEROAPI_KEY },
      });
      const json = await res.json();
      const f = json?.flights?.[0];
      results.push({
        ident,
        detail: b.detail,
        status: f?.status || 'scheduled',
        gateOrigin: f?.gate_origin || null,
        gateDestination: f?.gate_destination || null,
        scheduledOut: f?.scheduled_out || null,
        estimatedOut: f?.estimated_out || null,
        delayMin: f?.departure_delay ? Math.round(f.departure_delay / 60) : 0,
      });
    } catch {
      results.push({ ident, detail: b.detail, status: 'lookup failed' });
    }
  }
  return NextResponse.json({ flights: results, degraded: false });
}
