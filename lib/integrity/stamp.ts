// ─── Lane, commission and public price on each booking row (L3 + L4) ─────
// Written by the bridge (/api/plans/[planId]/bookable) after the rows are
// made, so every row the itinerary becomes carries them. The columns arrive
// in sql/pilot-gate-2026-11-08.sql; until that has run, PostgREST refuses
// the update for a column it does not know, and that is logged once and
// passed over — a booking is never lost or failed for the sake of its
// bookkeeping.
import { commissionFor, laneOf, type CommissionRow } from '../booking/commission.ts';
import { publicPriceOf, type ParityRow } from './price-parity.ts';

type Db = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        not: (c: string, op: string, v: string) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>;
      };
    };
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
    };
  };
};

/** PostgREST and Postgres saying "no such column / table": the migration has not run. */
export function schemaPending(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ['PGRST204', 'PGRST205', '42703', '42P01'].includes(String(error.code ?? ''))
    || /could not find the '[a-z_]+' column|column .* does not exist|relation .* does not exist|could not find the table/i.test(String(error.message ?? ''));
}

/** What a row should carry, from what it already holds. Pure. */
export function stampFor(row: CommissionRow & ParityRow & { lane?: unknown; commission_cents?: unknown; public_price_checked_at?: unknown },
  now: Date, env: Record<string, string | undefined> = process.env): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const lane = laneOf(row);
  if (lane && row.lane !== lane) patch.lane = lane;
  const { cents } = commissionFor(row, env);
  if (cents !== null && row.commission_cents !== cents) patch.commission_cents = cents;
  // Checked once per quote: a row already checked keeps its figure and time,
  // so the pilot can report what the price was when it was compared.
  if (lane === 'native' && !row.public_price_checked_at) {
    patch.public_price_cents = publicPriceOf(row);
    patch.public_price_checked_at = now.toISOString();
  }
  return Object.keys(patch).length ? patch : null;
}

export interface StampOutcome { stamped: number; failed: number; pending: boolean }

/** Stamps every live row on the plan. Never throws; says what it did. */
export async function stampLedger(db: Db, planId: string, now: Date = new Date()): Promise<StampOutcome> {
  const out: StampOutcome = { stamped: 0, failed: 0, pending: false };
  const { data, error } = await db.from('bookings').select('*').eq('plan_id', planId).not('status', 'in', '("failed","cancelled")');
  if (error) {
    console.error('[ledger] could not read the bookings to stamp', { planId, code: error.code });
    out.failed = 1;
    return out;
  }
  const rows = data ?? [];
  // The migration has not run if the columns are not on the rows `*` returned.
  if (rows.length && !('lane' in rows[0])) {
    console.error('[ledger] bookings.lane is not there yet — run sql/pilot-gate-2026-11-08.sql; nothing stamped');
    out.pending = true;
    return out;
  }
  for (const row of rows) {
    const patch = stampFor(row as Parameters<typeof stampFor>[0], now);
    if (!patch || !row.id) continue;
    const { error: wrote } = await db.from('bookings').update(patch).eq('id', String(row.id));
    if (wrote) {
      if (schemaPending(wrote)) {
        console.error('[ledger] a ledger column is not there yet — run sql/pilot-gate-2026-11-08.sql', { code: wrote.code });
        out.pending = true;
        return out;
      }
      console.error('[ledger] could not stamp a booking', { booking: row.id, code: wrote.code });
      out.failed++;
      continue;
    }
    out.stamped++;
  }
  return out;
}
