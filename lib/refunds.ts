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
import { NOT_CHARGED, reachBuys } from './booking/charged.ts';
import { netCollectedCents } from './booking/approval.ts';

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
const dollars = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const SUPPORT = 'hello@alcanzar.io';

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
 * What the payment history shows as given back on one payment: the recorded
 * amount, or — before the migration, when a whole refund could only be said
 * by the status — the whole payment.
 */
export function paymentRefundCents(c: Pick<ContributionRow, 'status' | 'amount_cents' | 'refunded_cents'>): number {
  const amount = cents(c?.amount_cents);
  if (c?.status === 'refunded') return amount;
  return Math.min(amount, refundedCentsOf(c));
}

/**
 * Money collected on a plan: every succeeded payment, less what was given
 * back. The same function approval checks against (netCollectedCents in
 * lib/booking/approval.ts), so the funding screen, the approval gate, the
 * fully-funded announcement and a refund can never disagree about how much
 * the group holds.
 */
export function collectedCents(rows: ContributionRow[] | null | undefined): number {
  return netCollectedCents(rows);
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
  mode?: string | null;
  provider?: string | null;
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
 * The bookings a payer's money is still tied up in: exactly what the funding
 * target and the approve gate count — a live status (not NOT_CHARGED) on
 * something Reach itself buys (reachBuys) — plus anything Reach already paid
 * a provider for and then cancelled.
 *
 * Only what Reach buys. A Ticketmaster seat or a Resy table is paid for by
 * the person on the seller's own checkout; Reach never spends a cent of the
 * group's money on it, so keeping money back for it would charge them twice.
 * The funding target and approval read the same reachBuys, so handing that
 * money back can never make either of them short.
 */
export function keptBookings<T extends RefundBooking>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(b => reachBuys(b)
    && (!NOT_CHARGED_STATUSES.includes(String(b?.status ?? '')) || spentThenCancelled(b)));
}

// ── Claims ─────────────────────────────────────────────────────────────
// A row in `refunds` per payment, written before Stripe is asked. Its status
// is ours while we wait ('claimed') and Stripe's once Stripe has answered.

export type RefundClaim = {
  id: string;
  contribution_id: string;
  status: string;
  amount_cents: number;
  /** refunded_cents on the payment when this claim was taken. */
  refunded_before_cents?: number | null;
  attempt?: number | null;
  stripe_refund_id?: string | null;
  user_id?: string | null;
};

/**
 * Money on its way back, or already back, as far as this claim knows.
 * 'claimed' is counted too: Stripe was asked, or is about to be, and may
 * have said yes without our hearing it. Counting money as gone that has not
 * gone costs a payer a wait; counting it as here when it has gone hands it
 * out twice.
 */
const CLAIM_COUNTS = new Set(['claimed', 'pending', 'requires_action', 'succeeded']);
/** Still being worked out, by Stripe or by us: nothing else may touch that payment. */
const CLAIM_OPEN = new Set(['claimed', 'pending', 'requires_action']);

/** Whether a claim is still open — its payment cannot be refunded again until it settles. */
export function claimOpen(claim: Pick<RefundClaim, 'status'> | null | undefined): boolean {
  return !!claim && CLAIM_OPEN.has(String(claim.status));
}

/**
 * How much of a payment has gone back or is going: the larger of what the
 * payment row says and what an open or finished claim says it will reach.
 * The payment row lags a claim by one Stripe round trip and one write, and
 * both can fail; this is what stops a second request in that gap from
 * refunding the same money again.
 */
export function goneCents(c: ContributionRow, claim?: RefundClaim | null): number {
  const recorded = refundedCentsOf(c);
  const claimed = claim && CLAIM_COUNTS.has(String(claim.status))
    ? cents(claim.refunded_before_cents) + cents(claim.amount_cents)
    : 0;
  return Math.min(cents(c.amount_cents), Math.max(recorded, claimed));
}

/** What a payment still holds for the trip, net of every refund recorded or claimed. */
export function heldCents(c: ContributionRow, claim?: RefundClaim | null): number {
  if (c?.status !== 'succeeded') return 0;
  return Math.max(0, cents(c.amount_cents) - goneCents(c, claim));
}

