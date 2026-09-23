// ─── What a refund means to a group's money ──────────────────────────────
// A contribution counts towards the trip's target only while it is
// 'succeeded'. Refund it in Stripe and the money is gone from the account,
// but the row went on saying succeeded — so the plan still looked funded, and
// the approve gate would have booked a hotel with money that had been handed
// back. Nobody would find out until a provider was paid.
//
// A refund of part of a payment could not be written down at all until
// contributions grew a refunded_cents column (sql/wave1-refunds-2026-09-22.sql).
// Everything that counts money now counts amount_cents less refunded_cents,
// and every read of that column treats a missing one as nothing refunded, so
// this file works the same before the migration as it did before it existed.
//
// Pure, because the decisions are worth testing without Stripe or a webhook.
import { sharesWithSkips, type Skip } from './money.ts';
import { NOT_CHARGED } from './booking/charged.ts';

export const REFUNDS_MIGRATION = 'sql/wave1-refunds-2026-09-22.sql';

export type ContributionRow = {
  id: string;
  user_id: string;
  status: string;
  amount_cents: number;
  refunded_cents?: number | null;
  stripe_payment_intent?: string | null;
  created_at?: string | null;
};

const cents = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));

/** How much of this payment has gone back. A missing column is nothing. */
export function refundedCentsOf(c: Pick<ContributionRow, 'refunded_cents'>): number {
  return cents(c?.refunded_cents);
}

/**
 * What this payment still puts towards the trip: nothing unless it
 * succeeded, and never the part Stripe has handed back.
 */
export function netPaidCents(c: Pick<ContributionRow, 'status' | 'amount_cents' | 'refunded_cents'>): number {
  if (c?.status !== 'succeeded') return 0;
  return Math.max(0, cents(c.amount_cents) - refundedCentsOf(c));
}

/**
 * Money collected on a plan: every succeeded payment, less what was given
 * back. The funding screen, the approval gate, the fully-funded announcement
 * and the ledger all read this, so none of them can count a refunded dollar.
 */
export function collectedCents(rows: ContributionRow[] | null | undefined): number {
  return (rows ?? []).reduce((s, c) => s + netPaidCents(c), 0);
}

/**
 * Whether the database has the refunded_cents column yet. PostgREST returns
 * every column for select('*'), so a row without the key means the migration
 * has not run. No rows means nothing to decide, which reads as present.
 */
export function refundColumnPresent(rows: Array<Record<string, unknown>> | null | undefined): boolean {
  const first = (rows ?? [])[0];
  return !first || 'refunded_cents' in first;
}

export type RefundOutcome = {
  /** What the contribution's status should be: whole payment back or not. */
  status: 'refunded' | 'succeeded';
  /** What to store in refunded_cents: never more than was paid. */
  refundedCents: number;
  partial: boolean;
};

/**
 * A fully refunded contribution stops counting and says 'refunded'. A partial
 * one stays 'succeeded' and counts amount_cents − refundedCents.
 *
 * refundedCents is clamped to the payment: Stripe can report more refunded
 * than a contribution holds in edge cases, and the column's check constraint
 * would refuse that write — which in a webhook means Stripe retrying for days.
 */
export function refundOutcome(amountCents: number, refundedCents: number): RefundOutcome {
  const paid = cents(amountCents);
  const back = Math.min(cents(refundedCents), paid);
  if (paid > 0 && back >= paid) return { status: 'refunded', refundedCents: paid, partial: false };
  return { status: 'succeeded', refundedCents: back, partial: back > 0 };
}

