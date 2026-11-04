// ─── Booking a table on a booking row: openings, hold, reserve, cancel ───
// What /api/bookings/[id]/table does, without the request around it, so
// every state can be tested with a fake platform and a fake database.
//
// The row is the one /api/bookings wrote for the itinerary's dinner line.
// Its state lives in response_payload.table:
//
//   { platform, venueId,
//     hold?:      the slot held for whoever is reading the terms,
//     reserving?: who pressed the button and when, written before the
//                 platform is called; `unknown` set when it never answered }
//
// Every write is conditional on the row's updated_at as it was read, so two
// presses of the button — a double-tap, two members at once — cannot both
// reach the platform: only one write matches, the other is told somebody is
// booking it. A row whose platform never answered stays marked, and is never
// booked again from here until somebody has checked.
//
// The hand-off is in every answer: the restaurant's own platform page
// ("Book on your own OpenTable") and its phone, so a refusal always leaves
// the next option on screen.
import { isOutcomeUnknown, type BookingItemResult } from '../types.ts';
import { midClaim } from '../claim.ts';
import { platformOfHost } from '../booking-links.ts';
import {
  type TableGuest, type TableHold, type TablePlatform, type TableProvider, type TableRefusal,
  HOLD_MINUTES, PLATFORM_LABEL, isRefusal,
} from './types.ts';
import { BOOK_BUTTON, TABLE_COPY, bookedCopy, heldCopy, pendingCopy, type TableWho } from './wording.ts';

export interface TableRow {
  id: string;
  plan_id: string;
  vertical: string;
  status: string;
  mode?: string | null;
  provider?: string | null;
  provider_ref?: string | null;
  redirect_url?: string | null;
  detail?: string | null;
  request_payload?: Record<string, any> | null;
  response_payload?: Record<string, any> | null;
  approved_at?: string | null;
  updated_at?: string | null;
}

export interface TableState {
  platform: TablePlatform;
  venueId: string;
  hold?: TableHold & { heldBy: string };
  reserving?: { at: string; by: string; holdId: string; unknown?: string };
}

export type Write = { ok: true; version: string } | { ok: false; taken: boolean; error?: string };

export interface TableStore {
  /** Apply `patch` only if the row is still at `version` (its updated_at). */
  write(id: string, version: string | null, patch: Record<string, unknown>): Promise<Write>;
}

export interface TableCtx {
  row: TableRow;
  /** The provider and id Reach may book this restaurant with, or null (lib/booking/registry.ts tableProviderFor). */
  table: { provider: TableProvider; venueId: string } | null;
  /** Which platform the row was booked on, when it was (tableProviderNamed). */
  bookedOn: TableProvider | null;
  solo: boolean;
  userId: string;
  store: TableStore;
  now?: Date;
  /** The restaurant's own links and number, from the venue table — for the hand-off. */
  venue?: { reservationUrl?: string | null; phone?: string | null } | null;
  /** Something was booked at the platform and our row does not say so. */
  report?: (message: string, extra: Record<string, unknown>) => void;
}

export interface FlowAnswer { status: number; body: Record<string, unknown> }

const NEW_OK = new Set(['awaiting_approval', 'redirected', 'failed', 'quoted']);

/** Where to go if Reach does not book it: the restaurant's own platform page, and its phone. */
export function handoffFor(row: TableRow, venue?: TableCtx['venue']) {
  const r = (row.request_payload?.restaurant ?? {}) as { externalUrl?: string; phone?: string | null };
  const url = venue?.reservationUrl || r.externalUrl || (row.mode === 'redirect' ? row.redirect_url : null) || null;
  let label: string | null = null;
  if (url) {
    try {
      const p = platformOfHost(new URL(url).hostname);
      label = p === 'opentable' ? 'Book on your own OpenTable' : p === 'resy' ? 'Book on your own Resy' : p === 'yelp' ? 'Book on Yelp yourself' : p ? 'Book on their booking page' : 'Book on their site';
    } catch { /* not a URL: no link */ }
  }
  return {
    ownAccount: url && label ? { label, url } : null,
    phone: venue?.phone ?? r.phone ?? null,
  };
}

function stateOf(row: TableRow): TableState | null {
  const t = row.response_payload?.table;
  return t && typeof t === 'object' && (t.platform === 'yelp' || t.platform === 'opentable') ? t as TableState : null;
}

