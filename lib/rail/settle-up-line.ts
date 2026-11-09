// ─── The settle-up line for a booking somebody paid for themselves ──────
// Shared by "I've got it" / "Booked it ✓" (POST /api/bookings/[id]/confirmation)
// and the status PATCH next door, so a booking marked done either way goes
// into settle-up the same way, and one marked not done comes back out of it.
// The decisions are in lib/rail/expense.ts, where a test can hold them.
import type { SupabaseClient } from '@supabase/supabase-js';
import { groupMemberIds } from '@/lib/auth';
import { planSkips } from '@/lib/participation';
import { expenseForBooking, removeBookingExpense, writeBookingExpense } from '@/lib/rail/expense';

export type SettleUpOutcome = 'written' | 'already' | 'none' | 'not_recorded';

/**
 * The expense for what somebody just paid on the seller's own site, so the
 * group settles it up. Never fails the caller: the booking is done whatever
 * happens here, and a failure is logged.
 */
export async function settleUpLine(
  ctx: { db: SupabaseClient; user: { id: string }; plan: Record<string, unknown> },
  booking: Record<string, unknown>,
  stated: number | null,
): Promise<SettleUpOutcome> {
  try {
    const [members, skips] = await Promise.all([
      groupMemberIds(ctx.db, String(ctx.plan.group_id)),
      planSkips(ctx.db, String(booking.plan_id)),
    ]);
    const row = expenseForBooking(
      { ...booking, id: booking.id, group_id: booking.group_id ?? ctx.plan.group_id },
      { paidBy: ctx.user.id, members, skips }, stated,
    );
    if (!row) return 'none';
    const wrote = await writeBookingExpense(ctx.db, row);
    if (wrote.ok === false) {
      console.error('[settle-up line] booked, and the expense for settle-up could not be written', { id: booking.id, code: wrote.code });
      return 'not_recorded';
    }
    return wrote.kept === 'already' ? 'already' : 'written';
  } catch (e) {
    console.error('[settle-up line] could not work out the expense for settle-up', { id: booking.id, e: e instanceof Error ? e.message : String(e) });
    return 'not_recorded';
  }
}

/** "Not booked after all": the expense that booking wrote comes back off. */
export async function takeOffSettleUp(db: SupabaseClient, bookingId: string): Promise<void> {
  const { ok, code } = await removeBookingExpense(db, bookingId);
  if (!ok) console.error('[settle-up line] could not take a booking\'s expense back off', { id: bookingId, code });
}
