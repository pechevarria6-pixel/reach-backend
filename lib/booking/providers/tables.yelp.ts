// ─── Tables via Yelp Reservations (Partner API) ──────────────────────────
// https://docs.developer.yelp.com/docs/reservation.md
//   GET  /v3/bookings/{business}/openings?covers&date&time
//   POST /v3/bookings/{business}/holds            → hold_id, 5 minutes, cancellation_policy, reserve_url
//   POST /v3/bookings/{business}/reservations     → reservation_id, confirmation_url
//   GET  /v3/bookings/reservation/{id}/status?covers
//   POST /v3/bookings/reservation/{id}/cancel
// Bodies are form data ("parameters must be sent as form data, not query
// parameters"). Errors are { error: { code, description } }.
//
// Partner access is off by default at Yelp and there is no sandbox: testing
// happens in production against business ids Yelp provisions. So this is off
// unless YELP_RESERVATIONS_API_KEY is set, and even then it books only the
// businesses in YELP_RESERVATIONS_TEST_BUSINESSES until
// YELP_RESERVATIONS_LIVE=yes — a test must never take a real restaurant's
// table. YELP_API_KEY (Places) does not switch this on: having a search key
// is not having a booking contract.
//
// Yelp cannot change a booking. A change is a cancel and a new booking, and
// the screen says that plainly (TABLE_COPY.yelpNoChange).
import { type BookingItemRequest, type BookingItemResult, type CancelResult, commitFetch, OutcomeUnknown } from '../types.ts';
import { quoteWith, bookWith } from '../tables/steps.ts';
import { platformOfHost } from '../booking-links.ts';
import { bodyOf, generic, plainText, readFetch, refuse } from '../tables/http.ts';
import {
  type HoldResult, type Openings, type OpeningsAsk, type StatusResult, type TableGuest, type TableHold,
  type TableProvider, type TableRefusal, type TableSlot, HOLD_MINUTES, clockOf, dayOf, isRefusal,
} from '../tables/types.ts';

const BASE = () => process.env.YELP_RESERVATIONS_BASE || 'https://api.yelp.com';
const KEY = () => process.env.YELP_RESERVATIONS_API_KEY || '';
const NAME = 'Yelp';

type YelpError = { error?: { code?: string; description?: string } };
const codeOf = (j: unknown) => String((j as YelpError | null)?.error?.code ?? '');

/** A Yelp business alias or id: letters, digits, hyphens, nothing else. */
const BUSINESS = /^[A-Za-z0-9_-]{2,200}$/;

/**
 * The Yelp business a link names — `yelp.com/reservations/<alias>` (where the
 * restaurant takes Yelp bookings) or `yelp.com/biz/<alias>` (its Yelp page).
 * The openings call accepts either the 22-character id or the alias. Only a
 * link we already hold is read; a name is never searched for.
 */
