// ─── How a share is paid: bank first, card one tap away (directive P1) ───
// A $10K trip collected by card costs about $292 in fees (2.9% + 30¢, five
// times) against a take of about $500. A US bank debit is 0.8%, capped at $5.
// Members pay exactly the same either way; the difference is whether the trip
// earns anything. So a contribution offers the bank first and keeps the card
// one tap away (REACH-BUSINESS-MODEL-2026-11-08.md §4A).
//
// The bank needs switching on in the Stripe Dashboard (an owner action). Until
// it is, Stripe refuses a PaymentIntent that names it — and a payment that
// cannot start is worse than a card fee, so that refusal falls back to the
// card alone.
//
// Never the account's automatic methods, and never buy-now-pay-later (owner
// decision 2026-11-08: no Klarna, Affirm, Afterpay, Cash App Pay or Zip on any
// contribution, ever). The fallback used to send
// automatic_payment_methods[enabled]=true, and the test account's default
// configuration put a Klarna tile in the Payment Element. Every form built
// here names its methods explicitly, from CONTRIBUTION_METHODS only.

/** The two the member chooses between, bank first. */
export const CONTRIBUTION_METHODS = ['us_bank_account', 'card'] as const;
export type ContributionMethod = typeof CONTRIBUTION_METHODS[number] | 'other';

/** Methods a contribution may never be offered: buy-now-pay-later, by owner decision. */
export const NEVER_OFFERED = ['klarna', 'affirm', 'afterpay_clearpay', 'cashapp', 'zip'] as const;

/** The form fields for a contribution's PaymentIntent: bank first, or the card alone. */
export function contributionIntentFields(
  base: { amountCents: number; planId: string; userId: string },
  how: 'bank_first' | 'card_only',
): URLSearchParams {
  const form = new URLSearchParams({
    amount: String(base.amountCents),
    currency: 'usd',
    'metadata[plan_id]': base.planId,
    'metadata[user_id]': base.userId,
    'metadata[kind]': 'reach_contribution',
  });
  if (how === 'bank_first') {
    CONTRIBUTION_METHODS.forEach((m, i) => form.append(`payment_method_types[${i}]`, m));
    // Instant verification through the bank's own sign-in, with micro-deposits
    // only where the bank offers nothing better.
    form.append('payment_method_options[us_bank_account][verification_method]', 'automatic');
    form.append('metadata[methods]', 'bank_first');
  } else {
    // The bank is not switched on: the card, named, and nothing else.
    form.append('payment_method_types[0]', 'card');
    form.append('metadata[methods]', 'card_only');
  }
  return form;
}

/**
 * Whether Stripe refused because the bank method is not switched on for this
 * account — the one refusal that should fall back rather than fail.
 */
export function bankNotEnabled(error: { message?: string; code?: string; param?: string } | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.param ?? ''} ${error.message ?? ''}`;
  return /payment_method_types|us_bank_account/i.test(text)
    && /(not (been )?(activated|enabled)|invalid|not available|cannot be used|isn't activated|is not supported)/i.test(text);
}

/** Which method actually paid, from a PaymentIntent (expanded or not). */
export function methodOf(pi: {
  payment_method?: string | { type?: string } | null;
  payment_method_types?: string[];
  latest_charge?: string | { payment_method_details?: { type?: string } | null } | null;
} | null | undefined): ContributionMethod | null {
  if (!pi) return null;
  const fromCharge = typeof pi.latest_charge === 'object' ? pi.latest_charge?.payment_method_details?.type : undefined;
  const fromMethod = typeof pi.payment_method === 'object' ? pi.payment_method?.type : undefined;
  const t = fromCharge || fromMethod || (pi.payment_method_types?.length === 1 ? pi.payment_method_types[0] : undefined);
  if (!t) return null;
  return t === 'us_bank_account' || t === 'card' ? t : 'other';
}

const missingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /payment_method/.test(e.message || ''));

/**
 * Write the method onto the contribution. Never fails the caller: before
 * sql/pilot-1-contribution-method-2026-11-08.sql runs the column is not
 * there, and a payment must be recorded with or without it.
 */
export async function recordMethod(
  db: { from: (t: string) => any },
  intentId: string,
  method: ContributionMethod | null,
): Promise<void> {
  if (!intentId || !method) return;
  try {
    const { error } = await db.from('contributions').update({ payment_method: method }).eq('stripe_payment_intent', intentId);
    if (error && !missingColumn(error)) console.error('[contributions] could not record how a share was paid', { intent: intentId, code: error.code });
  } catch { /* the payment is recorded elsewhere; this is the label on it */ }
}
