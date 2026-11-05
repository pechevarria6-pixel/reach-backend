// ─── GET /api/watches/options — can Reach watch this restaurant? ────────
//   ?bookingId=<a table on a plan>   or   ?venueRef=<a discovery_venues id>&party=2
//
// 200 { offer, restaurant, nights, start: { time, party }, limits }
//   offer.can 'platform'  — Reach checks the platform it has a deal with; offer.what says exactly what happens
//   offer.can 'call_list' — a phone-only restaurant: Reach's own call (calling is open) asks about a cancellation list
//   offer.can 'none'      — Reach can't watch it: offer.why, offer.what, and the next options —
//                           offer.alert (the platform's own Notify, on its page) and offer.phone (their number)
//
// Reads only. Nothing is saved and no platform is asked.
import { NextRequest, NextResponse } from 'next/server';
import { offerOf, resolveTarget } from '@/lib/watch/routes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const got = await resolveTarget({ bookingId: q.get('bookingId'), venueRef: q.get('venueRef'), party: q.get('party') });
  if (got.ok === false) return got.res;
  return NextResponse.json(await offerOf(got.db, got.target));
}
