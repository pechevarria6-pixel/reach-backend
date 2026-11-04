// ─── Tables via OpenTable's Online Booking API (Consumer API v2) ─────────
// https://docs.opentable.com/ (Postman collection 38767429/2sAXxTcWRy)
//   OAuth 2 client credentials:  {oauth}/api/v2/oauth/token?grant_type=client_credentials, Basic id:secret
//   GET    /v2/availability/{rid}?start_date_time&forward_minutes&backward_minutes&party_size…
//   POST   /v2/booking/{rid}/slot_locks              → reservation_token, expires within 5 minutes
//   DELETE /v2/booking/{rid}/slot_locks/{token}
//   GET    /v2/booking-policies/{rid}/{date}/{time}/{party}?dinerContext=details
//   POST   /v2/booking/{rid}/reservations            → confirmation_number, manage_reservation_url
//   PUT    /v2/booking/{rid}/reservations/{rid}-{n}  → modify (with a new lock), or { status: CancelledWeb }
//   GET    /v2/booking/{rid}/reservations/{rid}-{n}
// Errors are { errors: [{ message }], requestid }.
//
// The Consumer API is for "a visually accessible interface" where the diner
// accepts OpenTable's terms on screen; the Voice AI API is for voice, and
// using either for the other is forbidden. So a hold carries OpenTable's
// terms sentence and links (OPENTABLE_TERMS), and the screen shows them
// beside a button labelled "Complete reservation" before anything is booked.
//
// Deposits, card holds and prepaid experiences are not booked here. They
// need OpenTable's own card tokenisation, and Reach does not take a
// restaurant's deposit: those slots are handed to OpenTable's page. The
// OpenTable Service Fee only ever applies to those, and is shown exactly as
// OpenTable returns it (otServiceFee) — never worked out here.
//
// Off unless OPENTABLE_CLIENT_ID, OPENTABLE_CLIENT_SECRET and
// OPENTABLE_API_BASE are all set. The base URL is given at onboarding; it is
// never guessed.
import { type BookingItemRequest, type BookingItemResult, type CancelResult, commitFetch, OutcomeUnknown } from '../types.ts';
import { platformOfHost } from '../booking-links.ts';
import { bodyOf, generic, plainText, readFetch, refuse } from '../tables/http.ts';
import { quoteWith, bookWith } from '../tables/steps.ts';
import {
  type HoldResult, type Openings, type OpeningsAsk, type StatusResult, type TableFee, type TableGuest, type TableHold,
  type TableProvider, type TableRefusal, type TableSlot, type TableTerms, HOLD_MINUTES, clockOf, dayOf,
} from '../tables/types.ts';

const NAME = 'OpenTable';
const API = () => (process.env.OPENTABLE_API_BASE || '').replace(/\/+$/, '');
const OAUTH = () => (process.env.OPENTABLE_OAUTH_BASE || 'https://oauth.opentable.com').replace(/\/+$/, '');

/**
 * What OpenTable requires a partner's booking flow to say, from its partner
 * requirements: "By clicking ‘Complete reservation’ you agree to the
 * OpenTable Terms of Use and Privacy Policy." The screen shows this text and
 * these links, and the button beside them reads "Complete reservation".
 */
export const OPENTABLE_TERMS: TableTerms = {
  text: 'By clicking ‘Complete reservation’ you agree to the OpenTable Terms of Use and Privacy Policy.',
  links: [
    { label: 'Terms of Use', url: 'https://www.opentable.com/legal/terms-and-conditions' },
    { label: 'Privacy Policy', url: 'https://www.opentable.com/legal/privacy-policy' },
  ],
  version: 'opentable-terms-2024-12-20',
};

/**
 * OpenTable's restaurant id, from a link we hold: `?rid=`/`?restref=` (its
 * widget and booking pages) or `/restaurant/profile/<rid>`. A slug page
 * (`/r/<name>`) names a restaurant but not its id, and is not guessed at.
 */
export function openTableRidFrom(raw: string | null | undefined): string | null {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim().replace(/&amp;/g, '&'));
  } catch {
    return null;
  }
  if (platformOfHost(url.hostname) !== 'opentable') return null;
  for (const [k, v] of url.searchParams) {
    if ((k.toLowerCase() === 'rid' || k.toLowerCase() === 'restref') && /^\d{1,10}$/.test(v)) return v;
  }
  const m = /^\/restaurant\/profile\/(\d{1,10})(\/|$)/i.exec(url.pathname);
  return m ? m[1] : null;
}

