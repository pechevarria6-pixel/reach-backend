// Business model §4G M1/M4: the pilot_metrics migration reads only event
// names that can be written, and only props that survive the scrub — a view
// reading a name nothing emits, or a key scrubProps drops, is a metric that
// is null for ever and looks like "no data yet".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isEventName, scrubProps } from '../../lib/track.ts';
import { generationProps } from '../../lib/observe/ai-cost.ts';
import { ledgerSummary } from '../../lib/observe/ledger-at-end.ts';

const SQL = readFileSync(new URL('../../sql/pilot-metrics-2026-11-08.sql', import.meta.url), 'utf8');
// Comments out, so a name mentioned in prose is not mistaken for one read.
const BODY = SQL.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

test('every event name the views read is a name that can be written', () => {
  const names = [...BODY.matchAll(/name = '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(names.length >= 10, 'the views read events');
  for (const n of new Set(names)) assert.equal(isEventName(n), true, `${n} is read by pilot_metrics but not in EVENT_NAMES`);
});

/** Which props keys the SQL reads for a given event. */
function keysRead(): Set<string> {
  return new Set([...BODY.matchAll(/props->>'([a-z_]+)'/g)].map(m => m[1]));
}

test('the debrief keys the view reads survive the scrub', () => {
  // The form's props as the Verify track sends them.
  const debrief = { hours: 6, messages: 40, nps: 8, would_run_again: true };
  const kept = scrubProps(debrief);
  for (const k of ['hours', 'messages', 'nps', 'would_run_again']) {
    assert.ok(keysRead().has(k), `the view does not read ${k}`);
    assert.ok(k in kept, `scrubProps drops ${k}, so the view would always read null`);
  }
});

test('the AI and ledger keys the view reads are the ones written', () => {
  const ai = scrubProps(generationProps('claude-haiku-4-5', 'trips generate', { input_tokens: 1, output_tokens: 1 }));
  const ledger = scrubProps(ledgerSummary({ lines: [], solo: false, members: [] } as never));
  for (const k of ['cost_usd', 'priced', 'input_tokens', 'output_tokens']) assert.ok(k in ai, `ai_generation has no ${k}`);
  for (const k of ['open_lines', 'open_cents', 'solo']) assert.ok(k in ledger, `ledger_at_trip_end has no ${k}`);
  for (const k of ['cost_usd', 'priced', 'open_lines', 'open_cents', 'solo', 'answer']) assert.ok(keysRead().has(k), k);
});

test('margin is take minus fees minus AI minus concierge', () => {
  const m = BODY.match(/round\(coalesce\(bk\.take_cents, 0\)([\s\S]*?)as contribution_margin_cents/);
  assert.ok(m, 'contribution_margin_cents is computed in the view');
  assert.match(m![1], /- coalesce\(ct\.fee_cents, 0\)/);
  assert.match(m![1], /- coalesce\(ev\.ai_cost_usd, 0\) \* 100/);
  // Concierge minutes have no source yet, and the file says so.
  assert.match(SQL, /Concierge minutes: no source yet/);
});

test('no metric view is readable with the key every browser holds', () => {
  for (const v of ['pilot_trip_metrics', 'pilot_organizer_conversion', 'pilot_group_metrics', 'pilot_reconnection', 'pilot_metrics']) {
    assert.match(BODY, new RegExp(`create or replace view public\\.${v} with \\(security_invoker = true\\)`), v);
  }
  assert.match(BODY, /revoke all on public\.pilot_trip_metrics,[\s\S]*?from anon, authenticated;/);
  assert.match(BODY, /revoke all on function public\.pilot_metrics_between\(timestamptz, timestamptz\) from public, anon, authenticated;/);
});

test('it runs after the migration that adds the columns it reads', () => {
  for (const col of ['commission_cents', 'stripe_fee_cents', 'payment_method']) assert.match(BODY, new RegExp(col));
  assert.match(SQL, /sql\/pilot-gate-2026-11-08\.sql/);
});
