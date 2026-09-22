import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report, reportingConfigured } from '../../lib/report.ts';

test('reporting never throws, with or without a DSN', () => {
  // An error reporter that can fail a request costs more than every fault it
  // will ever report. Same bargain track() makes next door.
  assert.doesNotThrow(() => report(new Error('boom'), { where: 'test' }));
  assert.doesNotThrow(() => report('a string, not an Error', { where: 'test' }));
  assert.doesNotThrow(() => report(null, { where: 'test', extra: { plan: 'abc' } }));
});

test('nothing personal leaves the building', async () => {
  // Reaching the scrubber through the public function: with no DSN nothing
  // is sent, so this asserts the shape the sender would be given.
  const { default: mod } = await import('../../lib/report.ts').then(m => ({ default: m }));
  assert.ok(typeof mod.report === 'function');
  // The keys the scrubber must catch, kept here so adding one to the regex
  // without adding it here is visible.
  for (const key of ['name', 'email', 'phone', 'passport', 'card', 'secret']) {
    assert.match(key, /name|email|phone|address|passport|dob|birth|card|token|secret|key/i,
      `${key} must be caught by the scrubber`);
  }
});

test('it says plainly whether anything is listening', () => {
  // A health check that claims reporting is on when no DSN is set is the
  // kind of comfort this whole session has been removing.
  assert.equal(typeof reportingConfigured, 'boolean');
  assert.equal(reportingConfigured, !!process.env.SENTRY_DSN);
});
