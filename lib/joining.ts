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
// The second is fixed with the mechanism that already answers "who is paying
// for this booking": item_optouts. Whoever joins is recorded as not on every
// booking that existed before they arrived, which leaves every existing
// share exactly where it was. Their own seat, room or ticket has not been
// booked or priced, and the screens say so rather than implying it has.
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
export type OptOutRow = { plan_id: string; item_ref: string; user_id: string };

/**
 * The rows that keep a newcomer off everything booked before they arrived.
 *
 * Failed and cancelled bookings are nobody's to pay for, so they are left
 * alone. One row per booking, whatever the input repeats — Postgres refuses
 * an upsert that names the same row twice.
 */
export function latecomerOptOuts(bookings: PriorBooking[], userId: string): OptOutRow[] {
  if (!userId) return [];
  const seen = new Set<string>();
  const rows: OptOutRow[] = [];
  for (const b of bookings || []) {
    if (b?.id == null || b?.plan_id == null) continue;
    if (b.status === 'failed' || b.status === 'cancelled') continue;
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
 * What the plan screen says beside "Bring someone along".
 *
 * The only thing it must never do is let somebody believe the new person's
 * seat, room or ticket came with the invite. So once anything is booked or
 * paid, it says what stays and what does not, in that order.
 */
export function bringAlongNote(state: { hasBookings: boolean; paidCents: number }): string {
  const paid = Math.max(0, Math.round(state.paidCents || 0));
  if (!state.hasBookings && paid === 0) {
    return "It stays a trip for one until they join. After that it's planned as a group, and they get a say.";
  }
  const kept = paid > 0
    ? `What you've booked and the $${(paid / 100).toLocaleString('en-US', { minimumFractionDigits: paid % 100 ? 2 : 0, maximumFractionDigits: 2 })} you've paid stay exactly as they are, and they're for you alone.`
    : "What's already lined up stays exactly as it is, and it's for you alone.";
  return `${kept} Adding someone doesn't book them a seat, a room or a ticket, and their share isn't priced yet — anything for them gets booked separately.`;
}

/** `error` is the sentence to show when `ok` is false. */
export type JoinOutcome = { ok: boolean; satOut?: number; error?: string };

/**
 * Before the membership row is written: keep the newcomer off what is already
 * booked. Done first, so there is no moment in which they are a member and
 * funding quotes them a share of somebody else's room.
 *
 * A failure here stops the join. Letting them in anyway would re-price every
 * booking on the trip, including ones already paid for. The one exception is
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

  const rows = latecomerOptOuts((bookings ?? []) as PriorBooking[], userId);
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
