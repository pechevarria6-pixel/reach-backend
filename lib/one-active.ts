// ─── One trip and one night out being planned per group, at a time ──────
// The owner's rule, 2026-09-25 (rule "a"): a group may have one TRIP and one
// NIGHT OUT in planning or voting at once. Starting a second of the same kind
// is refused with the one that exists, so the client can offer to open it.
// A night out is never blocked by a trip, nor a trip by a night out.
//
// This extends the older guard in lib/trip-vote.ts (one UNDECIDED plan of
// each type), which only covered a group trip still waiting for its
// destination. That guard's answer, `already_waiting`, is kept for exactly
// the case it always covered; everything else the new rule refuses is
// `one_active`.
//
// Only while the first is still on by its own dates (isLive). One whose
// dates have passed is closed before the next is made, because the unique
// index that makes this hold under concurrent requests
// (sql/one-active-plan-2026-09-25.sql) cannot read dates.
//
// Everything but `readActive` and `closeStale` is pure, so each rule can be
// tested on its own.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isLive, dayWhere } from './calendar.ts';

export type PlanKind = 'trip' | 'night';

/** Statuses in which a plan is still being planned. Matches the index's WHERE. */
export const ACTIVE_STATUSES = ['planning', 'voting'] as const;

/**
 * Which of the two slots a plan type takes.
 *
 * A dinner out and a concert night are both an evening (the create flow
 * gives them the same short path, and lib/recommendations/trip-picks.ts
 * treats both as an evening); a trip and a weekend away both go somewhere.
 * sql/one-active-plan-2026-09-25.sql indexes the same expression, so the two
 * must change together.
 */
export function kindOf(type: string | null | undefined): PlanKind {
  return type === 'restaurant' || type === 'concert' ? 'night' : 'trip';
}

/** A plan as this guard reads it. */
export interface ActiveCandidate {
  id: string;
  title?: string | null;
  type?: string | null;
  status?: string | null;
  destination_style?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
}

function activeOfKind<T extends ActiveCandidate>(plans: T[], kind: PlanKind, except?: string | null): T[] {
  return plans
    .filter(p => p.id !== except
      && kindOf(p.type ?? 'trip') === kind
      && (ACTIVE_STATUSES as readonly string[]).includes(String(p.status ?? 'planning')))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}

const live = (p: ActiveCandidate, today: string) =>
  isLive({ status: p.status, startDate: p.start_date, endDate: p.end_date }, today);

/**
 * The plan of this kind the group is already planning, if one is still on.
 * `except` leaves out the plan being changed, for a PATCH that reopens it.
 */
export function activePlanIn<T extends ActiveCandidate>(
  plans: T[], p: { type: string; today: string; except?: string | null },
): T | null {
  return activeOfKind(plans, kindOf(p.type), p.except).find(x => live(x, p.today)) ?? null;
}

/**
 * Plans of this kind still marked planning/voting whose dates have been and
 * gone, with what each is closed as.
 *
 * Not all "cancelled": a night out with nothing to book stays in "planning"
 * for ever, and the dinner happened. Calling it cancelled would tell the
 * group, and every screen that reads status, that it was called off. So a
 * plan that was decided is closed as completed; only one still waiting for
 * its destination — which nobody ever went on — is cancelled, as before.
 */
export function staleActiveIn(
  plans: ActiveCandidate[], p: { type: string; today: string; except?: string | null },
): { id: string; closeAs: 'cancelled' | 'completed' }[] {
  return activeOfKind(plans, kindOf(p.type), p.except)
    .filter(x => !live(x, p.today))
    .map(x => ({ id: x.id, closeAs: x.destination_style === 'undecided' ? 'cancelled' : 'completed' }));
}

/**
 * The 409's code. `already_waiting` is the older answer, and the client
 * already opens the plan it names; it is kept for the case it described — a
 * new undecided group trip meeting an undecided one of the same type.
 */
export function refusalCode(
  incoming: { type: string; undecided: boolean }, existing: ActiveCandidate,
): 'already_waiting' | 'one_active' {
  return incoming.undecided && existing.destination_style === 'undecided'
    && String(existing.type ?? 'trip') === incoming.type
    ? 'already_waiting' : 'one_active';
}

/**
 * What the person reads: which one is in the way, and that it is the one
 * being opened. Nothing about calling it off — only the organiser can, and
 * this may not be them. A group of one is spoken to as one person.
 */
export function refusalCopy(kind: PlanKind, opts: { title?: string | null; solo?: boolean } = {}): string {
  const what = kind === 'night' ? 'night out' : 'trip';
  const who = opts.solo ? "You're" : 'This group is';
  const named = String(opts.title ?? '').trim();
  return named
    ? `${who} already planning a ${what}: ${named}. Here it is.`
    : `${who} already planning a ${what}. Here it is.`;
}

export type Stale = { id: string; closeAs: 'cancelled' | 'completed' };

/**
 * The group's plans of this kind still being planned: the live one in the
 * way, if any, and the stale ones to close. A read that fails is logged and
 * treated as nothing in the way — the unique index, once it is there, is
 * what holds the line, and refusing somebody their plan on a failed read is
 * the worse mistake.
 */
