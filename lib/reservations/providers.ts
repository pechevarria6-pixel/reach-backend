// ─── The voice providers: Retell first, Vapi second ─────────────────────
// Each adapter does three things and nothing else: place one outbound call,
// verify that a webhook really came from the provider, and turn the
// provider's call-ended payload into turns, an extraction and telephony
// signals for lib/reservations/outcome.ts to judge. Neither adapter decides
// whether a table was booked.
//
// Provider-side setup the owner does once (no key, no call — see gate.ts):
//
//   Retell  — an agent whose begin message is exactly {{opening}} and whose
//             prompt includes {{instructions}}; post-call analysis fields
//             named as in EXTRACTION below; the webhook URL set to
//             /api/webhooks/reservation-call. Keys: RETELL_API_KEY,
//             RETELL_AGENT_ID, RETELL_FROM_NUMBER (E.164, bought in Retell).
//   Vapi    — an assistant whose first message is {{opening}} and whose
//             system prompt includes {{instructions}}; a structured output
//             (or analysisPlan structuredData) with the EXTRACTION fields;
//             the server URL set to /api/webhooks/reservation-call with
//             secret VAPI_WEBHOOK_SECRET. Keys: VAPI_API_KEY,
//             VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID, VAPI_WEBHOOK_SECRET.
//
// The opening is checked in the transcript afterwards (disclosedIn), so an
// agent configured without {{opening}} is caught on its first call and
// every later call is refused until the owner looks.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env, ProviderName } from './gate.ts';
import type { Extraction, Signals, Turn } from './outcome.ts';
import type { CallFacts } from './script.ts';
import type { Window } from './agent/machine.ts';

/** The post-call fields both providers are configured to extract. */
export const EXTRACTION = {
  outcome: 'one of: confirmed, alternative_offered, no_availability, voicemail, no_answer, refused, do_not_call, needs_guest',
  staff_quote: "the restaurant staff's exact words that answered the request, copied verbatim from what they said",
  held_time: 'the time the staff agreed to hold, HH:MM 24-hour, only if they agreed',
  held_party: 'the party size the staff agreed to, only if they agreed',
  name_on_booking: 'the name the staff took the table under, only if they did',
  offered_time: 'a different time the staff offered, HH:MM 24-hour',
  asked_not_to_call: 'true if anyone asked not to be called again',
} as const;

export interface PlaceArgs {
  /** Our reservation_calls row id: the idempotency key and the metadata that ties the webhook back. */
  callId: string;
  to: string;
  variables: Record<string, string>;
  /** The relay runs the conversation itself, so it is handed the facts and the window. */
  facts?: CallFacts;
  window?: Window;
}

export type Placed =
  | { ok: true; providerCallId: string }
  /** The provider said no, so no call was made. */
  | { ok: false; placed: false; detail: string }
  /** We could not read the answer; a call may be ringing. */
  | { ok: false; placed: 'unknown'; detail: string };

export interface CallEnded {
  providerCallId: string | null;
  /** Our row id, from the metadata we sent. */
  callId: string | null;
  /** Whether this event carries the end of the call (the one to settle on). */
  final: boolean;
  turns: Turn[];
  extraction: Extraction | null;
  signals: Signals;
}

export interface Provider {
  name: ProviderName;
  place(args: PlaceArgs, fetchImpl?: typeof fetch): Promise<Placed>;
  verify(rawBody: string, headers: { get(name: string): string | null }, now?: number, url?: string): boolean;
  parse(body: unknown): CallEnded | null;
}

