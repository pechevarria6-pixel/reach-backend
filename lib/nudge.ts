// ─── One nudge a minute, per trip ────────────────────────────────────────
// "Nudge them by email" on a group trip's wait emails everybody who has not
// answered yet. Nothing stopped it being pressed ten times in a row, and
// every press is another email in somebody's inbox from their friends'
// trip — the fastest way to make people stop opening them.
//
// So a trip can be nudged once a minute, by anybody in it. Recorded in
// audit_logs rather than in a module variable, because a counter in memory is
// per serverless instance: two presses can land on two instances and both
// find nothing there, which is not a limit.
//
// A double-tap is two requests at the same instant, and both would read
// "nothing in the last minute" before either wrote. So each writes its claim
// first and then looks: whichever claim is oldest wins, and a later one takes
// itself back out and is refused. Taking it out matters — a refused press
// left on the record would push the minute along, and somebody pressing
// every few seconds could keep the button shut for ever.
import type { SupabaseClient } from '@supabase/supabase-js';
import { planShares, type PlanBooking, type Skip } from './money.ts';
import { netCollectedCents } from './booking/approval.ts';

export const NUDGE_ACTION = 'prefs_nudged';
export const NUDGE_COOLDOWN_MS = 60_000;

/**
 * Which nudges are held to the minute. Every nudge that reaches somebody —
 * the bell, their phone, or their inbox — is: answers still to give, votes
 * still to cast, and shares still to pay. The funding nudge used to be left
 * out, so "remind everyone to pay" could be pressed as often as anybody
 * liked, each press an email in every unpaid inbox.
 */
export function limitsNudge(kind: string): boolean {
  return kind === 'prefs' || kind === 'vote' || kind === 'funding';
}

export interface NudgeClaim {
  allowed: boolean;
  /** Seconds until the next nudge can go, when refused. */
  retryAfterSeconds: number;
  /** The record this nudge holds, so a send that went nowhere can give it back. */
  claimId?: string | null;
}

type Row = { id: string; created_at: string };

function wait(rows: Row[], now: Date): number {
  const first = rows[0] ? new Date(rows[0].created_at).getTime() : now.getTime();
  return Math.max(1, Math.ceil((first + NUDGE_COOLDOWN_MS - now.getTime()) / 1000));
}

/**
 * Claims this minute's nudge for a trip, or says how long until the next.
 *
 * Fails open if the record cannot be read or written: a reminder email that
 * goes twice is a smaller harm than a button that never works, and the read
 * failing is logged.
 */
