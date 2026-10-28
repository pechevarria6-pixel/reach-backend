// Run with: npm run test:unit
//
// Stage 5's settle-up screen, the "How was it?" card and the per-trip mute.
// The words are lib/settle-view.ts; the switch is lib/plan-mute.ts behind
// /api/plans/[planId]/mute; the wiring is held by reach-app.jsx's source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dollars, lineWords, openLines, settleHeadline, pendingWords, venmoHref, hasWayToPay,
  lineKeyPart, settleRefusal, closeSettleLine, CLOSE_SCORES, SETTLE_FOOTER, type LedgerLine,
  settledWords, nextBlockedWords, CLOSE_PENDING_LINE,
} from '../../lib/settle-view.ts';
import { readMute, writeMute, muteTableMissing } from '../../lib/plan-mute.ts';

const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../app/api/plans/[planId]/mute/route.ts', import.meta.url), 'utf8');
const between = (from: string, to: string) => {
  const a = app.indexOf(from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `${from} … ${to}`);
  return app.slice(a, b);
};

const owe = (over: Partial<LedgerLine> = {}): LedgerLine => ({
  direction: 'you_owe', with: 'sam', amountCents: 4200, pending: null,
  pay: { venmo: { app: 'venmo://x', web: 'https://venmo.com/x' }, cashApp: null, zelle: null }, ...over,
});
const people = { sam: { name: 'Sam Smith' }, alex: { name: 'Alex' } };

test('"You owe Sam $42 · Alex owes you $18", what you owe first', () => {
  const lines = [owe({ direction: 'owed_to_you', with: 'alex', amountCents: 1800, pay: null }), owe()];
  assert.equal(settleHeadline(lines, people), 'You owe Sam $42 · Alex owes you $18');
  assert.equal(settleHeadline([], people), null, 'square says nothing owed');
  assert.equal(dollars(4250), '$42.50');
  assert.equal(lineWords(owe(), 'Sam'), 'You owe Sam $42');
});

test('a 0 line is kept only for a claim still to answer', () => {
  const claim = owe({ amountCents: 0, pending: { id: 'p', amountCents: 4200, method: 'venmo' } });
  assert.deepEqual(openLines([owe({ amountCents: 0 }), claim]), [claim]);
});

test('a pay button opened an app, and that is all a pending line says: nobody is quoted as saying they sent it', () => {
  const pending = { id: 'p', amountCents: 4200, method: 'venmo' };
  const payee = pendingWords(owe({ direction: 'owed_to_you', pending }), 'Alex') ?? '';
  const payer = pendingWords(owe({ pending }), 'Sam') ?? '';
  assert.equal(payer, 'You opened Venmo to pay Sam $42. Did it go through? If it did, mark it paid.');
  assert.equal(payee, "Alex opened Venmo to pay you $42, but hasn't marked it sent. Mark it received once it arrives.");
  for (const w of [payer, payee, CLOSE_PENDING_LINE]) {
    assert.doesNotMatch(w, /\bsaid\b|\bsays\b|\bsent \$|waiting to be confirmed|Did it arrive/i, w);
  }
  assert.match(pendingWords(owe({ pending: { ...pending, method: 'cashapp' } }), 'Sam') ?? '', /opened Cash App/);
  assert.equal(pendingWords(owe(), 'Sam'), null);
});