async function post(url: string, headers: Record<string, string>, body: unknown, fetchImpl: typeof fetch): Promise<Placed> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, placed: 'unknown', detail: `no answer from the provider: ${(e as Error).message}` };
  }
  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
  const id = json && (json.call_id ?? json.id);
  if (res.ok && typeof id === 'string' && id) return { ok: true, providerCallId: id };
  // A 4xx is the provider refusing: nothing rang. Anything else may have.
  if (res.status >= 400 && res.status < 500) return { ok: false, placed: false, detail: `refused ${res.status}: ${JSON.stringify(json ?? {}).slice(0, 300)}` };
  return { ok: false, placed: 'unknown', detail: `status ${res.status} and no call id` };
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const same = (a: string, b: string) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// ── Retell ──────────────────────────────────────────────────────────────
// Signature: x-retell-signature = "v=<ms timestamp>,d=<hex HMAC-SHA256 of
// body + timestamp, keyed with the API key>", five minutes' tolerance —
// as the retell-sdk's webhook_auth implements it (read 2026-11-04).
export function retell(env: Env): Provider {
  const key = str(env.RETELL_API_KEY);
  return {
    name: 'retell',
    place({ callId, to, variables }, fetchImpl = fetch) {
      return post('https://api.retellai.com/v2/create-phone-call', { Authorization: `Bearer ${key}` }, {
        from_number: str(env.RETELL_FROM_NUMBER),
        to_number: to,
        override_agent_id: str(env.RETELL_AGENT_ID),
        retell_llm_dynamic_variables: variables,
        metadata: { reach_call_id: callId },
        idempotency_key: callId,
        honor_internal_dnc: true,
      }, fetchImpl);
    },
    verify(rawBody, headers, now = Date.now()) {
      const sig = headers.get('x-retell-signature') ?? '';
      const m = /^v=(\d+),d=([0-9a-f]+)$/i.exec(sig);
      if (!m || !key) return false;
      if (Math.abs(now - Number(m[1])) > 5 * 60 * 1000) return false;
      const want = createHmac('sha256', key).update(rawBody + m[1]).digest('hex');
      return same(want, m[2].toLowerCase());
    },
    parse(body) {
      const b = body as { event?: string; call?: Record<string, any> } | null;
      const call = b?.call;
      if (!call || (b?.event !== 'call_ended' && b?.event !== 'call_analyzed')) return null;
      const reason = str(call.disconnection_reason);
      const analysis = call.call_analysis ?? null;
      const turns: Turn[] = (Array.isArray(call.transcript_object) ? call.transcript_object : [])
        .map((t: any) => ({ speaker: t?.role === 'agent' ? 'assistant' : 'staff', text: str(t?.content) }) as Turn)
        .filter((t: Turn) => t.text.trim());
      const noAnswer = /^(dial_no_answer|dial_busy|dial_failed|invalid_destination|telephony_provider_permission_denied|no_valid_payment)$/.test(reason);
      const voicemail = reason === 'voicemail_reached' || analysis?.in_voicemail === true;
      return {
        providerCallId: str(call.call_id) || null,
        callId: str(call.metadata?.reach_call_id) || null,
        // call_analyzed carries the extraction; call_ended is final only when
        // nobody answered, because then there is nothing to extract.
        final: b.event === 'call_analyzed' || noAnswer || voicemail,
        turns,
        extraction: (analysis?.custom_analysis_data ?? null) as Extraction | null,
        signals: { noAnswer, voicemail },
      };
    },
  };
}

