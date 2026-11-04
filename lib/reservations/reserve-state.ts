// ─── Where a table's reservation stands, as the row records it ──────────
// lib/reservations/reserve.ts decides how a table is reserved and does it.
// What it did is written onto the booking row, in
// `response_payload.reserve`, so every reader — the checkout, the next-step
// card (lib/next-action.ts), the wallet — reads the same answer from the row
// rather than working it out again.
//
// Kept apart from reserve.ts so the client bundle can read it: nothing here
// reaches a provider, a database or the environment.
//
// The status column still says what it always said, and is never stretched:
//
//   awaiting_approval  nothing booked — open, or a platform/call offered another time
//   booking            Reach is at the platform this moment (the claim)
//   pending            Reach is on the phone to the restaurant (a live call),
//                      or the platform holds the booking until a card is added
//                      on its own page (OpenTable) — not booked either way
//   confirmed          the platform's reservation id, or staff's yes on a recorded call
//   redirected         handed to the person: their own account, their own card
//   failed             not booked, with the reason and the next option
//
// A held slot (Yelp's five-minute hold, OpenTable's slot lock) is never
// "booked": it is a step inside reserve.ts, never a state on the row.
//
// A table Reach booked on a platform carries its own record, written by the
// steps that booked it (lib/booking/tables/flow.ts: response_payload.table
// and .booked). That record is the truth for it, and reserveMarkOf reads it
// first — one table, one answer, whichever screen asks.
import { clockSaid, dateSaid } from '../line-when.ts';

export type ReservePath = 'instant' | 'call' | 'handoff';

export type ReserveState =
  | 'calling'      // a live call is ringing the restaurant
  | 'requested'    // the platform took the request and has not confirmed it
  | 'card_owed'    // the platform holds it until a card is added on its page: not booked
  | 'confirmed'    // the platform's id, or staff's yes on the recording
  | 'offered'      // not at that time; another time was offered
  | 'not_booked'   // a call ended without a table; the row is open again
  | 'failed'       // the platform said no
  | 'handed_off'   // the person books it: a deposit, a card hold, or no way for Reach
  | 'in_doubt';    // sent to the platform, and no answer came back

export interface ReserveMark {
  state: ReserveState;
  path: ReservePath;
  /** The platform it is on, where there is one (resy, opentable, yelp…). */
  platform?: string | null;
  /** YYYY-MM-DD and HH:MM asked for. */
  date?: string | null;
  time?: string | null;
  partySize?: number | null;
  /** HH:MM, the times offered instead, nearest first. */
  offeredTimes?: string[];
  /** Why it is not booked, in words for the screen. */
  reason?: string | null;
  /** The platform's reservation id, or `reach-call:<id>`. Never a number Reach made up. */
  ref?: string | null;
  /** The reservation call, for a call. */
  callId?: string | null;
  /** The terms the person accepted before Reach booked it. */
  terms?: { cancellationPolicy: string | null; depositCents: number | null; feeNote: string | null; termsUrl: string | null } | null;
  /** When this was written. */
  at?: string;
}

const STATES = new Set<ReserveState>(['calling', 'requested', 'card_owed', 'confirmed', 'offered', 'not_booked', 'failed', 'handed_off', 'in_doubt']);
const PATHS = new Set<ReservePath>(['instant', 'call', 'handoff']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type MarkRow = { response_payload?: unknown; status?: unknown; provider_ref?: unknown } | null | undefined;

const LABEL: Record<string, string> = { opentable: 'OpenTable', yelp: 'Yelp' };

/**
 * What the platform steps recorded on the row, as a mark: in doubt (sent and
 * never answered), booked, holding for a card, or let go before one was
 * added. Null when they recorded nothing that settles it.
 */
function platformMark(row: MarkRow): Record<string, unknown> | null {
  const p = row?.response_payload;
  if (!p || typeof p !== 'object') return null;
  const t = (p as { table?: Record<string, any> }).table;
  const booked = (p as { booked?: Record<string, any> }).booked;
  const platform = (t && typeof t === 'object' ? t.platform : null) ?? (booked && typeof booked === 'object' ? booked.platform : null);
  if (platform !== 'opentable' && platform !== 'yelp') return null;
  if (t?.reserving?.unknown) {
    return { state: 'in_doubt', path: 'instant', platform, date: t.hold?.date, time: t.hold?.time, partySize: t.hold?.covers ?? null };
  }
  if (!booked || typeof booked !== 'object') return null;
  // OpenTable's reference is {rid}-{confirmation}; the diner is given the confirmation.
  const ref = typeof booked.ref === 'string' ? (platform === 'opentable' ? booked.ref.replace(/^\d+-/, '') : booked.ref) : null;
  const base = { path: 'instant', platform, date: booked.date, time: booked.time, partySize: booked.covers ?? null, ref, at: booked.at };
  // Only while the row still holds that very reservation: a table booked
  // since some other way (a call, by hand) is that booking's, not this one's.
  const ours = !!row?.provider_ref && row.provider_ref === booked.ref;
  if (ours && row?.status === 'confirmed') return { ...base, state: 'confirmed' };
  if (ours && row?.status === 'pending') return { ...base, state: 'card_owed' };
  if (row?.status === 'failed' && booked.lapsedAt) {
    return { ...base, ref: null, state: 'failed', reason: `${LABEL[platform]} let this table go before a card was added.` };
  }
  return null;
}

/** The mark on a booking row, or null — read defensively: the payload is whatever was stored. */
export function reserveMarkOf(row: MarkRow): ReserveMark | null {
  const p = row?.response_payload;
  if (!p || typeof p !== 'object') return null;
  const m = platformMark(row) ?? (p as { reserve?: unknown }).reserve;
  if (!m || typeof m !== 'object') return null;
  const r = m as Record<string, unknown>;
  if (!STATES.has(r.state as ReserveState) || !PATHS.has(r.path as ReservePath)) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    ...(r as unknown as ReserveMark),
    platform: str(r.platform),
    date: str(r.date),
    time: str(r.time) && HHMM.test(String(r.time)) ? String(r.time) : null,
    offeredTimes: Array.isArray(r.offeredTimes) ? r.offeredTimes.filter((t): t is string => typeof t === 'string' && HHMM.test(t)) : [],
    reason: str(r.reason),
    ref: str(r.ref),
    partySize: Number.isFinite(Number(r.partySize)) && Number(r.partySize) > 0 ? Number(r.partySize) : null,
  };
}

/** The payload with the mark put on it, everything else kept. */
export function withMark(payload: unknown, mark: ReserveMark): Record<string, unknown> {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  return { ...base, reserve: mark };
}

/** "7:30" for a time on screen in a short line ("No 7:30"), "7:30 PM" where it stands alone. */
export const shortClock = (hhmm: string | null | undefined) => (clockSaid(hhmm ?? '') ?? '').replace(/ [AP]M$/, '');

/** "Sat, Nov 7 at 7:30 PM" — or as much of it as is known. */
export function tableWhen(date: string | null | undefined, time: string | null | undefined): string {
  const d = dateSaid(date ?? null);
  const t = clockSaid(time ?? '');
  if (d && t) return `${d} at ${t}`;
  return d ?? t ?? '';
}
