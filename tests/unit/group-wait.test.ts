// Run with: npm run test:unit
//
// Stage 5's faces: wherever a group plan waits on its people (answers, the
// vote, the money) one face each, ✓ done or grey, and a grey face is the
// nudge for that one person. What a screen says after a nudge is worked out
// in lib/group-wait.ts from what the server answered; the screens' wiring is
// held by reach-app.jsx's source, as elsewhere in this suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { facesShown, othersPending, waitWords, retryAfter, nudgeOutcome, askNote } from '../../lib/group-wait.ts';

const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
const between = (from: string, to: string) => {
  const a = app.indexOf(from);
  const b = app.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `${from} … ${to}`);
  return app.slice(a, b);
};

const face = (over: Record<string, unknown>) => ({
  userId: 'u', name: 'Sam', avatarUrl: null, isYou: false, done: false, needed: true, nudgedUntil: null, canNudge: true, ...over,
});

test('somebody with nothing to do here is not drawn as a grey face', () => {
  const shown = facesShown([face({ userId: 'a' }), face({ userId: 'b', needed: false }), face({ userId: 'c', done: true })]);
  assert.deepEqual(shown.map(f => f.userId), ['a', 'c']);
  assert.deepEqual(facesShown(null), []);
  assert.equal(othersPending([face({ isYou: true }), face({ done: true })]), false, 'only the reader is still to');
  assert.equal(othersPending([face({ isYou: true, done: true }), face({})]), true);
});

test('a 429 is the server\'s own wait, in hours when it is hours — never capped at a minute', () => {
  const twelve = { error: 'Sam was nudged in the last 12 hours — you can nudge them again in 11 hours', retryAfterSeconds: 11 * 3600 };
  const o = nudgeOutcome(429, twelve);
  assert.equal(o.ok, false);
  assert.equal(o.text, twelve.error, 'the server\'s sentence, as it sent it');
  assert.equal(o.waitSeconds, 11 * 3600);
  assert.equal(retryAfter(twelve), 39600);
  assert.equal(waitWords(39600), '11 hours');
  assert.equal(waitWords(45), '45 seconds');
  assert.equal(waitWords(60), 'a minute');
  assert.equal(waitWords(25 * 60), '25 minutes');
  assert.equal(waitWords(3600), 'an hour');
});

test('"Nudged Sam" only for who was reached; held and muted people are said apart', () => {
  assert.equal(nudgeOutcome(200, { notified: 1, nudged: [{ userId: 's', name: 'Sam' }] }).text, 'Nudged Sam');
  const mixed = nudgeOutcome(200, {
    notified: 1, nudged: [{ userId: 's', name: 'Sam' }],
    held: [{ userId: 'j', name: 'Jo', retryAfterSeconds: 100 }], muted: [{ userId: 'a', name: 'Alex' }],
  });
  assert.match(mixed.text, /^Nudged Sam · Jo was nudged in the last 12 hours · Alex has reminders for this trip turned off$/);
  const onlyMuted = nudgeOutcome(200, { notified: 0, nudged: [], muted: [{ userId: 'a', name: 'Alex' }] });
  assert.equal(onlyMuted.ok, false);
  assert.doesNotMatch(onlyMuted.text, /Nudged/, 'nobody reached, nobody "nudged"');
  assert.equal(nudgeOutcome(200, { notified: 0, message: 'Sam has already voted.' }).text, 'Sam has already voted.');
  assert.doesNotMatch(nudgeOutcome(200, { notified: 0 }).text, /Nudged/);
});

test('the answers screen says "in their Reach notifications" only when the bell was written', () => {
  const pushOnly = askNote({ notified: 1, inApp: 0, pushed: 1, emailed: 0, nudged: [{ userId: 's', name: 'Sam' }] });
  assert.doesNotMatch(pushOnly, /Reach notifications/, 'a phone push is not the bell');
  assert.match(pushOnly, /Nudged Sam — on their phone\./);
  const bell = askNote({ notified: 2, inApp: 2, pushed: 0, emailed: 1, nudged: [{ userId: 's', name: 'Sam' }, { userId: 'j', name: 'Jo' }] });
  assert.match(bell, /in their Reach notifications/);
  assert.match(bell, /by email/);
  assert.equal(askNote({ notified: 0, message: 'Everyone else has already answered.' }), 'Everyone else has already answered.');
});

test('the answers screen reads the 429\'s wait whole and its note from askNote', () => {
  const ask = between('const askTheOthers=async(id)=>{', 'const shareAnswerLink=');
  assert.doesNotMatch(ask, /Math\.min\(60/, 'the wait is not capped at a minute');
  assert.match(ask, /setNudgeWait\(retryAfter\(d\)\)/);
  assert.doesNotMatch(ask, /waiting in their Reach notifications/, 'never said for a push alone');
  assert.match(ask, /setAskNote\(askNoteFor\(d\)\)/);
});

test('faces replace the name lists and the group-wide nudge buttons', () => {
  assert.doesNotMatch(app, /<strong>Still to answer:<\/strong>/);
  assert.doesNotMatch(app, /Nudge whoever hasn't voted/);
  assert.doesNotMatch(app, /"Nudge them"/);
  assert.match(app, /<WaitFaces planId=\{waitPlanId\} kind="prefs"[^>]*organiser=\{iOrganise\}[^>]*solo=\{isSolo\}/);
  assert.equal((app.match(/<WaitFaces planId=\{planId\} kind="vote"/g) ?? []).length, 2, 'both vote screens');
  assert.equal((app.match(/<WaitFaces planId=\{planId\} kind="funding"[^>]*solo=\{participants<=1\}/g) ?? []).length, 2, 'both checkout waits');
  // The vote's standing line no longer lists names the faces already show.
  assert.doesNotMatch(app, /still to vote: \$\{namesList\(v\.stillToVote\)\}/);
});

test('the faces draw nothing on a plan for one, tap only a grey face, and show no amount', () => {
  const faces = between('function WaitFaces(', '\n}\n');
  assert.match(faces, /const live=!solo&&!!planId&&!isTempId\(planId\);/);
  assert.match(faces, /if\(!live\)return null;/);
  assert.match(faces, /body:JSON\.stringify\(userId\?\{kind,userId\}:\{kind\}\)/, 'one face, or everyone');
  assert.match(faces, /organiser&&pending&&/, '"Remind everyone" is the organiser\'s');
  assert.match(faces, /toast\(o\.text\)/, 'the toast is what the server answered');
  const one = between('function WaitFace(', '\n}\n');
  assert.match(one, /const tappable=!f\.done&&!f\.isYou&&f\.canNudge/);
  assert.doesNotMatch(one + faces, /amount|Cents|\$\{?dollars/i, 'never an amount');
});

test('every other nudge toast reads the server through nudgeOutcome', () => {
  assert.doesNotMatch(app, /Reminded \$\{d\.notified\}/);
  assert.doesNotMatch(app, /`Reminded \$\{plural\(d\.notified/);
  const cta = between('if(cta.kind==="nudge"){', 'return false;');
  assert.match(cta, /nudgeOutcome\(r\.status,d\)\.text/);
});

test('a nudge to somebody who muted the trip is never counted as reaching them', () => {
  const notify = readFileSync(new URL('../../app/api/plans/[planId]/notify/route.ts', import.meta.url), 'utf8');
  assert.match(notify, /delivery\.stored \? sendTo\.filter\(id => !mutedIds\.has\(id\)\) : \[\]/);
  assert.match(notify, /muted: sendTo\.filter\(id => mutedIds\.has\(id\)\)/);
});
