// ─── What Reach earns on a booking, and which way it was booked (L4) ─────
// REACH-BUSINESS-MODEL-2026-11-08.md §4B L4: per booking, store `lane`,
// `provider` and `commission_cents`, so blended take is measured rather than
// modelled.
//
// Reach may only state what it has verified, and that goes for its own books
// too. The commission is, in order:
//
//   1. what the provider itself said it pays on this booking — LiteAPI puts
//      a `commission` amount on every rate it returns, and that is read;
//   2. a configured rate for the provider, in basis points, from the env
//      (COMMISSION_BPS_<PROVIDER>, e.g. COMMISSION_BPS_DUFFEL=0) — a rate
//      somebody has agreed and written down;
//   3. otherwise null: not known. Never 0 by default, because "Reach earned
//      nothing" is a claim, and a margin query summing guesses as zeros
//      would report a take nobody measured.
//
// Nothing here is shown to a member. "lane" is an internal word and stays in
// the database.

export type Lane = 'native' | 'redirect' | 'concierge' | 'capture' | 'agent';
export const LANES: readonly Lane[] = ['native', 'redirect', 'concierge', 'capture', 'agent'];

export type CommissionSource = 'provider' | 'configured' | null;

export interface CommissionRow {
  mode?: string | null;
  provider?: string | null;
  price_cents?: number | null;
  currency?: string | null;
  response_payload?: unknown;
}

/** Which way this booking goes, from the row's own mode. Unknown modes are null, never guessed. */
export function laneOf(row: { mode?: string | null }): Lane | null {
  const m = String(row.mode ?? '').trim().toLowerCase();
  return (LANES as readonly string[]).includes(m) ? (m as Lane) : null;
}

type Money = { amount?: unknown; currency?: unknown };

/**
 * The provider's own figure: LiteAPI's `commission` (an array of money, as
 * every LiteAPI amount is) on the rate that was quoted. Only in the booking's
 * currency, and only a finite, non-negative amount.
 */
export function providerCommissionCents(row: CommissionRow): number | null {
  const raw = row.response_payload as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const c = (raw as { commission?: unknown }).commission;
  const list: Money[] = Array.isArray(c) ? c as Money[] : c && typeof c === 'object' ? [c as Money] : [];
  if (!list.length) return null;
  const currency = String(row.currency || 'USD').toUpperCase();
  let total = 0;
  for (const m of list) {
    const n = Number(m?.amount);
    if (!Number.isFinite(n) || n < 0) return null;
    const cur = m?.currency ? String(m.currency).toUpperCase() : currency;
    if (cur !== currency) return null;
    total += n;
  }
  return Math.round(total * 100);
}

/** A configured rate in basis points, or null when nobody has written one down. */
export function configuredBps(provider: string | null | undefined, env: Record<string, string | undefined> = process.env): number | null {
  const p = String(provider ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (!p) return null;
  const v = env[`COMMISSION_BPS_${p}`];
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10000 ? n : null;
}

/** What Reach earns on this booking, and where the figure came from. */
export function commissionFor(row: CommissionRow, env: Record<string, string | undefined> = process.env):
  { cents: number | null; source: CommissionSource } {
  const given = providerCommissionCents(row);
  if (given !== null) return { cents: given, source: 'provider' };
  const bps = configuredBps(row.provider, env);
  const price = Number(row.price_cents);
  if (bps !== null && Number.isFinite(price) && price > 0) {
    return { cents: Math.round(price * bps / 10000), source: 'configured' };
  }
  return { cents: null, source: null };
}
