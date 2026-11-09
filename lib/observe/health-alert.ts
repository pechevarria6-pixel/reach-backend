// ─── Telling somebody when a provider stops answering ────────────────────
// /api/health/providers already knows which lanes work. Nobody asks it: it
// answers whoever calls with the secret, and until now that was a person who
// already suspected something. A provider that broke on a Tuesday was found
// when a member's screen came up empty, which is the most expensive way to
// find anything.
//
// This reads that report and decides what is worth an email. `dormant` is
// not: a lane with no key is switched off on purpose, and an alert for it
// every run is an alert that gets filtered to a folder. `refused` and
// `unreachable` are, and so is Stripe running in a mode nobody expected —
// the gate's "fail loudly if live" (REACH-PILOT-GATE A1).
import { Resend } from 'resend';

export interface LaneReport {
  provider: string;
  lane: string;
  key: string;
  status: string;
  ms: number | null;
  detail: string | null;
}

export interface Failure { provider: string; status: string; detail: string | null }

const BROKEN = new Set(['refused', 'unreachable']);

/** The Stripe row says its mode in `detail`: "test mode — …" or "LIVE mode — …". */
export function stripeMode(lanes: LaneReport[]): 'test' | 'live' | null {
  const row = lanes.find(l => /^stripe$/i.test(l.provider));
  if (!row?.detail) return null;
  if (/^LIVE mode/.test(row.detail)) return 'live';
  if (/^test mode/.test(row.detail)) return 'test';
  return null;
}

/**
 * What is wrong, in the order the report listed it.
 *
 * `expectedStripe` is STRIPE_EXPECTED_MODE, 'test' until the owner says the
 * pilot takes real money. A live key during the pilot is a failure even
 * though every call would succeed — that is the whole danger of it.
 */
export function failuresOf(lanes: LaneReport[], expectedStripe: 'test' | 'live' = 'test'): Failure[] {
  const out: Failure[] = lanes
    .filter(l => BROKEN.has(l.status))
    .map(l => ({ provider: l.provider, status: l.status, detail: l.detail }));
  const mode = stripeMode(lanes);
  if (mode && mode !== expectedStripe) {
    out.push({ provider: 'Stripe', status: `${mode} mode`, detail: `expected ${expectedStripe} mode (STRIPE_EXPECTED_MODE)` });
  }
  return out;
}

/** The email's lines. Provider names and statuses only — never a key. */
export function alertLines(failures: Failure[], when: Date = new Date()): string[] {
  return [
    `${failures.length} provider check${failures.length === 1 ? '' : 's'} failed at ${when.toISOString()}.`,
    ...failures.map(f => `${f.provider}: ${f.status}${f.detail ? ` — ${f.detail}` : ''}`),
    'Full report: GET /api/health/providers?format=text with the cron secret.',
    'Log it in docs/pilot/INCIDENTS.md if a member saw it.',
  ];
}

const escape = (v: string) => v.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export interface Sent { sent: boolean; reason?: 'no_key' | 'rejected' | 'error' }

/**
 * Best-effort, and never thrown. If Resend is the provider that broke, this
 * cannot send — which is why the scheduled job also fails its own run, and
 * GitHub's failure notice is the second way somebody hears.
 */
export async function sendHealthAlert(failures: Failure[], when: Date = new Date()): Promise<Sent> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'no_key' };
  const to = process.env.ALERT_EMAIL || 'hello@alcanzar.io';
  const from = process.env.EMAIL_FROM || 'Reach <hello@alcanzar.io>';
  const lines = alertLines(failures, when);
  try {
    const { error } = await new Resend(key).emails.send({
      from, to,
      subject: `Reach health: ${failures.map(f => f.provider).join(', ')}`.slice(0, 180),
      text: lines.join('\n'),
      html: lines.map(l => `<p style="font-family:system-ui,sans-serif;font-size:14px;margin:0 0 8px;">${escape(l)}</p>`).join(''),
    });
    if (error) {
      console.error('[health-alert] Resend refused the alert', { name: (error as { name?: string }).name });
      return { sent: false, reason: 'rejected' };
    }
    return { sent: true };
  } catch (e) {
    console.error('[health-alert] could not send', { error: e instanceof Error ? e.message : 'unknown' });
    return { sent: false, reason: 'error' };
  }
}
