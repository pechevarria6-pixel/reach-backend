// Run with: npm run test:unit
//
// Stage 6, builder V: the gaps Stages 4 and 5 left (a driver's budget, the
// booker's Change, an old idea's flight on a drive, the preview's `flying`)
// and Task 9's polish — one sheet, Undo before anything is sent, optimistic
// changes that go back in words, a haptic on confirm, the pin that drops.
// The pure parts are tested here directly; the screens' wiring is held by
// reach-app.jsx's source, as elsewhere in this suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lineCosts } from '../../lib/budget.ts';
import { oldIdeaLines, previewFlying, awayEstimate } from '../../lib/away-lines.ts';
import { createUndoQueue, undoKey, UNDO_MS } from '../../lib/undo.ts';
import { haptic, revertWords } from '../../lib/feel.ts';

const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../../components/Sheet.jsx', import.meta.url), 'utf8');
const invite = readFileSync(new URL('../../app/invite/[token]/page.tsx', import.meta.url), 'utf8');
const between = (from: string, to: string) => {
  const a = app.indexOf(from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `${from} … ${to}`);
  return app.slice(a, b);
};

// ─── (a) The Budget tab and a driver ─────────────────────────────────────

const flightLine = { id: 'L1', cost_cents: 40000 };
const hotelLine = { id: 'L2', cost_cents: 30000 };
const bookings = [
  { id: 'B1', itinerary_item_id: 'L1', status: 'awaiting_approval' },
  { id: 'B2', itinerary_item_id: 'L2', status: 'awaiting_approval' },
];

test('a driver is charged nothing for the flight, and a flyer the fare split among those flying', () => {
  // Four in the group, one driving: three on a $1,050 party fare.
  const driver = lineCosts([flightLine, hotelLine], bookings, [
    { ref: 'B1', imIn: false, priceCents: 105000, inCount: 3, myCents: 0 },
    { ref: 'B2', imIn: true, priceCents: 120000, inCount: 4, myCents: 30000 },
  ], 4);
  assert.equal(driver.get('L1')!.mine, 0);
  assert.equal(driver.get('L1')!.off, true);
  // Altogether is the party fare, never $400 × 4.
  assert.equal(driver.get('L1')!.group, 105000);
  assert.equal(driver.get('L2')!.mine, 30000);

  const flyer = lineCosts([flightLine], bookings, [
    { ref: 'B1', imIn: true, priceCents: 105000, inCount: 3, myCents: 35000 },
  ], 4);
  assert.equal(flyer.get('L1')!.mine, 35000);
  assert.equal(flyer.get('L1')!.group, 105000);
});

test('a flight split per departure airport adds its rows up on its one line', () => {
  const two = [
    { id: 'B1', itinerary_item_id: 'L1', status: 'awaiting_approval' },
    { id: 'B3', itinerary_item_id: 'L1', status: 'awaiting_approval' },
  ];
  const c = lineCosts([flightLine], two, [
    { ref: 'B1', imIn: true, priceCents: 60000, inCount: 2, myCents: 30000 },
    { ref: 'B3', imIn: false, priceCents: 50000, inCount: 2, myCents: 0 },
  ], 4).get('L1')!;
  assert.deepEqual([c.mine, c.group, c.off], [30000, 110000, false]);
});

test('a held flight still costs a flyer their share in the budget, and cancelled rows count for nothing', () => {
  const held = lineCosts([flightLine], bookings, [{ ref: 'B1', imIn: true, held: true, priceCents: 90000, inCount: 3, myCents: 0 }], 3).get('L1')!;
  assert.equal(held.mine, 30000);
  const gone = lineCosts([flightLine], [{ id: 'B1', itinerary_item_id: 'L1', status: 'cancelled' }],
    [{ ref: 'B1', imIn: false, priceCents: 90000, inCount: 0 }], 3).get('L1')!;
  assert.equal(gone.from, 'line');
  assert.equal(gone.off, false);
});

test('before any booking, the group figure is the line party_cents when it has one, else cost × everyone', () => {
  const c = lineCosts([{ id: 'L1', cost_cents: 40000, party_cents: 120000, flying: 3 }, hotelLine], [], [], 4);
  assert.equal(c.get('L1')!.group, 120000);
  assert.equal(c.get('L1')!.mine, 40000);
  assert.equal(c.get('L2')!.group, 120000);
});