function withState(row: TableRow, state: TableState | null): Record<string, unknown> {
  const rest = { ...(row.response_payload ?? {}) };
  if (state) rest.table = state; else delete rest.table;
  return rest;
}

const nameOf = (row: TableRow) => String(row.request_payload?.restaurant?.name || row.detail || 'the restaurant').trim();

function refusal(r: TableRefusal, row: TableRow, venue: TableCtx['venue'], status = statusFor(r)): FlowAnswer {
  return { status, body: { code: r.code, error: r.error, platformUrl: r.handoffUrl ?? null, handoff: handoffFor(row, venue) } };
}

function statusFor(r: TableRefusal): number {
  switch (r.code) {
    case 'disabled': case 'no_venue_id': return 503;
    case 'not_on_platform': case 'slot_gone': case 'hold_expired': case 'duplicate': case 'no_change':
    case 'cancel_too_late': case 'already_cancelled': case 'needs_card': return 409;
    case 'party_size': case 'bad_request': return 422;
    case 'rate_limited': return 429;
    default: return 502;
  }
}

const answer = (status: number, body: Record<string, unknown>, ctx: TableCtx): FlowAnswer =>
  ({ status, body: { ...body, handoff: handoffFor(ctx.row, ctx.venue) } });

/** Why this row cannot be booked on a platform from here, or null. */
function blocked(ctx: TableCtx, forChange: boolean): FlowAnswer | null {
  const { row } = ctx;
  if (row.vertical !== 'restaurant') return answer(409, { code: 'not_a_table', error: 'This booking is not a table.' }, ctx);
  const state = stateOf(row);
  if (state?.reserving?.unknown) return answer(409, { code: 'outcome_unknown', error: TABLE_COPY.outcomeUnknown }, ctx);
  if (state?.reserving) return answer(409, { code: 'in_progress', error: TABLE_COPY.inProgress }, ctx);
  if (row.status === 'booking' || midClaim(row)) return answer(409, { code: 'in_progress', error: TABLE_COPY.inProgress }, ctx);
  if (row.status === 'confirmed') {
    if (!ctx.bookedOn) return answer(409, { code: 'already_booked', error: 'This table is already booked.' }, ctx);
    if (!forChange) return answer(409, { code: 'already_booked', error: 'This table is already booked. To move it, change the time.' }, ctx);
    if (!ctx.bookedOn.canModify) return answer(409, { code: 'no_change', error: TABLE_COPY.yelpNoChange, canCancel: true }, ctx);
    return null;
  }
  if (forChange) return answer(409, { code: 'not_booked', error: 'There is no booked table to change yet.' }, ctx);
  if (row.status === 'pending' && ctx.bookedOn && row.provider_ref) {
    // Reach's own table, waiting on a card at the platform: not "somebody is
    // booking it". settlePending has already asked the platform where it can.
    return answer(409, { code: 'pending_card', error: TABLE_COPY.pendingCard(PLATFORM_LABEL[ctx.bookedOn.platform]), platformUrl: row.redirect_url ?? null }, ctx);
  }
  if (row.status === 'pending') {
    return answer(409, { code: 'in_progress', error: 'Something is already asking this restaurant for the table. Wait for it to finish, or use the links below.' }, ctx);
  }
  if (row.status === 'cancelled') return answer(409, { code: 'cancelled', error: 'This table was cancelled. Add the dinner again to book a new one.' }, ctx);
  if (!NEW_OK.has(row.status)) return answer(409, { code: 'not_bookable', error: 'This table cannot be booked from here.' }, ctx);
  return null;
}

/** The provider for this step: the one it was booked on for a change, else the one Reach may use. */
function providerFor(ctx: TableCtx, forChange: boolean): { provider: TableProvider; venueId: string } | FlowAnswer {
  if (forChange) {
    const s = stateOf(ctx.row);
    if (!ctx.bookedOn || !s) return answer(409, { code: 'not_booked', error: 'There is no booked table to change yet.' }, ctx);
    if (!ctx.bookedOn.enabled()) return answer(503, { code: 'disabled', error: `Reach can't reach ${PLATFORM_LABEL[ctx.bookedOn.platform]} right now. Use the link in its confirmation to change the table.` }, ctx);
    return { provider: ctx.bookedOn, venueId: s.venueId };
  }
  if (!ctx.table) {
    return answer(503, {
      code: 'not_bookable_here',
      error: "Reach can't book this restaurant itself yet. Book it on their page, or ring them.",
    }, ctx);
  }
  return ctx.table;
}

const okDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const okTime = (s: unknown) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** The night, time and party, from what the person chose — or the line's own, never a default. */
function askOf(ctx: TableCtx, given: { date?: unknown; time?: unknown; covers?: unknown }) {
  const r = (ctx.row.request_payload?.restaurant ?? {}) as { date?: string; time?: string | null; partySize?: number };
  const date = given.date ?? r.date;
  const time = given.time ?? r.time;
  const covers = Math.floor(Number(given.covers ?? ctx.row.request_payload?.party ?? r.partySize));
  if (!okDate(date) || !okTime(time)) return null;
  if (!Number.isFinite(covers) || covers < 1) return null;
  return { date: date as string, time: time as string, covers };
}

/** The platform this row's unanswered booking was sent to, when one never answered. */
export function reserveUnknown(row: { response_payload?: Record<string, any> | null }): TablePlatform | null {
  const t = row.response_payload?.table;
  return t && typeof t === 'object' && t.reserving?.unknown && (t.platform === 'yelp' || t.platform === 'opentable') ? t.platform : null;
}

// ─── A table left pending at the platform ────────────────────────────────
// OpenTable answers some bookings with "add a card on our page", and the row
// is stored 'pending' — not booked. Nothing else moves it: the person adds
// the card on OpenTable, or doesn't and OpenTable lets it go (15 minutes, in
// its own example). Without asking, the row said "not booked yet" after the
// card was added, and "somebody is booking it" for ever after OpenTable had
// cancelled it, so the dinner could never be booked again.
//
// So every step asks the platform first. Only what it says moves the row:
// cancelled → failed (bookable again, the old number kept on the record);
// a card no longer owed → confirmed. An answer that says neither, or none,
// leaves it pending.

export async function settlePending(ctx: TableCtx): Promise<TableCtx> {
  const { row } = ctx;
  const p = ctx.bookedOn;
  if (row.status !== 'pending' || !p || !row.provider_ref || stateOf(row)?.reserving || !p.enabled()) return ctx;
  const booked = (row.response_payload?.booked ?? {}) as Record<string, any>;
  const covers = Math.floor(Number(booked.covers ?? booked.party_size ?? row.request_payload?.party)) || 1;
  let s;
  try {
    s = await p.status(String(row.provider_ref), { covers });
  } catch (e) {
    console.error('[tables] could not check a pending table', { id: row.id, msg: e instanceof Error ? e.message : String(e) });
    return ctx;
  }
  if (isRefusal(s)) return ctx;
  const at = (ctx.now ?? new Date()).toISOString();
  let patch: Record<string, unknown>;
  if (s.cancelled) {
    patch = {
      status: 'failed', provider_ref: null, redirect_url: null,
      error: `${PLATFORM_LABEL[p.platform]} let this table go before a card was added. Nothing is booked.`,
      response_payload: { ...(row.response_payload ?? {}), booked: { ...booked, lapsedAt: at } },
    };
  } else if (s.owesCard === false) {
    patch = {
      status: 'confirmed', error: null,
      redirect_url: typeof booked.manage_reservation_url === 'string' ? booked.manage_reservation_url : row.redirect_url ?? null,
      response_payload: { ...(row.response_payload ?? {}), booked: { ...booked, cardAddedAt: at } },
    };
  } else {
    return ctx;
  }
  const w = await ctx.store.write(row.id, row.updated_at ?? null, { ...patch, updated_at: at });
  if (w.ok === false) return ctx;
  return { ...ctx, row: { ...row, ...patch, updated_at: w.version } as TableRow };
}

// ─── GET: what the screen shows ──────────────────────────────────────────

export async function openingsStep(ctx0: TableCtx, given: { date?: unknown; time?: unknown; covers?: unknown; change?: boolean }): Promise<FlowAnswer> {
  const ctx = await settlePending(ctx0);
  const b = blocked(ctx, !!given.change);
  if (b) return b;
  const p = providerFor(ctx, !!given.change);
  if ('status' in p) return p;
  const ask = askOf(ctx, given);
  if (!ask) return answer(422, { code: 'needs_time', error: TABLE_COPY.needsTime, platform: p.provider.platform }, ctx);
  const o = await p.provider.openings(p.venueId, ask);
  if (isRefusal(o)) return refusal(o, ctx.row, ctx.venue);
  return answer(200, {
    platform: p.provider.platform,
    platformLabel: PLATFORM_LABEL[p.provider.platform],
    date: ask.date, time: ask.time, covers: ask.covers,
    // A slot that needs a card is listed with its own link and never offered as Reach's to book.
    slots: o.slots.map(s => ({ date: s.date, time: s.time, reachBooks: !s.needsCard, handoffUrl: s.handoffUrl, cardNote: s.cardNote ?? null })),
    canModify: p.provider.canModify,
    ...(o.slots.some(s => !s.needsCard) ? {} : {
      error: o.slots.length
        ? 'Every time left needs a card, which the restaurant takes on its own page. Pick one there, or ring them.'
        : `No tables left on ${PLATFORM_LABEL[p.provider.platform]} that night. Try another time, or ring them.`,
    }),
  }, ctx);
}

