// ─── A stale quote, priced again where it stands ─────────────────────────
// A trip for one that somebody joins has flights and a room on it priced for
// one. Before anybody pays, those are priced again for who is going now —
// the same flights, the same hotel, only the headcount changes (resize.ts).
//
// This used to retire the old row (cancelled, unlinked from its line) and
// insert a new one. Three things went wrong with that:
//   - a held quote was retired along with the rest, and when the re-price
//     failed — most often because the newcomer had not added travel details
//     yet — the line came back on the next open as a proposal, back in
//     everybody's share;
//   - an approval already at the provider could write 'confirmed' over the
//     cancelled row while the re-priced twin went live beside it, and
//     approving the twin bought a second order;
//   - a re-price that failed after retiring left the line with nothing on it.
//
// So the row is priced again in place: one conditional update, on the row as
// it was read (atVersion) and only while it is still a proposal. An approval
// that claimed it in the meantime moved its version, and this matches
// nothing. A re-price that fails changes nothing: the row stays stale, and
// funding refuses money against a stale row (stale_quotes), so nobody pays a
// share of the one-seat price in the meantime. A held quote is never touched
// here at all — it is out of every money sum, and is priced again once it is
// let go and is a proposal again.
//
// The route calls these; they are here so the order they are called in, and
// what each one writes, can be run against a stand-in database in
// tests/unit/booking-reprice.test.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readSkips } from '../participation.ts';
import { atVersion } from './claim.ts';
import { matchFor, partyFor, pricedFor, resized, staleOnPlan, type Match } from './resize.ts';

type Skip = { ref: string; userId: string };
type Row = {
  id?: unknown; vertical?: unknown; status?: unknown; mode?: unknown;
  request_payload?: unknown; approved_at?: unknown; updated_at?: unknown;
};

/** Who is going on a plan, as every size decision reads it. */
export interface Party { party: number; memberIds: string[]; skips: Skip[] }

/**
 * The group's members and who is kept off what, read so that a failure is a
 * failure. Null when either cannot be read: nothing is priced again, and no
 * money is refused or taken, on a guess about who is going.
 *
 * `party` is partySize's rule (lib/participation.ts) — one for a solo plan,
 * otherwise the group — from this same read, because partySize answers one
 * when the count fails, and one is a real number of people to price for.
 */
export async function readParty(
  db: SupabaseClient, plan: { group_id?: unknown; solo_mode?: boolean | null }, planId: string,
): Promise<Party | null> {
  const { data, error } = await db.from('group_members').select('user_id').eq('group_id', String(plan.group_id));
  if (error) {
    console.error('[reprice] could not read who is in the group', { planId, code: error.code });
    return null;
  }
  let skips: Skip[];
  try {
    skips = (await readSkips(db, planId)).skips;
  } catch {
    return null;
  }
  const memberIds = (data ?? []).map(m => String((m as { user_id: unknown }).user_id));
  return { party: plan.solo_mode === true ? 1 : Math.max(1, memberIds.length), memberIds, skips };
}

/** How many people one booking is for: the group, less anybody kept off it. */
export function expectedFor(p: Party): (row: Row) => number {
  return row => partyFor(p.party, p.memberIds, p.skips, String(row.id));
}

/** The flights and hotels on a plan priced for a different number of people than are on them. */
export function staleRows<T extends Row>(rows: T[] | null | undefined, p: Party): T[] {
  return staleOnPlan(rows, p);
}

/**
 * What POST /api/bookings does with one request, in order:
 *   1. nothing the plan has matches — a new quote;
 *   2. a live match that fits, or one that is bought, held or mid-booking —
 *      handed back, and it wins over re-pricing a stale twin;
 *   3. a stale proposal, asked for at exactly the size the route counts —
 *      priced again, unless anybody has paid (unknown counts as paid);
 *   4. anything else — handed back as it is.
 * `party` null (who is going could not be read) is never a re-price.
 */
export async function settle<T extends Row>(
  existing: T[] | null | undefined, item: Record<string, unknown> | null | undefined,
  party: Party | null, anyonePaid: () => Promise<boolean>,
): Promise<Match<T>> {
  const m = matchFor<T>(existing, item, party ? expectedFor(party) : null);
  if (m.kind === 'stale' && await anyonePaid()) return { kind: 'twin', row: m.row };
  return m;
}

