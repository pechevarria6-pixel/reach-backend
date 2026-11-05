// ─── /api/watches — the tables somebody has asked Reach to watch ────────
// GET  → 200 { ready, watches: WatchView[] }   ready false: the migration has not run
// POST { bookingId | venueRef, nights: ['YYYY-MM-DD'], from: 'HH:MM', to: 'HH:MM', party }
//   201 { watch }                         saved; the next scheduled check looks
//   409 { code: 'cannot_watch', offer }   Reach can't watch it: offer carries the next options
//   409 { code: 'already_watching' }      one live watch per restaurant per person, and per table
//   409 { code: 'limit' }                 three live watches each
//   409 { code: 'booked' }                the table is already booked
//   422 { code: 'bad_window' | 'details_missing', error, missing? }
//   503 { code: 'not_ready' }             sql/table-watches-2026-11-05.sql has not run
//
// The restaurant is the venue row the plan's line cites (or the Discover
// card's own row) — never a name. Nothing is held or booked here.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { dayWhere } from '@/lib/calendar';
import { requesterOf } from '@/lib/reservations/reserve-server';
import { offerOf, resolveTarget, watchView } from '@/lib/watch/routes';
import { WATCH_COLUMNS, rowOf } from '@/lib/watch/store';
import { TABLE_WATCH, expiresAtFor, readWindow } from '@/lib/watch/tables';
import { LIVE, missingTable } from '@/lib/watch/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const { data, error } = await ctx.db.from('watches').select(WATCH_COLUMNS)
    .eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(20);
  if (error) {
    if (missingTable(error)) return NextResponse.json({ ready: false, watches: [] });
    console.error('[watches] could not read the list', { code: error.code });
    return NextResponse.json({ error: 'Could not read your watches just now.' }, { status: 500 });
  }
  return NextResponse.json({ ready: true, watches: (data ?? []).map(r => watchView(rowOf(r as Record<string, unknown>))) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const got = await resolveTarget(body);
  if (got.ok === false) return got.res;
  const { db, userId, target: t } = got;

  if (t.booking?.status === 'confirmed' || String((t.booking as { confirmation_number?: string | null } | null)?.confirmation_number ?? '').trim()) {
    return NextResponse.json({ code: 'booked', error: `${t.facts.restaurant} is already booked on this plan.` }, { status: 409 });
  }
  const view = await offerOf(db, t);
  const offer = view.offer;
  if (offer.can === 'none') {
    if (offer.why === 'not_ready') {
      console.error('[watches] asked to watch before sql/table-watches-2026-11-05.sql has run');
      return NextResponse.json({ code: 'not_ready', error: offer.what, offer }, { status: 503 });
    }
    return NextResponse.json({ code: 'cannot_watch', error: offer.what, offer }, { status: 409 });
  }

  const today = dayWhere(t.lng);
  const w = readWindow(
    { nights: body.nights, from: body.from, to: body.to, party: body.party },
    { today, trip: t.plan ? { start: t.plan.start_date ?? null, end: t.plan.end_date ?? null } : null },
  );
  if (w.ok === false) return NextResponse.json({ code: w.code, error: w.error }, { status: 422 });

  // A table is held in somebody's name: asked now, not when one opens at 2 a.m.
  if (offer.can === 'platform' && t.booking) {
    const r = await requesterOf(db, userId);
    const missing = [...(r.firstName ? [] : ['first name']), ...(r.lastName ? [] : ['last name']), ...(r.email ? [] : ['email']), ...(r.phone ? [] : ['phone number'])];
    if (missing.length) {
      return NextResponse.json({ code: 'details_missing', missing, error: `${offer.platformName} needs your ${missing.join(', ')} to hold a table. Add ${missing.length === 1 ? 'it' : 'them'} in your profile first.` }, { status: 422 });
    }
  }

  // The cap is counted, not indexed: a double-tap past it is one extra watch,
  // and the unique indexes stop the double-tap that matters (the same table twice).
  const { count, error: countError } = await db.from('watches').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).in('status', LIVE as string[]);
  if (countError) {
    if (missingTable(countError)) return NextResponse.json({ code: 'not_ready', error: "Reach can't watch for tables yet." }, { status: 503 });
    console.error('[watches] could not count live watches', { code: countError.code });
    return NextResponse.json({ error: 'Could not save that just now. Nothing is being watched.' }, { status: 500 });
  }
  if ((count ?? 0) >= TABLE_WATCH.perPerson) {
    return NextResponse.json({ code: 'limit', error: `You're watching ${TABLE_WATCH.perPerson} tables already. Stop one to watch this.` }, { status: 409 });
  }

  const { data, error } = await db.from('watches').insert({
    kind: 'table', user_id: userId,
    plan_id: t.plan?.id ?? null, booking_id: t.booking?.id ?? null, item_id: t.line?.id ?? t.booking?.itinerary_item_id ?? null,
    target_ref: t.venueRef, method: offer.can, platform: offer.can === 'platform' ? offer.platform : null,
    spec: { restaurant: t.facts.restaurant, ...w.window, lng: t.lng, lapses: 0 },
    status: 'active', expires_at: expiresAtFor(w.window.nights), next_check_at: new Date().toISOString(),
  }).select(WATCH_COLUMNS).single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ code: 'already_watching', error: `${t.facts.restaurant} is already being watched${t.booking ? ' for this plan' : ''}.` }, { status: 409 });
    if (missingTable(error)) return NextResponse.json({ code: 'not_ready', error: "Reach can't watch for tables yet." }, { status: 503 });
    console.error('[watches] could not save a watch', { code: error.code });
    return NextResponse.json({ error: 'Could not save that just now. Nothing is being watched.' }, { status: 500 });
  }
  return NextResponse.json({ watch: watchView(rowOf(data as Record<string, unknown>)) }, { status: 201 });
}
