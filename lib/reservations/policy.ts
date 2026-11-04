// ─── When, and which numbers, the assistant may ring ────────────────────
// Three rules from the owner's decisions, each answered only from what we
// can verify, and each failing closed — a call we are unsure about is handed
// to the person instead:
//
//   * business landlines only. A number is a landline when a line-type
//     lookup says exactly "landline". No lookup keys, a lookup that fails, a
//     mobile, a VoIP line, a toll-free number: handed off. Calls to mobile
//     numbers are where the TCPA's consent rule bites hardest, and a
//     restaurant's listed number is often the owner's mobile.
//   * opening hours only. Read from the venue's own mapped hours, and only
//     when they parse and say plainly "open" across a margin either side of
//     now. The local time is estimated from longitude (lib/calendar.ts says
//     why that is the clue we have, and how far it can be off), so the
//     margin is wide enough to absorb it: two hours each side.
//   * the destination must be a North American (+1) number. That is what
//     the voice providers' own numbers dial, and the only law the research
//     covered.
import OpeningHours from 'opening_hours';
import { E164 } from './gate.ts';

/** A venue number as stored ("(919) 555-0100", "+1 919 555 0100") → E.164, or null when we cannot be sure. */
export function toE164(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Two numbers in one field ("919-555-0100; 919-555-0101") — we cannot pick.
  if (/[;,/]|\bor\b/i.test(s)) return null;
  const digits = s.replace(/(?:ext\.?|x)\s*\d+$/i, '').replace(/[^\d+]/g, '');
  if (/^\+/.test(digits)) return E164.test(digits) ? digits : null;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

/** Only +1 numbers with a real area code and exchange (NANP: neither starts 0 or 1). */
export function dialable(e164: string): boolean {
  return /^\+1(?![2-9]11)[2-9]\d{2}[2-9]\d{6}$/.test(e164);
}

export type LineType = 'landline' | 'mobile' | 'voip' | 'toll_free' | 'other' | 'unknown';

export interface LineLookup { (e164: string): Promise<LineType> }

/**
 * Twilio Lookup v2, line type intelligence. Configured only when both keys
 * are present; without them every number is 'unknown' and so handed off.
 */
export function twilioLookup(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): LineLookup | null {
  const sid = String(env.TWILIO_ACCOUNT_SID ?? '').trim();
  const token = String(env.TWILIO_AUTH_TOKEN ?? '').trim();
  if (!sid || !token) return null;
  return async (e164: string) => {
    try {
      const res = await fetchImpl(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
      });
      if (res.ok === false) return 'unknown';
      const json = await res.json().catch(() => null) as { line_type_intelligence?: { type?: string } } | null;
      return lineTypeOf(json?.line_type_intelligence?.type);
    } catch {
      return 'unknown';
    }
  };
}

export function lineTypeOf(t: unknown): LineType {
  switch (String(t ?? '').trim()) {
    case 'landline': return 'landline';
    case 'mobile': return 'mobile';
    case 'fixedVoip': case 'nonFixedVoip': return 'voip';
    case 'tollFree': return 'toll_free';
    case '': return 'unknown';
    default: return 'other';
  }
}

/** The venue's estimated local "YYYY-MM-DDTHH:MM" at a moment, from longitude; null without one. */
export function localMinute(lng: number | null | undefined, at: Date): string | null {
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  const offset = Math.max(-12, Math.min(14, Math.round(lng / 15)));
  return new Date(at.getTime() + offset * 3_600_000).toISOString().slice(0, 16);
}

/** Hours either side of now the venue must be plainly open, to absorb the longitude estimate. */
export const HOURS_MARGIN = 2;

/**
 * Whether the venue's own hours say it is open from HOURS_MARGIN hours
 * before now to HOURS_MARGIN hours after, at the venue's estimated local
 * time. Unknown, unparseable, missing, or "open but unknown" all say no.
 */
export function openForCalls(hours: string | null | undefined, lng: number | null | undefined, now: Date): { ok: boolean; why?: 'no_hours' | 'unreadable' | 'closed' | 'no_place' } {
  const text = String(hours ?? '').trim();
  if (!text) return { ok: false, why: 'no_hours' };
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return { ok: false, why: 'no_place' };
  let oh: OpeningHours;
  try {
    oh = new OpeningHours(text, null as never);
  } catch {
    return { ok: false, why: 'unreadable' };
  }
  const offset = Math.max(-12, Math.min(14, Math.round(lng / 15)));
  const localNow = new Date(now.getTime() + offset * 3_600_000);
  // Built from the shifted UTC parts as a local Date, the way lib/discovery/hours.ts reads hours.
  const asLocal = (ms: number) => {
    const d = new Date(localNow.getTime() + ms);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  };
  try {
    const from = asLocal(-HOURS_MARGIN * 3_600_000);
    const to = asLocal(HOURS_MARGIN * 3_600_000);
    // Open all the way through, and not one minute of it unknown.
    const intervals = oh.getOpenIntervals(from, to) as Array<[Date, Date, boolean, string | undefined]>;
    if (!intervals.length) return { ok: false, why: 'closed' };
    let cursor = from.getTime();
    for (const [start, end, unknown] of intervals) {
      if (unknown) return { ok: false, why: 'closed' };
      if (start.getTime() > cursor) return { ok: false, why: 'closed' };
      cursor = Math.max(cursor, end.getTime());
    }
    return cursor >= to.getTime() ? { ok: true } : { ok: false, why: 'closed' };
  } catch {
    return { ok: false, why: 'unreadable' };
  }
}