export type RefundPiece = {
  contributionId: string;
  paymentIntent: string;
  cents: number;
  /** What had already gone back on this payment, recorded or claimed, before this piece. */
  refundedBefore: number;
  amountCents: number;
  /** The payment's settled claim this piece takes over, or null for a first refund. */
  claimId: string | null;
  /** Which attempt this is on the payment: the Stripe key changes with it. */
  attempt: number;
};

export type RefundRefusal =
  | 'not_payer' | 'nothing_refundable' | 'already_refunded' | 'needs_migration'
  | 'in_progress' | 'covering_others';

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
  /** What the plan holds beyond every booking Reach is paying for. */
  surplusCents: number;
  pieces: RefundPiece[];
  /** What could not be found on a payment still free to refund. */
  shortCents: number;
};

/**
 * How much one person gets back, and from which of their payments.
 *
 * THE FORMULA
 *
 *   paid     = Σ over their succeeded payments of what each still holds:
 *              amount_cents less the larger of refunded_cents and what an
 *              open or finished claim on it will bring that to (goneCents)
 *   kept     = their share of every priced booking in keptBookings(), split
 *              exactly as funding splits it (sharesWithSkips), so somebody
 *              sitting out the dinner keeps nothing back for it
 *   surplus  = what the whole plan holds, counted the same way, less the full
 *              price of every booking in keptBookings()
 *   refund   = min(max(0, paid − kept), surplus)
 *
 * The surplus cap is the one that stops money Reach has already spent going
 * back. Shares fall after payment — somebody joins, a skip changes — and a
 * person who paid 10000 of a 10000 booking now shared by two has a "share"
 * of 5000. Without the cap they were handed 5000 of the airline's money. With
 * it they are told the extra covers somebody else's share until that person
 * pays, and can take it back then.
 *
 * `kept` is deliberately wider than "confirmed". Money for a booking still
 * awaiting approval is money the group has set aside to book it, and handing
 * it back would leave the plan short and approval would refuse it. To get
 * that money back too, the booking is held or cancelled first. This is
 * exactly the complement of the funding target, so after a refund the money
 * collected still covers every booking that is live.
 *
 * It is not the budget. `planShares` falls back to an even split of the budget
 * when nothing is priced — right for asking people to pay, wrong here: a plan
 * whose every booking failed keeps nothing, which is the Moab case, $1,474
 * collected against bookings that all failed.
 *
 * WHICH PAYMENTS
 *
 * Stripe refunds a payment, not a person. The amount comes from the newest
 * payment first — a top-up is the likeliest to be the surplus — each up to
 * what it still holds. A payment whose refund is still being worked out
 * (claimOpen) is left alone; one whose last refund settled, or was refused,
 * can be refunded again, as a new attempt with a new Stripe key.
 *
 * The route holds a per-plan lock while it runs this and asks Stripe, so two
 * payers cannot both take the same surplus.
 */
