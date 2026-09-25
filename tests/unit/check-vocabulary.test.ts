// Run with: npm run test:unit
//
// The vocabulary guard, run against a planted tree so the plant stays planted.
// A guard that has never failed has not been tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-vocabulary.mjs', import.meta.url));

function run(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'vocab-'));
  try {
    for (const d of ['components', 'app', 'lib']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'components', 'planted.tsx'), source);
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('"transfer" said of money fires', () => {
  const r = run('export const a = "Reach will transfer your share to Sam";\n');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /"transfer"/);
});

test('"payout" fires in a string and in JSX text between tags', () => {
  assert.equal(run('export const a = "Your payout arrives Friday";\n').code, 1);
  const jsx = run('export const B = () => <p>We send the payout to Sam</p>;\n');
  assert.equal(jsx.code, 1, jsx.out);
  assert.match(jsx.out, /"payout"/);
});

test('the ride from the airport is still a transfer', () => {
  const r = run([
    'export const a = "Airport transfers";',
    'export const b = "Transfer to the hotel by taxi";',
    'export const c = () => <p>Private transfer from the airport</p>;',
  ].join('\n') + '\n');
  assert.equal(r.code, 0, r.out);
});

test('the word as machinery is not copy', () => {
  const r = run([
    'type Transfer = { from: string; to: string };',
    'const transfers: Transfer[] = [];',
    '// A comment may say we transfer the money; a screen may not.',
  ].join('\n') + '\n');
  assert.equal(r.code, 0, r.out);
});
