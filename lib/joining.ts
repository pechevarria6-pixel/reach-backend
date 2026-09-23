// ─── Somebody joins a trip that already exists ──────────────────────────
// A solo trip is not a promise to stay solo — people change their minds, and
// "bring someone along" has to be a thing a person can do after the plan is
// made. Two facts change the moment a second person is in the group, and
// both used to stay where they were:
//
//   1. `plans.solo_mode`, set once at creation. The vote, readiness and
//      generation routes read it, so a trip that had become two people kept
//      opening votes and writing itineraries without asking the second one.
//
//   2. Who pays for what is already booked. Funding splits every priced
//      booking across every member, so the newcomer was handed half of a
//      hotel room booked for one — a room that is not theirs, priced as if
//      it were — and the person who had already paid for it saw their share
//      halve under them. Nothing already booked or paid may change because
//      somebody joined.
//
// The second depends on whether anything has actually been bought.
//
//   - Bought: a booking confirmed or pending with a provider, or anything on
//     a plan somebody has already paid into. That is
//     a seat, a room or a ticket in somebody's name, or a total somebody paid
//     against. The newcomer is recorded as not on it, with the mechanism that
//     already answers "who is paying for this booking" — item_optouts — which
//     leaves every existing share exactly where it was. Reach cannot add a
//     person to a flight or a room it has already bought.
//
//   - Not bought: a proposal ('awaiting_approval') or a quote somebody is
//     holding ('quoted'). Nothing is in anybody's name and nobody has paid, so
//     the newcomer is simply on it, and the next time checkout opens it is
//     re-priced for the new number of people (lib/booking/resize.ts) and the
//     total split between them. Keeping them off a proposal left a group that
//     gained a member with no way to put them on the flight or the hotel at
//     all: those cannot be sat out, so they cannot be sat back in either.
//
// Called from every place a membership is created for an existing group:
// POST /api/groups/[id]/members (an admin adding somebody),
// POST /api/invites/[token] (a link opened), and claimInvitesFor (an invite
// claimed at sign-in). Each of those has already decided the person may join;
// this only keeps the group's plans honest about it.
import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST's code for a table that does not exist: the migration has not run. */
const NO_TABLE = 'PGRST205';

export type PriorBooking = { id: string | number; plan_id: string | number; status?: string | null };

/**
 * Bought: with a provider, or confirmed by one — a seat, a room or a ticket in
 * somebody's name, whether or not the money has settled. Not 'redirected':
 * that is a link to somebody else's checkout, and nothing has been bought
 * through Reach at all.
 */
export const BOUGHT: ReadonlySet<string> = new Set(['confirmed', 'pending']);
/** Priced and nothing bought: a proposal, or a quote somebody is holding (lib/booking/charged.ts). */
const UNBOUGHT = new Set(['awaiting_approval', 'quoted']);
/** What is sized by headcount, and so re-sized when somebody joins (lib/booking/resize.ts). */
const RESIZED = new Set(['flight', 'hotel']);
export type OptOutRow = { plan_id: string; item_ref: string; user_id: string };

/**
 * The rows that keep a newcomer off what was bought before they arrived.
 *
 * Bought means past approval, or anything at all on a plan somebody has paid
 * into (`paidPlans`, plan ids) — what they paid against is that plan's total,
 * and it must not move under them. A proposal or a held quote on an unpaid
 * plan is left alone: it is re-priced for everyone going instead.
 *
 * Failed and cancelled bookings are nobody's to pay for. One row per booking,
 * whatever the input repeats — Postgres refuses an upsert that names the same
 * row twice.
 */
