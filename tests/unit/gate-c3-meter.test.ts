// Run with: npm run test:unit
// Directive C3: every model call is cost-logged — the shared JSON helper, the
// knowledge cron, the harvester and the recommendations route, not only generate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { askForJSON } from '../../lib/anthropic.ts';

test('askForJSON meters every billed attempt, the briefer retry included', async () => {
  const seen: string[] = [];
  let n = 0;
  const client = { messages: { create: async () => ({ stop_reason: n++ === 0 ? 'max_tokens' : 'end_turn', usage: { input_tokens: 10, output_tokens: 20 }, content: [] }) } } as never;
  await askForJSON({ client, model: 'claude-haiku-4-5', maxTokens: 100, prompt: 'p', schema: {}, label: 't', meter: (_r, _m, _l, attempt) => { seen.push(attempt); } });
  assert.deepEqual(seen, ['first', 'briefer']);
});

test('the other model callers pass a meter', () => {
  assert.match(readFileSync('app/api/cron/knowledge/route.ts', 'utf8'), /meter: aiMeter\(db, \{\}\)/);
  assert.match(readFileSync('app/api/discovery/harvest/route.ts', 'utf8'), /harvestVenue\([^)]*\}, aiMeter\(db, \{\}\)\)/);
  assert.match(readFileSync('lib/discovery/harvest.ts', 'utf8'), /meter\?\.\(res as never, 'claude-haiku-4-5', 'harvest'/);
  assert.match(readFileSync('app/api/recommendations/route.ts', 'utf8'), /aiMeter\(ctx\.db, \{ userId: ctx\.user\.id \}\)\(res as never, MODEL, 'recommendations'/);
});

test('a plan with nothing paid through Reach asks nobody for a share on participation or savings', () => {
  for (const f of ['app/api/plans/[planId]/participation/route.ts', 'app/api/plans/[planId]/savings/route.ts']) {
    assert.match(readFileSync(f, 'utf8'), /guessBudgetCents\(fundingTarget\(/, f);
  }
});
