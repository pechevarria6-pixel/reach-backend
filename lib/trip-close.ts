// ─── "How was it?" — closing a trip that happened ────────────────────────
// Task 8e of the checkout spec (2026-09-25), the server half. After a trip's
// last day, each person who went is asked one question with three answers
// (😞 😐 🤩, stored 1–3 in trip_reviews, sql/post-trip-close-2026-09-25.sql),
// told whether they still have money to square up, and offered the next one.
//
// When the card may show, and why it is all from rows we hold:
//
//   * The trip is over by its own dates — tripTiming() on the trip's clock
//     (the destination's longitude, as lib/pings.ts localClock reads it). A
//     plan nobody placed on the map is judged on the earliest calendar day
//     anywhere (UTC-12), so "How was it?" never arrives while somebody could
//     still be on it. Nothing flips plans.status to 'completed' for this
//     (owner decision 18): the date is the fact we hold.
//   * Something on it was actually held: a confirmed booking row, or a line
//     reserved — the same `reserved` the pings use. A trip nobody booked
//     anything for is not one we can say anybody went on.
//   * The person was in the group before it ended. Somebody who joined the
//     group last week was not on last month's trip, and asking them how it
//     was would be asking about something they did not do.
//
// The best-photo half of 8e is deferred (owner decision 19): NPS only.
//
// "Plan the next one?" is data, never a write: the group, the kind of plan,
// and the parameter to hand POST /api/plans (`from_close`). The plan route
// records `next_trip_started_from_close` only once a plan exists — the
// browser may not send that name — so the count is plans that were made, not
// taps. v_organizer_conversion counts `plan_created` alone, which that plan
// also writes once, so it is never counted twice there.
import type { SupabaseClient } from '@supabase/supabase-js';
import { tripTiming } from './calendar.ts';
import { validDay } from './ics.ts';
import { localClock, reserved, type PingLine, type PingBooking } from './pings.ts';
import { earliestToday, kindOf, refusalFor, type ActiveCandidate } from './one-active.ts';
import type { SettleLine } from './money.ts';

/** 1 = 😞, 2 = 😐, 3 = 🤩. */
export const CLOSE_SCORES = [1, 2, 3] as const;
export type CloseScore = typeof CLOSE_SCORES[number];

export function isCloseScore(v: unknown): v is CloseScore {
  return typeof v === 'number' && (CLOSE_SCORES as readonly number[]).includes(v);
}

/** Why the card is not shown. Null when it is. */
export type CloseWhy = 'no_dates' | 'not_over' | 'nothing_held' | 'joined_after' | 'cancelled';

export interface ClosePlan {
  id: string;
  group_id: string;
  type?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  destination_lng?: number | string | null;
}

/** The trip's own calendar day now; with no point on the map, the earliest day anywhere. */
export function closeDay(lng: unknown, now: Date = new Date()): string {
  return localClock(lng, now)?.day ?? earliestToday(now);
}

/** The trip's last day: its end, or its start when the end is missing or before it. */
export function lastDayOf(plan: Pick<ClosePlan, 'start_date' | 'end_date'>): string | null {
  const start = validDay(plan.start_date);
  if (!start) return null;
  const end = validDay(plan.end_date);
  return end && end >= start ? end : start;
}

/** Something on the trip was actually held: a confirmed booking, or a reserved line. */
export function somethingHeld(lines: PingLine[], bookings: PingBooking[]): boolean {
  const bs = (bookings ?? []).filter(b => b?.id);
  return bs.some(b => b.status === 'confirmed') || (lines ?? []).some(l => l?.id && reserved(l, bs));
}

/**
 * Whether this person is asked "How was it?" about this plan now.
 * `joinedAt` is their group_members.joined_at; null reads as "was there",
 * since a missing timestamp on an old row is not evidence they were not.
 */
export function closeAsk(p: {
  plan: ClosePlan; lines: PingLine[]; bookings: PingBooking[]; joinedAt?: string | null; now?: Date;
}): { ask: boolean; why: CloseWhy | null; endedOn: string | null } {
  const { plan } = p;
  const endedOn = lastDayOf(plan);
  if (plan.status === 'cancelled') return { ask: false, why: 'cancelled', endedOn };
  if (!endedOn) return { ask: false, why: 'no_dates', endedOn: null };
  const today = closeDay(plan.destination_lng, p.now);
  if (tripTiming({ startDate: plan.start_date, endDate: plan.end_date }, today) !== 'over') {
    return { ask: false, why: 'not_over', endedOn };
  }
  if (!somethingHeld(p.lines, p.bookings)) return { ask: false, why: 'nothing_held', endedOn };
  // Joined on a date after the last day: the trip was already done. The
  // join's UTC date against the trip's last date — somebody who joined on
  // the last day itself is asked, which is the generous side of the line.
  const joined = typeof p.joinedAt === 'string' ? validDay(p.joinedAt.slice(0, 10)) : null;
  if (joined && joined > endedOn) return { ask: false, why: 'joined_after', endedOn };
  return { ask: true, why: null, endedOn };
}