/** The statuses NOT_CHARGED names, as a list rather than a PostgREST filter. */
const NOT_CHARGED_STATUSES = NOT_CHARGED.replace(/[()"]/g, '').split(',');

export type RefundBooking = {
  id: string | number;
  status?: string | null;
  price_cents?: number | null;
  approved_at?: string | null;
  error?: string | null;
};

/**
 * Booked at a provider and then cancelled. The approve route stamps
 * approved_at on every attempt and clears `error` only when the provider
 * took the booking. A failure keeps its error, even after /bookable later
 * cancels it to try again. So a cancelled row with approved_at and no error
 * is one Reach paid a provider for.
 *
 * What the provider gave back for it is not on the row. The cancel route
 * quotes a refund (a non-refundable fare gives back nothing) but does not
 * store it, so the whole price is treated as spent. That can keep back money
 * an airline did return. The other way round would hand people money Reach
 * does not have, and the owner can still refund the difference in Stripe,
 * which the webhook records.
 */
export function spentThenCancelled(b: RefundBooking): boolean {
  return b?.status === 'cancelled' && !!b.approved_at && !b.error;
}

/**
 * The bookings a payer's money is still tied up in: everything the funding
 * target counts (status not in NOT_CHARGED), plus anything already paid out
 * to a provider and then cancelled.
 */
export function keptBookings<T extends RefundBooking>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(b =>
    !NOT_CHARGED_STATUSES.includes(String(b?.status ?? '')) || spentThenCancelled(b));
}

export type RefundPiece = {
  contributionId: string;
  paymentIntent: string;
  cents: number;
  /** What had already been refunded on this payment before this piece. */
  refundedBefore: number;
  amountCents: number;
};

export type RefundRefusal = 'not_payer' | 'nothing_refundable' | 'already_refunded' | 'needs_migration';

// One shape rather than a discriminated union, for the reason SendResult in
// lib/email.ts gives: `strict` is off here, and without it TypeScript does
// not narrow a union on `ok`. `why` is set exactly when ok is false; pieces
// is empty then.
export type RefundPlan = {
  ok: boolean;
  why?: RefundRefusal;
  refundableCents: number;
  keptCents: number;
  paidCents: number;
  pieces: RefundPiece[];
  /** What could not be found on a payment still free to refund. */
  shortCents: number;
};

/**
 * How much one person gets back, and from which of their payments.
 *
 * THE FORMULA
 *
 *   paid     = Σ over their succeeded payments of (amount_cents − refunded_cents)
 *   kept     = their share of every priced booking in keptBookings():
 *                · every booking the funding target counts — confirmed,
 *                  awaiting approval, pending, redirected — that is, status
 *                  not in NOT_CHARGED (failed, cancelled, held);
 *                · and a booking paid out to a provider and then cancelled
 *                  (spentThenCancelled), because that money has left too.
 *              Split exactly as the funding route splits it: sharesWithSkips,
 *              so somebody sitting out the dinner keeps nothing back for it.
 *   refund   = max(0, paid − kept)
 *
 * `kept` is deliberately wider than "confirmed". Money for a booking still
 * awaiting approval is money the group has set aside to book it, and handing
 * it back would leave the plan short: the approve gate would refuse the next
 * "Try again" and, because funding holds a payer's share at what they have
 * paid, nobody could pay it in again either. To get that money back too, the
 * booking is held or cancelled first — it then stops being charged, and the
 * next refund includes it. This is also exactly the complement of the funding
 * target, so after a refund the money collected still covers every booking
 * that is live: a refund can never make a funded plan unfunded.
 *
 * It is not the budget. `planShares` falls back to an even split of the budget
 * when nothing is priced — right for asking people to pay, wrong here: a plan
 * whose every booking failed keeps nothing, which is the Moab case, $1,474
 * collected against bookings that all failed.
 *
 * WHICH PAYMENTS
 *
 * Stripe refunds a payment, not a person, and the refunds table allows one
 * refund per payment. The amount comes from the newest payment first — a
 * top-up is the likeliest to be the surplus — each up to what it still
 * holds. A payment that already has a refund claimed is skipped; if the
 * surplus sits entirely on such payments, that is `already_refunded`.
 *
 * Before the migration there is nowhere to write a partial refund, so only
 * whole payments can go back. A plan that needs part of one returns
 * `needs_migration` rather than refunding money the funding total would go
 * on counting.
 */
export function planRefund(input: {
  userId: string;
  memberIds: string[];
  skips?: Skip[];
  /** Every booking on the plan; keptBookings() decides which ones count. */
  bookings: RefundBooking[];
  /** This plan's contributions; other people's are ignored. */
  contributions: ContributionRow[];
  /** Contribution ids with a refund already claimed (pending or done). */
  claimed?: Set<string>;
  /** False before sql/wave1-refunds-2026-09-22.sql has run. */
  columnPresent?: boolean;
}): RefundPlan {
  const mine = (input.contributions ?? []).filter(c => c.user_id === input.userId);
  const paidCents = mine.reduce((s, c) => s + netPaidCents(c), 0);

  const priced = keptBookings(input.bookings)
    .filter(b => cents(b.price_cents) > 0)
    .map(b => ({ ref: String(b.id), priceCents: cents(b.price_cents) }));
  const keptCents = priced.length
    ? cents(sharesWithSkips(priced, input.memberIds ?? [], input.skips ?? [])[input.userId])
    : 0;
  const refundableCents = Math.max(0, paidCents - keptCents);
  const base = { refundableCents, keptCents, paidCents, pieces: [] as RefundPiece[], shortCents: 0 };

  // Only somebody who paid can take money back. Someone whose payment has
  // already come back in full was a payer, and hears "already refunded".
  const everPaid = mine.some(c => c.status === 'succeeded' || c.status === 'refunded');
  if (!everPaid) return { ok: false, why: 'not_payer', ...base };
  if (paidCents === 0) return { ok: false, why: 'already_refunded', ...base };
  if (refundableCents === 0) return { ok: false, why: 'nothing_refundable', ...base };

  const claimed = input.claimed ?? new Set<string>();
  const newestFirst = [...mine]
    .filter(c => netPaidCents(c) > 0 && !!c.stripe_payment_intent)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));

  const pieces: RefundPiece[] = [];
  let left = refundableCents;
  let blockedByClaim = false;
  for (const c of newestFirst) {
    if (left <= 0) break;
    if (claimed.has(c.id)) { blockedByClaim = true; continue; }
    const take = Math.min(netPaidCents(c), left);
    pieces.push({
      contributionId: c.id,
      paymentIntent: c.stripe_payment_intent as string,
      cents: take,
      refundedBefore: refundedCentsOf(c),
      amountCents: cents(c.amount_cents),
    });
    left -= take;
  }

  if (!pieces.length) {
    return { ok: false, why: blockedByClaim ? 'already_refunded' : 'nothing_refundable', ...base };
  }
  if (input.columnPresent === false && pieces.some(p => p.cents + p.refundedBefore < p.amountCents)) {
    return { ok: false, why: 'needs_migration', ...base };
  }
  return { ok: true, ...base, pieces, shortCents: left };
}

