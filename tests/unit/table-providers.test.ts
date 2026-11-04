// Reach booking a table itself, on Yelp Reservations and OpenTable's
// Consumer API — against answers recorded from each platform's own docs
// (fixtures/tables/recorded.json). No live call is made: no credentials exist.
//
// What these hold: a platform with no credentials is never called; an id
// comes only from a link we hold; "confirmed" only with the platform's own
// reservation id; a 2xx without one, a 5xx or silence is "outcome unknown";
// a slot needing a card is handed to the platform, never booked; the terms
// and policy are accepted before anything is booked; two presses book once.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { yelpReservations, yelpBusinessFrom } from '../../lib/booking/providers/tables.yelp.ts';
import { openTableReservations, openTableRidFrom, otServiceFee, resetOpenTableToken, OPENTABLE_TERMS, phoneOf } from '../../lib/booking/providers/tables.opentable.ts';
import { pickTable } from '../../lib/booking/tables/pick.ts';
import { holdStep, openingsStep, reserveStep, cancelStep, type TableRow, type TableStore, type TableCtx } from '../../lib/booking/tables/flow.ts';
import { isRefusal, type TableHold, type TableGuest } from '../../lib/booking/tables/types.ts';
import { isOutcomeUnknown, type BookingItemResult } from '../../lib/booking/types.ts';
import { reachBuys } from '../../lib/booking/charged.ts';

const REC = JSON.parse(readFileSync('tests/unit/fixtures/tables/recorded.json', 'utf8'));
const Y = REC.yelp, O = REC.opentable;

// ─── A recorded platform ────────────────────────────────────────────────
type Call = { method: string; url: string; headers: Record<string, string>; body: string };
type Reply = { status: number; body?: unknown } | 'drop' | ((c: Call) => { status: number; body?: unknown } | 'drop');
let calls: Call[] = [];
let routes: [string, RegExp, Reply][] = [];
const realFetch = globalThis.fetch;

function on(method: string, path: RegExp, reply: Reply) {
  routes.unshift([method, path, reply]);
}