export function latecomerOptOuts(
  bookings: PriorBooking[], userId: string, paidPlans: ReadonlySet<string> = new Set(),
): OptOutRow[] {
  if (!userId) return [];
  const seen = new Set<string>();
  const rows: OptOutRow[] = [];
  for (const b of bookings || []) {
    if (b?.id == null || b?.plan_id == null) continue;
    if (b.status === 'failed' || b.status === 'cancelled') continue;
    if (!BOUGHT.has(String(b.status ?? '')) && !paidPlans.has(String(b.plan_id))) continue;
    const key = `${b.plan_id}|${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ plan_id: String(b.plan_id), item_ref: String(b.id), user_id: userId });
  }
  return rows;
}

/** A group of one travels solo. Anything more is a group trip. */
export function isSoloCount(memberCount: number): boolean {
  return !(memberCount > 1);
}

/**
 * What a trip holds, as far as the screen showing the note can tell.
 *
 * `known: false` is a screen that cannot see bookings or payments (the group
 * screen); it gets the sentence that is true whichever way they fall, rather
 * than the reassuring one.
 */
export type TripHolds = { known?: boolean; bought: boolean; unbought: boolean; paidCents: number };

/**
 * TripHolds from the booking rows a screen already has. Only flights and
 * rooms count as unbought here, because those are what the bridge re-sizes
 * (lib/booking/resize.ts); a table or an activity keeps the quote it has.
 */
export function tripHolds(
  bookings: { status?: string | null; vertical?: string | null }[] | null | undefined, paidCents: number,
): TripHolds {
  const rows = bookings ?? [];
  return {
    bought: rows.some(b => BOUGHT.has(String(b?.status ?? ''))),
    unbought: rows.some(b => UNBOUGHT.has(String(b?.status ?? '')) && RESIZED.has(String(b?.vertical))),
    paidCents: Math.max(0, Math.round(paidCents || 0)),
  };
}

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// A person added to a trip already booked needs somewhere to get their own
// seat or room, and Reach is not it: a Duffel order or a LiteAPI booking
// cannot take another passenger or guest, and the bridge hands back the
// booking already on the list rather than quoting a second one. So the
// sentence says where.
const OWN_BOOKING = "Reach can't add someone to a booking it has already made, so they'd book their own seat or room directly with the airline or hotel.";
// Flights and rooms only: those are what the bridge re-sizes. A table or an
// activity keeps the quote it has.
const REPRICED = "flights and rooms not bought yet are priced for everyone going the next time checkout opens, and the cost is split between you and them.";

/**
 * What the screen says beside "Bring someone along".
 *
 * The one thing it must never do is let somebody believe the new person's
 * seat or room came with the invite. Each sentence is what beforeJoining and
 * the bookable bridge actually do: what is bought, and everything on a trip
 * somebody has paid towards, stays the organiser's alone and the newcomer is
 * not added to it; flights and rooms not bought are re-sized for both.
 *
 * It used to promise that "anything for them gets booked separately".
 * Nothing did: for the same flight or hotel the bridge handed back the
 * organiser's own booking. So each branch says who actually does what.
 */
export function bringAlongNote(state: TripHolds): string {
  const paid = Math.max(0, Math.round(state.paidCents || 0));
  if (state.known === false) {
    return `Anything Reach has already booked, and any trip you've paid towards, stays priced for you alone. ${OWN_BOOKING} On a trip you haven't paid towards, ${REPRICED}`;
  }
  if (paid > 0) {
    // Paid for, not necessarily booked yet: what was paid against stays as it
    // is, so nothing on it is re-sized either, and they are not added to it.
    return `You've paid ${usd(paid)} towards this trip, so everything on it stays priced for you alone and they aren't charged for any of it. They'd book their own seat or room directly with the airline or hotel.`;
  }
  if (state.bought) {
    return `What's already booked stays yours alone. ${OWN_BOOKING}${state.unbought ? ` Once they join, ${REPRICED}` : ''}`;
  }
  if (state.unbought) {
    return `Nothing's bought yet. Once they join, ${REPRICED}`;
  }
  return "It stays a trip for one until they join. After that it's planned as a group, and they get a say.";
}

/**
 * Which flights and hotels each member is not on, for a screen to say so.
 * Only those two: they cannot be sat out by choice (the participation route
 * refuses it), so an opt-out on one is somebody who joined after it was
 * bought or paid for (latecomerOptOuts). A dinner somebody chose to sit out
 * is their own business and not what this reports.
 */