// ── OAuth ───────────────────────────────────────────────────────────────
let token: { value: string; until: number; key: string } | null = null;

/** Forget the cached token. Tests, and a 401 that says it is stale. */
export function resetOpenTableToken() {
  token = null;
}

async function bearer(): Promise<string | null> {
  const id = process.env.OPENTABLE_CLIENT_ID || '';
  const secret = process.env.OPENTABLE_CLIENT_SECRET || '';
  const key = `${OAUTH()}|${id}`;
  if (token && token.key === key && token.until > Date.now()) return token.value;
  const res = await readFetch(`${OAUTH()}/api/v2/oauth/token?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
  });
  if (!res || !res.ok) {
    console.error('[opentable] no access token', { status: res?.status ?? null });
    return null;
  }
  const json = await bodyOf(res) as { access_token?: string; expires_in?: number } | null;
  if (!json?.access_token) return null;
  const life = Number(json.expires_in);
  // A minute short of what OpenTable says, so a token never expires mid-booking.
  token = { value: json.access_token, key, until: Date.now() + (Number.isFinite(life) && life > 120 ? (life - 60) * 1000 : 60_000) };
  return token.value;
}

const NO_TOKEN = () => refuse('auth', "OpenTable didn't let Reach sign in, so nothing was booked. Book it on OpenTable directly for now.");

async function headers(json = false): Promise<Record<string, string> | null> {
  const t = await bearer();
  if (!t) return null;
  return { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

// ── Reading OpenTable's answers ─────────────────────────────────────────
const messages = (j: unknown): string =>
  ((j as { errors?: { message?: string }[] } | null)?.errors ?? []).map(e => String(e?.message ?? '')).join(' | ')
  || String((j as { message?: string } | null)?.message ?? '');

function otRefusal(status: number, json: unknown, handoffUrl?: string | null): TableRefusal {
  const m = messages(json);
  if (/CreditCardRequired|CreditCardTokenSCARequired|SCA Required/i.test(m)) {
    return refuse('needs_card', 'This restaurant wants a card for this table, which OpenTable takes on its own page. Reach does not take a restaurant’s deposit, so it has not booked it.', handoffUrl);
  }
  if (/DinerHasOverlappingReservations/i.test(m)) {
    return refuse('duplicate', 'OpenTable says this diner already has a booking that overlaps this one, so it would not book a second. Nothing new was booked.');
  }
  if (/CreditCardCutoff/i.test(m)) return refuse('cancel_too_late', 'The restaurant’s deadline for cancelling online has passed. Ring the restaurant to cancel.');
  if (/InThePast/i.test(m)) return refuse('cancel_too_late', 'That reservation time has already passed.');
  if (/AboveMaxPartySize|BelowMinPartySize/i.test(m)) return refuse('party_size', 'The restaurant doesn’t take a party that size online. Ring them instead.');
  if (/NotActive|not in Active state|does not accept online/i.test(m)) {
    return refuse('not_on_platform', 'This restaurant isn’t taking OpenTable bookings right now. Ring them instead.');
  }
  if (/reservation_token/i.test(m)) return refuse('hold_expired', 'The five minutes OpenTable holds a table for ran out, so nothing was booked. Pick the time again.');
  if (/NoTimesReasons|SlotStatusError|not available|SlotLock/i.test(m)) return refuse('slot_gone', 'That time has just gone. Nothing was booked — pick another time.');
  if (/Email address|IllegalPhone|phone/i.test(m)) return refuse('bad_request', 'OpenTable didn’t accept the email or phone number on your profile. Fix it there and try again — nothing was booked.');
  if (status === 404 || /MissingResource/i.test(m)) return refuse('not_on_platform', 'OpenTable doesn’t know this restaurant, so Reach can’t book it there.');
  return generic(status, NAME) ?? refuse('bad_request', `OpenTable turned this down${m ? ` (${m.slice(0, 120)})` : ''}. Nothing was booked.`);
}

/**
 * The OpenTable Service Fee, exactly as OpenTable returns it (OTServiceFee in
 * `ot_fees`), or null when there is none. Labelled the way OpenTable requires,
 * with the percentage it gives; never calculated here.
 */
export function otServiceFee(json: unknown): TableFee | null {
  const j = json as { ot_fees?: { fee_amount?: number; tax_on_fee_amount?: number; fee_percent?: number; fee_type?: string }[]; currency?: string } | null;
  const fees = (j?.ot_fees ?? []).filter(f => !f.fee_type || f.fee_type === 'OTServiceFee');
  const amount = fees.reduce((s, f) => s + (Number(f.fee_amount) || 0), 0);
  if (!fees.length || amount <= 0) return null;
  const pct = Number(fees[0].fee_percent);
  return {
    label: Number.isFinite(pct) && pct > 0 ? `OpenTable Service Fee (${pct}%)` : 'OpenTable Service Fee',
    amountCents: amount,
    taxCents: fees.reduce((s, f) => s + (Number(f.tax_on_fee_amount) || 0), 0),
    currency: j?.currency || 'USD',
  };
}

type Area = { booking_url?: string; booking_restref_url?: string };
type Kind = {
  type?: string;
  cancellation_policy?: { type?: string; id?: string; amount?: number; denominator?: number; currency?: string; deposit_type?: string };
  cancellationPolicy?: Kind['cancellation_policy'];
  dining_area?: Area[]; diningArea?: Area[];
};

const money = (amount?: number, denominator?: number, currency?: string) => {
  const a = Number(amount), d = Number(denominator) || 100;
  if (!Number.isFinite(a) || a <= 0) return null;
  return `${currency === 'USD' || !currency ? '$' : `${currency} `}${(a / d).toFixed(2).replace(/\.00$/, '')}`;
};

/** A slot's money, in words, from the policy OpenTable attached to it. */
function cardNote(p: Kind['cancellation_policy']): string | null {
  if (!p?.type) return null;
  const amt = money(p.amount, p.denominator, p.currency);
  const per = p.deposit_type === 'PerGuest' ? ' a person' : '';
  if (/deposit/i.test(p.type)) return amt ? `A ${amt}${per} deposit, taken by OpenTable.` : 'A deposit, taken by OpenTable.';
  if (/prepay/i.test(p.type)) return 'Paid in advance, on OpenTable.';
  return amt ? `A card hold of ${amt}${per}, if you don’t show.` : 'A card on file, held by OpenTable.';
}

const ridOf = (ref: string) => (/^(\d+)-\d+$/.exec(ref) ?? [])[1] ?? null;

/** OpenTable's own booking page for this restaurant — Stage 1's link shape, from an id it published. */
const pageFor = (rid: string) => `https://www.opentable.com/booking/restref/availability?rid=${rid}&restref=${rid}`;

/**
 * OpenTable wants the number and its country apart. A +1 number is read as
 * US; any other needs the country we hold for it, and without one the
 * number is not sent under a guessed country.
 */
export function phoneOf(g: TableGuest): { number: string; country_code: string; phone_type: 'mobile' } | null {
  const digits = g.phone.replace(/[^\d+]/g, '');
  const us = /^\+?1\d{10}$/.test(digits) || /^\d{10}$/.test(digits);
  const country = g.phoneCountry || (us ? 'US' : null);
  if (!country || digits.replace(/\D/g, '').length < 7) return null;
  return { number: us ? digits.replace(/\D/g, '').slice(-10) : digits.replace(/^\+/, ''), country_code: country, phone_type: 'mobile' };
}

export const openTableReservations: TableProvider = {
  vertical: 'restaurant',
  name: 'opentable',
  platform: 'opentable',
  canModify: true,

  enabled(env = process.env) {
    return !!(env.OPENTABLE_CLIENT_ID && env.OPENTABLE_CLIENT_SECRET && env.OPENTABLE_API_BASE);
  },

  allows(_venueId, env = process.env) {
    return this.enabled(env);
  },

  venueIdFrom(urls) {
    for (const u of urls) {
      const rid = openTableRidFrom(u);
      if (rid) return rid;
    }
    return null;
  },

  async openings(rid, ask: OpeningsAsk): Promise<Openings> {
    if (!this.enabled()) return refuse('disabled', 'Reach is not booking OpenTable tables yet.');
    const h = await headers();
    if (!h) return NO_TOKEN();
    const q = new URLSearchParams({
      start_date_time: `${ask.date}T${ask.time}`, forward_minutes: '120', backward_minutes: '120',
      party_size: String(ask.covers), include_credit_card_results: 'true', include_experiences: 'false',
    });
    const res = await readFetch(`${API()}/v2/availability/${encodeURIComponent(rid)}?${q}`, { headers: h });
    if (!res) return refuse('platform_down', "OpenTable didn't answer. Nothing was booked — try again shortly.");
    const json = await bodyOf(res) as { times_available?: { time?: string; availability_types?: Kind[] }[] } | null;
    if (!res.ok) return otRefusal(res.status, json);
    const slots: TableSlot[] = [];
    for (const t of json?.times_available ?? []) {
      if (dayOf(t.time) !== ask.date) continue;
      const time = clockOf(t.time);
      // A plain table. Experiences are a menu at a price, and not what was asked for.
      const kind = (t.availability_types ?? []).find(k => !k.type || k.type === 'Standard');
      if (!time || !kind) continue;
      const policy = kind.cancellation_policy ?? kind.cancellationPolicy;
      const needsCard = !!policy?.type;
      const area = (kind.dining_area ?? kind.diningArea ?? [])[0];
      slots.push({
        date: ask.date, time, needsCard,
        handoffUrl: needsCard ? (area?.booking_url || area?.booking_restref_url || pageFor(rid)) : null,
        cardNote: cardNote(policy),
      });
    }
    slots.sort((a, b) => a.time.localeCompare(b.time));
    return { ok: true, slots };
  },

  async hold(rid, ask): Promise<HoldResult> {
    if (!this.enabled()) return refuse('disabled', 'Reach is not booking OpenTable tables yet.');
    const h = await headers(true);
    if (!h) return NO_TOKEN();
    const res = await readFetch(`${API()}/v2/booking/${encodeURIComponent(rid)}/slot_locks`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ party_size: ask.covers, date_time: `${ask.date}T${ask.time}`, reservation_attribute: 'default' }),
    });
    if (!res) return refuse('platform_down', "OpenTable didn't answer. Nothing was held or booked — try again shortly.");
    const json = await bodyOf(res) as { reservation_token?: string; expires_at?: string; payment_method?: unknown } | null;
    if (!res.ok) return otRefusal(res.status, json, pageFor(rid));
    const holdId = json?.reservation_token;
    if (!holdId) return refuse('platform_down', "OpenTable didn't hold the table. Nothing was booked — try again.");
    const now = Date.now();
    const lock: TableHold = {
      platform: 'opentable', venueId: rid, holdId, date: ask.date, time: ask.time, covers: ask.covers,
      // OpenTable's expires_at carries no zone; its own docs say five minutes, which is what this counts.
      expiresAt: new Date(now + HOLD_MINUTES * 60_000).toISOString(),
      cancellationPolicy: null, policies: [], terms: OPENTABLE_TERMS, fee: otServiceFee(json),
      editable: true, cancelBy: null, notes: null, handoffUrl: pageFor(rid),
    };
    if (json?.payment_method) {
      // A card is needed: OpenTable sent its tokeniser. Reach does not take
      // a restaurant's deposit, so the lock is let go and the slot handed over.
      await this.release(lock);
      return refuse('needs_card', 'This restaurant wants a card for this table, which OpenTable takes on its own page. Reach does not take a restaurant’s deposit, so it has not booked it.', pageFor(rid));
    }
    // The restaurant's own policies for this time, shown before the button.
    const p = await readFetch(
      `${API()}/v2/booking-policies/${encodeURIComponent(rid)}/${ask.date}/${ask.time}/${ask.covers}?dinerContext=details`,
      { headers: h },
    );
    if (p?.ok) {
      const pj = await bodyOf(p) as { Policies?: { Message?: string; Type?: string }[] } | null;
      lock.policies = (pj?.Policies ?? []).map(x => plainText(x.Message)).filter((x): x is string => !!x);
    } else {
      console.error('[opentable] booking policies unavailable', { rid, status: p?.status ?? null });
    }
    return { ok: true, hold: lock };
  },

  async release(hold) {
    const h = await headers();
    if (!h) return;
    const res = await readFetch(`${API()}/v2/booking/${encodeURIComponent(hold.venueId)}/slot_locks/${encodeURIComponent(hold.holdId)}`, { method: 'DELETE', headers: h });
    if (res && !res.ok) console.error('[opentable] could not release a lock; it lapses in five minutes', { rid: hold.venueId, status: res.status });
  },

  async reserve(hold: TableHold, guest: TableGuest): Promise<BookingItemResult | TableRefusal> {
    if (!this.enabled()) return refuse('disabled', 'Reach is not booking OpenTable tables yet.');
    const phone = phoneOf(guest);
    if (!phone) return refuse('bad_request', 'OpenTable needs a phone number with its country. Add it to your profile and try again — nothing was booked.');
    const h = await headers(true);
    if (!h) return NO_TOKEN();
    // The call that books. No answer, or a 5xx, may still have booked it.
    const res = await commitFetch(`${API()}/v2/booking/${encodeURIComponent(hold.venueId)}/reservations`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        reservation_token: hold.holdId,
        first_name: guest.firstName, last_name: guest.lastName, email_address: guest.email,
        phone,
        reservation_attribute: 'default',
        ...(guest.notes ? { special_request: guest.notes.slice(0, 75) } : {}),
        // Nobody is signed up for anybody's marketing by Reach.
        restaurant_email_marketing_opt_in: false,
        opentable_marketing_opt_in: null,
        sms_notifications_opt_in: false,
      }),
    });
    const json = await bodyOf(res) as Record<string, unknown> | null;
    if (!res.ok) return otRefusal(res.status, json, hold.handoffUrl);
    return settled(hold, json, 'reserve');
  },

  async modify(ref, hold, guest): Promise<BookingItemResult | TableRefusal> {
    if (!this.enabled()) return refuse('disabled', 'Reach is not booking OpenTable tables yet.');
    const rid = ridOf(ref);
    if (!rid || rid !== hold.venueId) return refuse('bad_request', 'That hold is for a different restaurant. Nothing was changed.');
    const h = await headers(true);
    if (!h) return NO_TOKEN();
    const res = await commitFetch(`${API()}/v2/booking/${rid}/reservations/${encodeURIComponent(ref)}`, {
      method: 'PUT', headers: h,
      body: JSON.stringify({
        party_size: hold.covers, date_time: `${hold.date}T${hold.time}`, reservation_token: hold.holdId,
        reservation_attribute: 'default', ...(guest.notes ? { special_request: guest.notes.slice(0, 75) } : {}),
      }),
    });
    const json = await bodyOf(res) as Record<string, unknown> | null;
    if (!res.ok) return otRefusal(res.status, json, hold.handoffUrl);
    return settled(hold, json, 'modify', ref);
  },

  async status(ref): Promise<StatusResult> {
    if (!this.enabled()) return refuse('disabled', 'Reach is not booking OpenTable tables yet.');
    const rid = ridOf(ref);
    if (!rid) return refuse('bad_request', 'That is not an OpenTable reservation number.');
    const h = await headers();
    if (!h) return NO_TOKEN();
    const res = await readFetch(`${API()}/v2/booking/${rid}/reservations/${encodeURIComponent(ref)}`, { headers: h });
    if (!res) return refuse('platform_down', "OpenTable didn't answer.");
    const json = await bodyOf(res) as Record<string, unknown> | null;
    if (!res.ok) return otRefusal(res.status, json);
    const st = String(json?.status ?? '');
    const owed = owesOf(json);
    return {
      ok: true, active: st === 'Pending' || st === 'Seated' || st === 'AssumedSeated',
      date: dayOf(json?.date_time), time: clockOf(json?.date_time), covers: Number(json?.party_size) || null,
      fee: otServiceFee(json), owesCard: owed.owes, cardUrl: owed.url, cancelled: st.startsWith('Cancelled'), raw: json,
    };
  },

  async cancel(ref, opts = {}): Promise<CancelResult> {
    if (!this.enabled()) return { status: 'failed', error: 'Reach is not booking OpenTable tables yet, so it cannot cancel one. Use the link in OpenTable’s confirmation.' };
    const rid = ridOf(ref);
    if (!rid) return { status: 'failed', error: 'We don’t hold the OpenTable reservation number for this one.' };
    // Reach never takes a deposit on OpenTable, so nothing it paid comes back.
    if (!opts.confirm) return { status: 'quoted', refundCents: 0, currency: 'USD' };
    const h = await headers(true);
    if (!h) return { status: 'failed', error: "OpenTable didn't let Reach sign in, so the table is still booked. Use the link in OpenTable’s confirmation." };
    const res = await readFetch(`${API()}/v2/booking/${rid}/reservations/${encodeURIComponent(ref)}`, {
      method: 'PUT', headers: h, body: JSON.stringify({ status: 'CancelledWeb' }),
    });
    if (!res) return { status: 'failed', error: "OpenTable didn't answer, so we can't tell whether the table was cancelled. Check OpenTable’s confirmation before you rely on it either way." };
    const json = await bodyOf(res);
    if (res.ok) return { status: 'cancelled', refundCents: 0, currency: 'USD', raw: json };
    if (res.status >= 500) return { status: 'failed', error: "OpenTable had a problem, so we can't tell whether the table was cancelled. Check OpenTable’s confirmation, or ring the restaurant.", raw: json };
    const r = otRefusal(res.status, json);
    return { status: 'failed', error: r.code === 'cancel_too_late' ? r.error : "OpenTable wouldn't cancel this table. Use the link in OpenTable’s confirmation, or ring the restaurant.", raw: json };
  },

  async quote(req: BookingItemRequest): Promise<BookingItemResult> {
    return quoteWith(this, req);
  },
  async book(req: BookingItemRequest): Promise<BookingItemResult> {
    return bookWith(this, req);
  },
};

