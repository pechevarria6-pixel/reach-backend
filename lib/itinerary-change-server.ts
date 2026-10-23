// ─── Changing one line of a plan, on the server ─────────────────────────
// What the three routes under app/api/plans/[planId]/itinerary/[itemId]
// share: reading the line and everything that decides who may change it
// (lib/itinerary-change.ts), reading the menu it may be changed to
// (lib/itinerary-alternatives.ts), and the swap itself — the line's booking
// first, then the line, then the event that says it happened.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { placesFor, type RealPlace } from '@/lib/discovery/real-places';
import { ITEM_COLUMNS, itemFromRow, type ItineraryItem } from '@/lib/contracts/itinerary-item';
import { membersOf, organiserOf, firstName, type Member } from '@/lib/trip-ideas-store';
import { isOrganiser } from '@/lib/trip-vote';
import { isSoloPlan } from '@/lib/booking/approval';
import { atVersion } from '@/lib/booking/claim';
import { lockedIn, changeRight, bookedBy, shownSuggestions, type Right, type ShownSuggestion, type SuggestionRow, type VoteRow } from '@/lib/itinerary-change';
import { bookingOnSwap, type LineBooking } from '@/lib/itinerary-bookings';
import { replaceLine } from '@/lib/itinerary-replace';
import { alternativesFor, placeByRef, placeOfLine, placeRef, swappedLine, type PlanLine } from '@/lib/itinerary-alternatives';
import { track } from '@/lib/track';

type PlanRow = {
  id: string; group_id: string; status?: string | null; type?: string | null; created_by?: string | null;
  solo_mode?: boolean | null; destination_city?: string | null; destination_country?: string | null;
  start_date?: string | null; end_date?: string | null;
};
export interface PlanCtx {
  db: SupabaseClient;
  user: { id: string };
  plan: Record<string, unknown> & { id: string; group_id: string };
  role: 'admin' | 'member';
}

export interface LineContext extends PlanState {
  item: ItineraryItem;
  /** The row as read, for the version the write is taken on. */
  asRead: { title: string | null; venue_name: string | null };
  lines: PlanLine[];
  /** The live booking on this line, if any. */
  booking: (LineBooking & { itinerary_item_id: string | null }) | null;
  right: Right;
}

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  ({ fail: NextResponse.json({ error, ...extra }, { status }) });

export interface PlanState {
  plan: PlanRow;
  members: Member[];
  solo: boolean;
  organiser: boolean;
  organiserName: string | null;
  locked: boolean;
  bookings: (LineBooking & { itinerary_item_id: string | null })[];
  nightOut: boolean;
}

/** Who is on the plan, whether it is locked in, and whether this person organises it. */
export async function planState(ctx: PlanCtx): Promise<{ fail: NextResponse } | { state: PlanState }> {
  const plan = ctx.plan as unknown as PlanRow;
  const { db } = ctx;
  const [members, { data: bookings, error: bookErr }, { data: paid, error: paidErr }] = await Promise.all([
    membersOf(db, plan.group_id),
    db.from('bookings')
      .select('id, itinerary_item_id, status, mode, provider, vertical, approved_at, updated_at, confirmation_number, booked_by, fulfilled_by')
      .eq('plan_id', plan.id),
    db.from('contributions').select('amount_cents').eq('plan_id', plan.id).eq('status', 'succeeded'),
  ]);
  if (bookErr || !members) {
    console.error('[itinerary item] could not read the plan', { plan: plan.id, bookings: bookErr?.code, members: !members });
    return fail("Couldn't check this plan just now.", 500);
  }
  // A payment that cannot be checked counts as one: the plan is read as
  // locked, which only narrows who may change it.
  if (paidErr) console.error('[itinerary item] could not read payments — treating the plan as locked in', { plan: plan.id, code: paidErr.code });
  const collected = paidErr ? 1 : (paid ?? []).reduce((n, c) => n + (Number(c.amount_cents) || 0), 0);
  const who = organiserOf(members, plan.created_by ?? null);
  return {
    state: {
      plan,
      members,
      solo: isSoloPlan(plan, members.length),
      organiser: isOrganiser({ role: ctx.role, createdBy: plan.created_by ?? null, userId: ctx.user.id }),
      organiserName: who ? firstName(who.name) : null,
      locked: lockedIn(plan.status, bookings ?? [], collected),
      bookings: (bookings ?? []) as PlanState['bookings'],
      nightOut: plan.type === 'restaurant',
    },
  };
}