export interface CloseSettle {
  /** False before sql/settle-up-2026-09-25.sql: nothing can be marked paid yet. */
  available: boolean;
  /** Money still to move on a line this person is on, either way. */
  unsettled: boolean;
  youOweCents: number;
  owedToYouCents: number;
  /** A payment started in Venmo or Cash App and not yet marked either way, on one of their lines. */
  pending: boolean;
}

/**
 * This person's side of the ledger, totals only — the ledger screen
 * (GET /api/plans/[id]/ledger) has the lines and the pay links, and the
 * close card points there rather than showing them a second time.
 */
export function settleFor(me: string, lines: SettleLine[], available: boolean): CloseSettle {
  let youOweCents = 0, owedToYouCents = 0, pending = false;
  for (const l of lines ?? []) {
    if (l.from !== me && l.to !== me) continue;
    const cents = Math.max(0, Math.round(Number(l.amountCents) || 0));
    if (l.from === me) youOweCents += cents; else owedToYouCents += cents;
    if (l.pending) pending = true;
  }
  return { available, unsettled: youOweCents > 0 || owedToYouCents > 0, youOweCents, owedToYouCents, pending };
}

export interface NextOffer {
  groupId: string;
  /** The plan type to start: the same kind of thing as the one that just ended. */
  type: 'trip' | 'restaurant' | 'concert' | 'weekend';
  /** Pass as `from_close` in the body of POST /api/plans. */
  fromClose: string;
  /**
   * A plan of this kind the group is already planning. One trip and one
   * night out at a time (lib/one-active.ts): the card offers to open this
   * one instead of starting another, which POST /api/plans would refuse.
   */
  blockedBy: { id: string; title: string | null } | null;
}

const TYPES = new Set(['trip', 'restaurant', 'concert', 'weekend']);

export function nextOffer(plan: ClosePlan, blockedBy: { id: string; title?: string | null } | null): NextOffer {
  const type = (TYPES.has(String(plan.type)) ? plan.type : 'trip') as NextOffer['type'];
  return {
    groupId: String(plan.group_id),
    type,
    fromClose: String(plan.id),
    blockedBy: blockedBy ? { id: String(blockedBy.id), title: blockedBy.title ?? null } : null,
  };
}

/**
 * The plan "Plan the next one?" should open instead of starting one: the
 * plan POST /api/plans would refuse the new one over, and only that. It asks
 * refusalFor itself, so the card and the insert cannot disagree — a group of
 * one is never blocked (Lisbon finished, Tokyo already in planning for March,
 * and the next trip is still a new trip), which the card once missed by
 * reading `live` on its own (review, 2026-10-23). `solo` is the group's own
 * head count, as POST /api/plans counts it.
 */
export function nextBlocker(
  found: { live: ActiveCandidate | null; waiting?: ActiveCandidate | null },
  p: { type: string; solo: boolean },
): ActiveCandidate | null {
  const refused = refusalFor(found, { type: p.type, undecided: false, solo: p.solo, understands: true });
  if (!refused) return null;
  return [found.live, found.waiting].find(x => x && x.id === refused.planId) ?? null;
}

/** The plan's lines and bookings, as closeAsk reads them. Throws on a failed read. */
export async function loadHeld(db: SupabaseClient, planId: string): Promise<{ lines: PingLine[]; bookings: PingBooking[] }> {
  const [lines, bookings] = await Promise.all([
    db.from('itinerary_items').select('id, type, title, scheduled_time, is_confirmed').eq('plan_id', planId),
    db.from('bookings').select('id, itinerary_item_id, vertical, mode, status, confirmation_number').eq('plan_id', planId),
  ]);
  // Reading "nothing was booked" off a failed read would hide the card from
  // a trip that happened; reading it the other way would ask about one that
  // did not. Neither: the caller says it could not tell.
  if (lines.error || bookings.error) {
    throw new Error(`could not read what was held (${lines.error?.code ?? bookings.error?.code})`);
  }
  return { lines: (lines.data ?? []) as PingLine[], bookings: (bookings.data ?? []) as PingBooking[] };
}

/**
 * Whether a new plan was really started from this plan's close card: the
 * source is in the same group, and is a trip the card could be shown for.
 * Anything else carrying `from_close` is a stale screen or a guess, and is
 * not counted.
 */
export async function startedFromClose(
  db: SupabaseClient, p: { sourceId: string; groupId: string; now?: Date },
): Promise<{ ok: true; sourceType: string } | { ok: false; why: string }> {
  const { data: source, error } = await db.from('plans')
    .select('id, group_id, type, status, start_date, end_date, destination_lng')
    .eq('id', p.sourceId).maybeSingle();
  if (error) return { ok: false, why: `source_unreadable:${error.code}` };
  if (!source) return { ok: false, why: 'no_source' };
  if (String(source.group_id) !== String(p.groupId)) return { ok: false, why: 'other_group' };
  const held = await loadHeld(db, p.sourceId).catch(() => null);
  if (!held) return { ok: false, why: 'source_unreadable' };
  const asked = closeAsk({ plan: source as ClosePlan, ...held, now: p.now });
  if (!asked.ask) return { ok: false, why: asked.why ?? 'not_asked' };
  return { ok: true, sourceType: kindOf(source.type ?? 'trip') };
}