export function notOnBooked(
  bookings: { id?: unknown; vertical?: string | null }[] | null | undefined,
  skips: { ref: string; userId: string }[] | null | undefined,
  memberIds: string[],
): Record<string, ('flight' | 'hotel')[]> {
  const kind = new Map<string, 'flight' | 'hotel'>();
  for (const b of bookings ?? []) {
    if (b?.id != null && RESIZED.has(String(b.vertical))) kind.set(String(b.id), b.vertical as 'flight' | 'hotel');
  }
  const members = new Set(memberIds);
  const out: Record<string, ('flight' | 'hotel')[]> = {};
  for (const s of skips ?? []) {
    const v = kind.get(String(s.ref));
    if (!v || !members.has(s.userId)) continue;
    const list = (out[s.userId] ??= []);
    if (!list.includes(v)) list.push(v);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** `error` is the sentence to show when `ok` is false. */
export type JoinOutcome = { ok: boolean; satOut?: number; error?: string };

/**
 * Before the membership row is written: keep the newcomer off what is already
 * bought. Done first, so there is no moment in which they are a member and
 * funding quotes them a share of somebody else's room.
 *
 * A failure here stops the join. Letting them in anyway would split bookings
 * already bought or paid for. The one exception is
 * a deployment that has not run sql/preferences-v1.sql: there, nobody can be
 * kept off anything, shares split evenly as they always did, and refusing
 * every join would be worse than that.
 */
export async function beforeJoining(db: SupabaseClient, groupId: string, userId: string): Promise<JoinOutcome> {
  const { data: plans, error: plansErr } = await db.from('plans').select('id').eq('group_id', groupId);
  if (plansErr) {
    console.error('[joining] could not read the group’s plans', { groupId, code: plansErr.code });
    return { ok: false, error: "We couldn't check this group's trips just now — try again in a moment." };
  }
  const planIds = (plans ?? []).map(p => String((p as { id: unknown }).id));
  if (!planIds.length) return { ok: true, satOut: 0 };

  const { data: bookings, error: bookingsErr } = await db
    .from('bookings').select('id, plan_id, status').in('plan_id', planIds);
  if (bookingsErr) {
    console.error('[joining] could not read what the group’s trips hold', { groupId, code: bookingsErr.code });
    return { ok: false, error: "We couldn't check what's already booked — try again in a moment." };
  }

  // Plans somebody has paid into: everything on them stays as it was paid for.
  const { data: paid, error: paidErr } = await db
    .from('contributions').select('plan_id').in('plan_id', planIds).eq('status', 'succeeded');
  if (paidErr) {
    console.error('[joining] could not read what has been paid', { groupId, code: paidErr.code });
    return { ok: false, error: "We couldn't check what's already been paid — try again in a moment." };
  }
  const paidPlans = new Set((paid ?? []).map(c => String((c as { plan_id: unknown }).plan_id)));

  const rows = latecomerOptOuts((bookings ?? []) as PriorBooking[], userId, paidPlans);
  if (!rows.length) return { ok: true, satOut: 0 };

  const { error: optErr } = await db
    .from('item_optouts')
    .upsert(rows, { onConflict: 'plan_id,item_ref,user_id', ignoreDuplicates: true });
  if (optErr) {
    if (optErr.code === NO_TABLE) {
      console.error('[joining] item_optouts is missing — a newcomer will share existing bookings; run sql/preferences-v1.sql', { groupId });
      return { ok: true, satOut: 0 };
    }
    console.error('[joining] could not keep the newcomer off existing bookings', { groupId, code: optErr.code });
    return { ok: false, error: "We couldn't add them without changing what's already booked — try again in a moment." };
  }
  return { ok: true, satOut: rows.length };
}

/**
 * After the membership row is written: a group of more than one is not solo,
 * so no plan of theirs may go on saying it is.
 *
 * Not a reason to undo the join if it fails — the person is in, and the
 * readiness check counts members as well as reading the flag, so a stale
 * flag cannot skip them. It is said out loud all the same.
 */
export async function afterJoining(db: SupabaseClient, groupId: string): Promise<{ soloEnded: number }> {
  const { data: members, error: membersErr } = await db
    .from('group_members').select('user_id').eq('group_id', groupId);
  if (membersErr) {
    console.error('[joining] could not count the group after a join', { groupId, code: membersErr.code });
    return { soloEnded: 0 };
  }
  if (isSoloCount((members ?? []).length)) return { soloEnded: 0 };

  const { data: flipped, error: flipErr } = await db
    .from('plans').update({ solo_mode: false })
    .eq('group_id', groupId).eq('solo_mode', true)
    .select('id');
  if (flipErr) {
    console.error('[joining] a trip still says solo after somebody joined', { groupId, code: flipErr.code });
    return { soloEnded: 0 };
  }
  return { soloEnded: (flipped ?? []).length };
}
