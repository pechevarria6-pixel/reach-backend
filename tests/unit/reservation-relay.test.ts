// Run with: npm run test:unit
// Reach's own call relay as a provider: Twilio places the call, the relay
// (relay/server.ts, tested in relay/server.test.ts) runs it, and the webhook
// trusts only a signed report or Twilio's own signed status callback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relay, relayTicket, readTicket, relayTwiml, twilioSignature, relaySignature, senderOf, providerFor } from '../../lib/reservations/providers.ts';
import { providerFrom, gate } from '../../lib/reservations/gate.ts';
import { opening } from '../../lib/reservations/script.ts';

const FACTS = { restaurant: 'Husk & "Co" <bar>', venuePhone: '+18435551234', date: '2026-12-04', time: '19:30', partySize: 4, firstName: 'Sam', notes: null };
const WINDOW = { start: '18:30', end: '20:00' };
const ENV = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550001111', RELAY_WSS_URL: 'wss://relay.example/ws', RELAY_SECRET: 's3cret' };
const H = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

test('Twilio\'s signature scheme matches the worked example in its own docs', () => {
  // twilio.com/docs/usage/security, read 2026-11-23: token 12345, this URL and these fields.
  const url = 'https://example.com/myapp.php?foo=1&bar=2';
  const params = { Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE' };
  assert.equal(twilioSignature('12345', url, params), 'L/OH5YylLD5NRKLltdqwSvS0BnU=');
});

test('the relay is preferred when its keys are all present, and test mode still rings only the test number', () => {
  assert.equal(providerFrom(ENV), 'relay');
  assert.equal(providerFrom({ ...ENV, RELAY_SECRET: '' }), null);
  const g = gate({ ...ENV, RESERVATION_CALLS_MODE: 'test', RESERVATION_TEST_NUMBER: '+15550002222' });
  assert.ok(g.ok && g.provider === 'relay' && g.testNumber === '+15550002222');
  assert.equal(gate({ ...ENV, RESERVATION_CALLS_MODE: 'live' }).ok, false, 'live still needs the lawyer\'s yes');
});

test('a ticket is signed, refuses tampering, and expires after fifteen minutes', () => {
  const t = relayTicket('s3cret', 'call-9', FACTS, WINDOW);
  assert.deepEqual(readTicket('s3cret', t.payload, t.sig)?.window, WINDOW);
  assert.equal(readTicket('other', t.payload, t.sig), null);
  assert.equal(readTicket('s3cret', t.payload.slice(0, -2) + 'AA', t.sig), null);
  assert.equal(readTicket('s3cret', t.payload, t.sig, Date.now() + 16 * 60 * 1000), null);
});

test('the call opens with our own disclosure, escaped, never recorded, and nothing a member typed can break the XML', () => {
  const xml = relayTwiml(ENV.RELAY_WSS_URL, opening(FACTS), relayTicket('s3cret', 'c', FACTS, WINDOW));
  assert.match(xml, /welcomeGreeting="Hi, this is an automated AI assistant from Reach, calling for Sam\. This call is recorded\./);
  assert.match(xml, /welcomeGreetingInterruptible="none"/, 'the disclosure is said in full');
  assert.doesNotMatch(xml, /<bar>|"Co"/);
  assert.doesNotMatch(xml, /[Rr]ecord="?true/);
});

test('placing a call: Twilio is asked once, with our status callback; a refusal rang nothing', async () => {
  const sent: { url: string; body: string }[] = [];
  const ok = (async (url: string, init: RequestInit) => { sent.push({ url, body: String(init.body) }); return new Response(JSON.stringify({ sid: 'CA77' }), { status: 201 }); }) as typeof fetch;
  const p = relay(ENV);
  const r = await p.place({ callId: 'call-9', to: '+15550002222', variables: { opening: opening(FACTS) }, facts: FACTS, window: WINDOW }, ok);
  assert.deepEqual(r, { ok: true, providerCallId: 'CA77' });
  assert.match(sent[0].url, /Accounts\/AC1\/Calls\.json$/);
  const form = new URLSearchParams(sent[0].body);
  assert.equal(form.get('To'), '+15550002222');
  assert.match(form.get('StatusCallback') ?? '', /\/api\/webhooks\/reservation-call\?call=call-9$/);
  assert.equal(form.get('Record'), null);
  const no = (async () => new Response(JSON.stringify({ message: 'bad number' }), { status: 400 })) as typeof fetch;
  const r2 = await p.place({ callId: 'c', to: '+1', variables: { opening: 'x' }, facts: FACTS, window: WINDOW }, no);
  assert.ok(r2.ok === false && r2.placed === false);
  assert.ok((await p.place({ callId: 'c', to: '+1', variables: { opening: 'x' } }, ok)).ok === false, 'no facts, no call');
});

test('the webhook trusts a signed relay report and a signed Twilio status, and nothing else', () => {
  const p = providerFor('relay', ENV);
  const body = JSON.stringify({ event: 'call_ended', callId: 'call-9', providerCallId: 'CA77', turns: [{ speaker: 'assistant', text: 'Hi' }, { speaker: 'staff', text: 'Hello' }], extraction: { outcome: 'unclear' }, signals: {} });
  const sig = relaySignature('s3cret', body, Date.now());
  assert.equal(senderOf(H({ 'x-reach-relay-signature': sig })), 'relay');
  assert.ok(p.verify(body, H({ 'x-reach-relay-signature': sig })));
  assert.equal(p.verify(body + ' ', H({ 'x-reach-relay-signature': sig })), false);
  assert.equal(p.verify(body, H({ 'x-reach-relay-signature': relaySignature('s3cret', body, Date.now() - 10 * 60 * 1000) })), false, 'an old report is refused');
  const ev = p.parse(JSON.parse(body))!;
  assert.equal(ev.callId, 'call-9'); assert.equal(ev.turns.length, 2);

  const url = 'https://www.alcanzar.io/api/webhooks/reservation-call?call=call-9';
  const form = 'CallSid=CA77&CallStatus=no-answer&To=%2B15550002222';
  const tsig = twilioSignature('tok', url, Object.fromEntries(new URLSearchParams(form)));
  assert.equal(senderOf(H({ 'x-twilio-signature': tsig })), 'relay');
  assert.ok(p.verify(form, H({ 'x-twilio-signature': tsig }), Date.now(), url));
  assert.equal(p.verify(form, H({ 'x-twilio-signature': tsig }), Date.now(), url.replace('call-9', 'call-8')), false);
  const nobody = p.parse({ twilio: Object.fromEntries(new URLSearchParams(form)), call: 'call-9' })!;
  assert.ok(nobody.final && nobody.signals.noAnswer && nobody.callId === 'call-9');
  assert.equal(p.parse({ twilio: { CallSid: 'CA77', CallStatus: 'completed' }, call: 'call-9' }), null, 'an answered call is settled by the relay\'s own report');
});