/**
 * A 2xx from reserve or modify, read. Confirmed only with OpenTable's
 * confirmation number; one that still wants something from the diner (a
 * card page, an action) is pending, never booked; a 2xx with no number is
 * an outcome nobody can know.
 */
/**
 * Whether OpenTable's answer says a card is still owed. Only what it says:
 * an answer with neither the payment nor the required action in it is
 * null, not "paid" — a reservation read without those fields is not proof
 * the card was added.
 */
export function owesOf(json: Record<string, unknown> | null): { owes: boolean | null; url: string | null } {
  const payment = json?.payment as { status?: string; payment_page_url?: string } | undefined | null;
  const action = json?.post_booking_required_action;
  const url = typeof payment?.payment_page_url === 'string' ? payment.payment_page_url : null;
  const payOwes = payment && typeof payment.status === 'string' ? payment.status !== 'Completed' : null;
  const actOwes = typeof action === 'string' ? action !== 'None' : null;
  if (payOwes === true || actOwes === true) return { owes: true, url };
  if (payOwes === false || actOwes === false) return { owes: false, url };
  return { owes: null, url };
}

function settled(hold: TableHold, json: Record<string, unknown> | null, step: 'reserve' | 'modify', ref?: string): BookingItemResult {
  if (json === null) {
    // Modify answers with a body in OpenTable's docs; reserve always does.
    throw new OutcomeUnknown(`OpenTable accepted the ${step === 'modify' ? 'change' : 'reservation'} and its answer could not be read.`);
  }
  const n = json.confirmation_number;
  const num = (typeof n === 'number' && n > 0) || (typeof n === 'string' && /^\d+$/.test(n)) ? String(n) : null;
  if (!num) throw new OutcomeUnknown(`OpenTable accepted the ${step === 'modify' ? 'change' : 'reservation'} and sent no confirmation number.`);
  const providerRef = ref ?? `${hold.venueId}-${num}`;
  const payment = json.payment as { status?: string; payment_page_url?: string; auto_cancel_hours?: number } | undefined;
  const action = String(json.post_booking_required_action ?? 'None');
  const owesSomething = (payment && payment.status && payment.status !== 'Completed') || (action && action !== 'None');
  const manage = typeof json.manage_reservation_url === 'string' ? json.manage_reservation_url : undefined;
  return {
    vertical: 'restaurant', mode: 'native',
    status: owesSomething ? 'pending' : 'confirmed',
    provider: 'opentable', providerRef,
    redirectUrl: owesSomething ? (payment?.payment_page_url || manage) : manage,
    priceCents: 0,
    raw: {
      confirmation_number: num, manage_reservation_url: manage ?? null,
      message: plainText(json.message), cancel_cutoff_date_utc: json.cancel_cutoff_date_utc ?? null,
      post_booking_required_action: action, payment: payment ?? null,
      date_time: json.date_time ?? `${hold.date}T${hold.time}`, party_size: json.party_size ?? hold.covers,
    },
    ...(owesSomething ? { error: 'OpenTable is holding this table until a card is added on its page. It is not booked until then.' } : {}),
  };
}