beforeEach(() => {
  calls = [];
  routes = [];
  resetOpenTableToken();
  for (const k of ['YELP_RESERVATIONS_API_KEY', 'YELP_RESERVATIONS_LIVE', 'YELP_RESERVATIONS_TEST_BUSINESSES', 'YELP_API_KEY',
    'OPENTABLE_CLIENT_ID', 'OPENTABLE_CLIENT_SECRET', 'OPENTABLE_API_BASE', 'OPENTABLE_OAUTH_BASE']) delete process.env[k];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const c: Call = { method: init.method || 'GET', url, headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body ?? '') };
    calls.push(c);
    const hit = routes.find(([m, re]) => m === c.method && re.test(url));
    if (!hit) throw new Error(`unrecorded call ${c.method} ${url}`);
    const r = typeof hit[2] === 'function' ? hit[2](c) : hit[2];
    if (r === 'drop') throw new TypeError('fetch failed');
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const yelpOn = (live = false) => {
  process.env.YELP_RESERVATIONS_API_KEY = 'yelp-partner-key';
  if (live) process.env.YELP_RESERVATIONS_LIVE = 'yes';
  else process.env.YELP_RESERVATIONS_TEST_BUSINESSES = 'victors-french-bistro-test-listing-san-francisco';
};
const otOn = () => {
  process.env.OPENTABLE_CLIENT_ID = 'reach';
  process.env.OPENTABLE_CLIENT_SECRET = 'shh';
  process.env.OPENTABLE_API_BASE = 'https://platform.otqa.com';
  process.env.OPENTABLE_OAUTH_BASE = 'https://oauth-pp.opentable.com';
  on('GET', /oauth-pp\.opentable\.com\/api\/v2\/oauth\/token\?grant_type=client_credentials$/, { status: 200, body: O.token });
};

const VICTOR = 'victors-french-bistro-test-listing-san-francisco';
const ASK = { date: '2026-11-06', time: '19:30', covers: 4 };
const GUEST: TableGuest = { firstName: 'Maria', lastName: 'Lopez', email: 'maria@example.com', phone: '+1 (919) 555-0134', notes: 'Window table please' };

// ─── Off means off ──────────────────────────────────────────────────────

test('with no partner credentials neither platform is called — a Places key does not switch Yelp booking on', async () => {
  process.env.YELP_API_KEY = 'places-only';
  assert.equal(yelpReservations.enabled(), false);
  assert.equal(openTableReservations.enabled(), false);
  const y = await yelpReservations.openings(VICTOR, ASK);
  const o = await openTableReservations.openings('1038007', ASK);
  assert.ok(isRefusal(y) && y.code === 'disabled');
  assert.ok(isRefusal(o) && o.code === 'disabled');
  assert.equal(calls.length, 0, 'a disabled platform was called');
  assert.equal(pickTable([openTableReservations, yelpReservations], ['https://www.opentable.com/restref/client?rid=1038007', `https://www.yelp.com/reservations/${VICTOR}`]), null);
});

test('OpenTable needs all three of id, secret and its onboarding base URL — the base is never guessed', () => {
  process.env.OPENTABLE_CLIENT_ID = 'reach';
  process.env.OPENTABLE_CLIENT_SECRET = 'shh';
  assert.equal(openTableReservations.enabled(), false);
  process.env.OPENTABLE_API_BASE = 'https://platform.otqa.com';
  assert.equal(openTableReservations.enabled(), true);
});

test('Yelp with a key books only its provisioned test businesses until it is switched live', async () => {
  yelpOn();
  assert.equal(yelpReservations.allows(VICTOR), true);
  assert.equal(yelpReservations.allows('a-real-restaurant-raleigh'), false);
  const r = await yelpReservations.hold('a-real-restaurant-raleigh', { ...ASK, uniqueId: 'b1' });
  assert.ok(isRefusal(r) && r.code === 'disabled');
  assert.equal(calls.length, 0, 'a real restaurant was asked for a table in test mode');
  process.env.YELP_RESERVATIONS_LIVE = 'yes';
  assert.equal(yelpReservations.allows('a-real-restaurant-raleigh'), true);
});

// ─── Ids only from links we hold ────────────────────────────────────────

test('a Yelp business comes from its Yelp reservations or business link, and nothing else', () => {
  assert.equal(yelpBusinessFrom(`https://www.yelp.com/reservations/${VICTOR}`), VICTOR);
  assert.equal(yelpBusinessFrom('https://www.yelp.com/biz/poole-s-diner-raleigh?osq=dinner'), 'poole-s-diner-raleigh');
  assert.equal(yelpBusinessFrom('https://www.yelp.com/search?find_desc=poole%27s'), null);
  assert.equal(yelpBusinessFrom('https://www.yelp.com/'), null);
  assert.equal(yelpBusinessFrom('https://notyelp.com/biz/poole-s-diner-raleigh'), null);
  assert.equal(yelpBusinessFrom('Poole’s Diner'), null, 'a name is not an id');
});

test('an OpenTable rid comes from rid/restref or a profile page — never from a slug', () => {
  assert.equal(openTableRidFrom('https://www.opentable.com/booking/restref/availability?rid=1038007&restref=1038007'), '1038007');
  assert.equal(openTableRidFrom('https://www.opentable.com/restref/client?restRef=412&lang=en-US'), '412');
  assert.equal(openTableRidFrom('https://www.opentable.com/restaurant/profile/152416/reserve'), '152416');
  assert.equal(openTableRidFrom('https://www.opentable.com/r/mulino-reservations-raleigh'), null);
  assert.equal(openTableRidFrom('https://www.opentable.com/booking/restref/availability?rid='), null);
  assert.equal(openTableRidFrom('https://evil.example.com/?rid=1038007'), null);
});

test('the picker uses a platform only when it is on and holds an id for this restaurant', () => {
  otOn();
  const both = [openTableReservations, yelpReservations];
  assert.equal(pickTable(both, ['https://www.opentable.com/r/mulino-reservations-raleigh']), null);
  const p = pickTable(both, [null, 'https://www.opentable.com/booking/restref/availability?rid=1038007&restref=1038007']);
  assert.equal(p?.provider.platform, 'opentable');
  assert.equal(p?.venueId, '1038007');
  assert.equal(pickTable(both, [`https://www.yelp.com/reservations/${VICTOR}`]), null, 'Yelp is off here');
  // A provider that is off is skipped whatever else it says about itself.
  const off = { ...openTableReservations, enabled: () => false, allows: () => true };
  assert.equal(pickTable([off], ['https://www.opentable.com/restref/client?rid=1038007']), null);
});

// ─── Yelp ───────────────────────────────────────────────────────────────

test('Yelp openings: only the night asked for, in order, and a card slot handed to Yelp', async () => {
  yelpOn();
  on('GET', /\/v3\/bookings\/victors-french-bistro-test-listing-san-francisco\/openings\?/, { status: 200, body: Y.openings });
  const o = await yelpReservations.openings(VICTOR, ASK);
  assert.ok(!isRefusal(o));
  assert.deepEqual(o.slots.map(s => s.time), ['18:45', '19:30', '20:00']);
  assert.ok(o.slots.every(s => s.date === '2026-11-06'));
  const card = o.slots.find(s => s.time === '20:00')!;
  assert.equal(card.needsCard, true);
  assert.match(card.handoffUrl!, /yelp\.com\/reservations\/victors/);
  assert.equal(o.maxParty, 8);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('covers'), '4');
  assert.equal(u.searchParams.get('time'), '19:30');
  assert.equal(calls[0].headers.Authorization, 'Bearer yelp-partner-key');
});