// ─── POST hold ───────────────────────────────────────────────────────────

export async function holdStep(ctx0: TableCtx, given: { date?: unknown; time?: unknown; covers?: unknown; change?: boolean }): Promise<FlowAnswer> {
  const ctx = await settlePending(ctx0);
  const change = !!given.change;
  const b = blocked(ctx, change);
  if (b) return b;
  const p = providerFor(ctx, change);
  if ('status' in p) return p;
  const ask = askOf(ctx, given);
  if (!ask) return answer(422, { code: 'needs_time', error: TABLE_COPY.needsTime }, ctx);
  const version = ctx.row.updated_at ?? null;
  const h = await p.provider.hold(p.venueId, { ...ask, uniqueId: ctx.row.id });
  if (isRefusal(h)) return refusal(h, ctx.row, ctx.venue);
  const state: TableState = { platform: p.provider.platform, venueId: p.venueId, hold: { ...h.hold, heldBy: ctx.userId } };
  const wrote = await ctx.store.write(ctx.row.id, version, {
    response_payload: withState(ctx.row, state),
    updated_at: (ctx.now ?? new Date()).toISOString(),
  });
  if (wrote.ok === false) {
    // Not ours to keep: let the table go rather than sit on it unrecorded.
    await p.provider.release(h.hold);
    return answer(409, { code: wrote.taken ? 'changed' : 'store_error', error: wrote.taken ? TABLE_COPY.changedMeanwhile : 'We could not save that hold just now. Nothing was booked — try again.' }, ctx);
  }
  const who = whoFor(ctx, h.hold, '');
  const copy = heldCopy(who, HOLD_MINUTES, BOOK_BUTTON[h.hold.platform]);
  return answer(200, {
    hold: publicHold(h.hold),
    button: BOOK_BUTTON[h.hold.platform],
    title: copy.title, body: copy.body,
    // Yelp cannot change a booking later; said before it is made.
    changeNote: p.provider.canModify ? null : TABLE_COPY.yelpNoChange,
  }, ctx);
}

/** The hold as the screen needs it: everything to show before the button, never the platform's token. */
export function publicHold(h: TableHold) {
  return {
    holdId: h.holdId, platform: h.platform, platformLabel: PLATFORM_LABEL[h.platform],
    date: h.date, time: h.time, covers: h.covers, expiresAt: h.expiresAt,
    cancellationPolicy: h.cancellationPolicy, policies: h.policies,
    terms: h.terms, fee: h.fee, cancelBy: h.cancelBy, notes: h.notes, editable: h.editable,
  };
}

function whoFor(ctx: TableCtx, h: { platform: TablePlatform; date: string; time: string; covers: number }, under: string): TableWho {
  return { restaurant: nameOf(ctx.row), platform: h.platform, date: h.date, time: h.time, covers: h.covers, under, solo: ctx.solo };
}

// ─── POST reserve ────────────────────────────────────────────────────────

export interface ReserveAsk {
  holdId?: unknown;
  /** What the person accepted on screen: the terms' version, and the restaurant's policy. */
  accept?: { terms?: unknown; policy?: unknown } | null;
}

