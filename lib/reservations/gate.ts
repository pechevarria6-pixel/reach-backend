// ─── Whether Reach may place a reservation call at all ──────────────────
// The owner's decision, 2026-11-04: build the calling assistant, and call NO
// restaurant until a phone-law lawyer has signed off. That decision lives
// here, in code, and not in anybody's memory of it:
//
//   RESERVATION_CALLS_MODE=off   (or unset, or anything else) — no call, ever.
//   RESERVATION_CALLS_MODE=test  — every call dials RESERVATION_TEST_NUMBER
//                                  and nothing else, whatever the venue's
//                                  number is. No booking is changed by it.
//   RESERVATION_CALLS_MODE=live  — refused, unless
//                                  RESERVATION_CALLS_LAWYER_APPROVED=yes is
//                                  ALSO set. Two switches, so a typo in one
//                                  never rings a restaurant.
//
// A provider is used only when every key it needs is present. Absent keys
// mean disabled, not "try anyway".

export type CallMode = 'off' | 'test' | 'live';
export type ProviderName = 'retell' | 'vapi';

export type Env = Record<string, string | undefined>;

export type GateRefusal =
  | 'calls_off'
  | 'live_not_approved'
  | 'no_test_number'
  | 'no_provider';

export interface Gate {
  ok: boolean;
  mode: CallMode;
  provider: ProviderName | null;
  refusal?: GateRefusal;
  /** In test mode, the only number that may be dialled. */
  testNumber?: string;
}

/** E.164: a plus, a country code, and up to fifteen digits in all. */
export const E164 = /^\+[1-9]\d{6,14}$/;

/** What the environment says the mode is. Anything not exactly test or live is off. */
export function modeFrom(env: Env): CallMode {
  const raw = String(env.RESERVATION_CALLS_MODE ?? '').trim().toLowerCase();
  return raw === 'test' || raw === 'live' ? raw : 'off';
}

/** The lawyer's sign-off, as the owner records it. Only the literal "yes" counts. */
export function lawyerApproved(env: Env): boolean {
  return String(env.RESERVATION_CALLS_LAWYER_APPROVED ?? '').trim().toLowerCase() === 'yes';
}

/** The first provider whose keys are all present: Retell, then Vapi. */
export function providerFrom(env: Env): ProviderName | null {
  const has = (...keys: string[]) => keys.every(k => String(env[k] ?? '').trim() !== '');
  if (has('RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_FROM_NUMBER')) return 'retell';
  if (has('VAPI_API_KEY', 'VAPI_ASSISTANT_ID', 'VAPI_PHONE_NUMBER_ID', 'VAPI_WEBHOOK_SECRET')) return 'vapi';
  return null;
}

export function gate(env: Env): Gate {
  const mode = modeFrom(env);
  if (mode === 'off') return { ok: false, mode, provider: null, refusal: 'calls_off' };
  if (mode === 'live' && !lawyerApproved(env)) return { ok: false, mode, provider: null, refusal: 'live_not_approved' };
  const provider = providerFrom(env);
  if (mode === 'test') {
    const testNumber = String(env.RESERVATION_TEST_NUMBER ?? '').trim();
    if (!E164.test(testNumber)) return { ok: false, mode, provider, refusal: 'no_test_number' };
    if (!provider) return { ok: false, mode, provider, refusal: 'no_provider', testNumber };
    return { ok: true, mode, provider, testNumber };
  }
  if (!provider) return { ok: false, mode, provider, refusal: 'no_provider' };
  return { ok: true, mode, provider };
}

/**
 * The number this call will actually ring. In test mode it is the test
 * number and never the venue's, whatever the caller passes; in any other
 * mode that is not open, it is nothing.
 */
export function dialTarget(g: Gate, venueNumber: string): string | null {
  if (g.ok === false) return null;
  if (g.mode === 'test') return g.testNumber ?? null;
  if (g.mode === 'live') return venueNumber;
  return null;
}
