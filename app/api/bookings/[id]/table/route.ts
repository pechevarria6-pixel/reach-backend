// ─── /api/bookings/[id]/table — Reach books the table itself ─────────────
// For a restaurant booking row, on Yelp Reservations or OpenTable, where the
// platform is switched on (its credentials are set) and we hold the
// restaurant's id there from a link it published. Otherwise every answer is
// the hand-off, and nothing is tried. The logic is lib/booking/tables/flow.ts.
//
// The UI this needs (nothing in components/reach-app.jsx calls it yet):
//
// Every answer carries `handoff: { ownAccount: {label, url} | null, phone }`.
// Show it beside Reach's button in every state — "Book on your own OpenTable"
// keeps a diner's card perks — and on every refusal, so the next option is
// always on screen. Refusals are `{ code, error, platformUrl?, handoff }`;
// `error` is the sentence to show and `platformUrl`, when set, is the
// platform's own page for exactly this slot (a card-required table).
//
// GET ?date=YYYY-MM-DD&time=HH:MM&covers=N[&change=1]
//   date/time default to the line's own night and time, never to a guess;
//   without both → 422 { code: 'needs_time' } — ask the person for a time.
//   → 200 { platform, platformLabel, date, time, covers, canModify,
//           slots: [{ date, time, reachBooks, handoffUrl, cardNote }], error? }
//     reachBooks=false is a slot that needs a card or deposit: show it with
//     its handoffUrl ("Book on OpenTable"), never as Reach's to book.
//     `canModify` false (Yelp) means a booked table can only be cancelled and
//     booked again — say so before booking (holdStep returns changeNote).
//   → 503 { code: 'not_bookable_here' }  this restaurant is not one Reach books: show the hand-off only.
//
// POST { action: 'hold', date, time, covers?, change? }
//   → 200 { hold: { holdId, platform, platformLabel, date, time, covers, expiresAt,
//                   cancellationPolicy, policies[], terms: {text, links[], version} | null,
//                   fee: {label, amountCents, taxCents, currency} | null, cancelBy, notes, editable },
//           button, title, body, changeNote }
//     Show, before the button: cancellationPolicy and policies (the
//     restaurant's own words), terms.text with its links (OpenTable requires
//     it, and the button must read exactly `button`, "Complete reservation"),
//     fee when not null exactly as given, and a countdown to expiresAt. The
//     table is HELD, not booked: say "Held — not booked yet" (title).
//
// POST { action: 'reserve', holdId, accept: { terms: hold.terms?.version, policy: true } }
//   Booked under the signed-in member's saved name, email and phone.
//   → 200 { booked: true, ref, platform, confirmationUrl, title, body }   confirmed: the platform's reservation id
//   → 200 { booked: false, pending: true, confirmationUrl, title, body }  the platform wants a card on its page: NOT booked
//   → 422 terms_not_accepted | needs_guest     → 409 hold_missing | hold_expired | slot_gone | needs_card | duplicate | in_progress
//   → 502 outcome_unknown — it MAY be booked; do not offer to book again, point to the platform's email
//   On a confirmed OpenTable row, hold { change: true } then reserve moves it
//   (OpenTable modify). On Yelp, hold { change: true } answers 409 no_change
//   with the cancel-then-rebook sentence.
//
// POST { action: 'cancel', confirm?: true }
//   without confirm → 200 { status: 'quoted', refundCents: 0, cancellationPolicy, cancelBy, body }
//   with confirm    → 200 { status: 'cancelled' } | 502 { code: 'cancel_failed', error }
//   → 409 outcome_unknown when a booking never answered: it MAY be booked, and
//     Reach holds no number to cancel it with — the error says where to look.
//
// A table left pending (OpenTable wants a card) is checked with the platform
// at the start of every step: cancelled there → failed and bookable again;
// card added → confirmed. Still owed, or no answer → 409 { code: 'pending_card',
// error, platformUrl } where platformUrl is OpenTable's card page.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { heldVenueNear } from '@/lib/discovery/held-venue';
import { locatePlan } from '@/lib/discovery/geocode';
import { report } from '@/lib/report';
import { isSoloPlan } from '@/lib/booking/approval';
import { atVersion } from '@/lib/booking/claim';
import { tableProviderFor, tableProviderNamed } from '@/lib/booking/registry';
import {
  cancelStep, holdStep, openingsStep, reserveStep,
  type FlowAnswer, type TableCtx, type TableRow, type TableStore,
} from '@/lib/booking/tables/flow';
import type { TableGuest } from '@/lib/booking/tables/types';
import type { SupabaseClient } from '@supabase/supabase-js';

const BOOKING = 'id, plan_id, vertical, status, mode, provider, provider_ref, redirect_url, detail, request_payload, response_payload, approved_at, updated_at';