export async function reserveStep(ctx0: TableCtx, ask: ReserveAsk, guest: TableGuest | null): Promise<FlowAnswer> {
  const ctx = await settlePending(ctx0);
  const change = ctx.row.status === 'confirmed';
  const b = blocked(ctx, change);
  if (b) return b;
  const state = stateOf(ctx.row);
  const hold = state?.hold;
  if (!state || !hold || typeof ask.holdId !== 'string' || ask.holdId !== hold.holdId) {
    return answer(409, { code: 'hold_missing', error: TABLE_COPY.holdMissing }, ctx);
  }
  const now = ctx.now ?? new Date();
  if (Date.parse(hold.expiresAt) <= now.getTime()) {
    return answer(409, { code: 'hold_expired', error: `The ${HOLD_MINUTES} minutes ${PLATFORM_LABEL[hold.platform]} holds a table for ran out, so nothing was booked. Pick the time again.` }, ctx);
  }
  const provider = change ? ctx.bookedOn : (ctx.table?.provider.platform === hold.platform ? ctx.table.provider : null);
  if (!provider || provider.platform !== hold.platform || (!change && ctx.table?.venueId !== hold.venueId)) {
    return answer(503, { code: 'not_bookable_here', error: "Reach can't book this restaurant itself right now. Book it on their page, or ring them." }, ctx);
  }
  // Shown and accepted, or not booked: OpenTable's terms, and the restaurant's own policy.
  const hasPolicy = !!hold.cancellationPolicy || hold.policies.length > 0;
  if ((hold.terms && ask.accept?.terms !== hold.terms.version) || (hasPolicy && ask.accept?.policy !== true)) {
    return answer(422, { code: 'terms_not_accepted', error: TABLE_COPY.termsNotAccepted, terms: hold.terms }, ctx);
  }
  if (!guest) return answer(422, { code: 'needs_guest', error: TABLE_COPY.needsGuest }, ctx);

  // The claim: written before the platform is called, on the row as read.
  const at = now.toISOString();
  const claimed = await ctx.store.write(ctx.row.id, ctx.row.updated_at ?? null, {
    response_payload: withState(ctx.row, { ...state, reserving: { at, by: ctx.userId, holdId: hold.holdId } }),
    updated_at: at,
  });
  if (claimed.ok === false) {
    return answer(409, { code: claimed.taken ? 'in_progress' : 'store_error', error: claimed.taken ? TABLE_COPY.inProgress : 'Could not start this booking just now. Nothing was booked.' }, ctx);
  }
  const claimedRow: TableRow = { ...ctx.row, updated_at: claimed.version, response_payload: withState(ctx.row, { ...state, reserving: { at, by: ctx.userId, holdId: hold.holdId } }) };

  let result: BookingItemResult | TableRefusal;
  try {
    result = change && provider.modify
      ? await provider.modify(String(ctx.row.provider_ref ?? ''), hold, guest)
      : await provider.reserve(hold, guest, { reference: ctx.row.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isOutcomeUnknown(e)) {
      // It may be booked. Kept claimed, with the reason, so nothing books it twice.
      const kept = await ctx.store.write(ctx.row.id, claimed.version, {
        response_payload: withState(claimedRow, { ...state, reserving: { at, by: ctx.userId, holdId: hold.holdId, unknown: msg } }),
        error: `outcome unknown: ${msg}`,
        updated_at: new Date().toISOString(),
      });
      if (kept.ok === false) console.error('[tables] could not note an unknown outcome', { id: ctx.row.id, error: kept.error });
      ctx.report?.(`table outcome unknown: ${msg}`, { bookingId: ctx.row.id, platform: hold.platform });
      return answer(502, { code: 'outcome_unknown', error: TABLE_COPY.outcomeUnknown }, ctx);
    }
    result = { ok: false, code: 'platform_down', error: `${PLATFORM_LABEL[hold.platform]} couldn't be reached. Nothing was booked — try again shortly.` };
    console.error('[tables] reserve threw before anything was sent', { id: ctx.row.id, msg });
  }

  if (isRefusal(result) || result.status === 'failed') {
    const r: TableRefusal = isRefusal(result) ? result : { ok: false, code: 'bad_request', error: result.error || 'Nothing was booked.' };
    // The hold is spent either way; the claim is let go so somebody can try again.
    const freed = await ctx.store.write(ctx.row.id, claimed.version, {
      response_payload: withState(claimedRow, { platform: state.platform, venueId: state.venueId }),
      updated_at: new Date().toISOString(),
    });
    if (freed.ok === false) console.error('[tables] could not release a refused claim', { id: ctx.row.id, error: freed.error });
    return refusal(r, ctx.row, ctx.venue);
  }

  const ref = result.providerRef!;
  const lead = guest.firstName;
  const who = whoFor(ctx, hold, lead);
  const pending = result.status === 'pending';
  const copy = pending ? pendingCopy(who) : bookedCopy(who, ref.replace(/^\d+-/, ''));
  const done = await ctx.store.write(ctx.row.id, claimed.version, {
    status: pending ? 'pending' : 'confirmed',
    mode: 'native',
    provider: hold.platform,
    provider_ref: ref,
    redirect_url: result.redirectUrl ?? null,
    price_cents: null,
    error: null,
    detail: nameOf(ctx.row),
    response_payload: {
      ...withState(claimedRow, { platform: state.platform, venueId: state.venueId }),
      booked: { platform: hold.platform, ref, date: hold.date, time: hold.time, covers: hold.covers, under: lead, by: ctx.userId, at, ...(result.raw as object ?? {}) },
      policy: { cancellation: hold.cancellationPolicy, policies: hold.policies, cancelBy: hold.cancelBy, terms: hold.terms?.version ?? null },
    },
    updated_at: new Date().toISOString(),
  });
  if (done.ok === false) {
    // Booked at the platform, and our row does not say so: the one fault a
    // retry cannot fix. Said loudly, and the person is told it IS booked.
    ctx.report?.('table booked and not recorded', { bookingId: ctx.row.id, platform: hold.platform, ref });
    // Pending is not booked here either: the platform still wants a card.
    return answer(200, {
      booked: !pending, pending, ref, platform: hold.platform, confirmationUrl: result.redirectUrl ?? null, title: copy.title, body: copy.body,
      warning: pending
        ? `${PLATFORM_LABEL[hold.platform]} is holding it until a card is added, but we could not update your plan — it may not show here yet.`
        : 'It is booked with the restaurant, but we could not update your plan — it may not show as booked here yet.',
    }, ctx);
  }
  return answer(200, {
    booked: !pending, pending, ref, platform: hold.platform, confirmationUrl: result.redirectUrl ?? null,
    title: copy.title, body: copy.body,
  }, ctx);
}

// ─── POST cancel ─────────────────────────────────────────────────────────

export async function cancelStep(ctx0: TableCtx, confirm: boolean): Promise<FlowAnswer> {
  const ctx = await settlePending(ctx0);
  const { row } = ctx;
  if (row.status === 'cancelled') return answer(200, { status: 'cancelled', alreadyCancelled: true }, ctx);
  const p = ctx.bookedOn;
  if (!p || !row.provider_ref || !['confirmed', 'pending'].includes(row.status)) {
    // A booking that never answered may well be booked: never "Reach did not book this".
    const unknown = reserveUnknown(row);
    if (unknown) return answer(409, { code: 'outcome_unknown', error: TABLE_COPY.outcomeUnknownCancel(PLATFORM_LABEL[unknown]) }, ctx);
    if (row.status === 'failed' && row.response_payload?.booked?.lapsedAt) {
      return answer(200, { status: 'failed', alreadyCancelled: true, body: `${PLATFORM_LABEL[row.response_payload.table?.platform as TablePlatform] ?? 'The platform'} already let this table go, so there is nothing to cancel.` }, ctx);
    }
    return answer(409, { code: 'not_booked', error: 'Reach did not book this table, so it is cancelled wherever it was booked. Their link and number are below.' }, ctx);
  }
  const policy = (row.response_payload?.policy ?? {}) as { cancellation?: string | null; cancelBy?: string | null };
  const r = await p.cancel(row.provider_ref, { confirm });
  if (r.status === 'failed') return answer(502, { code: 'cancel_failed', error: r.error ?? 'That table could not be cancelled.' }, ctx);
  if (r.status === 'quoted') {
    return answer(200, {
      status: 'quoted', refundCents: 0,
      cancellationPolicy: policy.cancellation ?? null, cancelBy: policy.cancelBy ?? null,
      body: `This cancels the table on ${PLATFORM_LABEL[p.platform]}. Reach took no payment for it, so there is nothing to refund.`,
    }, ctx);
  }
  const marked = await ctx.store.write(row.id, row.updated_at ?? null, {
    status: 'cancelled', response_payload: withState(row, null), updated_at: new Date().toISOString(),
  });
  if (marked.ok === false) {
    ctx.report?.('table cancelled and not recorded', { bookingId: row.id, platform: p.platform });
    return answer(200, { status: 'cancelled', warning: `It is cancelled on ${PLATFORM_LABEL[p.platform]}, but we could not update your plan — it may still show as booked.` }, ctx);
  }
  return answer(200, { status: 'cancelled', body: `Cancelled on ${PLATFORM_LABEL[p.platform]}.` }, ctx);
}
