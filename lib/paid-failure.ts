// ─── A booking failed after the group had paid ───────────────────────────
// Moab collected $1,474, every booking on it failed at the provider, and the
// only trace was a console.error in a function log nobody reads. The screen
// told the traveller "we'll follow up", and nothing did, because nothing
// knew.
//
// This is the one call the approve route makes when a provider refuses, or
// throws, on a plan somebody has already paid into. It tells the error
// reporter, and it emails the inbox the rest of Reach's emails already give
// customers. Each of those says so in the log when it is not configured
// (no SENTRY_DSN, no RESEND_API_KEY), so a silent alert is a visible gap
// rather than a quiet one.
//
// It never throws and never changes the response. Whatever the approve route
// was going to say to the person, it still says.
import type { SupabaseClient } from '@supabase/supabase-js';
import { report } from '@/lib/report';
import { sendPaidFailureAlert } from '@/lib/email';
import { collectedCents, paidFailureNotice, type ContributionRow } from '@/lib/refunds';

export async function reportPaidFailure(
  db: SupabaseClient,
  booking: { id: string | number; plan_id: string; vertical?: string | null; detail?: string | null },
  reason: string | null | undefined,
): Promise<void> {
  try {
    // select('*') rather than naming refunded_cents, so this still reads
    // before sql/wave1-refunds-2026-09-22.sql has run. A missing column is
    // counted as nothing refunded.
    const [{ data: contributions, error: readError }, { data: plan }] = await Promise.all([
      db.from('contributions').select('*').eq('plan_id', booking.plan_id),
      db.from('plans').select('title').eq('id', booking.plan_id).maybeSingle(),
    ]);
    if (readError) {
      // Unknown whether anybody paid. Report it anyway: a false alarm costs
      // a minute, a missed one costs somebody their money.
      report(new Error(`booking failed; could not tell whether money was collected: ${reason ?? 'no reason'}`), {
        where: 'bookings/approve',
        extra: { planId: booking.plan_id, bookingId: String(booking.id), vertical: booking.vertical ?? null, code: readError.code },
      });
      return;
    }

    const collected = collectedCents((contributions ?? []) as ContributionRow[]);
    const what = [booking.vertical, booking.detail].filter(Boolean).join(' · ') || null;
    const notice = paidFailureNotice({
      planId: booking.plan_id,
      planTitle: plan?.title ?? null,
      bookingId: String(booking.id),
      what,
      reason,
      collectedCents: collected,
    });
    // Nothing collected: the checkout screen already handles a failure
    // before payment, and alerting on those would bury the ones that matter.
    if (!notice) return;

    report(new Error(notice.subject), {
      where: 'bookings/approve',
      extra: {
        planId: booking.plan_id, bookingId: String(booking.id),
        vertical: booking.vertical ?? null, collectedCents: collected, reason: reason ?? null,
      },
    });
    const mail = await sendPaidFailureAlert(notice);
    if (!mail.sent) {
      console.error('[paid-failure] the owner was not emailed about a paid booking that failed', {
        planId: booking.plan_id, bookingId: String(booking.id), why: mail.reason, detail: mail.detail,
      });
    }
  } catch (e) {
    console.error('[paid-failure] could not report a paid booking that failed', {
      planId: booking.plan_id, bookingId: String(booking.id), e: e instanceof Error ? e.message : String(e),
    });
  }
}
