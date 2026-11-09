// Pilot gate A5: a provider that stops answering reaches somebody's inbox,
// and a lane switched off on purpose does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { failuresOf, stripeMode, alertLines, sendHealthAlert, type LaneReport } from '../../lib/observe/health-alert.ts';

const lane = (provider: string, status: string, detail: string | null = null): LaneReport =>
  ({ provider, lane: 'discovery', key: 'set', status, ms: 10, detail });

test('refused and unreachable are failures; ok, dormant and unknown are not', () => {
  const f = failuresOf([
    lane('weather.gov', 'ok'),
    lane('Yelp (events)', 'dormant', "needs Yelp's developer beta"),
    lane('Viator (activities)', 'unknown'),
    lane('Ticketmaster', 'refused', 'HTTP 401 — key rejected'),
    lane('Resend (email)', 'unreachable', 'no answer in 6000ms'),
  ]);
  assert.deepEqual(f.map(x => x.provider), ['Ticketmaster', 'Resend (email)']);
});

test('Stripe in live mode during a test-mode pilot is a failure', () => {
  const live = lane('Stripe', 'unknown', 'LIVE mode — see /api/health/stripe for a live check');
  assert.equal(stripeMode([live]), 'live');
  assert.equal(failuresOf([live]).length, 1);
  assert.equal(failuresOf([live], 'live').length, 0);
  const test_ = lane('Stripe', 'unknown', 'test mode — see /api/health/stripe for a live check');
  assert.equal(failuresOf([test_]).length, 0);
});

test('the Stripe row is read the way the providers route writes it', () => {
  // The alert reads "LIVE mode" / "test mode" off the detail; if the route's
  // wording moves, a live key would pass silently.
  const route = readFileSync(new URL('../../app/api/health/providers/route.ts', import.meta.url), 'utf8');
  assert.match(route, /\? 'LIVE' : .*\? 'test'/);
  assert.match(route, /`\$\{mode\} mode — see \/api\/health\/stripe/);
});

test('the email names providers and statuses, never a key', () => {
  const lines = alertLines([{ provider: 'Ticketmaster', status: 'refused', detail: 'HTTP 401 — key rejected' }], new Date('2026-11-08T12:00:00Z'));
  assert.match(lines[0], /1 provider check failed at 2026-11-08T12:00:00.000Z/);
  assert.equal(lines[1], 'Ticketmaster: refused — HTTP 401 — key rejected');
  assert.doesNotMatch(lines.join('\n'), /sk_|re_[A-Za-z0-9]{8}|Bearer/);
});

test('no Resend key is reported, not thrown', async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    assert.deepEqual(await sendHealthAlert([{ provider: 'x', status: 'refused', detail: null }]), { sent: false, reason: 'no_key' });
  } finally {
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  }
});

test('the scheduled job fails its own run when anything is failing', () => {
  // The second channel, for the day Resend is the thing that broke.
  const wf = readFileSync(new URL('../../.github/workflows/health-alert.yml', import.meta.url), 'utf8');
  assert.match(wf, /\/api\/health\/alert/);
  assert.match(wf, /if \[ "\$failing" != "0" \]; then[\s\S]*?exit 1/);
  // Not a sub-daily vercel.json cron, which would silently reject deploys.
  const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
  assert.doesNotMatch(vercel, /health\/alert/);
});

test('the alert route is behind the cron secret', () => {
  const route = readFileSync(new URL('../../app/api/health/alert/route.ts', import.meta.url), 'utf8');
  assert.match(route, /if \(!authorised\(req\)\) return NextResponse\.json\(\{ error: 'Not authorised' \}, \{ status: 401 \}\)/);
  assert.match(route, /`Bearer \$\{secret\}`/);
});
