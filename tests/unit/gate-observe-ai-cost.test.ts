// Pilot gate A5 / business model §4E C2–C3: every model call in trip
// generation is costed, and the options take the small model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { costUsd, priceFor, generationProps, stageOf, aiMeter, MODEL_PRICES } from '../../lib/observe/ai-cost.ts';
import { scrubProps } from '../../lib/track.ts';

const ROUTE = readFileSync(new URL('../../app/api/trips/generate/route.ts', import.meta.url), 'utf8');

test('a call is costed at the published rate for its model', () => {
  // 10k in, 2k out on Haiku 4.5 at $1 / $5 per million: 0.01 + 0.01.
  assert.equal(costUsd('claude-haiku-4-5', { input_tokens: 10_000, output_tokens: 2_000 }), 0.02);
  // Sonnet 5 at $2 / $10: 0.02 + 0.02.
  assert.equal(costUsd('claude-sonnet-5', { input_tokens: 10_000, output_tokens: 2_000 }), 0.04);
});

test('cache reads and writes are priced, not ignored', () => {
  const c = costUsd('claude-sonnet-5', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
  assert.equal(c, 2.5 + 0.2);
});

test('a dated snapshot prices as its alias', () => {
  assert.deepEqual(priceFor('claude-haiku-4-5-20251001'), MODEL_PRICES['claude-haiku-4-5']);
});

test('an unknown model is recorded unpriced, never guessed', () => {
  assert.equal(costUsd('claude-something-new', { input_tokens: 100, output_tokens: 100 }), null);
  const p = generationProps('claude-something-new', 'trips generate', { input_tokens: 100 });
  assert.equal(p.priced, false);
  assert.equal('cost_usd' in p, false);
});

test('every model the route names is in the price table', () => {
  for (const m of ROUTE.matchAll(/const (?:FAST|QUALITY)_MODEL = '([^']+)'/g)) {
    assert.ok(priceFor(m[1]), `${m[1]} has no price — its calls would all be unpriced`);
  }
});

test('the props survive scrubProps whole', () => {
  // A props key the scrub drops is a margin silently missing its AI half.
  const props = generationProps('claude-sonnet-5', 'trips itinerary',
    { input_tokens: 9000, output_tokens: 3100, cache_read_input_tokens: 0 },
    { attempt: 'briefer', stop: 'end_turn', max_tokens: 24000 });
  assert.deepEqual(scrubProps(props), props);
  assert.equal(props.stage, 'itinerary');
  assert.equal(typeof props.cost_usd, 'number');
});

test('the label says which stage', () => {
  assert.equal(stageOf('trips generate'), 'options');
  assert.equal(stageOf('trips generate away retry'), 'options');
  assert.equal(stageOf('trips itinerary'), 'itinerary');
  assert.equal(stageOf('trips slot'), 'slot');
});

test('a meter that cannot write never reaches the itinerary it costs', () => {
  const exploding = { from: () => { throw new Error('boom'); } } as never;
  const meter = aiMeter(exploding, { userId: 'u', groupId: 'g', planId: null });
  assert.doesNotThrow(() => meter({ usage: { input_tokens: 1, output_tokens: 1 } }, 'claude-haiku-4-5', 'trips generate', 'first', 16000));
  assert.doesNotThrow(() => meter(null, 'claude-haiku-4-5', 'trips generate', 'first', 16000));
});

test('the meter writes an ai_generation row against the plan it was given', async () => {
  const rows: Record<string, unknown>[] = [];
  const db = { from: () => ({ insert: (r: Record<string, unknown>) => { rows.push(r); return Promise.resolve({ error: null }); } }) } as never;
  aiMeter(db, { userId: 'u1', groupId: 'g1', planId: 'p1' })(
    { usage: { input_tokens: 1000, output_tokens: 500 }, stop_reason: 'end_turn' }, 'claude-haiku-4-5', 'trips generate', 'first', 16000);
  await new Promise(r => setImmediate(r));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'ai_generation');
  assert.equal(rows[0].plan_id, 'p1');
  assert.equal((rows[0].props as Record<string, unknown>).model, 'claude-haiku-4-5');
});

// ── The route ─────────────────────────────────────────────────────────

test('every model call in the route goes through the metered wrapper', () => {
  // One messages.create, inside withSchemaFallback, and it meters.
  assert.equal(ROUTE.match(/messages\.create\(/g)?.length, 1);
  assert.match(ROUTE, /meter\?\.\(res, model, label, attempt, tokens\)/);
  const calls = [...ROUTE.matchAll(/await withSchemaFallback\(([\s\S]*?)\)(?:;|\.catch)/g)];
  assert.equal(calls.length, 5, 'slot, itinerary, options and its two retries');
  for (const c of calls) assert.match(c[1], /\bmeter\b/, `a call is not metered: ${c[1].slice(0, 80)}`);
});

test('options take the small model and the itinerary the large one, each with a hard cap', () => {
  // C2: small for the three options, large only for the final itinerary.
  assert.match(ROUTE, /const FAST_MODEL = 'claude-haiku-4-5'/);
  const calls = [...ROUTE.matchAll(/await withSchemaFallback\(([\s\S]*?)\)(?:;|\.catch)/g)].map(c => c[1]);
  const options = calls.filter(c => /'trips generate/.test(c));
  const large = calls.filter(c => /'trips (itinerary|slot)'/.test(c));
  assert.equal(options.length, 3);
  for (const c of options) assert.match(c, /client, FAST_MODEL, \d+,/);
  assert.equal(large.length, 2);
  for (const c of large) assert.match(c, /client, QUALITY_MODEL, \d+,/);
});

test('the itinerary parse sits inside a try', () => {
  const at = ROUTE.indexOf("parseModelJSON(textOf(res), ItinerarySchema, 'trips itinerary')");
  assert.ok(at > 0);
  const before = ROUTE.slice(0, at);
  assert.ok(before.lastIndexOf('try {') > before.lastIndexOf('} catch'), 'the itinerary parse is not inside a try block');
});