/**
 * The request a stale row is priced again with: its own, as stored — the
 * pinned hotel, the chosen flight numbers — sized for `party`. Never the
 * incoming request's, which only has to agree on what it is and how many.
 */
export function restated<R extends Record<string, unknown>>(row: Row, party: number, extra: Partial<R> = {}): R {
  const own = (row.request_payload && typeof row.request_payload === 'object'
    ? row.request_payload : {}) as Record<string, unknown>;
  return { ...resized(own, party), ...extra } as R;
}

type Quote = {
  status?: string; error?: string; provider?: string; mode?: string; providerRef?: string;
  redirectUrl?: string; priceCents?: number; currency?: string; detail?: string; raw?: unknown;
};

export type Rewrite =
  | { ok: true; why?: undefined; error?: undefined }
  /** Nothing was written; `error` says why, in words for the person. */
  | { ok: false; why: 'unpriced' | 'paid' | 'changed' | 'write'; error: string };

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Write a new price onto the stale row it was made for — or, when anything
 * says not to, leave the row exactly as it was and say why.
 *
 * `paidNow` is asked afresh, just before writing: a payment that landed
 * while the provider was answering is a total somebody paid against.
 */
export async function writeRepriced(
  db: SupabaseClient, row: Row, request: Record<string, unknown>, result: Quote,
  paidNow: () => Promise<boolean>,
): Promise<Rewrite> {
  const was = pricedFor(row);
  const now = Number(request.party) || 1;
  const priced = was ? `This was priced for ${people(was)} and ${now} ${now === 1 ? 'is' : 'are'} going now` : 'This was priced for a different number of people';
  // Only a price is a price: a quote that came back failed, or as anything
  // but a quote, leaves the row as it was.
  if (!result || !(result.status === 'quoted' || result.status === 'awaiting_approval')) {
    return {
      ok: false, why: 'unpriced',
      error: `${priced}, and it couldn't be priced again${result?.error ? ` — ${result.error}` : ''}. Nobody can pay towards the trip until it is; reopen checkout to try again.`,
    };
  }
  if (await paidNow()) {
    return { ok: false, why: 'paid', error: 'Somebody paid towards this trip while it was being priced again, so it stays at the price they paid against.' };
  }
  // The hotel that was priced is the hotel approval books: a row priced
  // before hotels were pinned is pinned now, to the one this price is for.
  const hotelId = (result.raw as { hotelId?: unknown } | null | undefined)?.hotelId;
  const hotel = request.hotel as Record<string, unknown> | undefined;
  const stored = request.vertical === 'hotel' && hotel && typeof hotelId === 'string' && hotelId && !hotel.hotelId
    ? { ...request, hotel: { ...hotel, hotelId } } : request;
  const { data, error } = await atVersion(db.from('bookings').update({
    request_payload: stored,
    response_payload: result.raw ?? null,
    provider: result.provider ?? null,
    mode: result.mode ?? null,
    provider_ref: result.providerRef ?? null,
    redirect_url: result.redirectUrl ?? null,
    price_cents: result.priceCents ?? null,
    currency: result.currency ?? 'USD',
    detail: result.detail ?? null,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', String(row.id)).eq('status', 'awaiting_approval'), row.updated_at).select('id');
  if (error) {
    console.error('[reprice] could not write the new price', { id: row.id, code: error.code });
    return { ok: false, why: 'write', error: "We priced this again but couldn't save it — reopen checkout to try again." };
  }
  if (!data?.length) {
    return { ok: false, why: 'changed', error: 'This changed while it was being priced again — reopen checkout to see where it stands.' };
  }
  // A price rise approval was holding for the old size is not a price for
  // this one. Before sql/wave1-bookings-2026-09-22.sql there is no column,
  // and nothing to clear.
  const { error: cleared } = await db.from('bookings')
    .update({ pending_price_cents: null }).eq('id', String(row.id)).not('pending_price_cents', 'is', null);
  if (cleared && !(cleared.code === 'PGRST204' || cleared.code === '42703' || /pending_price_cents/.test(cleared.message ?? ''))) {
    console.error('[reprice] could not clear a price rise held for the old size', { id: row.id, code: cleared.code });
  }
  return { ok: true };
}