test('the payer keeps their pay buttons while a line is pending, and the payee is not asked to deny a claim nobody made', () => {
  const screen = between('function SettleUpScreen(', '\nfunction ');
  assert.match(screen, /\{line\.direction==="you_owe"&&line\.amountCents>0&&\(/, 'Pay on Venmo stays after a tab closed unpaid');
  assert.doesNotMatch(screen, /"Not yet"/);
  assert.match(screen, /"It didn't go through"/);
  const card = between('function CloseCard(', '\n}\n');
  assert.match(card, /c\.settle\?\.pending\?CLOSE_PENDING_LINE:null/);
  assert.doesNotMatch(card, /waiting to be confirmed/);
});

test('a line the payer closed alone reads as marked, never as received, and the payee can say it never arrived', () => {
  const nameOf = (id: string) => ({ alex: 'Alex', sam: 'Sam' } as Record<string, string>)[id] ?? 'Someone';
  const row = { id: 's1', from_user_id: 'alex', to_user_id: 'sam', amount_cents: 4200 };
  // Alex marked it paid himself.
  const byPayer = { ...row, closed_by: 'alex' };
  assert.deepEqual(settledWords(byPayer, 'sam', nameOf), { text: 'Alex marked $42 to you as paid', confirmed: false, canDispute: true });
  assert.deepEqual(settledWords(byPayer, 'alex', nameOf), { text: 'You marked $42 to Sam as paid — Sam can say if it never arrived', confirmed: false, canDispute: false });
  // An old row with nobody named is not taken as confirmed either.
  assert.equal(settledWords({ ...row, closed_by: null }, 'sam', nameOf).confirmed, false);
  // Sam confirmed it.
  const byPayee = { ...row, closed_by: 'sam' };
  assert.deepEqual(settledWords(byPayee, 'sam', nameOf), { text: 'Alex paid you $42', confirmed: true, canDispute: false });
  assert.deepEqual(settledWords(byPayee, 'alex', nameOf), { text: 'Sam got your $42', confirmed: true, canDispute: false });

  const screen = between('function SettleUpScreen(', '\nfunction ');
  assert.match(screen, /w\.canDispute&&marking/);
  assert.match(screen, /send\("PATCH",\{id:row\.id,status:"cancelled"\}\)/, 'the payee withdraws the paid row, which the server allows only them');
  assert.match(screen, /"It never arrived"/);
  assert.doesNotMatch(screen, /`\$\{nameOf\(s\.from_user_id\)\} paid you/, 'no "paid you" written over a row the payee never confirmed');
  // The payer's Mark as paid asks once before closing the line on their word.
  assert.match(screen, /onClick=\{\(\)=>setConfirming\(lineKeyPart\(line\)\)\}>Mark as paid</);
  assert.match(screen, /"Yes, I've paid"/);
});

test('"already planning" is said for the group, and never names "Where next?"', () => {
  assert.equal(nextBlockedWords({ title: 'Where next?' }, { solo: false, type: 'trip' }), 'This group is already planning a trip — open it');
  assert.equal(nextBlockedWords({ title: 'Lisbon' }, { solo: false, type: 'trip' }), 'This group is already planning Lisbon — open it');
  assert.equal(nextBlockedWords({ title: null }, { solo: false, type: 'night' }), 'This group is already planning a night out — open it');
  assert.equal(nextBlockedWords({ title: 'Tokyo' }, { solo: true }), "You're already planning Tokyo — open it");
  const card = between('function CloseCard(', '\n}\n');
  assert.match(card, /nextBlockedWords\(next\.blockedBy,\{solo:c\.solo,type:next\.type\}\)/);
  assert.doesNotMatch(card, /You're already planning/);
});

test('/home?settle=<plan>&group=<group> opens Settle up, before the group link takes ?group', () => {
  const link = between('if(params.get("settle")){', '\n      }');
  assert.match(link, /push\("settleUp",\{planId,groupId\}\)/);
  assert.ok(app.indexOf('if(params.get("settle")){') < app.indexOf('if(params.get("group")){'));
});

test('Venmo opens the app on a phone and the site elsewhere; no way to pay is said, never a dead link', () => {
  assert.equal(venmoHref(owe().pay!.venmo, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'venmo://x');
  assert.equal(venmoHref(owe().pay!.venmo, 'Mozilla/5.0 (Macintosh)'), 'https://venmo.com/x');
  assert.equal(hasWayToPay(owe({ pay: { venmo: null, cashApp: null, zelle: null } })), false);
  assert.equal(hasWayToPay(owe({ pay: null })), false);
  assert.match(lineKeyPart(owe()), /^[A-Za-z0-9_:.-]{1,80}$/);
  assert.match(settleRefusal(409, { reason: 'nothing_owed' }), /already moved/);
});

test('the close card says totals only, and answers with a face', () => {
  assert.equal(closeSettleLine({ unsettled: true, youOweCents: 4200, owedToYouCents: 0 }), 'You owe $42');
  assert.equal(closeSettleLine({ unsettled: false, youOweCents: 4200 }), null);
  assert.deepEqual(CLOSE_SCORES.map(s => s.emoji), ['😞', '😐', '🤩']);
  assert.equal(SETTLE_FOOTER, 'Payments happen in your own app.');
});

test('the settle-up screen: per-line Venmo / Cash App, Zelle with a copy button, Mark as paid, the footer', () => {
  const screen = between('function SettleUpScreen(', '\nfunction ');
  assert.match(screen, />Pay on Venmo</);
  assert.match(screen, />Pay on Cash App</);
  assert.match(screen, /copy\(line\.pay\.zelle\.value\)/);
  assert.match(screen, /"Mark as paid"/);
  assert.match(screen, /"Mark received"/);
  assert.match(screen, /\{SETTLE_FOOTER\}/);
  assert.match(screen, /l\.you\?\.askForHandle&&!askDismissed/, 'the handle prompt, once, skippable');
  assert.match(screen, />Not now</);
  assert.match(screen, /status:"pending",idempotencyKey:keyFor\(line\)/, 'a pay-button tap is a claim, never a payment');
  assert.doesNotMatch(screen, /transfer|payout/i);
  assert.match(app, /if\(screen==="settleUp"\)return <SettleUpScreen \{\.\.\.cp\} \{\.\.\.props\}\/>;/);
});

test('"Plan the next one?" opens the plan it is blocked by, or starts one that carries from_close', () => {
  const card = between('function CloseCard(', '\n}\n');
  assert.match(card, /if\(next\.blockedBy\)\{push\("planDetail",\{planId:next\.blockedBy\.id/);
  assert.match(card, /push\("createPlan",\{fresh:true,defaultGroupId:next\.groupId,seed:\{planType:next\.type,fromClose:next\.fromClose\}\}\)/);
  assert.match(app, /\.\.\.\(seed\?\.fromClose\?\{fromClose:seed\.fromClose\}:\{\}\)/, 'CreatePlanFlow keeps it on the plan');
  assert.match(app, /\.\.\.\(plan\.fromClose\?\{from_close:plan\.fromClose\}:\{\}\)/, 'and POST /api/plans is sent it');
  assert.doesNotMatch(app, /trackEvent\("next_trip_started_from_close"/, 'counted by the server only');
  assert.match(app, /\{timing==="over"&&<CloseCard /);
});

test('/home?pay=<plan>&group=<group> opens that checkout', () => {
  const link = between('if(params.get("pay")){', '\n      }');
  assert.match(link, /push\("checkout",\{planId,groupId\}\)/);
  assert.ok(app.indexOf('if(params.get("pay")){') < app.indexOf('if(params.get("group")){'), 'before the group link takes ?group');
});

// ── The mute switch ──────────────────────────────────────────────────────
function fakeDb(state: { rows: Set<string>; fail?: { code: string; message: string } }) {
  return {
    from() {
      const q: { plan?: string; user?: string; op?: string; row?: { plan_id: string; user_id: string } } = {};
      const done = () => {
        if (state.fail) return { data: null, error: state.fail };
        const k = `${q.plan}:${q.user}`;
        if (q.op === 'delete') { state.rows.delete(k); return { data: null, error: null }; }
        return { data: state.rows.has(k) ? { user_id: q.user } : null, error: null };
      };
      const chain: Record<string, unknown> = {
        select() { return chain; },
        eq(col: string, v: string) { if (col === 'plan_id') q.plan = v; else q.user = v; return chain; },
        maybeSingle: async () => done(),
        delete() { q.op = 'delete'; return chain; },
        then(res: (v: unknown) => void) { res(done()); },
        // The primary key: a second insert of the same row is a 23505 unless
        // the write says to ignore a duplicate.
        upsert: async (row: { plan_id: string; user_id: string }, opts?: { ignoreDuplicates?: boolean }) => {
          if (state.fail) return { data: null, error: state.fail };
          const k = `${row.plan_id}:${row.user_id}`;
          if (state.rows.has(k) && !opts?.ignoreDuplicates) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          state.rows.add(k); return { data: null, error: null };
        },
      };
      return chain;
    },
  } as never;
}

test('mute is one row per person per plan: on twice is one row, off is a delete', async () => {
  const state = { rows: new Set<string>() };
  const db = fakeDb(state);
  const both = await Promise.all([writeMute(db, 'p', 'u', true), writeMute(db, 'p', 'u', true)]);
  assert.deepEqual(both, [{ ok: true, muted: true }, { ok: true, muted: true }], 'a double tap is two oks, not a failure');
  assert.equal(state.rows.size, 1);
  assert.deepEqual(await readMute(db, 'p', 'u'), { ok: true, muted: true, available: true });
  assert.deepEqual(await writeMute(db, 'p', 'u', false), { ok: true, muted: false });
  assert.deepEqual(await readMute(db, 'p', 'u'), { ok: true, muted: false, available: true });
});

test('a failed read is said as one, never as "not muted"; a missing table hides the switch', async () => {
  const broken = fakeDb({ rows: new Set(), fail: { code: '57014', message: 'timeout' } });
  assert.deepEqual(await readMute(broken, 'p', 'u'), { ok: false });
  const missing = fakeDb({ rows: new Set(), fail: { code: 'PGRST205', message: "Could not find the table 'public.plan_notification_mutes' in the schema cache" } });
  assert.deepEqual(await readMute(missing, 'p', 'u'), { ok: true, muted: false, available: false });
  assert.equal(muteTableMissing({ code: '42P01' }), true);
  assert.deepEqual(await writeMute(missing, 'p', 'u', true), { ok: false, missing: true });
});

test('the mute route only ever touches the caller\'s own row, as a plan member', () => {
  assert.match(route, /requirePlanMember\(params\.planId\)/);
  assert.match(route, /readMute\(ctx\.db, params\.planId, ctx\.user\.id\)/);
  assert.match(route, /writeMute\(ctx\.db, params\.planId, ctx\.user\.id, body\.muted\)/);
  assert.doesNotMatch(route, /body\.(userId|user_id)/);
  const toggle = between('function MuteReminders(', '\n}\n');
  assert.match(toggle, /if\(!m\?\.available\)return null;/, 'no switch that does nothing');
  assert.match(toggle, /Mute reminders for this trip/);
});