export async function readActive(
  db: SupabaseClient, groupId: string, p: { type: string; today?: string; except?: string | null },
): Promise<{ live: ActiveCandidate | null; waiting: ActiveCandidate | null; stale: Stale[] }> {
  const { data, error } = await db.from('plans')
    .select('id, title, type, destination_style, status, start_date, end_date, created_at')
    .eq('group_id', groupId)
    .in('status', [...ACTIVE_STATUSES]);
  if (error) {
    console.error('[one-active] could not check for a plan of this kind already being planned', { groupId, code: error.code });
    return { live: null, waiting: null, stale: [] };
  }
  const plans: ActiveCandidate[] = (data ?? []).map(r => ({
    id: String(r.id), title: r.title, type: r.type, destination_style: r.destination_style, status: r.status,
    start_date: r.start_date, end_date: r.end_date, created_at: r.created_at,
  }));
  const q = { ...p, today: p.today ?? earliestToday() };
  return { live: activePlanIn(plans, q), waiting: waitingPlanIn(plans, q), stale: staleActiveIn(plans, q) };
}

/**
 * "Today" for a server that keeps UTC: the earliest calendar day anywhere.
 * A night out in New York is still tonight at 9pm there, when the UTC date
 * has already turned over, so a plan only counts as over once it is over
 * everywhere — the error this can make is keeping a finished plan waiting a
 * few hours longer, never closing one somebody is still on.
 */
export function earliestToday(now: Date = new Date()): string {
  return dayWhere(-180, now);
}

/**
 * Close plans still being planned whose dates have been and gone, so the
 * indexes let the group start the next. Only while they are still in
 * planning or voting: a status landing at the same moment wins.
 */
export async function closeStale(db: SupabaseClient, groupId: string, stale: Stale[]): Promise<void> {
  for (const closeAs of ['cancelled', 'completed'] as const) {
    const ids = stale.filter(s => s.closeAs === closeAs).map(s => s.id);
    if (!ids.length) continue;
    const { error } = await db.from('plans')
      .update({ status: closeAs, updated_at: new Date().toISOString() })
      .in('id', ids).eq('group_id', groupId)
      .in('status', [...ACTIVE_STATUSES]);
    if (error) console.error('[one-active] could not close a plan whose dates have passed', { groupId, ids, closeAs, code: error.code });
    else console.log('[one-active] closed plans whose dates have passed', { groupId, ids, closeAs });
  }
}

/**
 * The 409's body: { error, code, planId, kind }. The client opens `planId`
 * rather than making a second plan of the same kind.
 */
export function refusalBody(
  existing: ActiveCandidate,
  incoming: { type: string; undecided: boolean; solo: boolean },
): { error: string; code: 'already_waiting' | 'one_active'; planId: string; kind: PlanKind } {
  const kind = kindOf(incoming.type);
  return {
    error: refusalCopy(kind, { title: existing.title, solo: incoming.solo }),
    code: refusalCode(incoming, existing),
    planId: existing.id,
    kind,
  };
}

/**
 * Whether this request is refused, and with what — or null to let it through.
 *
 * Two cases the rule does not reach, both found in review on 2026-09-25:
 *
 * · A group of one. Planning alone puts every plan into the one personal
 *   "Just me" group (CreatePlanFlow's chooseSolo), so the rule there would
 *   mean one trip and one dinner across everything somebody plans on their
 *   own — Lisbon in December would block Tokyo in March. The rule exists so a
 *   group is not split across two trips; a group of one cannot be. The old
 *   guard exempted solo groups too.
 *
 * · A caller that cannot act on `one_active`. Until components/reach-app.jsx
 *   handles it, a refused plan is kept on the device as a ghost and the
 *   screens say it was saved — "Saved to your plans", "added to <group> 🎉" —
 *   which is exactly the claim CLAUDE.md forbids. So `one_active` is only
 *   answered to a caller that says it understands it (`accepts_one_active`);
 *   anyone else gets the older rule alone, whose `already_waiting` every
 *   caller already opens.
 */
export function refusalFor(
  found: { live: ActiveCandidate | null; waiting?: ActiveCandidate | null },
  incoming: { type: string; undecided: boolean; solo: boolean; understands: boolean },
): ReturnType<typeof refusalBody> | null {
  if (incoming.solo) return null;
  // The older case first, for every caller: a second undecided group trip
  // meets the undecided one of its type, even behind a decided trip that was
  // made earlier (which `live` would name, and plans_one_waiting would then
  // refuse at the insert with nothing to show for it).
  if (incoming.undecided && found.waiting) return refusalBody(found.waiting, incoming);
  if (found.live && incoming.understands) return refusalBody(found.live, incoming);
  return null;
}

/**
 * The undecided plan of exactly this type still on by its dates — the one
 * the older rule (plans_one_waiting) keeps to one per group.
 */
export function waitingPlanIn<T extends ActiveCandidate>(
  plans: T[], p: { type: string; today: string; except?: string | null },
): T | null {
  return activeOfKind(plans, kindOf(p.type), p.except)
    .find(x => x.destination_style === 'undecided' && String(x.type ?? 'trip') === p.type && live(x, p.today)) ?? null;
}