/** Every line on the plan, the one asked about, and who may change it. */
export async function readLine(ctx: PlanCtx, itemId: string): Promise<{ fail: NextResponse } | { line: LineContext }> {
  const plan = ctx.plan as unknown as PlanRow;
  const { db } = ctx;

  const [{ data: row, error: rowErr }, { data: all, error: allErr }, st] = await Promise.all([
    db.from('itinerary_items').select(ITEM_COLUMNS).eq('id', itemId).eq('plan_id', plan.id).maybeSingle(),
    db.from('itinerary_items').select('id, type, title, scheduled_time, venue_name, booking_mode, cost_cents').eq('plan_id', plan.id),
    planState(ctx),
  ]);
  if (rowErr || allErr) {
    console.error('[itinerary item] could not read the line', { plan: plan.id, item: itemId, code: rowErr?.code ?? allErr?.code });
    return fail("Couldn't read that line just now.", 500);
  }
  if (!row) return fail('That line is not on this plan any more — reopen the plan.', 404);
  if ('fail' in st) return st;
  const { state } = st;

  const booking = state.bookings.find(b => b.itinerary_item_id === itemId && b.status !== 'failed' && b.status !== 'cancelled') ?? null;
  const r = row as unknown as Record<string, unknown>;
  return {
    line: {
      ...state,
      item: itemFromRow(r),
      asRead: { title: (r.title as string | null) ?? null, venue_name: (r.venue_name as string | null) ?? null },
      lines: (all ?? []) as PlanLine[],
      booking,
      right: changeRight({ solo: state.solo, organiser: state.organiser, locked: state.locked, bookedIt: bookedBy(booking, ctx.user.id) }),
    },
  };
}

/**
 * The verified menu for the plan's town, read the way the generator reads it
 * — for the plan's dates, judged on the evening for a night out — and deeper
 * per kind, because a menu built to furnish a whole day holds only a few bars
 * and a swap wants the bars.
 */
export async function menuFor(db: SupabaseClient, plan: PlanRow): Promise<RealPlace[]> {
  const city = String(plan.destination_city || '').trim();
  if (!city) return [];
  const days = plan.start_date ? { from: String(plan.start_date), to: String(plan.end_date || plan.start_date) } : null;
  return placesFor(db, { city, country: plan.destination_country ?? null, interests: [] },
    { perKind: 15, max: 150, days, eveningOut: plan.type === 'restaurant' })
    .catch(e => {
      console.error('[itinerary item] could not read the menu', { plan: plan.id, error: e instanceof Error ? e.message : String(e) });
      return [] as RealPlace[];
    });
}

/** The verifier's columns arrived in a migration; without them a swap still lands. */
const VERIFIER = ['verified_at', 'verified_status', 'verified_source', 'subtitle_unverified',
  'subtitle_claims', 'title_claims', 'payment_note_unverified'];
const missingColumn = (detail: string) => /could not find the .* column|column .* does not exist/i.test(detail);

export type SwapReason = 'organiser' | 'booker' | 'solo' | 'suggestion';

/**
 * Put `place` on the line. The booking on it goes first, then the line —
 * so a failure between the two leaves an unbooked line naming the old place,
 * which the Book tab offers again, rather than a booking for the old place
 * sitting under the new one (the Raleigh dinner).
 */
export async function swapLine(
  ctx: PlanCtx, lc: LineContext, places: RealPlace[], place: RealPlace,
  reason: SwapReason, extra: { suggestionId?: string; title?: string | null; costCents?: number | null } = {},
): Promise<NextResponse> {
  const { db } = ctx;
  const itemId = String(lc.item.id);
  const on = bookingOnSwap(lc.booking, { filled: lc.item.filled, venue_name: lc.item.venue_name, booking_mode: lc.item.booking_mode });
  if (on.action === 'refuse') {
    return NextResponse.json({ code: on.code, error: on.message, bookingId: lc.booking?.id ?? null }, { status: 409 });
  }

  let retired: string | null = null;
  if (on.action === 'retire' && lc.booking) {
    const b = lc.booking;
    const { data: gone, error } = await atVersion(db.from('bookings')
      .update({ status: 'cancelled', itinerary_item_id: null, updated_at: new Date().toISOString() })
      .eq('id', b.id).eq('status', b.status), b.updated_at)
      .select('id').maybeSingle();
    if (error) {
      console.error('[itinerary item] could not let go of the old booking — nothing changed', { item: itemId, booking: b.id, code: error.code });
      return NextResponse.json({ error: "Couldn't change that just now — nothing was changed." }, { status: 500 });
    }
    if (!gone) return NextResponse.json({ code: 'changed', error: 'This changed while you were looking — reopen it.' }, { status: 409 });
    retired = b.id;
  }

  const asLine: PlanLine = { id: itemId, type: lc.item.type, title: lc.item.title, scheduled_time: lc.item.time,
    venue_name: lc.item.venue_name, booking_mode: lc.item.booking_mode };
  const oldPlace = placeOfLine(asLine, places);
  const patch = swappedLine(asLine, oldPlace, place, extra.title ?? null, { costCents: extra.costCents ?? null });
  let out = await replaceLine(db, lc.plan.id, itemId, lc.asRead, patch);
  if (out.status === 'failed' && missingColumn(out.detail)) {
    console.error('[itinerary item] verifier columns missing — swapping without clearing them; run sql/itinerary-verification-2026-09-20.sql');
    out = await replaceLine(db, lc.plan.id, itemId, lc.asRead,
      Object.fromEntries(Object.entries(patch).filter(([k]) => !VERIFIER.includes(k))));
  }
  if (out.status !== 'swapped') {
    console.error('[itinerary item] the line was not swapped', { item: itemId, outcome: out, retired });
    return NextResponse.json(
      out.status === 'changed'
        ? { code: 'changed', error: 'Somebody changed this line while you were looking — reopen it.', retiredBookingId: retired }
        : { error: "Couldn't change that line just now.", retiredBookingId: retired },
      { status: out.status === 'changed' ? 409 : 500 },
    );
  }

  // Old, new, who and why. Refs, never names: an event row is not where a
  // place's name lives, and scrubProps would drop it anyway.
  void track(db, 'itinerary_item_swapped', {
    userId: ctx.user.id, groupId: lc.plan.group_id, planId: lc.plan.id,
    props: {
      item_id: itemId,
      from_ref: oldPlace ? placeRef(oldPlace) : 'unlisted',
      to_ref: placeRef(place),
      reason,
      ...(extra.title ? { something_else: true } : {}),
      locked: lc.locked,
      booking_retired: !!retired,
      ...(extra.suggestionId ? { suggestion_id: extra.suggestionId } : {}),
    },
  });
  console.log('[itinerary item] swapped', { plan: lc.plan.id, item: itemId, from: oldPlace?.name ?? lc.item.venue_name ?? null, to: place.name, by: ctx.user.id, reason });

  return NextResponse.json({
    item: itemFromRow(out.row),
    retiredBookingId: retired,
    // Said only when it is true: the old place's booking went, and this one
    // is booked from the Book tab like any other line.
    ...(retired ? {
      notice: ['reach', 'ahead'].includes(String(patch.booking_mode))
        ? `The booking for the old place was let go. ${place.name} isn't booked yet — book it from the Book tab.`
        : 'The booking for the old place was let go.',
    } : {}),
  });
}