test('a Yelp hold carries the cancellation policy and Yelp\'s page; a card hold is handed off, not booked', async () => {
  yelpOn();
  on('POST', /\/holds$/, { status: 200, body: Y.hold });
  const h = await yelpReservations.hold(VICTOR, { ...ASK, uniqueId: 'booking-1' });
  assert.ok(!isRefusal(h));
  assert.match(h.hold.cancellationPolicy!, /24 hours ahead/);
  assert.equal(h.hold.holdId, Y.hold.hold_id);
  assert.equal(h.hold.editable, false);
  assert.match(h.hold.handoffUrl!, /hold_id=ab12/);
  const form = new URLSearchParams(calls[0].body);
  assert.equal(calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(form.get('unique_id'), 'booking-1');
  assert.equal(form.get('covers'), '4');

  on('POST', /\/holds$/, { status: 200, body: Y.holdCard });
  const c = await yelpReservations.hold(VICTOR, { ...ASK, uniqueId: 'booking-1' });
  assert.ok(isRefusal(c) && c.code === 'needs_card');
  assert.match(c.handoffUrl!, /hold_id=zz12/);
});

async function yelpHold(): Promise<TableHold> {
  on('POST', /\/holds$/, { status: 200, body: Y.hold });
  const h = await yelpReservations.hold(VICTOR, { ...ASK, uniqueId: 'booking-1' });
  assert.ok(!isRefusal(h));
  return h.hold;
}

test('Yelp reserve is confirmed only with Yelp\'s reservation id, and sends the row as unique_id', async () => {
  yelpOn();
  const hold = await yelpHold();
  on('POST', /\/reservations$/, { status: 200, body: Y.reservation });
  const r = await yelpReservations.reserve(hold, GUEST, { reference: 'booking-1' }) as BookingItemResult;
  assert.equal(r.status, 'confirmed');
  assert.equal(r.providerRef, Y.reservation.reservation_id);
  assert.match(r.redirectUrl!, /confirmed\/e33b/);
  const form = new URLSearchParams(calls.at(-1)!.body);
  assert.equal(form.get('hold_id'), hold.holdId);
  assert.equal(form.get('unique_id'), 'booking-1');
  assert.equal(form.get('first_name'), 'Maria');
  assert.equal(form.get('phone'), GUEST.phone);
});

test('Yelp: a 2xx with no id, an unreadable 2xx, a 5xx and silence are each "outcome unknown", never failed', async () => {
  yelpOn();
  const hold = await yelpHold();
  for (const reply of [{ status: 200, body: { notes: 'ok' } }, { status: 200 }, { status: 500, body: Y.errors.internal }, 'drop'] as Reply[]) {
    on('POST', /\/reservations$/, reply);
    await assert.rejects(() => yelpReservations.reserve(hold, GUEST, { reference: 'booking-1' }), (e: unknown) => isOutcomeUnknown(e));
  }
});

test('Yelp refusals say what happened and where to go next', async () => {
  yelpOn();
  const hold = await yelpHold();
  const cases: [unknown, number, string][] = [
    [Y.errors.creditCardRequired, 402, 'needs_card'],
    [Y.errors.slotGone, 409, 'slot_gone'],
    [Y.errors.holdNotFound, 404, 'hold_expired'],
    [Y.errors.duplicate, 409, 'duplicate'],
    [Y.errors.doesNotTake, 404, 'not_on_platform'],
  ];
  for (const [body, status, code] of cases) {
    on('POST', /\/reservations$/, { status, body });
    const r = await yelpReservations.reserve(hold, GUEST, { reference: 'booking-1' });
    assert.ok(isRefusal(r), code);
    assert.equal(r.code, code);
    assert.match(r.error, /Nothing|not|doesn't|has not/i);
    if (code === 'needs_card') assert.equal(r.handoffUrl, hold.handoffUrl, 'the card slot is handed to Yelp\'s own page');
  }
});

test('Yelp cancel is two steps; an already-cancelled table reads as cancelled; status reads a cancelled one as inactive', async () => {
  yelpOn();
  const ref = Y.reservation.reservation_id;
  const q = await yelpReservations.cancel(ref);
  assert.equal(q.status, 'quoted');
  assert.equal(calls.length, 0, 'asking what a cancel costs cancelled it');
  on('POST', /\/reservation\/.+\/cancel$/, { status: 200, body: {} });
  assert.equal((await yelpReservations.cancel(ref, { confirm: true })).status, 'cancelled');
  on('POST', /\/reservation\/.+\/cancel$/, { status: 409, body: Y.errors.alreadyCanceled });
  assert.equal((await yelpReservations.cancel(ref, { confirm: true })).status, 'cancelled');
  on('POST', /\/reservation\/.+\/cancel$/, { status: 409, body: Y.errors.cancelConflict });
  const f = await yelpReservations.cancel(ref, { confirm: true });
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /ring the restaurant/);
  on('GET', /\/status\?covers=4$/, { status: 400, body: Y.errors.canceled });
  const s = await yelpReservations.status(ref, { covers: 4 });
  assert.ok(!isRefusal(s) && s.active === false);
  on('GET', /\/status\?covers=4$/, { status: 200, body: Y.status });
  const a = await yelpReservations.status(ref, { covers: 4 });
  assert.ok(!isRefusal(a) && a.active && a.time === '19:30');
});

// ─── OpenTable ──────────────────────────────────────────────────────────

test('OpenTable signs in with client credentials once and reuses the token', async () => {
  otOn();
  on('GET', /\/v2\/availability\/1038007\?/, { status: 200, body: O.availability });
  await openTableReservations.openings('1038007', ASK);
  await openTableReservations.openings('1038007', ASK);
  const tokenCalls = calls.filter(c => /oauth\/token/.test(c.url));
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].headers.Authorization, `Basic ${Buffer.from('reach:shh').toString('base64')}`);
  assert.equal(calls.at(-1)!.headers.Authorization, `Bearer ${O.token.access_token}`);
});

