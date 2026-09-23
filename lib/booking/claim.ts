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
// 'booking' is a new status and the bookings CHECK constraint refuses it
// until sql/wave1-bookings-2026-09-22.sql runs. Until then the claim is taken
// on approved_at instead: set only where it is still empty, on a row still
// awaiting approval. That is the same conditional update on a column that
// exists today. It was chosen over claiming with 'pending', which is a real
// state other screens read as "handed over" and the plan's booked check
// reads as settled — a claim that died half way would have looked like a
// booking somebody made.
//
// A row stuck mid-claim (the function was killed while the provider was
// answering) is never retried on its own: the provider may hold an order for
// it. It answers `already_in_progress` until somebody looks.
import type { SupabaseClient } from '@supabase/supabase-js';

export const M1 = 'sql/wave1-bookings-2026-09-22.sql';

/** How the claim was taken, and the stamp that proves it is still ours. */
export interface Claim { how: 'status' | 'stamp'; at: string; by: string }

export type ClaimResult =
  | { ok: true; claim: Claim }
  /** `taken`: somebody else holds it. Otherwise `error` says what failed. */
  | { ok: false; taken: boolean; error?: string };

type Err = { code?: string; message?: string } | null;

/** The status CHECK refusing 'booking': the migration has not run. */
export function statusNotAllowed(error: Err): boolean {
  return !!error && (error.code === '23514' || /bookings_status_check|violates check constraint/i.test(error.message ?? ''));
}

export async function claimBooking(
  db: SupabaseClient, id: string, by: string, now: Date = new Date(),
): Promise<ClaimResult> {
  const at = now.toISOString();
  const first = await db.from('bookings')
    .update({ status: 'booking', approved_by: by, approved_at: at, updated_at: at })
    .eq('id', id).eq('status', 'awaiting_approval')
    .select('id');
  if (!first.error) {
    return first.data?.length ? { ok: true, claim: { how: 'status', at, by } } : { ok: false, taken: true };
  }
  if (!statusNotAllowed(first.error)) {
    return { ok: false, taken: false, error: first.error.message ?? 'claim failed' };
  }

  console.error(`[approve] claiming on approved_at: the 'booking' status is not allowed yet — run ${M1}`);
  const stamp = await db.from('bookings')
    .update({ approved_by: by, approved_at: at, updated_at: at })
    .eq('id', id).eq('status', 'awaiting_approval').is('approved_at', null)
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