// ── Vapi ────────────────────────────────────────────────────────────────
// Authenticated by the server URL secret, sent as x-vapi-secret (or as a
// bearer token, for a credential set up that way).
export function vapi(env: Env): Provider {
  const key = str(env.VAPI_API_KEY);
  const secret = str(env.VAPI_WEBHOOK_SECRET);
  return {
    name: 'vapi',
    place({ callId, to, variables }, fetchImpl = fetch) {
      return post('https://api.vapi.ai/call', { Authorization: `Bearer ${key}` }, {
        assistantId: str(env.VAPI_ASSISTANT_ID),
        phoneNumberId: str(env.VAPI_PHONE_NUMBER_ID),
        customer: { number: to },
        assistantOverrides: { variableValues: variables },
        metadata: { reach_call_id: callId },
      }, fetchImpl);
    },
    verify(_rawBody, headers) {
      if (!secret) return false;
      const given = headers.get('x-vapi-secret') ?? (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      return !!given && same(given, secret);
    },
    parse(body) {
      const msg = (body as { message?: Record<string, any> } | null)?.message;
      if (!msg || msg.type !== 'end-of-call-report') return null;
      const reason = str(msg.endedReason);
      const turns: Turn[] = (Array.isArray(msg.artifact?.messages) ? msg.artifact.messages : [])
        .filter((t: any) => t?.role === 'assistant' || t?.role === 'bot' || t?.role === 'user')
        .map((t: any) => ({ speaker: t.role === 'user' ? 'staff' : 'assistant', text: str(t.message) }) as Turn)
        .filter((t: Turn) => t.text.trim());
      const outputs = msg.artifact?.structuredOutputs;
      const fromOutputs = outputs && typeof outputs === 'object'
        ? (Object.values(outputs) as any[]).map(o => o?.result).find(r => r && typeof r === 'object') ?? null
        : null;
      const noAnswer = /customer-did-not-answer|customer-busy|no-answer|failed-to-connect|twilio-failed/.test(reason);
      return {
        providerCallId: str(msg.call?.id) || null,
        callId: str(msg.call?.metadata?.reach_call_id) || null,
        final: true,
        turns,
        extraction: (msg.analysis?.structuredData ?? fromOutputs ?? null) as Extraction | null,
        signals: { noAnswer, voicemail: /voicemail/.test(reason) },
      };
    },
  };
}

// ── Reach's relay (Twilio ConversationRelay + relay/server.ts) ───────────
// Twilio dials and does the speech both ways; our relay server holds the
// call's WebSocket and runs lib/reservations/agent (Claude words each reply,
// the rules decide). Two kinds of delivery reach the webhook:
//   · the relay's report when a connected call ends — x-reach-relay-signature,
//     "t=<ms>,v=<hex HMAC-SHA256 of '<t>.<body>' keyed with RELAY_SECRET>";
//   · Twilio's own status callback, for a call nobody answered (the relay
//     never hears of those) — x-twilio-signature, HMAC-SHA1 of the URL plus
//     the sorted form fields, keyed with the auth token (Twilio's scheme).
// Recording is never switched on: the call is transcribed, not recorded
// (design D4).
export const xmlEscape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The signed bundle the relay is handed: the facts, the window and our row id. */
export function relayTicket(secret: string, callId: string, facts: CallFacts, window: Window): { payload: string; sig: string } {
  const payload = Buffer.from(JSON.stringify({ callId, facts, window, iat: Date.now() })).toString('base64url');
  return { payload, sig: createHmac('sha256', secret).update(payload).digest('hex') };
}

/** The relay's check of a ticket: the bundle, or null when the signature does not hold. */
export function readTicket(secret: string, payload: string, sig: string, now = Date.now()): { callId: string; facts: CallFacts; window: Window } | null {
  if (!secret || !payload || !sig) return null;
  const want = createHmac('sha256', secret).update(payload).digest('hex');
  if (!same(want, sig)) return null;
  let t: { callId: string; facts: CallFacts; window: Window; iat?: number };
  try { t = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  // A ticket is good for one call placed in the last fifteen minutes; an old one is never replayed.
  if (typeof t.iat !== 'number' || now - t.iat > 15 * 60 * 1000 || t.iat - now > 60 * 1000) return null;
  return { callId: t.callId, facts: t.facts, window: t.window };
}

/** What Twilio is told to do when the call is answered. */
export function relayTwiml(wssUrl: string, greeting: string, ticket: { payload: string; sig: string }): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Connect>'
    + `<ConversationRelay url="${xmlEscape(wssUrl)}" welcomeGreeting="${xmlEscape(greeting)}" welcomeGreetingInterruptible="none" interruptible="speech" dtmfDetection="true">`
    + `<Parameter name="ticket" value="${xmlEscape(ticket.payload)}"/><Parameter name="sig" value="${xmlEscape(ticket.sig)}"/>`
    + '</ConversationRelay></Connect></Response>';
}

/** Twilio's request signature: base64 HMAC-SHA1 of the URL and the form fields, sorted by name. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function relaySignature(secret: string, body: string, t: number): string {
  return `t=${t},v=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export function relay(env: Env): Provider {
  const sid = str(env.TWILIO_ACCOUNT_SID), token = str(env.TWILIO_AUTH_TOKEN), secret = str(env.RELAY_SECRET);
  const app = str(env.NEXT_PUBLIC_APP_URL) || 'https://www.alcanzar.io';
  return {
    name: 'relay',
    async place({ callId, to, variables, facts, window }, fetchImpl = fetch) {
      if (!facts || !window) return { ok: false, placed: false, detail: 'the relay needs the facts and the window' };
      const twiml = relayTwiml(str(env.RELAY_WSS_URL), variables.opening, relayTicket(secret, callId, facts, window));
      const form = new URLSearchParams({
        To: to, From: str(env.TWILIO_FROM_NUMBER), Twiml: twiml,
        StatusCallback: `${app}/api/webhooks/reservation-call?call=${encodeURIComponent(callId)}`,
        StatusCallbackEvent: 'completed', Timeout: '30',
      });
      let res: Response;
      try {
        res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
          method: 'POST',
          headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
      } catch (e) {
        return { ok: false, placed: 'unknown', detail: `no answer from Twilio: ${(e as Error).message}` };
      }
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      const callSid = json && json.sid;
      if (res.ok && typeof callSid === 'string' && callSid) return { ok: true, providerCallId: callSid };
      if (res.status >= 400 && res.status < 500) return { ok: false, placed: false, detail: `Twilio refused ${res.status}: ${str(json?.message).slice(0, 200)}` };
      return { ok: false, placed: 'unknown', detail: `Twilio status ${res.status} and no call sid` };
    },
    verify(rawBody, headers, now = Date.now(), url) {
      const ours = headers.get('x-reach-relay-signature');
      if (ours) {
        const m = /^t=(\d+),v=([0-9a-f]+)$/i.exec(ours);
        if (!m || !secret) return false;
        if (Math.abs(now - Number(m[1])) > 5 * 60 * 1000) return false;
        return same(relaySignature(secret, rawBody, Number(m[1])), ours);
      }
      const tw = headers.get('x-twilio-signature');
      if (!tw || !token || !url) return false;
      const params = Object.fromEntries(new URLSearchParams(rawBody));
      return same(twilioSignature(token, url, params), tw);
    },
    parse(body) {
      // Twilio's status callback arrives as form fields; the route hands it
      // over as { twilio: {...fields}, call: <our id from the URL> }.
      const b = body as Record<string, any> | null;
      if (b?.twilio) {
        const status = str(b.twilio.CallStatus);
        // A call that was answered is settled by the relay's own report.
        if (!/^(no-answer|busy|failed|canceled)$/.test(status)) return null;
        return { providerCallId: str(b.twilio.CallSid) || null, callId: str(b.call) || null, final: true, turns: [], extraction: null, signals: { noAnswer: true } };
      }
      if (b?.event !== 'call_ended') return null;
      const turns: Turn[] = (Array.isArray(b.turns) ? b.turns : [])
        .map((t: any) => ({ speaker: t?.speaker === 'assistant' ? 'assistant' : 'staff', text: str(t?.text) }) as Turn)
        .filter((t: Turn) => t.text.trim());
      return {
        providerCallId: str(b.providerCallId) || null,
        callId: str(b.callId) || null,
        final: true,
        turns,
        extraction: (b.extraction ?? null) as Extraction | null,
        signals: { noAnswer: b.signals?.noAnswer === true, voicemail: b.signals?.voicemail === true },
      };
    },
  };
}

export function providerFor(name: ProviderName, env: Env): Provider {
  return name === 'relay' ? relay(env) : name === 'retell' ? retell(env) : vapi(env);
}

/** Which provider sent this webhook, by the header only that provider sends. */
export function senderOf(headers: { get(name: string): string | null }): ProviderName | null {
  if (headers.get('x-reach-relay-signature') || headers.get('x-twilio-signature')) return 'relay';
  if (headers.get('x-retell-signature')) return 'retell';
  if (headers.get('x-vapi-secret') || headers.get('authorization')) return 'vapi';
  return null;
}
