// Run with: npm run test:unit
// Part B, consistent branding: the raw-colour ratchet is in the gate and its
// baseline only ever names files that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('check:raw-hex runs in verify, against a baseline of real files', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts.verify, /npm run check:raw-hex/);
  const base = JSON.parse(readFileSync('scripts/raw-hex-baseline.json', 'utf8')) as Record<string, number>;
  for (const [f, n] of Object.entries(base)) {
    assert.ok(existsSync(f), `${f} is in the baseline but no longer exists — rewrite it with --write`);
    assert.ok(Number.isInteger(n) && n > 0);
  }
  assert.ok(Object.values(base).reduce((a, b) => a + b, 0) <= 141, 'the baseline only goes down');
});