test('the Budget tab reads lineCosts for yours and for altogether', () => {
  const tab = between('const youreOff=linesYoureOff(planBookings,share?.items);', 'altogether</span>');
  assert.match(tab, /lineCosts\(items,planBookings,share\?\.items/);
  assert.match(tab, /c:k\?k\.mine:i\.cost_cents/);
  assert.match(tab, /\{money\(altogether\)\} $/);
  assert.doesNotMatch(tab, /\(fixedTotal\+varTotal\)\*heads/);
});

// ─── (b) The booker sees Change after Lock it in ─────────────────────────

test('after Lock it in, whoever booked a line elsewhere is shown Change on it, as the server allows', () => {
  const rule = between('const mayChange=item=>', 'const ChangeLink=');
  assert.match(rule, /soloTrip\|\|!lockedNow\|\|organiserHere\|\|bookedItMyself\(item\)/);
  assert.match(app, /const bookedItMyself=item=>!!me&&planBookings\.some\(b=>String\(b\.itinerary_item_id\)===String\(item\?\.id\)&&bookedBy\(b,me\)\)/);
});

// ─── (c) An idea saved before away lines, on a drive ─────────────────────

const oldIdea = {
  destination: 'Blue Ridge cabin', city: 'Blue Ridge', tier: 'on_budget', total_per_person: 900,
  costs: { flights: { per_person: 320 }, accommodation: { per_person: 400 }, ground_transport: { per_person: 60 } },
};
const opts = { nights: 3, town: 'Blue Ridge', start: '2026-11-06', end: '2026-11-09', party: 4, solo: false };

test('an old idea a drive away gets no flight line, whatever it priced', () => {
  const lines = oldIdeaLines(oldIdea, { ...opts, km: 150 });
  assert.equal(lines.some(l => l.type === 'flight'), false);
  assert.ok(lines.some(l => l.type === 'transport'));
  assert.ok(lines.some(l => l.type === 'hotel'));
});

test('an old idea a long way off keeps its flight, and one whose distance is unknown writes none', () => {
  assert.ok(oldIdeaLines(oldIdea, { ...opts, km: 2400 }).some(l => l.type === 'flight'));
  const unknown = oldIdeaLines(oldIdea, { ...opts, km: null });
  assert.equal(unknown.some(l => l.type === 'flight'), false);
  assert.ok(unknown.some(l => l.title === 'Getting there and back' && l.booking_mode === 'ahead'));
});

test('the client measures the distance before writing an old idea\'s lines', () => {
  const rows = between('async function awayRows(', '/** What the days stage is told');
  assert.match(rows, /const km=await kmFromHome\(from,trip\)/);
  assert.match(rows, /oldIdeaLines\(trip\|\|\{\},\{\.\.\.opts,nights,km\}\)/);
  assert.match(rows, /awayOf\(\{mode:"trip",home,destination:dest\}\)\.km/);
  assert.doesNotMatch(rows, /savedIdeaLines\(/);
  // Every caller waits for it and says where home is.
  const calls = app.match(/awayRows\(trip,\{[^}]*\}\)/g) ?? [];
  assert.equal(calls.length, 4);
  for (const c of calls) assert.match(c, /from:departure\?\.city/);
  assert.equal((app.match(/\.\.\.await awayRows\(/g) ?? []).length, 4);
});

// ─── (d) `flying` to the preview ─────────────────────────────────────────

test('the preview is told how many fly: none on a drive away', () => {
  const drive = awayEstimate(oldIdea, { nights: 3, km: 150 });
  const far = awayEstimate(oldIdea, { nights: 3, km: 2400 });
  assert.equal(previewFlying(drive, 4), 0);
  assert.equal(previewFlying(far, 4), 4);
  assert.equal(previewFlying(far, 4, 3), 3);
  assert.equal(previewFlying(null, 2), 2);
  const call = between('fetchWithin("/api/trips/preview"', '"checking prices")');
  assert.match(call, /flying:previewFlying\(trip\.away,seats\)/);
});

// ─── Undo: five seconds, then one request ────────────────────────────────

function fakeClock() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  return {
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimer: (id: unknown) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    advance(ms: number) {
      now += ms;
      for (const t of [...timers].filter(t => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
  };
}
const tick = () => new Promise(r => setImmediate(r));

test('nothing is sent until the five seconds run out, and then exactly once, with its key', async () => {
  const clock = fakeClock();
  const q = createUndoQueue({ ...clock, key: () => 'k1' });
  const sent: string[] = [];
  q.schedule({ commit: k => { sent.push(k); } });
  clock.advance(UNDO_MS - 1);
  await tick();
  assert.deepEqual(sent, []);
  clock.advance(1);
  await tick();
  assert.deepEqual(sent, ['k1']);
  q.flush();
  clock.advance(UNDO_MS * 2);
  await tick();
  assert.deepEqual(sent, ['k1']);
});

test('Undo sends nothing and puts the screen back', async () => {
  const clock = fakeClock();
  const q = createUndoQueue(clock);
  let sent = 0, reverted = 0;
  const p = q.schedule({ commit: () => { sent++; }, revert: () => { reverted++; } });
  assert.equal(q.undo(p.id), true);
  clock.advance(UNDO_MS * 2);
  await tick();
  assert.deepEqual([sent, reverted], [0, 1]);
  assert.equal(q.undo(p.id), false);
});

test('a second change sends the first straight away; a failed send reverts and says so', async () => {
  const clock = fakeClock();
  const q = createUndoQueue(clock);
  const log: string[] = [];
  q.schedule({ commit: () => { log.push('first'); throw new Error('Only the organiser can do that'); }, revert: () => log.push('revert'), onFail: e => log.push(`fail:${(e as Error).message}`) });
  q.schedule({ commit: () => { log.push('second'); } });
  await tick();
  assert.deepEqual(log, ['first', 'revert', 'fail:Only the organiser can do that']);
  clock.advance(UNDO_MS);
  await tick();
  assert.deepEqual(log.slice(-1), ['second']);
});

test('undo keys are unique', () => {
  const a = undoKey(), b = undoKey();
  assert.notEqual(a, b);
  assert.match(a, /^undo:/);
});

test('Skip, Change, Remove and Leave go through Undo, each sending one keyed request', () => {
  assert.match(app, /"Idempotency-Key":key/);
  const skip = between('const setSkip=async(item,optOut,{confirm=false}={})=>{', 'setSkipping(item.ref);');
  assert.match(skip, /item\.vertical!=="flight"/);
  assert.match(skip, /undoable\(toast,/);
  assert.match(skip, /sendOnce\(`\/api\/plans\/\$\{planId\}\/participation`/);
  const change = between('const apply=(to,title,cost,name,url)=>{', 'const suggest=');
  assert.match(change, /undoable\(toast,/);
  assert.match(change, /sendOnce\(`\/api\/plans\/\$\{planId\}\/itinerary\/\$\{item\.id\}`,\{method:"PATCH"/);
  const remove = between('const doRemove=(uid,name)=>{', 'const doLeave=');
  assert.match(remove, /undoable\(toast,/);
  assert.match(remove, /method:"DELETE"/);
  const leave = between('const leaveGroup=(groupId)=>{', 'const deleteGroup=');
  assert.match(leave, /undoable\(showToast,/);
  // The "are you sure?" steps are gone from these four.
  assert.doesNotMatch(app, /Remove \{u\.name\}\?/);
  assert.doesNotMatch(app, /Leave \{group\.name\}\?/);
  assert.doesNotMatch(app, />\{working\?"Leaving…":"Yes, leave"\}/);
  assert.doesNotMatch(app, /confirmingRemove/);
});

test('confirms stay for deleting a plan and cancelling a booking', () => {
  // Calling a plan off asks first (CallOffPlan), and so does the tap that
  // takes the flight off for everybody (the server's needsConfirm).
  assert.match(between('const callOff=async()=>{', 'return('), /haptic\(\)/);
  assert.match(app, /onClick=\{\(\)=>setConfirming\(true\)\}/);
  assert.match(app, /r\.status===409&&d\.needsConfirm/);
});

test('booking and paying are never optimistic or undoable', () => {
  const pay = between('const confirmPay=async()=>{', '\n  };');
  assert.doesNotMatch(pay, /undoable|setMarked/);
  // Flights wait for the server: coming off one reprices everybody's seat.
  const skip = between('const setSkip=async', 'const submitRanges=');
  assert.ok(skip.indexOf('item.vertical!=="flight"') < skip.indexOf('undoable('));
});

test('mark as paid is optimistic with Undo, and the line leaves the headline with it', () => {
  const screen = between('function SettleUpScreen(', '\n}\n');
  assert.match(screen, /const markPaid=line=>markLater\(/);
  assert.match(screen, /const markReceived=line=>markLater\(/);
  assert.match(screen, /settleHeadline\(shownRaw,l\.people\)/);
  assert.doesNotMatch(screen, /Yes, I've paid/);
});

test('a vote on an idea shows at once and goes back in words when refused', () => {
  const cast = between('const cast=async(o)=>{', 'const veto=');
  assert.match(cast, /setV\(x=>/);
  assert.match(cast, /setV\(was\)/);
  assert.match(cast, /revertWords\(e\.message,"your vote"\)/);
});

test('revert copy is the server\'s own sentence, or a plain one — never a code', () => {
  assert.equal(revertWords("Only the organiser can change that", 'Dinner'), 'Only the organiser can change that, so Dinner is back to how it was.');
  assert.match(revertWords('500', 'Dinner'), /^That didn't save, so Dinner is back/);
  assert.match(revertWords('Failed to fetch', 'your vote'), /^That didn't save/);
  assert.match(revertWords('', 'your vote'), /^That didn't save/);
});

// ─── One sheet ───────────────────────────────────────────────────────────

test('every action sheet is the shared Sheet', () => {
  assert.doesNotMatch(app, /className="ov"/);
  assert.doesNotMatch(app, /position:"fixed",inset:0,background:"rgba\(0,0,0,\.45\)"/);
  assert.equal((app.match(/<Sheet\b/g) ?? []).length, (app.match(/<\/Sheet>/g) ?? []).length);
  assert.ok((app.match(/<Sheet\b/g) ?? []).length >= 9);
});

test('the sheet slides up in 200ms, drags to dismiss, traps focus and answers Escape', () => {
  assert.match(app, /animation:su \.2s /);
  assert.match(sheet, /e\.key === "Escape"/);
  assert.match(sheet, /e\.key !== "Tab"/);
  assert.match(sheet, /onPointerDown=\{down\}/);
  assert.match(sheet, /moved > DISMISS_PX/);
  assert.match(sheet, /before\?\.focus/);
  assert.match(sheet, /OPEN\[OPEN\.length - 1\] !== me/);
  assert.match(sheet, /prefersReducedMotion\(\)/);
});

// ─── Feel ────────────────────────────────────────────────────────────────

test('the haptic is a 10ms tick where there is one, and nothing where there is not', () => {
  const calls: number[] = [];
  assert.equal(haptic({ vibrate: ms => { calls.push(ms); return true; } }), true);
  assert.deepEqual(calls, [10]);
  assert.equal(haptic({}), false);
  assert.equal(haptic(undefined), false);
  assert.equal(haptic({ vibrate: () => { throw new Error('blocked'); } }), false);
});

test('the gold pin drops for booked, paid and joined, and holds still for reduced motion', () => {
  assert.match(app, /<PinDrop size=\{30\} label="Booked"\/>/);
  assert.match(app, /<PinDrop size=\{36\} label="Paid"\/>/);
  assert.match(app, /<PinDrop size=\{22\} label="Joined"\/>/);
  assert.match(app, /@media \(prefers-reduced-motion:reduce\)\{\n  \.skel::after\{display:none;\}\n  \.pin-drop,\.pin-drop-shadow\{animation:none;\}/);
  assert.match(invite, /&joined=1/);
});

test('three skeleton cards stand in while the options are worked out', () => {
  const step = between('{/* ── STEP 1: Generating ── */}', '{/* ── STEP 2: Results ── */}');
  assert.match(step, /<OptionSkeletons count=\{3\}\/>/);
  assert.doesNotMatch(step, /finding flights from/);
});
