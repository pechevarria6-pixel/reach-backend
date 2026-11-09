// ─── Payments kill switch (pilot gate §A1) ──────────────────────────────
// One environment variable stops every new movement of money without a
// deploy of code: PAYMENTS_ENABLED=false in Vercel, then redeploy (an env
// change only reaches a deployment built after it). Unset, or anything else,
// means payments run — the switch exists to stop money, so it must never be
// the reason money stops by accident.
//
// What it stops: a new PaymentIntent for somebody's share (/funding POST, the
// pay step of checkout) and approval of anything Reach pays a provider for
// (/approve). What it leaves alone: recording money that has already moved
// (/funding/confirm, the Stripe webhook), refunds, and handing somebody a
// seller's own link — none of those is Reach starting to move money, and
// stopping them would lose facts or strand people mid-way.
//
// "false" is read without regard to case or spaces around it. An owner
// typing FALSE into the Vercel dashboard meant it.
//
// docs/pilot/PAYMENTS-KILL-SWITCH.md has the flip procedure.

export function paymentsPaused(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.PAYMENTS_ENABLED ?? '').trim().toLowerCase() === 'false';
}

/** The words a member reads. Nothing was taken, and it is a moment, not a failure. */
export const PAYMENTS_PAUSED_MESSAGE =
  'Payments are paused for a moment. Nothing has been charged and nothing was booked — try again a little later.';

/** The body and status every paused route answers with. */
export function pausedAnswer(): { body: { code: 'payments_paused'; error: string }; status: 503 } {
  return { body: { code: 'payments_paused', error: PAYMENTS_PAUSED_MESSAGE }, status: 503 };
}