export async function claimNudge(
  db: SupabaseClient,
  planId: string,
  userId: string,
  now: Date = new Date(),
): Promise<NudgeClaim> {
  const since = new Date(now.getTime() - NUDGE_COOLDOWN_MS).toISOString();
  const recent = () => db
    .from('audit_logs').select('id, created_at')
    .eq('action', NUDGE_ACTION).eq('resource_id', planId)
    .gte('created_at', since)
    .order('created_at', { ascending: true }).order('id', { ascending: true });

  const before = await recent();
  if (before.error) {
    console.error('[nudge] could not read when this trip was last nudged — allowing', { planId, code: before.error.code });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if ((before.data || []).length) {
    return { allowed: false, retryAfterSeconds: wait(before.data as Row[], now) };
  }

  const { data: mine, error: wrote } = await db
    .from('audit_logs')
    .insert({ user_id: userId, action: NUDGE_ACTION, resource: 'plans', resource_id: planId, success: true })
    .select('id').single();
  if (wrote || !mine) {
    console.error('[nudge] could not record this nudge — allowing, uncounted', { planId, code: wrote?.code });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const after = await recent();
  const rows = (after.data || []) as Row[];
  if (after.error || !rows.length || rows[0].id === mine.id) {
    return { allowed: true, retryAfterSeconds: 0, claimId: String(mine.id) };
  }

  // Somebody else's press got there first.
  const { error: undone } = await db.from('audit_logs').delete().eq('id', mine.id);
  if (undone) console.error('[nudge] could not take back a refused claim', { planId, code: undone.code });
  return { allowed: false, retryAfterSeconds: wait(rows, now) };
}

/**
 * Gives a claim back when nothing was sent — email switched off, every send
 * failed — so the next press can try again straight away rather than being
 * told to wait a minute for an email that never went.
 */
export async function releaseNudge(db: SupabaseClient, claimId: string | null | undefined): Promise<void> {
  if (!claimId) return;
  const { error } = await db.from('audit_logs').delete().eq('id', claimId);
  if (error) console.error('[nudge] could not release a nudge that sent nothing', { code: error.code });
}

// ─── One nudge per person per twelve hours ──────────────────────────────
// The minute above is per trip, and it bounds how often the button fires.
// It does not bound how often one person hears about it: a group of four
// pressing it once a minute each is still a message a minute in Sam's
// pocket. And once any grey face can be tapped to nudge that one person,
// the minute cannot be the limit at all — tapping Sam, then Jo, then Sam
// again would each be a fresh press.
//
// So each person on a plan can be nudged once in twelve hours, whoever does
// it and whichever thing they are still to do. Per plan: the same group's
// night out and trip are two different asks. The same claim-then-look as the
// minute, one audit_logs row per person on the plan — so a tap on
// Sam's face and "Remind everyone" landing at the same instant send Sam one
// nudge between them, not two.
//
// The row's resource_id is the plan and the person is metadata.to. It was
// keyed '<plan>:<person>' in resource_id, and on 2026-11-05 three funding
// nudges to the same person inside five seconds all went, each a bell and an
// email: the live audit_logs was never checked in (sql/core-schema.sql was
// written down after it), every other writer puts a uuid in that column, and
// a key that is not one is refused on read and on write — and refused means
// "allowing, uncounted" below. A plan id is the one value that column is
// certain to take.

export const PERSON_NUDGE_ACTION = 'person_nudged';
export const PERSON_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export interface PeopleClaim {
  /** People this nudge may reach. claimId is null when the record could not be written. */
  claimed: Array<{ userId: string; claimId: string | null }>;
  /** People nudged in the last twelve hours, and how long until they can be again. */
  held: Array<{ userId: string; retryAfterSeconds: number }>;
}

type KeyedRow = { id: string; created_at: string; metadata?: { to?: unknown } | null };

const whoOf = (r: KeyedRow) => String(r.metadata?.to ?? '');

/** The oldest claim for each person inside the window: the one that holds it. */
function firstByPerson(rows: KeyedRow[]): Map<string, KeyedRow> {
  const first = new Map<string, KeyedRow>();
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || String(a.id).localeCompare(String(b.id)));
  for (const r of sorted) if (whoOf(r) && !first.has(whoOf(r))) first.set(whoOf(r), r);
  return first;
}

function waitFrom(row: KeyedRow, now: Date): number {
  return Math.max(1, Math.ceil((new Date(row.created_at).getTime() + PERSON_COOLDOWN_MS - now.getTime()) / 1000));
}

function recentPeople(db: SupabaseClient, planId: string, userIds: string[], now: Date) {
  const since = new Date(now.getTime() - PERSON_COOLDOWN_MS).toISOString();
  return db
    .from('audit_logs').select('id, created_at, metadata')
    .eq('action', PERSON_NUDGE_ACTION).eq('resource_id', planId)
    .in('metadata->>to', userIds)
    .gte('created_at', since)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
}

/**
 * Claims the next twelve hours of nudging for each of these people on this
 * plan, and says who was nudged too recently.
 *
 * Fails open, like the minute: if the record cannot be read or written the
 * nudge goes, uncounted, and it is logged. The minute still bounds a
 * whole-group press when that happens.
 */
export async function claimPeople(
  db: SupabaseClient,
  planId: string,
  byUserId: string,
  recipientIds: string[],
  now: Date = new Date(),
): Promise<PeopleClaim> {
  const people = [...new Set(recipientIds.filter(Boolean))];
  if (!people.length) return { claimed: [], held: [] };
  const uncounted = (ids: string[]) => ids.map(userId => ({ userId, claimId: null }));

  const before = await recentPeople(db, planId, people, now);
  if (before.error) {
    console.error('[nudge] could not read who was nudged lately — allowing', { planId, code: before.error.code });
    return { claimed: uncounted(people), held: [] };
  }
  const already = firstByPerson((before.data || []) as KeyedRow[]);
  const held: PeopleClaim['held'] = [];
  const candidates: string[] = [];
  for (const userId of people) {
    const row = already.get(userId);
    if (row) held.push({ userId, retryAfterSeconds: waitFrom(row, now) });
    else candidates.push(userId);
  }
  if (!candidates.length) return { claimed: [], held };

  const { data: mine, error: wrote } = await db
    .from('audit_logs')
    .insert(candidates.map(userId => ({
      user_id: byUserId, action: PERSON_NUDGE_ACTION, resource: 'plans',
      resource_id: planId, success: true,
      metadata: { plan: planId, to: userId },
    })))
    .select('id, metadata');
  if (wrote || !mine) {
    console.error('[nudge] could not record who was nudged — allowing, uncounted', { planId, code: wrote?.code });
    return { claimed: uncounted(candidates), held };
  }
  const myRow = new Map((mine as KeyedRow[]).map(r => [whoOf(r), String(r.id)]));

  const after = await recentPeople(db, planId, candidates, now);
  const winners = after.error ? null : firstByPerson((after.data || []) as KeyedRow[]);
  const claimed: PeopleClaim['claimed'] = [];
  const lost: string[] = [];
  for (const userId of candidates) {
    const id = myRow.get(userId) ?? null;
    const first = winners?.get(userId);
    // Ours is the oldest, or we cannot tell: the nudge goes.
    if (!first || String(first.id) === id) {
      claimed.push({ userId, claimId: id });
      continue;
    }
    // Somebody else's nudge for this person got there first.
    held.push({ userId, retryAfterSeconds: waitFrom(first, now) });
    if (id) lost.push(id);
  }
  // Taken back out, like the minute's: a refused claim left on the record
  // would move this person's twelve hours along.
  if (lost.length) {
    const { error: undone } = await db.from('audit_logs').delete().in('id', lost);
    if (undone) console.error('[nudge] could not take back refused claims', { planId, code: undone.code });
  }
  return { claimed, held };
}

/**
 * Gives back the twelve hours for people the nudge never reached — no bell,
 * no phone, the email failed — so they can be nudged again straight away.
 */
export async function releasePeople(db: SupabaseClient, claimIds: Array<string | null | undefined>): Promise<void> {
  const ids = claimIds.filter((x): x is string => !!x);
  if (!ids.length) return;
  const { error } = await db.from('audit_logs').delete().in('id', ids);
  if (error) console.error('[nudge] could not release nudges that reached nobody', { code: error.code });
}

/**
 * When each of these people can next be nudged on this plan: an ISO time,
 * or null when they can be now. For the faces, so a grey face somebody
 * nudged this morning says so instead of offering a tap that will be
 * refused. Null for everyone when the record cannot be read — the tap is
 * still held to the limit by claimPeople.
 */
export async function nudgedUntil(
  db: SupabaseClient, planId: string, userIds: string[], now: Date = new Date(),
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = Object.fromEntries(userIds.map(id => [id, null]));
  if (!userIds.length) return out;
  const { data, error } = await recentPeople(db, planId, userIds, now);
  if (error) {
    console.error('[nudge] could not read who was nudged lately', { planId, code: error.code });
    return out;
  }
  const first = firstByPerson((data || []) as KeyedRow[]);
  for (const id of userIds) {
    const row = first.get(id);
    if (row) out[id] = new Date(new Date(row.created_at).getTime() + PERSON_COOLDOWN_MS).toISOString();
  }
  return out;
}

// ─── Who still owes, for the funding nudge and its faces ────────────────
// Worked out exactly as checkout works it out (fundingStatus in
// app/api/plans/[planId]/funding/route.ts), because the faces say "paid" or
// "pending" and the nudge says "your share is still to pay": both are claims
// about what checkout will ask for, and they must not disagree with it.
//
// Two ways this used to go wrong. Any successful payment counted as paid, so
// somebody who owed a top-up after a flight was added, or had been partly
// refunded, wore a paid tick over money checkout was still asking for and
// could not be nudged. And the share came from the budget every time, where
// checkout drops the budget once any money is in — so after a hotel failed
// at the provider, people checkout says owe nothing were told to pay.

export interface FundingStanding {
  /** Owes nothing more, and has paid something towards it. */
  done: Set<string>;
  /** Owes nothing and paid nothing — sitting all of it out. */
  notNeeded: Set<string>;
  /** Each member's share: the figure checkout divides the plan into. */
  shares: Record<string, number>;
  /** What checkout would ask each member for now (myRemainingCents). */
  remaining: Record<string, number>;
}

type Contribution = { status?: unknown; amount_cents?: unknown; refunded_cents?: unknown; user_id?: unknown };

export function fundingStanding(
  bookings: PlanBooking[], budgetCents: number | null | undefined,
  contributions: Contribution[] | null | undefined, memberIds: string[], skips: Skip[] = [],
): FundingStanding {
  // The budget is a guess only until money has come in — checkout's rule.
  const guessCents = netCollectedCents(contributions) > 0 ? 0 : Math.max(0, budgetCents || 0);
  const shares = planShares(bookings, guessCents, memberIds, skips);
  // And a guess is never asked for: with nothing priced checkout refuses to
  // take a payment ("We're still pricing this") and shows "Nothing to pay".
  // B was nudged three times that "Your share is still to pay" on exactly
  // such a plan (2026-11-05). Nobody owes until something has a price.
  const priced = bookings.some(b => (b.price_cents || 0) > 0);
  const out: FundingStanding = { done: new Set(), notNeeded: new Set(), shares, remaining: {} };
  for (const id of memberIds) {
    const paid = netCollectedCents(contributions, id);
    const owe = priced ? Math.max(0, (shares[id] ?? 0) - paid) : 0;
    out.remaining[id] = owe;
    if (owe > 0) continue;
    (paid > 0 ? out.done : out.notNeeded).add(id);
  }
  return out;
}

/**
 * What a nudge says when there is nobody to send it to. "Everyone else has
 * already answered" on a trip for one is group copy on a screen somebody
 * reached alone (2026-11-05); "Everyone has already paid" on a plan nothing
 * is priced on yet is a payment nobody made.
 */
export function nobodyToNudge(p: {
  kind: 'vote' | 'funding' | 'prefs';
  /** Every member but whoever pressed it. */
  others: string[];
  /** Members with nothing to do here (fundingStanding's notNeeded). */
  notNeeded: Set<string>;
  night: boolean;
}): string {
  const what = p.night ? 'night out' : 'trip';
  if (!p.others.length) return `It's just you on this ${what}, so there's nobody to nudge.`;
  if (p.kind === 'prefs') return 'Everyone else has already answered';
  if (p.kind === 'funding') {
    return p.others.every(id => p.notNeeded.has(id))
      ? `Nobody else has anything to pay on this ${what}.`
      : 'Everyone has already paid';
  }
  return 'Everyone has already done this';
}
