import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanSteps, RENDERED } from '../../lib/create-plan-steps.ts';

for (const kind of ['restaurant', 'concert', 'weekend', 'trip']) {
  test(`a ${kind} ends on the budget, and every step has a screen`, () => {
    const steps = createPlanSteps(kind);
    assert.equal(steps[steps.length - 1], 'Budget');
    for (const s of steps) assert.ok(RENDERED.has(s), `${kind}: no screen for "${s}"`);
  });
}
test('only a stay-length plan asks where to stay', () => {
  assert.ok(!createPlanSteps('restaurant').includes('Stay'));
  assert.ok(!createPlanSteps('concert').includes('Stay'));
});
