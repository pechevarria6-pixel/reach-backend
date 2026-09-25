// ─── POST /api/bookings/[id]/confirmation — "I've got it" ────────────────
// Some bookings Reach cannot finish itself: a ticket on the seller's site, a
// table on Resy, a flight handed to the airline. The row carries a
// redirect_url, the screen says "Finish on <provider> →", and the person
// books it there. When they come back and press "I've got it", this is where
// they say so — and where the confirmation number the seller gave them is
// kept, so the trip wallet can show it next to the booking.
//
// body { confirmationNumber?: string | null }   (empty or absent: "I didn't get one")
//
// → 200 { booking, kept }  kept: whether the number was stored. False only
//   before sql/booking-confirmation-2026-09-25.sql runs: the booking is still
//   marked done — "I've got it" must work — and the log names the file.
//
// Only for what somebody books elsewhere (reachBuys false). Reach's own
// purchases are settled by approval and cancel, never by somebody saying so,
// the same rule the status PATCH next door keeps.
//
// A double tap is two requests at once. Both read the row at one version and
// only one write can match it; the other re-reads, and if the row already
// says what it asked for, answers the same 200 rather than "this changed".
//
// The number is what the person typed. Reach did not see the seller's
// confirmation, so a screen shows it as "You entered ABC123", never as
// confirmed by Reach.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { reachBuys } from '@/lib/booking/charged';
import { atVersion, midClaim } from '@/lib/booking/claim';
import { confirmationInput, confirmationColumnMissing } from '@/lib/contracts/booking';

const MIGRATION = 'sql/booking-confirmation-2026-09-25.sql';
const RETURNED = 'id, plan_id, vertical, status, mode, provider, provider_ref, redirect_url, updated_at';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({})) as { confirmationNumber?: unknown };
  const input = confirmationInput(body?.confirmationNumber);
  if (input.ok === false) return NextResponse.json({ error: input.error }, { status: 400 });
  const number = input.value;

  const { data: booking, error: readErr } = await createServerClient()
    .from('bookings')
    .select('id, plan_id, status, mode, provider, approved_at, updated_at')
    .eq('id', params.id).maybeSingle();
  if (readErr) {
    console.error('[confirmation] could not read the booking', { id: params.id, code: readErr.code });
    return NextResponse.json({ error: 'Could not read that booking just now.' }, { status: 500 });
  }
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const ctx = await requirePlanMember(booking.plan_id);
  if (isFail(ctx)) return ctx.error;

  if (reachBuys(booking)) {
    return NextResponse.json({
      error: 'Reach books this one itself, so how it went comes from the booking, not from here.',
    }, { status: 409 });
  }
  if (midClaim(booking)) {
    return NextResponse.json({ error: 'Somebody is booking this right now.' }, { status: 409 });
  }
  if (booking.status === 'cancelled' || booking.status === 'failed') {
    return NextResponse.json({
      error: "This one was taken off the trip, so there's nothing to mark as done. Open checkout for what's still to book.",
    }, { status: 409 });
  }

  const now = new Date().toISOString();
  const base = { status: 'confirmed', fulfilled_by: ctx.user.id, updated_at: now };
  const write = (fields: Record<string, unknown>) => atVersion(ctx.db.from('bookings')
    .update(fields).eq('id', params.id), booking.updated_at)
    .select(RETURNED).maybeSingle();

  let kept = true;
  let res = await write({ ...base, confirmation_number: number });
  if (res.error && confirmationColumnMissing(res.error)) {
    // The column is not there yet. The booking is still done — that is what
    // the person came to say — and the number waits for the migration.
    console.error(`[confirmation] bookings.confirmation_number is missing — run ${MIGRATION}; marked done without the number`, { id: params.id });
    kept = false;
    res = await write(base);
  }
  if (res.error) {
    console.error('[confirmation] could not save', { id: params.id, code: res.error.code });
    const shape = res.error.code === '23514';
    return NextResponse.json({
      error: shape
        ? "That confirmation number couldn't be kept — check it and try again."
        : 'Could not save that just now — try again in a moment.',
    }, { status: shape ? 400 : 500 });
  }

  if (!res.data) {
    // Somebody wrote to the row between the read and the write — most often
    // this same person's second tap. If it now says what this request came to
    // say, that is the answer, not a conflict.
    const { data: fresh, error: againErr } = await ctx.db.from('bookings')
      .select('*').eq('id', params.id).maybeSingle();
    if (againErr) {
      console.error('[confirmation] could not re-read after a lost write', { id: params.id, code: againErr.code });
      return NextResponse.json({ error: 'Could not save that just now — try again in a moment.' }, { status: 500 });
    }
    const row = fresh as Record<string, unknown> | null;
    const stored = typeof row?.confirmation_number === 'string' ? row.confirmation_number : null;
    const hasColumn = !!row && 'confirmation_number' in row;
    if (row?.status === 'confirmed' && (!hasColumn || !number || stored === number)) {
      return NextResponse.json({ booking: pick(row), kept: hasColumn && (!number || stored === number) });
    }
    return NextResponse.json({ error: 'This changed while you were looking — reopen it.' }, { status: 409 });
  }

  return NextResponse.json({ booking: { ...res.data, confirmation_number: kept ? number : null }, kept });
}

/** The same fields the write returns, from a whole-row read. */
function pick(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RETURNED.split(', ')) out[k] = row[k] ?? null;
  out.confirmation_number = typeof row.confirmation_number === 'string' ? row.confirmation_number : null;
  return out;
}