export function yelpBusinessFrom(raw: string | null | undefined): string | null {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (platformOfHost(url.hostname) !== 'yelp') return null;
  const m = /^\/(reservations|biz)\/([^/?#]+)\/?$/i.exec(url.pathname);
  if (!m) return null;
  const id = decodeURIComponent(m[2]);
  return BUSINESS.test(id) ? id : null;
}

function headers(form = false): Record<string, string> {
  return {
    Authorization: `Bearer ${KEY()}`,
    Accept: 'application/json',
    ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
  };
}

const form = (o: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};

/** Yelp's error code as something the screen can act on. */
function yelpRefusal(status: number, json: unknown, handoffUrl?: string | null): TableRefusal {
  const code = codeOf(json);
  switch (code) {
    case 'BUSINESS_NOT_FOUND':
    case 'DOES_NOT_TAKE_RESERVATIONS':
      return refuse('not_on_platform', "This restaurant doesn't take bookings through Yelp, so Reach can't book it there.");
    case 'COVERS_VALUE_OUT_OF_RANGE':
      return refuse('party_size', 'Yelp books tables for 1 to 10 people. For a bigger group, ring the restaurant.');
    case 'HOLD_SLOT_NOT_AVAILABLE':
    case 'RESERVATION_SLOT_NO_LONGER_AVAILABLE':
      return refuse('slot_gone', 'That time has just gone. Nothing was booked — pick another time.');
    case 'INVALID_HOLD_ID':
    case 'HOLD_NOT_FOUND':
      return refuse('hold_expired', 'The five minutes Yelp holds a table for ran out, so nothing was booked. Pick the time again.');
    case 'CREDIT_CARD_REQUIRED':
      return refuse('needs_card', 'This restaurant wants a card to hold the table, which Yelp takes on its own page. Reach has not booked it.', handoffUrl);
    case 'DUPLICATE_RESERVATION':
      return refuse('duplicate', 'Yelp says there is already a table booked under these details that day, so it would not book a second. Nothing new was booked.');
    case 'RESERVATIONS_PARAMS_DONT_MATCH_HOLDS_PARAMS':
    case 'INVALID_RESERVATION_PARAMETER':
    case 'INVALID_DATE_TIME_RANGE':
    case 'DATE_TIME_VALIDATION_ERROR':
    case 'TOO_SMALL_VALIDATION_ERROR':
    case 'TOO_LARGE_VALIDATION_ERROR':
      return refuse('bad_request', "Yelp couldn't take that date, time or party size. Nothing was booked — check them and try again.");
  }
  return generic(status, NAME) ?? refuse('bad_request', `Yelp turned this down${code ? ` (${code})` : ''}. Nothing was booked.`);
}

const allowList = (env: NodeJS.ProcessEnv) =>
  new Set(String(env.YELP_RESERVATIONS_TEST_BUSINESSES ?? '').split(',').map(s => s.trim()).filter(Boolean));

const unix = (n: unknown): string | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString() : null;
};

export const yelpReservations: TableProvider = {
  vertical: 'restaurant',
  name: 'yelp',
  platform: 'yelp',
  canModify: false,

  enabled(env = process.env) {
    return !!env.YELP_RESERVATIONS_API_KEY;
  },

  allows(venueId, env = process.env) {
    if (!this.enabled(env)) return false;
    if (env.YELP_RESERVATIONS_LIVE === 'yes') return true;
    return allowList(env).has(venueId);
  },

  venueIdFrom(urls) {
    for (const u of urls) {
      const id = yelpBusinessFrom(u);
      if (id) return id;
    }
    return null;
  },

  async openings(venueId, ask: OpeningsAsk): Promise<Openings> {
    if (!this.allows(venueId)) return refuse('disabled', 'Reach is not booking Yelp tables yet.');
    const q = new URLSearchParams({ covers: String(ask.covers), date: ask.date, time: ask.time, get_covers_range: 'true' });
    const res = await readFetch(`${BASE()}/v3/bookings/${encodeURIComponent(venueId)}/openings?${q}`, { headers: headers() });
    if (!res) return refuse('platform_down', "Yelp didn't answer. Nothing was booked — try again shortly.");
    const json = await bodyOf(res) as {
      reservation_times?: { date?: string; times?: { time?: string; credit_card_required?: boolean }[] }[];
      covers_range?: { min_party_size?: number; max_party_size?: number };
    } | null;
    if (!res.ok) return yelpRefusal(res.status, json);
    const slots: TableSlot[] = [];
    // Yelp answers for the day before through two days after. Only the night
    // that was asked for is this line's.
    for (const day of json?.reservation_times ?? []) {
      if (dayOf(day.date) !== ask.date) continue;
      for (const t of day.times ?? []) {
        const time = clockOf(t.time);
        if (!time) continue;
        const card = t.credit_card_required === true;
        slots.push({ date: ask.date, time, needsCard: card, handoffUrl: card ? `https://www.yelp.com/reservations/${encodeURIComponent(venueId)}` : null });
      }
    }
    slots.sort((a, b) => a.time.localeCompare(b.time));
    return {
      ok: true, slots,
      minParty: Number(json?.covers_range?.min_party_size) || null,
      maxParty: Number(json?.covers_range?.max_party_size) || null,
    };
  },

  async hold(venueId, ask): Promise<HoldResult> {
    if (!this.allows(venueId)) return refuse('disabled', 'Reach is not booking Yelp tables yet.');
    const res = await readFetch(`${BASE()}/v3/bookings/${encodeURIComponent(venueId)}/holds`, {
      method: 'POST', headers: headers(true),
      body: form({ covers: ask.covers, date: ask.date, time: ask.time, unique_id: ask.uniqueId }),
    });
    if (!res) return refuse('platform_down', "Yelp didn't answer. Nothing was held or booked — try again shortly.");
    const json = await bodyOf(res) as Record<string, unknown> | null;
    if (!res.ok) return yelpRefusal(res.status, json);
    const holdId = typeof json?.hold_id === 'string' ? json.hold_id : '';
    if (!holdId) return refuse('platform_down', "Yelp didn't hold the table. Nothing was booked — try again.");
    const reserveUrl = typeof json?.reserve_url === 'string' ? json.reserve_url : null;
    if (json?.credit_card_hold === true) {
      // Yelp's own rule: a card hold is finished on reserve_url, never through the API.
      return refuse('needs_card', 'This restaurant wants a card to hold the table, which Yelp takes on its own page. Reach has not booked it.', reserveUrl);
    }
    const now = Date.now();
    return {
      ok: true,
      hold: {
        platform: 'yelp', venueId, holdId, date: ask.date, time: ask.time, covers: ask.covers,
        expiresAt: unix(json?.expires_at) ?? new Date(now + HOLD_MINUTES * 60_000).toISOString(),
        cancellationPolicy: plainText(json?.cancellation_policy),
        policies: [],
        terms: null,
        fee: null,
        editable: false,
        cancelBy: unix(json?.last_cancellation_date),
        notes: plainText(json?.notes),
        handoffUrl: reserveUrl,
      },
    };
  },

  async release() {
    // Yelp has no call to let a hold go; it lapses on its own in five minutes.
  },

  async reserve(hold: TableHold, guest: TableGuest, opts): Promise<BookingItemResult | TableRefusal> {
    if (!this.allows(hold.venueId)) return refuse('disabled', 'Reach is not booking Yelp tables yet.');
    // The call that books. No answer, or a 5xx, may still have booked it.
    const res = await commitFetch(`${BASE()}/v3/bookings/${encodeURIComponent(hold.venueId)}/reservations`, {
      method: 'POST', headers: headers(true),
      body: form({
        covers: hold.covers, date: hold.date, time: hold.time,
        first_name: guest.firstName, last_name: guest.lastName, phone: guest.phone, email: guest.email,
        hold_id: hold.holdId,
        // Our booking row: the same row asking twice is the same diner to Yelp.
        unique_id: opts.reference,
        notes: guest.notes || undefined,
      }),
    });
    const json = await bodyOf(res) as Record<string, unknown> | null;
    if (!res.ok) return yelpRefusal(res.status, json, hold.handoffUrl);
    if (json === null) throw new OutcomeUnknown('Yelp accepted the reservation and its answer could not be read.');
    const id = typeof json.reservation_id === 'string' && json.reservation_id ? json.reservation_id : null;
    // Accepted with no reservation id: the table may be booked. Never "failed".
    if (!id) throw new OutcomeUnknown('Yelp accepted the reservation and sent no reservation id.');
    return {
      vertical: 'restaurant', mode: 'native', status: 'confirmed', provider: 'yelp',
      providerRef: id,
      redirectUrl: typeof json.confirmation_url === 'string' ? json.confirmation_url : undefined,
      priceCents: 0,
      raw: { reservation_id: id, confirmation_url: json.confirmation_url ?? null, notes: plainText(json.notes) },
    };
  },

  async status(ref, opts): Promise<StatusResult> {
    if (!this.enabled()) return refuse('disabled', 'Reach is not booking Yelp tables yet.');
    const res = await readFetch(`${BASE()}/v3/bookings/reservation/${encodeURIComponent(ref)}/status?covers=${opts.covers}`, { headers: headers() });
    if (!res) return refuse('platform_down', "Yelp didn't answer.");
    const json = await bodyOf(res) as Record<string, unknown> | null;
    if (codeOf(json) === 'RESERVATION_CANCELED') return { ok: true, active: false, date: null, time: null, covers: null, fee: null, owesCard: null, cancelled: true };
    if (!res.ok) return yelpRefusal(res.status, json);
    return {
      ok: true, active: json?.active === true, date: dayOf(json?.date), time: clockOf(json?.time),
      // Reach never books a Yelp slot that wants a card (it is handed to
      // Yelp's page), so a table it booked there owes nothing.
      covers: Number(json?.covers) || null, fee: null, owesCard: false, cancelled: false, raw: json,
    };
  },

  async cancel(ref, opts = {}): Promise<CancelResult> {
    if (!this.enabled()) return { status: 'failed', error: 'Reach is not booking Yelp tables yet, so it cannot cancel one. Use the link in Yelp’s confirmation.' };
    // Nothing was paid for a Yelp table, so nothing comes back.
    if (!opts.confirm) return { status: 'quoted', refundCents: 0, currency: 'USD' };
    const res = await readFetch(`${BASE()}/v3/bookings/reservation/${encodeURIComponent(ref)}/cancel`, { method: 'POST', headers: headers() });
    if (!res) return { status: 'failed', error: "Yelp didn't answer, so we can't tell whether the table was cancelled. Check Yelp's confirmation before you rely on it either way." };
    const json = await bodyOf(res);
    if (res.ok || codeOf(json) === 'RESERVATION_ALREADY_CANCELED') return { status: 'cancelled', refundCents: 0, currency: 'USD', raw: json };
    if (res.status >= 500) return { status: 'failed', error: "Yelp had a problem, so we can't tell whether the table was cancelled. Check Yelp's confirmation, or ring the restaurant.", raw: json };
    return { status: 'failed', error: "Yelp wouldn't cancel this table. Use the link in Yelp's confirmation, or ring the restaurant.", raw: json };
  },

  // ── The same steps as the other providers, for the registry ──
  async quote(req: BookingItemRequest): Promise<BookingItemResult> {
    return quoteWith(this, req);
  },
  async book(req: BookingItemRequest): Promise<BookingItemResult> {
    return bookWith(this, req);
  },
};
