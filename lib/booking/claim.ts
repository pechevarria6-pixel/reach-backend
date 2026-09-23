// ─── One approval per booking, settled by the database ──────────────────
// Approval read the row's status, went to the provider, and wrote the result
// — with nothing in between saying "this one is mine". Two presses of "Book
// it" (a double tap, two members at once, a retry after a slow answer) both
// read awaiting_approval, both reached the airline, and the group owned two
// flights. Reading first cannot fix that; both requests read before either
// writes. A conditional update can: only one of them matches.
//
// So approval claims the row — status 'booking', only where it is still
// 'awaiting_approval' — after every check that can refuse, and before the
// provider is called. Whoever matches nothing is told somebody else is
// already booking it. The final write only moves a row this claim still
// holds.
//
// The claim is also taken only on the row as approval read it: the same
// `updated_at`. Status alone let a change made in the meantime go unnoticed
// — somebody picking another flight on the options screen, or holding it,
// while approval was re-pricing the old one — and the old choice was booked
// under a row that now described the new one. Any write to a booking moves
// updated_at, so a row that changed since it was read is not claimed, and
// the person is told it changed rather than that it was bought.
//
// 'booking' is a new status and the bookings CHECK constraint refuses it
// until sql/wave1-bookings-2026-09-22.sql runs. Until then the claim is a
// stamp: approved_at and updated_at both set to the same instant, on a row
// still awaiting approval. Nothing else writes both at once, so that pair is
// what says "mid-booking" (midClaim below) to the other routes — options,
// hold, the status PATCH, and deleting a trip — which all refuse such a row.
// An approved_at left on an awaiting row by something older does not look
// like a claim, and does not lock the row for good.
//
// A row stuck mid-claim (the function was killed while the provider was
// answering, or the provider's answer never came back) is never retried on
// its own: the provider may hold an order for it. It answers
// `already_in_progress` until somebody looks.
import type { SupabaseClient } from '@supabase/supabase-js';

export const M1 = 'sql/wave1-bookings-2026-09-22.sql';

/** How the claim was taken, and the stamp that proves it is still ours. */
export interface Claim { how: 'status' | 'stamp'; at: string; by: string }

export type ClaimResult =
  | { ok: true; claim: Claim }
  /** `taken`: somebody else holds it. Otherwise `error` says what failed. */
  | { ok: false; taken: boolean; error?: string };

type Err = { code?: string; message?: string } | null;

type Versioned = { status?: unknown; approved_at?: unknown; updated_at?: unknown };

const instant = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Whether a booking is at the provider right now: claimed by an approval
 * that has not finished. 'booking' after M1; before it, the stamp — an
 * awaiting row whose approved_at and updated_at are the same instant.
 */
export function midClaim(row: Versioned): boolean {
  if (row.status === 'booking') return true;
  if (row.status !== 'awaiting_approval') return false;
  const a = instant(row.approved_at);
  return a !== null && a === instant(row.updated_at);
}

/**
 * Whether a trip or a group may not be deleted over this row: something is
 * bought, handed over, or at the provider this minute.
 */
export function holdsSomething(row: Versioned): boolean {
  return ['confirmed', 'redirected', 'pending', 'booking'].includes(String(row.status)) || midClaim(row);
}

/** The version filter every conditional write to a booking uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function atVersion<Q extends { eq: (c: string, v: string) => any; is: (c: string, v: null) => any }>(
  q: Q, updatedAt: unknown,
): Q {
  return (typeof updatedAt === 'string' && updatedAt ? q.eq('updated_at', updatedAt) : q.is('updated_at', null)) as Q;
}

/** The status CHECK refusing 'booking': the migration has not run. */
export function statusNotAllowed(error: Err): boolean {
  return !!error && (error.code === '23514' || /bookings_status_check|violates check constraint/i.test(error.message ?? ''));
}

export async function claimBooking(
  db: SupabaseClient, id: string, by: string, version: unknown, now: Date = new Date(),
): Promise<ClaimResult> {
  const at = now.toISOString();
  const first = await atVersion(db.from('bookings')
    .update({ status: 'booking', approved_by: by, approved_at: at, updated_at: at })
    .eq('id', id).eq('status', 'awaiting_approval'), version)
    .select('id');
  if (!first.error) {
    return first.data?.length ? { ok: true, claim: { how: 'status', at, by } } : { ok: false, taken: true };
  }
  if (!statusNotAllowed(first.error)) {
    return { ok: false, taken: false, error: first.error.message ?? 'claim failed' };
  }

  console.error(`[approve] claiming with a stamp: the 'booking' status is not allowed yet — run ${M1}`);
  // The caller has already refused a row that midClaim says is mid-booking,
  // and the version says nobody has written to it since — so a second
  // approval that read the row after this stamp sees the stamp, and one that
  // read it before holds an older version and matches nothing.
  const stamp = await atVersion(db.from('bookings')
    .update({ approved_by: by, approved_at: at, updated_at: at })
    .eq('id', id).eq('status', 'awaiting_approval'), version)
    .select('id');
  if (stamp.error) return { ok: false, taken: false, error: stamp.error.message ?? 'claim failed' };
  return stamp.data?.length ? { ok: true, claim: { how: 'stamp', at, by } } : { ok: false, taken: true };
}

/**
 * Write the outcome, but only onto a row this claim still holds. Returns the
 * row, or null when the claim was lost — which after a successful booking
 * means the provider holds an order our table does not point at.
 */
export async function finishClaim(
  db: SupabaseClient, id: string, claim: Claim, patch: Record<string, unknown>,
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const held = claim.how === 'status' ? 'booking' : 'awaiting_approval';
  const { data, error } = await db.from('bookings')
    .update({ ...patch, approved_by: claim.by, approved_at: claim.at })
    .eq('id', id).eq('status', held).eq('approved_at', claim.at)
    .select()
    .maybeSingle();
  if (error) return { row: null, error: error.message ?? 'update failed' };
  return { row: (data as Record<string, unknown> | null) ?? null, error: null };
}

const CHANGEABLE = new Set(['quoted', 'awaiting_approval']);

/**
 * Why this booking cannot be swapped or held right now, or null if it can.
 * Read by the options and hold routes before any write, which is then taken
 * only on the version read (atVersion).
 *
 * A row mid-booking is refused: before M1 it still reads awaiting_approval,
 * and a hold or a new flight written onto it while the provider was
 * answering booked the old choice under a row describing the new one — or
 * moved it to 'quoted', lost approval its claim, and had the order cancelled.
 *
 * So is anything Reach does not buy. A flight handed to the airline's own
 * site given a Duffel price by "pick another flight" was charged to the
 * group as a share, and then booked as a handoff with the price taken off —
 * money collected for nothing.
 */
export function changeRefusal(row: Versioned & { mode?: unknown }): string | null {
  if (midClaim(row)) return 'Somebody is booking this right now.';
  if (row.status === 'confirmed') return 'This is already booked. To change it, cancel it first — then pick another.';
  if (!CHANGEABLE.has(String(row.status))) return 'This one cannot be changed right now.';
  if (row.mode === 'redirect' || row.mode === 'concierge') {
    return "Reach isn't buying this one — it is booked on the seller's own site — so there is nothing to change here.";
  }
  return null;
}
