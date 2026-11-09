// ─── What Stripe kept, per contribution (directive P6) ───────────────────
// Fee per trip is one of the pilot's numbers (card vs bank mix, contribution
// margin), and it is only knowable from Stripe's balance transaction for the
// charge: 2.9% + 30¢ for a card, 0.8% capped at $5 for a bank debit, or
// whatever the account's negotiated rate really is. Read, never computed
// from a rate card — the rate card is what the pilot is checking.
//
// contributions.stripe_fee_cents arrives in sql/pilot-gate-2026-11-08.sql.
// Until it runs the write is refused as an unknown column and dropped
// quietly: a payment is recorded with or without the label on it.

type BalanceTransaction = { fee?: unknown; currency?: unknown } | string | null | undefined;
type ChargeLike = { balance_transaction?: BalanceTransaction } | string | null | undefined;

/** The fee on a balance transaction, in cents, or null when it is not there to read. */
export function feeOf(bt: BalanceTransaction): number | null {
  if (!bt || typeof bt !== 'object') return null;
  const fee = Number(bt.fee);
  if (!Number.isFinite(fee) || fee < 0) return null;
  return Math.round(fee);
}

/** The fee on a charge whose balance_transaction was expanded, or null. */
export function feeOfCharge(charge: ChargeLike): number | null {
  if (!charge || typeof charge !== 'object') return null;
  return feeOf(charge.balance_transaction);
}

/** The id to ask Stripe for when the charge carried only a reference. */
export function balanceTransactionId(charge: ChargeLike): string | null {
  if (!charge || typeof charge !== 'object') return null;
  const bt = charge.balance_transaction;
  return typeof bt === 'string' && bt.startsWith('txn_') ? bt : null;
}

const missingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /stripe_fee_cents/.test(e.message || ''));

/**
 * Write the fee onto the contribution paid by this intent. Never fails the
 * caller. Returns whether it was written, for the log.
 */
export async function recordFee(
  db: { from: (t: string) => any },
  intentId: string | null | undefined,
  feeCents: number | null,
): Promise<'written' | 'skipped' | 'no_column' | 'error'> {
  if (!intentId || feeCents === null) return 'skipped';
  try {
    const { error } = await db.from('contributions')
      .update({ stripe_fee_cents: feeCents })
      .eq('stripe_payment_intent', intentId);
    if (!error) return 'written';
    if (missingColumn(error)) return 'no_column';
    console.error('[contributions] could not record the Stripe fee', { intent: intentId, code: error.code });
    return 'error';
  } catch {
    return 'error';
  }
}