export function planRefund(input: {
  userId: string;
  memberIds: string[];
  skips?: Skip[];
  /** Every booking on the plan; keptBookings() decides which ones count. */
  bookings: RefundBooking[];
  /** Every contribution on the plan: the surplus is the whole plan's. */
  contributions: ContributionRow[];
  /** Every refunds row on the plan, at most one per contribution. */
  claims?: RefundClaim[];
}): RefundPlan {
  const byPayment = new Map<string, RefundClaim>();
  for (const k of input.claims ?? []) byPayment.set(String(k.contribution_id), k);
  const claimOf = (c: ContributionRow) => byPayment.get(String(c.id)) ?? null;

  const all = input.contributions ?? [];
  const mine = all.filter(c => c.user_id === input.userId);
  const paidCents = mine.reduce((s, c) => s + heldCents(c, claimOf(c)), 0);
  const holdsCents = all.reduce((s, c) => s + heldCents(c, claimOf(c)), 0);

  const kept = keptBookings(input.bookings).filter(b => cents(b.price_cents) > 0);
  const spentCents = kept.reduce((s, b) => s + cents(b.price_cents), 0);
  const keptCents = kept.length
    ? cents(sharesWithSkips(kept.map(b => ({ ref: String(b.id), priceCents: cents(b.price_cents) })),
        input.memberIds ?? [], input.skips ?? [])[input.userId])
    : 0;
  const surplusCents = Math.max(0, holdsCents - spentCents);
  const ownCents = Math.max(0, paidCents - keptCents);
  const refundableCents = Math.min(ownCents, surplusCents);
  const base = { refundableCents, keptCents, paidCents, surplusCents, pieces: [] as RefundPiece[], shortCents: 0 };

  // Only somebody who paid can take money back. Someone whose payment has
  // already come back in full was a payer, and hears "already refunded".
  const everPaid = mine.some(c => c.status === 'succeeded' || c.status === 'refunded');
  if (!everPaid) return { ok: false, why: 'not_payer', ...base };
  const anyOpen = mine.some(c => claimOpen(claimOf(c)));
  if (paidCents === 0) return { ok: false, why: anyOpen ? 'in_progress' : 'already_refunded', ...base };
  if (ownCents === 0) return { ok: false, why: 'nothing_refundable', ...base };
  if (refundableCents === 0) return { ok: false, why: 'covering_others', ...base };

  const newestFirst = [...mine]
    .filter(c => heldCents(c, claimOf(c)) > 0 && !!c.stripe_payment_intent)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));

  const pieces: RefundPiece[] = [];
  let left = refundableCents;
  let blocked = false;
  for (const c of newestFirst) {
    if (left <= 0) break;
    const claim = claimOf(c);
    if (claimOpen(claim)) { blocked = true; continue; }
    const take = Math.min(heldCents(c, claim), left);
    pieces.push({
      contributionId: c.id,
      paymentIntent: c.stripe_payment_intent as string,
      cents: take,
      refundedBefore: goneCents(c, claim),
      amountCents: cents(c.amount_cents),
      claimId: claim ? String(claim.id) : null,
      attempt: claim ? Math.max(1, cents(claim.attempt)) + 1 : 1,
    });
    left -= take;
  }

  if (!pieces.length) {
    return { ok: false, why: blocked ? 'in_progress' : 'nothing_refundable', ...base };
  }
  return { ok: true, ...base, pieces, shortCents: left };
}

/**
 * What the refund route answers when there is nothing it can do: 403 for
 * someone who did not pay, 409 when there is nothing (left) to give back or
 * a refund is still being worked out, 503 when only the migration stands in
 * the way. The words say what is true and what to do next.
 */
export function refusal(why: RefundRefusal, figures: { paidCents: number; keptCents: number }):
  { status: number; error: string } {
  switch (why) {
    case 'not_payer':
      return { status: 403, error: 'Only the person who paid can ask for their money back.' };
    case 'already_refunded':
      return { status: 409, error: 'Everything you paid on this plan has already been refunded. Stripe says a refund takes 5–10 business days to reach the card.' };
    case 'in_progress':
      return { status: 409, error: `A refund of your payment is still going through at Stripe, so nothing more can go back until it has. Nothing new has been refunded. If it has not reached your card in 10 business days, write to ${SUPPORT} with the name of this plan.` };
    case 'covering_others':
      return { status: 409, error: `Nothing has been refunded. You paid ${dollars(figures.paidCents)} and your share is ${dollars(figures.keptCents)}, but the group has only paid in enough to cover what Reach is booking, so the extra is covering somebody else's share for now. Once they pay theirs, you can take it back here.` };
    case 'needs_migration':
      return { status: 503, error: `Refunds can't be taken from the app yet, so nothing has been refunded. To ask for one, write to ${SUPPORT} with the name of this plan.` };
    case 'nothing_refundable':
    default:
      return {
        status: 409,
        error: figures.keptCents > 0
          ? `Nothing to give back: the ${dollars(figures.paidCents)} you paid is covering your share of what Reach is booking or has booked for this plan.`
          : 'Nothing to give back on this plan.',
      };
  }
}

/**
 * The Stripe idempotency key for one attempt at refunding one payment. The
 * same attempt always sends the same key, so a double-tap or a retry after a
 * timeout gets the same refund back from Stripe rather than a second one. A
 * new attempt — after Stripe refused the last, or after the last one settled
 * and more has become refundable — needs a new key: Stripe answers a reused
 * one with the old refund (or the old refusal) for 24 hours.
 */
