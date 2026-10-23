// ─── GET /api/plans/[planId]/wallet — the trip wallet ────────────────────
// Every confirmation number on the trip, the flights, the hotel — what you
// show at a desk. Built by lib/wallet.ts from the booking rows alone; that
// file says where each field comes from and what is never filled in.
//
// → 200 Wallet { planId, title, asOf, entries[] }
//   asOf: when this answer was built. public/sw.js keeps the last copy of
//   this one response for when there is no signal, and the screen says
//   "as of <time>" from it, so an old copy never reads as the current one.
//
// Terminal and gate are asked of FlightAware AeroAPI, only for a flight a
// day or two out, and only kept when AeroAPI's flight leaves on the booked
// date. Without AEROAPI_KEY, or when the lookup fails, they are null and
// the rest of the wallet is unchanged.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { readSkips } from '@/lib/participation';
import { buildWallet, liveFromAero, worthAsking, type AeroFlight, type WalletBookingRow } from '@/lib/wallet';

const AERO_TIMEOUT_MS = 4000;

async function aeroFlights(ident: string): Promise<AeroFlight[] | null> {
  const key = process.env.AEROAPI_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(ident)}`, {
      headers: { 'x-apikey': key },
      signal: AbortSignal.timeout(AERO_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[wallet] AeroAPI refused the lookup', { ident, status: res.status });
      return null;
    }
    const json = await res.json().catch(() => null) as { flights?: AeroFlight[] } | null;
    return Array.isArray(json?.flights) ? json!.flights : null;
  } catch (e) {
    console.error('[wallet] AeroAPI lookup failed', { ident, error: (e as Error)?.name });
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const db = ctx.db;

  // `*`, not a list: bookings.confirmation_number is what a member typed on
  // "I've got it", and a narrow select is how a fact drops off a screen.
  const [{ data: bookings, error: bErr }, { data: items, error: iErr }] = await Promise.all([
    db.from('bookings').select('*').eq('plan_id', params.planId),
    db.from('itinerary_items').select('id, title').eq('plan_id', params.planId),
  ]);
  if (bErr) {
    console.error('[wallet] could not read bookings', { planId: params.planId, code: bErr.code });
    return NextResponse.json({ error: 'Could not read the bookings just now.' }, { status: 503 });
  }
  if (iErr) console.error('[wallet] could not read the itinerary titles', { planId: params.planId, code: iErr.code });

  let mySkips: string[] = [];
  try {
    const { skips } = await readSkips(db, params.planId);
    mySkips = skips.filter(s => s.userId === ctx.user.id).map(s => s.ref);
  } catch {
    // Shown rather than hidden: a booking somebody sits out is still on the
    // trip, and an empty wallet would say there is nothing booked.
  }

  const itemTitles: Record<string, string> = {};
  for (const i of items ?? []) if (i?.id && typeof i.title === 'string') itemTitles[String(i.id)] = i.title;

  const now = new Date();
  const wallet = buildWallet({
    planId: params.planId,
    title: (ctx.plan as { title?: string | null }).title ?? null,
    bookings: (bookings ?? []) as WalletBookingRow[],
    mySkips, itemTitles, now,
  });

  await Promise.all(wallet.entries.map(async e => {
    const out = e.flight?.out;
    if (!e.flight?.ident || !out || !worthAsking(out.date, now)) return;
    const flights = await aeroFlights(e.flight.ident);
    e.flight.live = liveFromAero(flights, { date: out.date, from: out.from }, new Date());
  }));

  return NextResponse.json(wallet, { headers: { 'Cache-Control': 'private, no-store' } });
}
