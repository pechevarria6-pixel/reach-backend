import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAllocation } from '../../lib/playbooks.ts';

test('percentages become fractions', () => {
  // The bachelor_party row from the first real run. Same meaning as the
  // others, a hundred times the number.
  assert.deepEqual(
    normaliseAllocation({ food: 20, stay: 30, transport: 20, activities: 30 }),
    { stay: 0.3, food: 0.2, activities: 0.3, transport: 0.2 });
});

test('fractions are left alone', () => {
  const frac = { stay: 0.35, food: 0.2, activities: 0.3, transport: 0.15 };
  assert.deepEqual(normaliseAllocation(frac), frac);
});

test('a little rounding is tolerated on both scales', () => {
  assert.ok(normaliseAllocation({ stay: 0.34, food: 0.2, activities: 0.3, transport: 0.14 }));
  assert.ok(normaliseAllocation({ stay: 34, food: 20, activities: 30, transport: 14 }));
});

test('weights that mean nothing are refused, not guessed at', () => {
  // Sums to neither one nor a hundred. Scaling it would invent a meaning.
  assert.equal(normaliseAllocation({ stay: 5, food: 3, activities: 2, transport: 1 }), null);
  assert.equal(normaliseAllocation({ stay: 0, food: 0, activities: 0, transport: 0 }), null);
  assert.equal(normaliseAllocation({ stay: -0.5, food: 0.5, activities: 0.5, transport: 0.5 }), null);
  assert.equal(normaliseAllocation(null), null);
});