export function refundIdempotencyKey(contributionId: string, attempt = 1): string {
  return attempt > 1 ? `reach_refund_${contributionId}_${attempt}` : `reach_refund_${contributionId}`;
}

/**
 * The body sent to POST /v1/refunds. The claim's id and attempt ride along in
 * metadata, so a claim whose answer was lost can be matched to the refund at
 * Stripe later (claimAtStripe) and the webhook can find its row.
 */
export function refundRequestBody(input: {
  planId: string; userId: string; claimId: string; attempt: number;
  piece: Pick<RefundPiece, 'contributionId' | 'paymentIntent' | 'cents'>;
}): Record<string, string> {
  return {
    payment_intent: input.piece.paymentIntent,
    amount: String(input.piece.cents),
    reason: 'requested_by_customer',
    'metadata[kind]': 'reach_refund',
    'metadata[plan_id]': input.planId,
    'metadata[user_id]': input.userId,
    'metadata[contribution_id]': input.piece.contributionId,
    'metadata[refund_claim_id]': input.claimId,
    'metadata[attempt]': String(input.attempt),
  };
}

export type StripeRefund = { id?: string; status?: string; amount?: number; metadata?: Record<string, string> | null };

/**
 * A claim left 'claimed' by a request that never heard Stripe's answer (a
 * timeout, a function killed mid-way, a write that failed). Stripe's own list
 * of refunds on the payment is the authority. Found: it is recorded as
 * whatever Stripe says. Not found: nothing was created — the route only
 * looks while it holds the plan's lock, so the request that asked is long
 * finished — and the claim is marked failed so the next attempt can take a
 * new key.
 */
export function claimAtStripe(claim: Pick<RefundClaim, 'id' | 'attempt'>, refunds: StripeRefund[]):
  { status: string; stripeRefundId: string | null; amountCents: number | null } {
  const attempt = String(Math.max(1, cents(claim.attempt)));
  const hit = (refunds ?? []).find(r => r?.metadata?.refund_claim_id === String(claim.id)
    && String(r?.metadata?.attempt ?? '1') === attempt);
  if (!hit?.id) return { status: 'failed', stripeRefundId: null, amountCents: null };
  return { status: String(hit.status ?? 'pending'), stripeRefundId: String(hit.id), amountCents: cents(hit.amount) };
}

/**
 * What a charge has really given back: every refund on it that has not
 * failed or been cancelled. A refund that fails at the card network comes
 * back into the balance, and the payment holds that money again.
 */
