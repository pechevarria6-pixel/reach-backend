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
  verify(rawBody: string, headers: { get(name: string): string | null }, now?: number): boolean;
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

export function providerFor(name: ProviderName, env: Env): Provider {
  return name === 'retell' ? retell(env) : vapi(env);
}

/** Which provider sent this webhook, by the header only that provider sends. */
export function senderOf(headers: { get(name: string): string | null }): ProviderName | null {
  if (headers.get('x-retell-signature')) return 'retell';
  if (headers.get('x-vapi-secret') || headers.get('authorization')) return 'vapi';
  return null;
}