/**
 * The menu place `ref` names, when it may go on this line: one of the line's
 * own alternatives (the same kind of line, near the rest of the day, open
 * then, not already on the plan), however far down the list. The rule a
 * swap and a suggestion are both held to, so neither can name a place the
 * Change sheet would never have offered.
 */
export function candidateFor(lc: LineContext, places: RealPlace[], ref: unknown, opts: { anyType?: boolean } = {}): RealPlace | null {
  const got = alternativesFor({
    line: { id: String(lc.item.id), type: lc.item.type, title: lc.item.title, scheduled_time: lc.item.time,
      venue_name: lc.item.venue_name, booking_mode: lc.item.booking_mode },
    lines: lc.lines, places, nightOut: lc.nightOut,
    startDate: lc.plan.start_date ?? null, countryCode: lc.plan.destination_country ?? null,
    count: Infinity, anyType: !!opts.anyType,
  });
  if (got.status !== 'ok' || !got.alternatives.some(a => a.ref === ref)) return null;
  return placeByRef(ref, places);
}

/** A table that is not there yet: the suggestions migration has not been run. */
export function suggestionsMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST205' || e.code === '42P01' || /itinerary_item_suggestion/i.test(e.message ?? '') && /schema cache|does not exist/i.test(e.message ?? ''));
}
export const SUGGESTIONS_SQL = 'sql/itinerary-suggestions-2026-09-25.sql';

/**
 * Open suggestions on a plan (or one line of it), with their 👍 and who
 * made them. `available: false` until the suggestions SQL is run, so a screen
 * can leave the feature out rather than show an error.
 */
export async function readSuggestions(
  ctx: PlanCtx, members: Member[], itemId?: string,
): Promise<{ available: boolean; suggestions: ShownSuggestion[]; error?: boolean }> {
  let q = ctx.db.from('itinerary_item_suggestions')
    .select('id, item_id, suggested_by, candidate_ref, candidate, note, status, created_at')
    .eq('plan_id', String(ctx.plan.id)).eq('status', 'open');
  if (itemId) q = q.eq('item_id', itemId);
  const { data: rows, error } = await q.order('created_at', { ascending: true }).limit(200);
  if (error) {
    if (suggestionsMissing(error)) return { available: false, suggestions: [] };
    console.error('[suggestions] could not read them', { plan: ctx.plan.id, code: error.code });
    return { available: true, suggestions: [], error: true };
  }
  const ids = (rows ?? []).map(r => String(r.id));
  let votes: VoteRow[] = [];
  if (ids.length) {
    const { data: v, error: vErr } = await ctx.db.from('itinerary_item_suggestion_votes')
      .select('suggestion_id, user_id').in('suggestion_id', ids);
    if (vErr) {
      console.error('[suggestions] could not read the votes', { plan: ctx.plan.id, code: vErr.code });
      return { available: true, suggestions: [], error: true };
    }
    votes = (v ?? []) as VoteRow[];
  }
  const names = new Map(members.map(m => [m.userId, m.name ? firstName(m.name) : null] as const));
  return { available: true, suggestions: shownSuggestions((rows ?? []) as SuggestionRow[], votes, ctx.user.id, names) };
}