export function liveRefundedCents(refunds: StripeRefund[] | null | undefined): number {
  return (refunds ?? [])
    .filter(r => r && r.status !== 'failed' && r.status !== 'canceled')
    .reduce((s, r) => s + cents(r.amount), 0);
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

/** How one piece of a refund came out at Stripe. */
export type PieceResult =
  | { kind: 'going'; cents: number; stripeStatus: 'succeeded' | 'pending' }
  | { kind: 'needs_action'; cents: number }
  | { kind: 'refused'; cents: number; reason: string }
  | { kind: 'unknown'; cents: number }
  | { kind: 'busy'; cents: number }
  /** Our own claim write failed, so Stripe was never asked. */
  | { kind: 'not_started'; cents: number };

/**
 * The route's answer, in words that say only what happened.
 *
 * A refund that is going is "on its way", never "refunded": Stripe's own
 * figure is 5–10 business days. A refused one says it was refused, and that
 * asking again is a real retry (a new attempt, a new key) — not "a refund is
 * going through", which is what a refused one used to be told. One nobody
 * heard back about says exactly that, and that it cannot go twice.
 */
export function refundReply(results: PieceResult[], figures: { paidCents: number; keptCents: number; shortCents?: number }):
  { status: number; body: Record<string, unknown> } {
  const sum = (k: PieceResult['kind']) => results.filter(r => r.kind === k).reduce((s, r) => s + r.cents, 0);
  const going = sum('going');
  const pending = results.some(r => r.kind === 'going' && r.stripeStatus === 'pending');
  const notGone = sum('refused') + sum('unknown') + sum('needs_action') + sum('busy') + sum('not_started') + cents(figures.shortCents);
  const refusedReason = (results.find(r => r.kind === 'refused') as { reason?: string } | undefined)?.reason;
  const base = { paidCents: figures.paidCents, keptCents: figures.keptCents };

  const why = () => {
    if (sum('unknown')) return `Stripe did not answer about ${dollars(sum('unknown'))} of it, so we can't tell yet whether that part went through. It cannot be refunded twice. Ask again in a few minutes and we will check with Stripe.`;
    if (sum('refused')) return `Stripe refused ${dollars(sum('refused'))} of it${refusedReason ? ` (${refusedReason})` : ''}, so that part has not been refunded. You can ask again, or write to ${SUPPORT} with the name of this plan.`;
    if (sum('needs_action')) return `Stripe needs something more before ${dollars(sum('needs_action'))} of it can go back, and Reach can't collect that yet. Write to ${SUPPORT} with the name of this plan.`;
    if (sum('not_started')) return `We could not start ${dollars(sum('not_started'))} of it on our side, so Stripe was not asked for that part. Try again in a moment.`;
    if (sum('busy')) return `Another refund of ${dollars(sum('busy'))} of it was already going through, so that part was left alone.`;
    return `${dollars(cents(figures.shortCents))} of it could not be found on a payment that can be refunded. Write to ${SUPPORT} with the name of this plan.`;
  };

  if (going > 0) {
    const on = `${dollars(going)} is on its way back to your card. Stripe says a refund takes 5–10 business days to arrive.`;
    return {
      status: 200,
      body: {
        refundedCents: going,
        status: notGone > 0 ? 'partial' : pending ? 'pending' : 'succeeded',
        message: notGone > 0 ? `${on} ${why()}` : on,
        ...base,
      },
    };
  }
  if (sum('unknown')) {
    return { status: 502, body: { error: `Nothing has been refunded yet as far as we know. ${why()}`, ...base } };
  }
  if (sum('needs_action')) {
    return {
      status: 200,
      body: {
        refundedCents: 0, status: 'requires_action',
        message: `Nothing has gone back yet. ${why()}`, ...base,
      },
    };
  }
  if (sum('refused')) {
    return { status: 502, body: { error: `Nothing has been refunded. ${why()}`, ...base } };
  }
  if (sum('not_started')) {
    return { status: 500, body: { error: `Nothing has been refunded. ${why()}`, ...base } };
  }
  return { status: 409, body: { error: refusal('in_progress', figures).error, ...base } };
}

/** PostgREST's words for "that column is not there yet". */
export function isMissingColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST204' || e.code === '42703'
    || (/refunded_cents/.test(e.message || '') && /column/i.test(e.message || '')));
}

/** PostgREST's words for "that table is not there yet". */
export function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST205' || e.code === '42P01'
    || (/refund/.test(e.message || '') && /(table|relation)/i.test(e.message || '')));
}

/**
 * What the owner is told when a booking fails after money was collected, or
 * null when nothing was collected — a failure before anybody paid is the
 * ordinary case the checkout screen already handles, and alerting on it
 * would bury the one that matters.
 *
 * It says what the owner can actually do today. There is no refund button
 * in the app yet — the checkout screen still says "We'll follow up" — and
 * the refund route only refunds the caller's own payments, so pointing the
 * owner at it described a way out nobody could take.
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
  const title = input.planTitle?.trim() || 'a plan';
  return {
    subject: `A booking failed after ${dollars(collected)} was collected — ${title}`,
    lines: [
      `Plan: ${title} (${input.planId})`,
      `Booking: ${input.bookingId}${input.what ? ` · ${input.what}` : ''}`,
      `What the provider said: ${input.reason?.trim() || 'no reason given'}`,
      `Money collected on this plan: ${dollars(collected)}`,
      'Nothing retries this booking on its own, and there is no refund button in the app yet. Refund what was not spent from the Stripe dashboard; the webhook records it on the plan.',
    ],
  };
}
