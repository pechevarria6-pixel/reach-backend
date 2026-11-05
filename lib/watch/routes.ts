// ─── What the watch routes share ────────────────────────────────────────
// Whether a restaurant can be watched (the offer), the nights a picker may
// show, and a watch as the screen reads it. GET /api/watches/options, POST
// /api/watches and GET /api/watches/[id] all use these, so what the screen
// is offered, what is saved and what is shown cannot disagree.
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requirePlanMember, requireUser, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { tableProviderFor } from '@/lib/booking/registry';
import { PLATFORM_LABEL } from '@/lib/booking/tables/types';
import { dayWhere } from '@/lib/calendar';
import { tableWhen } from '@/lib/reservations/reserve-state';
import { scheduleRunning, watchesMigrated } from './store';
import { heldOf, nightsOffered, offerFor, openingOf, specOf, windowSaid, TABLE_WATCH, type WatchOffer } from './tables';
import { bookingTarget, readBooking, venueTarget, type WatchTarget } from './table-server';
import { LIVE, type WatchRow } from './types';

export interface OfferView {
  offer: WatchOffer;
  restaurant: string;
  /** Nights the picker may show: the trip's from today, or the next fortnight. */
  nights: string[];
  /** The line's own time and party, for the picker to start from — shown, never sent unseen. */
  start: { time: string | null; party: number };
  limits: { nights: number; perPerson: number; partyMax: number };
}

export async function offerOf(db: SupabaseClient, t: WatchTarget, env: NodeJS.ProcessEnv = process.env): Promise<OfferView> {
  const f = t.facts;
  const onPlan = !!t.booking;
  const instant = tableProviderFor(f.urls, env);
  const [migrated, running] = await Promise.all([watchesMigrated(db), scheduleRunning(db)]);
  const offer = offerFor(
    { restaurant: f.restaurant, platform: f.platform, reserveUrl: f.reserveUrl, phone: f.phone, onPlan, cited: !!t.venueRef },
    { instant, migrated, running },
  );
  const today = dayWhere(t.lng);
  const trip = t.plan ? { start: t.plan.start_date ?? null, end: t.plan.end_date ?? null } : null;
  return {
    offer, restaurant: f.restaurant,
    nights: nightsOffered(today, trip),
    start: { time: f.time, party: f.partySize },
    limits: { nights: TABLE_WATCH.nights, perPerson: TABLE_WATCH.perPerson, partyMax: TABLE_WATCH.partyMax },
  };
}

export interface WatchView {
  id: string;
  restaurant: string;
  status: WatchRow['status'];
  live: boolean;
  method: string;
  platformName: string | null;
  nights: string[];
  from: string;
  to: string;
  party: number;
  /** The window in words. */
  window: string;
  /** Where it stands, in one sentence. */
  said: string;
  /** The table held for them right now, while it is. */
  held: { date: string; time: string; expiresAt: string } | null;
  /** The platform's page for a table that opened which Reach could not hold. */
  link: string | null;
  /**
   * That table — kept until its time has gone or a later check found it no
   * longer listed — so the landing a notification opens names it beside the
   * link, however late it is tapped.
   */
  opened: { date: string; time: string; when: string; card: boolean } | null;
  planId: string | null;
  bookingId: string | null;
  itemId: string | null;
  /** The venue row watched. */
  targetRef: string;
  expiresAt: string;
}