/**
 * What the refund route answers when there is nothing it can do, per the
 * contract the checkout screen reads: 403 for someone who did not pay, 409
 * when there is nothing (left) to give back, 503 when only the migration
 * stands in the way. The words say what is true and what to do next.
 */
export function refusal(why: RefundRefusal, figures: { paidCents: number; keptCents: number }):
  { status: number; error: string } {
  const dollars = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
  switch (why) {
    case 'not_payer':
      return { status: 403, error: 'Only the person who paid can ask for their money back.' };
    case 'already_refunded':
      return { status: 409, error: 'That payment has already been refunded, or a refund of it is going through. Stripe says a refund takes 5–10 business days to reach the card.' };
    case 'needs_migration':
      return { status: 503, error: 'Only part of this payment is yours to take back, and Reach cannot give back part of a payment yet. Nothing has been refunded. To ask for it, write to hello@alcanzar.io with the name of this plan.' };
    case 'nothing_refundable':
    default:
      return {
        status: 409,
        error: figures.keptCents > 0
          ? `Nothing to give back: the ${dollars(figures.paidCents)} you paid is covering your share of bookings that are booked or waiting to be booked.`
          : 'Nothing to give back on this plan.',
      };
  }
}

/**
 * The Stripe idempotency key for refunding one payment. One per contribution,
 * matching the refunds table's one row per contribution: a double-tap, a
 * retry after a timeout, or two people's screens all get the same refund
 * back from Stripe rather than a second one.
 */
export function refundIdempotencyKey(contributionId: string): string {
  return `reach_refund_${contributionId}`;
}

/**
 * What to write on the contribution once Stripe has answered for one piece.
 *
 * Stripe's refund object says succeeded, pending (card refunds often are,
 * for a moment), requires_action, failed or canceled. Succeeded and pending
 * both mean the money is on its way back and has left what the plan can
 * spend, and the charge's amount_refunded already counts it, which is what
 * the webhook will write too. The other three mean it has not gone, so
 * nothing is written and the webhook stays the authority.
 */
export function afterStripeRefund(piece: Pick<RefundPiece, 'cents' | 'refundedBefore' | 'amountCents'>, stripeStatus: string):
  { counts: boolean; outcome: RefundOutcome | null } {
  if (stripeStatus !== 'succeeded' && stripeStatus !== 'pending') return { counts: false, outcome: null };
  return { counts: true, outcome: refundOutcome(piece.amountCents, piece.refundedBefore + piece.cents) };
}

/** PostgREST's words for "that column is not there yet". */
export function isMissingColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST204' || e.code === '42703'
    || (/refunded_cents/.test(e.message || '') && /column/i.test(e.message || '')));
}

/** PostgREST's words for "that table is not there yet". */
export function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST205' || e.code === '42P01'
    || (/refunds/.test(e.message || '') && /(table|relation)/i.test(e.message || '')));
}

/**
 * What the owner is told when a booking fails after money was collected, or
 * null when nothing was collected — a failure before anybody paid is the
 * ordinary case the checkout screen already handles, and alerting on it
 * would bury the one that matters.
 */
export function paidFailureNotice(input: {
  planId: string;
  planTitle?: string | null;
  bookingId: string;
  what?: string | null;
  reason?: string | null;
  collectedCents: number;
}): { subject: string; lines: string[] } | null {
  const collected = cents(input.collectedCents);
  if (collected <= 0) return null;
  const dollars = `$${(collected / 100).toFixed(2)}`;
  const title = input.planTitle?.trim() || 'a plan';
  return {
    subject: `A booking failed after ${dollars} was collected — ${title}`,
    lines: [
      `Plan: ${title} (${input.planId})`,
      `Booking: ${input.bookingId}${input.what ? ` · ${input.what}` : ''}`,
      `What the provider said: ${input.reason?.trim() || 'no reason given'}`,
      `Money collected on this plan: ${dollars}`,
      'Nothing retries this booking on its own. Each person who paid can take back their unspent share with POST /api/plans/[planId]/funding/refund, or it can be refunded in the Stripe dashboard; the webhook records either.',
    ],
  };
}
