// Run with: npm run test:unit
// REACH-DESTINATION-DIVERSITY-2026-11-22, Part B: support, privacy, timing.
//   · Help: a "Message us" form that says Sent only when the email provider
//     accepted the message, and otherwise says so and gives the address.
//   · Who sees what: in the app, linked to the Privacy Policy, matching what
//     the API hands another member (the e2e half is tests/two-person.spec.ts).
//   · Time to options: tap to screen, in ms, for p50/p95.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSupport, SUPPORT_MAX, SUPPORT_PER_HOUR } from '../../lib/support.ts';
import { EVENT_NAMES, BROWSER_EVENT_NAMES, scrubProps } from '../../lib/track.ts';

const ROUTE = readFileSync('app/api/support/route.ts', 'utf8');
const EMAIL = readFileSync('lib/email.ts', 'utf8');
const APP = readFileSync('components/reach-app.jsx', 'utf8');
const E2E = readFileSync('tests/two-person.spec.ts', 'utf8');

test('a message needs words, has a ceiling, and keeps only a real plan id', () => {
  assert.equal(parseSupport({ message: '   ' }).ok, false);
  assert.equal(parseSupport({ message: 'x'.repeat(SUPPORT_MAX + 1) }).ok, false);
  const p = parseSupport({ message: ' Help with my flight ', topic: 'booking', planId: 'not-a-uuid', bookingRef: ' ABC123 ' });
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.value, { topic: 'booking', message: 'Help with my flight', planId: null, bookingRef: 'ABC123' });
  const q = parseSupport({ message: 'hi', topic: 'sabotage' });
  assert.ok(q.ok && q.value.topic === 'other', 'an unknown topic is "other", not refused');
  assert.equal(SUPPORT_PER_HOUR, 5);
});

test('the route says sent only when the provider accepted it, and is limited', () => {
  const send = ROUTE.indexOf('await sendSupportMessage(');
  const ok = ROUTE.indexOf("NextResponse.json({ sent: true })");
  assert.ok(send > 0 && ok > send);
  assert.match(ROUTE.slice(send, ok), /if \(!sent\.sent\) \{[\s\S]*status: 503/);
  assert.ok(ROUTE.indexOf('allowance(') < send, 'the limit is checked before sending');
  assert.ok(ROUTE.indexOf("from('audit_logs').insert(") > send, 'counted after a send, not before');
  assert.match(ROUTE, /if \(member\) plan =/, 'a trip is named only when the sender is on it');
  assert.match(EMAIL, /reply_to: replyTo/);
  assert.match(EMAIL, /export function sendSupportMessage[\s\S]*escape\(opts\.message\)/);
});

test('Help is in Profile, and its form never shows Sent on a failure', () => {
  assert.match(APP, /<Row icon="💬" title="Help" sub="Quick answers, or message us"/);
  assert.match(APP, /if\(r\.ok&&d\.sent===true\)\{setSent\(true\)/);
  assert.match(APP, /setErr\(d\.error\|\|`We couldn't send that just now\./);
});

test('Who sees what is in the app and links to the policy', () => {
  assert.match(APP, /<span className="sl">Who sees what<\/span>/);
  assert.match(APP, /Your name, email address and picture/);
  assert.match(APP, /title="Privacy Policy"[\s\S]{0,140}window\.location\.href="\/privacy"/);
  assert.match(E2E, /a private field reached another member/);
});

test('time to options is an allowed browser event whose props survive', () => {
  assert.ok((EVENT_NAMES as readonly string[]).includes('options_shown'));
  assert.ok((BROWSER_EVENT_NAMES as readonly string[]).includes('options_shown'));
  const props = { ms: 8123, count: 3, mode: 'trip', shared: false, widen: 0 };
  assert.deepEqual(scrubProps(props), props);
  assert.match(APP, /shown\(data\.trips\.length,false\)/);
  assert.match(APP, /shown\(data\.trips\.length,true\)/);
});
