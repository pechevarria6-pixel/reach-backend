// ─── Reach's call relay ──────────────────────────────────────────────────
// Holds the WebSocket that Twilio ConversationRelay opens for each answered
// call. Twilio turns the restaurant's speech into text and our text into
// speech; this server runs lib/reservations/agent: Claude words each reply,
// the rules (machine.ts) decide what happens, and when the call ends the
// turns go to Reach's webhook, where outcome.ts proves — from the staff's
// own words — whether anything was booked.
//
// Vercel functions cannot hold a WebSocket open, which is why this is its
// own small service (design D1). It runs on Node 22+ with type stripping:
//
//   node --experimental-strip-types relay/server.ts
//
// Environment: RELAY_SECRET (shared with Reach), ANTHROPIC_API_KEY,
// REACH_WEBHOOK_URL (https://www.alcanzar.io/api/webhooks/reservation-call),
// RELAY_MODEL (default claude-haiku-5-5), PORT (default 8080).
//
// It holds no database access and no Twilio keys: it can talk on a call it
// was handed a signed ticket for, and report what was said. Nothing else.
import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import Anthropic from '@anthropic-ai/sdk';
import { createSession, type Model } from '../lib/reservations/agent/session.ts';
import { readTicket, relaySignature } from '../lib/reservations/providers.ts';

const SECRET = process.env.RELAY_SECRET ?? '';
const WEBHOOK = process.env.REACH_WEBHOOK_URL ?? 'https://www.alcanzar.io/api/webhooks/reservation-call';
const MODEL = process.env.RELAY_MODEL ?? 'claude-haiku-5-5';
const PORT = Number(process.env.PORT ?? 8080);
/** A phone turn that waits longer than this sounds like a dropped line. */
const TURN_MS = 4500;

let anthropic: Anthropic | null = null;

/** One model turn: system + messages in, the reply's text out, inside TURN_MS. */
export const claude: Model = async (system, messages) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TURN_MS);
  try {
    anthropic ??= new Anthropic();
    const res = await anthropic.messages.create({ model: MODEL, max_tokens: 200, system, messages }, { signal: ctl.signal });
    return res.content.map(c => (c.type === 'text' ? c.text : '')).join('');
  } finally {
    clearTimeout(t);
  }
};

/** Roughly how long Twilio will take to say a line, so `end` does not cut it off. */
const speakMs = (s: string) => Math.min(12_000, 800 + s.length * 65);

async function report(body: Record<string, unknown>, secret = SECRET, url = WEBHOOK): Promise<void> {
  const raw = JSON.stringify(body);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-reach-relay-signature': relaySignature(secret, raw, Date.now()) },
        body: raw,
      });
      if (res.ok) return;
      console.error('[relay] Reach did not take the report', { status: res.status, attempt, callId: body.callId });
      if (res.status < 500) return; // refused for a reason a retry will not fix
    } catch (e) {
      console.error('[relay] could not reach Reach', { attempt, callId: body.callId, error: (e as Error).message });
    }
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
}

export interface RelayOptions { model: Model; secret: string; webhook: string }

export function handle(ws: WebSocket, o: RelayOptions): void {
  let session: ReturnType<typeof createSession> | null = null;
  let callId = '', callSid = '';
  let reported = false;
  let busy = Promise.resolve();
  const send = (m: Record<string, unknown>) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };

  const finish = async () => {
    if (reported || !session) return;
    reported = true;
    const s = session.summary();
    console.log('[relay] call ended', { callId, ending: s.ending, why: s.why, turns: s.turns.length });
    await report({
      event: 'call_ended', callId, providerCallId: callSid,
      turns: s.turns, extraction: s.extraction,
      signals: { noAnswer: false, voicemail: s.ending === 'no_answer' && s.turns.filter(t => t.speaker === 'staff').length <= 1 },
      ending: s.ending, why: s.why,
    }, o.secret, o.webhook);
  };

  ws.on('message', data => {
    let m: Record<string, any>;
    try { m = JSON.parse(String(data)); } catch { return; }

    if (m.type === 'setup') {
      const p = m.customParameters ?? {};
      const t = readTicket(o.secret, String(p.ticket ?? ''), String(p.sig ?? ''));
      if (!t) {
        console.error('[relay] a call without a good ticket; ending it', { callSid: m.callSid });
        send({ type: 'end', handoffData: JSON.stringify({ reason: 'bad_ticket' }) });
        return;
      }
      callId = t.callId; callSid = String(m.callSid ?? '');
      session = createSession(t.facts, t.window, o.model);
      // Twilio has already said these words (welcomeGreeting): recorded as
      // the first turn, so the disclosure check reads what was actually said.
      session.greeting();
      return;
    }

    if (m.type === 'prompt' && m.last && session) {
      const said = String(m.voicePrompt ?? '');
      // One turn at a time, in order: a second prompt waits for the first reply.
      busy = busy.then(async () => {
        const r = await session!.heard(said);
        if (r.press) send({ type: 'sendDigits', digits: r.press });
        if (r.say) send({ type: 'text', token: r.say, last: true });
        if (r.ended) {
          setTimeout(() => send({ type: 'end', handoffData: JSON.stringify({ ending: r.ended }) }), r.say ? speakMs(r.say) : 0);
          await finish();
        }
      }).catch(e => console.error('[relay] turn failed', { callId, error: (e as Error).message }));
      return;
    }

    if (m.type === 'error') console.error('[relay] Twilio reported', { callId, description: m.description });
  });

  ws.on('close', () => {
    if (session && !reported) { session.hungUp(); void finish(); }
  });
}

/** The HTTP server: /health, and /ws for Twilio. */
export function relayServer(o: RelayOptions): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    res.writeHead(404); res.end();
  });
  new WebSocketServer({ server, path: '/ws' }).on('connection', ws => handle(ws, o));
  return server;
}

// Run directly (node relay/server.ts): the real model, from the environment.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!SECRET || !process.env.ANTHROPIC_API_KEY) {
    console.error('[relay] RELAY_SECRET and ANTHROPIC_API_KEY are both needed; refusing to start');
    process.exit(1);
  }
  relayServer({ model: claude, secret: SECRET, webhook: WEBHOOK })
    .listen(PORT, () => console.log(`[relay] listening on ${PORT}, model ${MODEL}`));
}