test('OpenTable openings: a plain table is Reach\'s, a deposit slot is OpenTable\'s page, an experience is not offered', async () => {
  otOn();
  on('GET', /\/v2\/availability\/1038007\?/, { status: 200, body: O.availability });
  const o = await openTableReservations.openings('1038007', ASK);
  assert.ok(!isRefusal(o));
  assert.deepEqual(o.slots.map(s => [s.time, s.needsCard]), [['19:00', false], ['19:30', true]]);
  const dep = o.slots[1];
  assert.match(dep.handoffUrl!, /book\/validate\?rid=1038007/);
  assert.equal(dep.cardNote, 'A $5 a person deposit, taken by OpenTable.');
  const u = new URL(calls.at(-1)!.url);
  assert.equal(u.searchParams.get('start_date_time'), '2026-11-06T19:30');
  assert.equal(u.searchParams.get('party_size'), '4');
});

test('an OpenTable lock comes with OpenTable\'s terms and the restaurant\'s policies; a lock that wants a card is let go', async () => {
  otOn();
  on('POST', /\/v2\/booking\/1038007\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/v2\/booking-policies\/1038007\/2026-11-06\/19:00\/4\?dinerContext=details$/, { status: 200, body: O.bookingPolicies });
  const h = await openTableReservations.hold('1038007', { date: '2026-11-06', time: '19:00', covers: 4, uniqueId: 'b' });
  assert.ok(!isRefusal(h));
  assert.equal(h.hold.terms, OPENTABLE_TERMS);
  assert.match(h.hold.terms!.text, /By clicking ‘Complete reservation’ you agree to the OpenTable Terms of Use and Privacy Policy/);
  assert.match(h.hold.policies[0], /15 minute grace period/);
  assert.doesNotMatch(h.hold.policies[0], /<br/);
  assert.equal(h.hold.fee, null, 'no fee is invented for a plain table');

  calls = [];
  on('POST', /\/v2\/booking\/1038007\/slot_locks$/, { status: 200, body: O.slotLockCard });
  on('DELETE', /\/v2\/booking\/1038007\/slot_locks\//, { status: 200, body: O.releasedLock });
  const c = await openTableReservations.hold('1038007', { date: '2026-11-06', time: '19:30', covers: 4, uniqueId: 'b' });
  assert.ok(isRefusal(c) && c.code === 'needs_card');
  assert.ok(calls.some(x => x.method === 'DELETE'), 'the card lock was kept while it was handed off');
});

async function otHold(): Promise<TableHold> {
  on('POST', /\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/booking-policies\//, { status: 200, body: O.bookingPolicies });
  const h = await openTableReservations.hold('1038007', { date: '2026-11-06', time: '19:00', covers: 4, uniqueId: 'b' });
  assert.ok(!isRefusal(h));
  return h.hold;
}

test('OpenTable reserve: confirmed with {rid}-{confirmation_number}; nobody is opted into marketing', async () => {
  otOn();
  const hold = await otHold();
  on('POST', /\/v2\/booking\/1038007\/reservations$/, { status: 201, body: O.reservation });
  const r = await openTableReservations.reserve(hold, GUEST, { reference: 'b' }) as BookingItemResult;
  assert.equal(r.status, 'confirmed');
  assert.equal(r.providerRef, '1038007-1751');
  assert.match(r.redirectUrl!, /confnumber=1751/);
  const sent = JSON.parse(calls.at(-1)!.body);
  assert.equal(sent.reservation_token, hold.holdId);
  assert.deepEqual(sent.phone, { number: '9195550134', country_code: 'US', phone_type: 'mobile' });
  assert.equal(sent.restaurant_email_marketing_opt_in, false);
  assert.equal(sent.sms_notifications_opt_in, false);
  assert.ok(sent.special_request.length <= 75);
});

test('OpenTable: a booking that still wants a card is pending, not booked', async () => {
  otOn();
  const hold = await otHold();
  on('POST', /\/reservations$/, { status: 201, body: O.reservationOwesCard });
  const r = await openTableReservations.reserve(hold, GUEST, { reference: 'b' }) as BookingItemResult;
  assert.equal(r.status, 'pending');
  assert.match(r.redirectUrl!, /cc-details/);
});

test('OpenTable: no confirmation number, an empty 2xx, a 5xx and silence are "outcome unknown"', async () => {
  otOn();
  const hold = await otHold();
  for (const reply of [{ status: 201, body: { message: 'Thanks' } }, { status: 201 }, { status: 504, body: O.errors.gateway }, 'drop'] as Reply[]) {
    on('POST', /\/reservations$/, reply);
    await assert.rejects(() => openTableReservations.reserve(hold, GUEST, { reference: 'b' }), (e: unknown) => isOutcomeUnknown(e));
  }
});

test('OpenTable refusals, read from its documented error messages', async () => {
  otOn();
  const hold = await otHold();
  const cases: [unknown, number, string][] = [
    [O.errors.creditCardRequired, 409, 'needs_card'],
    [O.errors.overlapping, 409, 'duplicate'],
    [O.errors.badToken, 400, 'hold_expired'],
    [O.errors.permission, 403, 'auth'],
  ];
  for (const [body, status, code] of cases) {
    on('POST', /\/reservations$/, { status, body });
    const r = await openTableReservations.reserve(hold, GUEST, { reference: 'b' });
    assert.ok(isRefusal(r));
    assert.equal(r.code, code);
  }
});

test('a phone with no country is not sent under a guessed one', () => {
  assert.equal(phoneOf({ ...GUEST, phone: '+44 20 7946 0958' }), null);
  assert.deepEqual(phoneOf({ ...GUEST, phone: '+44 20 7946 0958', phoneCountry: 'GB' }), { number: '442079460958', country_code: 'GB', phone_type: 'mobile' });
});

test('OpenTable modify moves the booking with a new lock; cancel is two steps and says when it is too late', async () => {
  otOn();
  const hold = await otHold();
  on('PUT', /\/v2\/booking\/1038007\/reservations\/1038007-1751$/, { status: 200, body: O.modified });
  const m = await openTableReservations.modify!('1038007-1751', hold, GUEST) as BookingItemResult;
  assert.equal(m.status, 'confirmed');
  assert.equal(m.providerRef, '1038007-1751');
  assert.equal(JSON.parse(calls.at(-1)!.body).reservation_token, hold.holdId);

  calls = [];
  assert.equal((await openTableReservations.cancel('1038007-1751')).status, 'quoted');
  assert.equal(calls.length, 0);
  on('PUT', /\/reservations\/1038007-1751$/, c => (JSON.parse(c.body).status === 'CancelledWeb' ? { status: 200 } : { status: 400 }));
  assert.equal((await openTableReservations.cancel('1038007-1751', { confirm: true })).status, 'cancelled');
  on('PUT', /\/reservations\/1038007-1751$/, { status: 409, body: O.errors.cancelCutoff });
  const late = await openTableReservations.cancel('1038007-1751', { confirm: true });
  assert.equal(late.status, 'failed');
  assert.match(late.error!, /deadline for cancelling online has passed/);

  on('GET', /\/reservations\/1038007-1751$/, { status: 200, body: O.getReservation });
  const s = await openTableReservations.status('1038007-1751', { covers: 4 });
  assert.ok(!isRefusal(s) && s.active === false, 'a table the restaurant cancelled is not active');
});

test('the OpenTable Service Fee is shown exactly as OpenTable returns it, and not at all when it returns none', () => {
  assert.deepEqual(otServiceFee(O.depositTotal), { label: 'OpenTable Service Fee (1%)', amountCents: 250, taxCents: 10, currency: 'USD' });
  assert.deepEqual(otServiceFee({ ...O.depositTotal, ot_fees: [{ ...O.depositTotal.ot_fees[0], fee_percent: 2 }] })?.label, 'OpenTable Service Fee (2%)');
  assert.equal(otServiceFee(O.reservation), null);
  assert.equal(otServiceFee({ ot_fees: [] }), null);
});

// ─── The booking row: hold → accept → reserve, once ─────────────────────

function fakeStore(row: TableRow) {
  let version = row.updated_at ?? null;
  const writes: Record<string, unknown>[] = [];
  const store: TableStore = {
    async write(_id, v, patch) {
      await new Promise(r => setTimeout(r, 1));
      if (v !== version) return { ok: false, taken: true };
      version = String(patch.updated_at ?? new Date().toISOString()) + `#${writes.length}`;
      Object.assign(row, patch, { updated_at: version });
      writes.push(patch);
      return { ok: true, version };
    },
  };
  return { store, writes, row };
}

function row(over: Partial<TableRow> = {}): TableRow {
  return {
    id: 'booking-1', plan_id: 'plan-1', vertical: 'restaurant', status: 'redirected', mode: 'redirect', provider: 'opentable',
    provider_ref: 'RES-XYZ', redirect_url: 'https://www.opentable.com/booking/restref/availability?rid=1038007&restref=1038007',
    detail: 'Mulino', updated_at: '2026-11-04T10:00:00.000Z',
    request_payload: { party: 4, restaurant: { name: 'Mulino', city: 'Raleigh', date: '2026-11-06', time: '19:00', partySize: 4, externalUrl: 'https://www.opentable.com/booking/restref/availability?rid=1038007&restref=1038007', phone: '+19195550100' } },
    response_payload: { platform: 'opentable' },
    ...over,
  };
}

function ctxFor(r: TableRow, store: TableStore, over: Partial<TableCtx> = {}): TableCtx {
  return {
    row: r, table: { provider: openTableReservations, venueId: '1038007' }, bookedOn: null,
    solo: false, userId: 'u1', store, now: new Date(), ...over,
  };
}

test('hold → reserve: the policy and terms must be accepted, then the row is confirmed with OpenTable\'s reference', async () => {
  otOn();
  on('POST', /\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/booking-policies\//, { status: 200, body: O.bookingPolicies });
  on('POST', /\/reservations$/, { status: 201, body: O.reservation });
  const f = fakeStore(row());
  const held = await holdStep(ctxFor(f.row, f.store), {});
  assert.equal(held.status, 200);
  const h = held.body.hold as { holdId: string; terms: { version: string } };
  assert.equal(held.body.button, 'Complete reservation');
  assert.match(String(held.body.title), /not booked yet/);
  assert.deepEqual((held.body.handoff as { ownAccount: { label: string } }).ownAccount.label, 'Book on your own OpenTable');

  const noAccept = await reserveStep(ctxFor(f.row, f.store), { holdId: h.holdId }, GUEST);
  assert.equal(noAccept.status, 422);
  assert.equal(noAccept.body.code, 'terms_not_accepted');
  assert.ok(!calls.some(c => /\/reservations$/.test(c.url)), 'booked before the terms were accepted');

  const ok = await reserveStep(ctxFor(f.row, f.store), { holdId: h.holdId, accept: { terms: h.terms.version, policy: true } }, GUEST);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.booked, true);
  assert.equal(f.row.status, 'confirmed');
  assert.equal(f.row.provider_ref, '1038007-1751');
  assert.equal(f.row.mode, 'native');
  assert.equal((f.row as TableRow & { price_cents?: unknown }).price_cents, null);
  assert.equal(ok.body.title, 'Mulino is booked');
  assert.match(String(ok.body.body), /under Maria\. OpenTable confirmation 1751\./);
  assert.equal(reachBuys(f.row), false, 'a table nobody pays Reach for landed in the total');
});

test('a solo table says "you", never whose name it is under', async () => {
  otOn();
  on('POST', /\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/booking-policies\//, { status: 200, body: O.bookingPolicies });
  on('POST', /\/reservations$/, { status: 201, body: O.reservation });
  const f = fakeStore(row());
  const held = await holdStep(ctxFor(f.row, f.store, { solo: true }), { covers: 1 });
  const h = held.body.hold as { holdId: string; terms: { version: string } };
  const ok = await reserveStep(ctxFor(f.row, f.store, { solo: true }), { holdId: h.holdId, accept: { terms: h.terms.version, policy: true } }, GUEST);
  assert.equal(ok.body.title, "You're booked at Mulino");
  assert.doesNotMatch(String(ok.body.body), /under/);
  assert.match(String(ok.body.body), /for 1 person\./);
});

test('two presses at once book once', async () => {
  otOn();
  on('POST', /\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/booking-policies\//, { status: 200, body: O.bookingPolicies });
  on('POST', /\/reservations$/, { status: 201, body: O.reservation });
  const f = fakeStore(row());
  const held = await holdStep(ctxFor(f.row, f.store), {});
  const h = held.body.hold as { holdId: string; terms: { version: string } };
  const seen = { ...f.row };
  const accept = { holdId: h.holdId, accept: { terms: h.terms.version, policy: true } };
  const [a, b] = await Promise.all([
    reserveStep(ctxFor({ ...seen }, f.store), accept, GUEST),
    reserveStep(ctxFor({ ...seen }, f.store), accept, GUEST),
  ]);
  assert.equal(calls.filter(c => c.method === 'POST' && /\/reservations$/.test(c.url)).length, 1, 'the platform was asked twice');
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('an unanswered reserve keeps the row claimed, and nothing books it again', async () => {
  otOn();
  on('POST', /\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/booking-policies\//, { status: 200, body: O.bookingPolicies });
  on('POST', /\/reservations$/, 'drop');
  const reported: string[] = [];
  const f = fakeStore(row());
  const held = await holdStep(ctxFor(f.row, f.store), {});
  const h = held.body.hold as { holdId: string; terms: { version: string } };
  const accept = { holdId: h.holdId, accept: { terms: h.terms.version, policy: true } };
  const first = await reserveStep(ctxFor(f.row, f.store, { report: m => reported.push(m) }), accept, GUEST);
  assert.equal(first.status, 502);
  assert.equal(first.body.code, 'outcome_unknown');
  assert.notEqual(f.row.status, 'failed');
  assert.equal(reported.length, 1);
  const again = await reserveStep(ctxFor(f.row, f.store), accept, GUEST);
  assert.equal(again.body.code, 'outcome_unknown');
  const rehold = await holdStep(ctxFor(f.row, f.store), {});
  assert.equal(rehold.body.code, 'outcome_unknown');
  assert.equal(calls.filter(c => /\/reservations$/.test(c.url)).length, 1);
});

test('a refused reserve frees the row, names the next option, and books nothing', async () => {
  otOn();
  on('POST', /\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/booking-policies\//, { status: 200, body: O.bookingPolicies });
  on('POST', /\/reservations$/, { status: 409, body: O.errors.creditCardRequired });
  const f = fakeStore(row());
  const held = await holdStep(ctxFor(f.row, f.store), {});
  const h = held.body.hold as { holdId: string; terms: { version: string } };
  const r = await reserveStep(ctxFor(f.row, f.store), { holdId: h.holdId, accept: { terms: h.terms.version, policy: true } }, GUEST);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'needs_card');
  assert.ok(r.body.platformUrl, 'no OpenTable page to finish it on');
  assert.ok((r.body.handoff as { phone: string }).phone);
  assert.equal(f.row.status, 'redirected');
  assert.equal(f.row.response_payload?.table?.reserving, undefined);
});

test('an expired hold is refused without asking the platform', async () => {
  otOn();
  on('POST', /\/slot_locks$/, { status: 200, body: O.slotLock });
  on('GET', /\/booking-policies\//, { status: 200, body: O.bookingPolicies });
  const f = fakeStore(row());
  const held = await holdStep(ctxFor(f.row, f.store), {});
  const h = held.body.hold as { holdId: string; terms: { version: string } };
  const later = new Date(Date.now() + 6 * 60_000);
  const r = await reserveStep(ctxFor(f.row, f.store, { now: later }), { holdId: h.holdId, accept: { terms: h.terms.version, policy: true } }, GUEST);
  assert.equal(r.body.code, 'hold_expired');
  assert.ok(!calls.some(c => /\/reservations$/.test(c.url)));
});

test('no time chosen is asked for, never filled in', async () => {
  otOn();
  const r = row();
  r.request_payload!.restaurant.time = null;
  const f = fakeStore(r);
  const o = await openingsStep(ctxFor(f.row, f.store), {});
  assert.equal(o.status, 422);
  assert.equal(o.body.code, 'needs_time');
  assert.equal(calls.length, 0);
});

test('a restaurant Reach cannot book keeps the hand-off, and nothing is tried', async () => {
  const f = fakeStore(row());
  const o = await openingsStep(ctxFor(f.row, f.store, { table: null }), {});
  assert.equal(o.status, 503);
  assert.equal(o.body.code, 'not_bookable_here');
  assert.equal((o.body.handoff as { ownAccount: { url: string } }).ownAccount.url, f.row.request_payload!.restaurant.externalUrl);
  assert.equal(calls.length, 0);
});

test('a Yelp table cannot be moved — the screen is told to cancel and book again, plainly', async () => {
  yelpOn(true);
  const f = fakeStore(row({ status: 'confirmed', mode: 'native', provider: 'yelp', provider_ref: Y.reservation.reservation_id, response_payload: { table: { platform: 'yelp', venueId: VICTOR } } }));
  const r = await holdStep(ctxFor(f.row, f.store, { bookedOn: yelpReservations, table: null }), { change: true, time: '20:00' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'no_change');
  assert.match(String(r.body.error), /Yelp can't change a booking\. To move it, cancel this table and book the new time/);
  assert.equal(calls.length, 0);
});

test('cancelling a table Reach booked asks first, then cancels on the platform and marks the row', async () => {
  yelpOn(true);
  const f = fakeStore(row({ status: 'confirmed', mode: 'native', provider: 'yelp', provider_ref: Y.reservation.reservation_id, response_payload: { policy: { cancellation: 'Call 24 hours ahead.' } } }));
  const q = await cancelStep(ctxFor(f.row, f.store, { bookedOn: yelpReservations }), false);
  assert.equal(q.body.status, 'quoted');
  assert.equal(q.body.cancellationPolicy, 'Call 24 hours ahead.');
  assert.equal(f.row.status, 'confirmed');
  on('POST', /\/cancel$/, { status: 200, body: {} });
  const c = await cancelStep(ctxFor(f.row, f.store, { bookedOn: yelpReservations }), true);
  assert.equal(c.body.status, 'cancelled');
  assert.equal(f.row.status, 'cancelled');
});

// ─── Wiring ─────────────────────────────────────────────────────────────

test('the registry lists both table platforms, and the restaurant lane still hands off by default', () => {
  const src = readFileSync('lib/booking/registry.ts', 'utf8');
  assert.match(src, /restaurant:\s*tableReservations/);
  assert.match(src, /opentable:\s*openTableReservations/);
  assert.match(src, /yelp:\s*yelpReservations/);
  assert.match(src, /pickTable\(/);
  const cancel = readFileSync('app/api/bookings/[id]/cancel/route.ts', 'utf8');
  assert.match(cancel, /tableProviderNamed\(/, 'a table Reach booked could not be cancelled from the cancel route');
});