export function watchView(row: WatchRow, now: Date = new Date()): WatchView {
  const s = specOf(row);
  const name = row.platform && row.platform in PLATFORM_LABEL ? PLATFORM_LABEL[row.platform as keyof typeof PLATFORM_LABEL] : null;
  const h = heldOf(row);
  const holding = row.status === 'held' && h && Date.parse(h.expiresAt) > now.getTime() ? h : null;
  const last = (row.last_result ?? {}) as { found?: string };
  const live = (LIVE as string[]).includes(row.status);
  const opening = live ? openingOf(row.last_result) : null;
  let said: string;
  switch (row.status) {
    case 'held':
      said = holding ? `A table is held for you now. Tap to read the terms and book it.` : `The held table is no longer held. Nothing was booked.`;
      break;
    case 'active':
      said = last.found === 'platform_off'
        ? `Reach can't reach ${name ?? 'the platform'} right now, so it isn't checking. It starts again once it can.`
        : last.found === 'their_hold'
          ? `A table is held on this line for whoever pressed Book it. Reach waits until that hold is done.`
          : `Reach is checking ${name ?? 'the platform'} for a table.`;
      break;
    case 'booked': said = 'Booked.'; break;
    case 'stopped': said = 'Stopped.'; break;
    case 'expired': said = 'The nights picked have gone. Nothing was booked.'; break;
    default:
      said = last.found === 'lapsed' ? `Stopped after ${TABLE_WATCH.lapses} held tables went unbooked.`
        : last.found === 'booked_elsewhere' ? 'Stopped: this table is booked.'
          : last.found === 'card_owed' ? `Stopped: ${name ?? 'the platform'} is holding this table until you add a card on its page. It isn't booked until you do.`
            : last.found === 'ask_first' ? `Stopped: this table was handed to you to book, so Reach can't hold one. If you haven't booked it, start watching again and say so.`
              : last.found === 'gone' ? 'Stopped: this dinner is no longer on the plan.'
                : 'Stopped.';
  }
  return {
    id: row.id, restaurant: s.restaurant, status: row.status, live, method: row.method, platformName: name,
    nights: s.nights, from: s.from, to: s.to, party: s.party, window: windowSaid(s), said,
    held: holding ? { date: holding.date, time: holding.time, expiresAt: holding.expiresAt } : null,
    link: opening?.link ?? null,
    opened: opening ? { date: opening.date, time: opening.time, when: tableWhen(opening.date, opening.time), card: opening.card } : null,
    planId: row.plan_id, bookingId: row.booking_id, itemId: row.item_id, targetRef: row.target_ref, expiresAt: row.expires_at,
  };
}

/**
 * The restaurant a request is about, and who is asking: a plan's booking row
 * (only a member of that plan), or a venue row on its own (anybody signed
 * in — it books nothing and holds nothing).
 */
export async function resolveTarget(given: { bookingId?: unknown; venueRef?: unknown; party?: unknown }): Promise<
  | { ok: true; db: SupabaseClient; userId: string; target: WatchTarget }
  | { ok: false; res: NextResponse }
> {
  const bookingId = typeof given.bookingId === 'string' && /^[0-9a-f-]{36}$/i.test(given.bookingId) ? given.bookingId : null;
  if (bookingId) {
    const { row, error } = await readBooking(createServerClient(), bookingId);
    if (error) return { ok: false, res: NextResponse.json({ error: 'Could not read that table just now.' }, { status: 500 }) };
    if (!row) return { ok: false, res: NextResponse.json({ error: 'Booking not found' }, { status: 404 }) };
    if (row.vertical !== 'restaurant') return { ok: false, res: NextResponse.json({ code: 'not_a_table', error: 'Only a table can be watched.' }, { status: 409 }) };
    const ctx = await requirePlanMember(row.plan_id);
    if (isFail(ctx)) return { ok: false, res: ctx.error };
    return { ok: true, db: ctx.db, userId: ctx.user.id, target: await bookingTarget(ctx.db, ctx.plan as Record<string, any>, row) };
  }
  const ctx = await requireUser();
  if (isFail(ctx)) return { ok: false, res: ctx.error };
  const party = Number(given.party);
  const t = await venueTarget(ctx.db, given.venueRef, Number.isFinite(party) ? party : 2);
  if (!t) return { ok: false, res: NextResponse.json({ code: 'no_venue', error: "Reach doesn't hold this restaurant's booking details, so it can't watch it." }, { status: 404 }) };
  return { ok: true, db: ctx.db, userId: ctx.user.id, target: t };
}
