// Run with: cd relay && npm test   (node --test, type stripping)
// The relay end to end on this machine: a real WebSocket server, a fake
// Twilio (setup / prompt / sendDigits / text / end), a scripted model, and a
// catcher for the signed report. No phone, no model, no Reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { relayServer } from './server.ts';
import { relayTicket, relay as relayProvider } from '../lib/reservations/providers.ts';
import { settleWithin } from '../lib/reservations/agent/settle-window.ts';
import type { Model } from '../lib/reservations/agent/session.ts';

const SECRET = 'test-secret';
const FACTS = { restaurant: 'Husk', venuePhone: '+18435551234', date: '2026-12-04', time: '19:30', partySize: 4, firstName: 'Sam', notes: null };
const WINDOW = { start: '18:30', end: '20:00' };

const scripted = (...r: object[]): Model => { let i = 0; return async () => JSON.stringify(r[i++] ?? { say: '', move: 'not-a-move', heard: {} }); };
const listen = (s: Server) => new Promise<number>(ok => s.listen(0, () => ok((s.address() as AddressInfo).port)));

async function call(model: Model, staff: string[], ticket = relayTicket(SECRET, 'call-1', FACTS, WINDOW), hangUpEarly = false) {
  const reports: { headers: Record<string, any>; raw: string }[] = [];
  const catcher = createServer((req, res) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { reports.push({ headers: req.headers, raw: b }); res.end('ok'); }); });
  const hook = await listen(catcher);
  const relay = relayServer({ model, secret: SECRET, webhook: `http://localhost:${hook}/` });
  const port = await listen(relay);
  const got: Record<string, any>[] = [];
  await new Promise<void>(done => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    let i = 0;
    const next = () => { if (i < staff.length) ws.send(JSON.stringify({ type: 'prompt', voicePrompt: staff[i++], last: true })); else if (hangUpEarly) ws.close(); };
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'setup', callSid: 'CA1', customParameters: { ticket: ticket.payload, sig: ticket.sig } })); next(); });
    ws.on('message', d => {
      const m = JSON.parse(String(d)); got.push(m);
      if (m.type === 'text' || m.type === 'sendDigits') setTimeout(next, 20);
      if (m.type === 'end') ws.close();
    });
    ws.on('close', () => setTimeout(done, 400));
  });
  relay.close(); catcher.close();
  return { got, reports };
}

test('a counter-offer inside the window: read back, confirmed, reported signed, and proved by Reach', async () => {
  const { got, reports } = await call(
    scripted({ say: 'Eight works. So four people on Friday, December 4 at 8:00 PM under Sam. Is that right?', move: 'offered', heard: { time: '20:00' } }, { say: '', move: 'staff_yes', heard: {} }),
    ['We are full at 7:30 but I could do eight o\'clock.', 'Yes, that\'s right.'],
  );
  assert.ok(got.some(m => m.type === 'text' && /8:00 PM/.test(m.token)), 'the read-back was spoken');
  assert.ok(got.some(m => m.type === 'end'), 'the call was ended by the relay');
  assert.equal(reports.length, 1);
  // Reach's webhook accepts the signature, parses the report, and its proof agrees.
  const provider = relayProvider({ RELAY_SECRET: SECRET });
  const headers = { get: (n: string) => (reports[0].headers[n.toLowerCase()] as string) ?? null };
  assert.ok(provider.verify(reports[0].raw, headers), 'the report is signed with the shared secret');
  assert.equal(provider.verify(reports[0].raw.replace('Sam', 'Max'), headers), false, 'a changed report fails');
  const ev = provider.parse(JSON.parse(reports[0].raw))!;
  assert.equal(ev.callId, 'call-1');
  assert.equal(ev.turns[0].speaker, 'assistant');
  assert.match(ev.turns[0].text, /automated AI assistant from Reach/);
  const settled = settleWithin(FACTS, WINDOW, ev.turns, ev.extraction, ev.signals);
  assert.equal(settled.outcome, 'confirmed');
  assert.equal(settled.held?.time, '20:00');
});

test('a phone menu is pressed through with sendDigits', async () => {
  const { got } = await call(
    scripted({ say: '', move: 'press', heard: { digits: '2' } }, { say: '', move: 'full', heard: {} }),
    ['For reservations press 2.', 'Sorry, we are fully booked that night.'],
  );
  assert.ok(got.some(m => m.type === 'sendDigits' && m.digits === '2'));
  assert.ok(got.some(m => m.type === 'end'));
});

test('a forged ticket ends the call before a word is generated', async () => {
  let asked = 0;
  const model: Model = async () => { asked++; return '{}'; };
  const bad = { ...relayTicket(SECRET, 'call-1', FACTS, WINDOW), sig: 'f'.repeat(64) };
  const { got, reports } = await call(model, ['Hello?'], bad);
  assert.ok(got.some(m => m.type === 'end' && /bad_ticket/.test(m.handoffData)));
  assert.equal(asked, 0);
  assert.equal(reports.length, 0, 'nothing to report for a call it never ran');
});

test('a hang-up mid-call is still reported, as failed, and is not booked', async () => {
  const { reports } = await call(scripted({ say: 'Of course.', move: 'answer', heard: {} }), ['One moment please.'], undefined, true);
  assert.equal(reports.length, 1);
  const body = JSON.parse(reports[0].raw);
  assert.equal(body.ending, 'failed');
  assert.notEqual(body.extraction.outcome, 'confirmed');
});