async function load(id: string): Promise<{ row: TableRow | null; failed: boolean }> {
  const { data, error } = await createServerClient().from('bookings').select(BOOKING).eq('id', id).maybeSingle();
  if (error) console.error('[booking table] could not read the booking', { id, code: error.code });
  return { row: (data as TableRow | null) ?? null, failed: !!error };
}

function storeFor(db: SupabaseClient): TableStore {
  return {
    async write(id, version, patch) {
      const at = typeof patch.updated_at === 'string' ? patch.updated_at : new Date().toISOString();
      const { data, error } = await atVersion(db.from('bookings').update({ ...patch, updated_at: at }).eq('id', id), version).select('id');
      if (error) return { ok: false, taken: false, error: error.message };
      return data?.length ? { ok: true, version: at } : { ok: false, taken: true };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function venueFor(db: SupabaseClient, row: TableRow, plan: Record<string, any>) {
  const name = String(row.request_payload?.restaurant?.name ?? '').trim();
  if (!name) return null;
  const lat = Number(plan.destination_lat), lng = Number(plan.destination_lng);
  const at = plan.destination_lat != null && plan.destination_lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng, countryCode: null as string | null }
    : await locatePlan(plan).catch(() => null);
  const country = at?.countryCode || (/^[A-Z]{2}$/i.test(String(plan.destination_country || '')) ? String(plan.destination_country) : null);
  const { venue, error } = await heldVenueNear(db, name, at, { country });
  if (error) console.error('[booking table] could not read the venue', { name, code: error.code });
  return venue ? { reservationUrl: venue.reservation_url, phone: venue.phone } : null;
}

async function context(id: string): Promise<{ ctx: TableCtx; db: SupabaseClient; userId: string } | NextResponse> {
  const { row, failed } = await load(id);
  if (failed) return NextResponse.json({ error: 'Could not read that booking just now. Nothing was booked.' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const auth = await requirePlanMember(row.plan_id);
  if (isFail(auth)) return auth.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plan = auth.plan as Record<string, any>;
  const { count, error: countErr } = await auth.db.from('group_members')
    .select('user_id', { count: 'exact', head: true }).eq('group_id', String(plan.group_id));
  if (countErr) console.error('[booking table] could not count the group', { code: countErr.code });
  const venue = await venueFor(auth.db, row, plan);
  // Only links we hold: the line's own, the row's hand-off, the venue table's.
  const urls = [row.request_payload?.restaurant?.externalUrl, row.mode === 'redirect' ? row.redirect_url : null, venue?.reservationUrl];
  const ctx: TableCtx = {
    row,
    table: tableProviderFor(urls),
    bookedOn: tableProviderNamed(row.provider),
    // Unknown member count reads as a group: "the group" said to one person
    // is wrong, but less wrong than "you" said to five.
    solo: !countErr && isSoloPlan(plan, Number(count ?? 0)),
    userId: auth.user.id,
    store: storeFor(auth.db),
    venue,
    report: (message, extra) => report(new Error(message), { where: 'bookings/table', extra }),
  };
  return { ctx, db: auth.db, userId: auth.user.id };
}

function send(a: FlowAnswer) {
  // A platform that refused, failed or never answered, on the record with its reason.
  if (a.status >= 500) console.error('[booking table] answered', a.status, { code: a.body.code, error: a.body.error });
  return NextResponse.json(a.body, { status: a.status });
}

async function guestFor(db: SupabaseClient, userId: string, notes: unknown): Promise<TableGuest | null> {
  const { data, error } = await db.from('users').select('first_name, last_name, email, phone').eq('id', userId).maybeSingle();
  if (error) {
    console.error('[booking table] could not read the member', { code: error.code });
    return null;
  }
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const g = { firstName: s(data?.first_name), lastName: s(data?.last_name), email: s(data?.email), phone: s(data?.phone) };
  if (!g.firstName || !g.lastName || !g.email || !g.phone) return null;
  return { ...g, notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 300) : null };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await context(params.id);
  if (c instanceof NextResponse) return c;
  const q = req.nextUrl.searchParams;
  return send(await openingsStep(c.ctx, {
    date: q.get('date') ?? undefined, time: q.get('time') ?? undefined,
    covers: q.get('covers') ?? undefined, change: q.get('change') === '1',
  }));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const c = await context(params.id);
  if (c instanceof NextResponse) return c;
  switch (body.action) {
    case 'hold':
      return send(await holdStep(c.ctx, { date: body.date, time: body.time, covers: body.covers, change: body.change === true }));
    case 'reserve':
      return send(await reserveStep(c.ctx, {
        holdId: body.holdId, accept: (body.accept ?? null) as { terms?: unknown; policy?: unknown } | null,
      }, await guestFor(c.db, c.userId, body.notes)));
    case 'cancel':
      return send(await cancelStep(c.ctx, body.confirm === true));
    default:
      return NextResponse.json({ error: "Say what to do: 'hold', 'reserve' or 'cancel'." }, { status: 400 });
  }
}
