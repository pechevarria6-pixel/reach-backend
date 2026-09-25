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

// The first JSX scan read only a brace-free run of text on one line, so the
// two usual shapes of settle-up copy — a value interpolated into the
// sentence, and a sentence on its own line between tags — both walked past.
test('money words fire in JSX text that interpolates a value or sits on its own line', () => {
  for (const src of [
    'export const B = ({ amt }) => <p>Your payout of {amt} is on its way</p>;\n',
    'export const B = ({ amt, name }) => <p>Reach transfers {amt} to {name}</p>;\n',
    'export const B = () => (\n  <p>\n    Reach transfers the money to Sam\n  </p>\n);\n',
    'export const B = ({ amt }) => (\n  <p className="x">\n    Your {fmt({ amt })} payout\n    is on its way\n  </p>\n);\n',
  ]) {
    const r = run(src);
    assert.equal(r.code, 1, src + r.out);
  }
  const r = run('export const B = () => (\n  <p>\n    Reach transfers the money to Sam\n  </p>\n);\n');
  assert.match(r.out, /planted\.tsx:3\s+"transfer"/, 'reported on the line the copy is on');
});

test('code between a > and a < is not JSX text', () => {
  const r = run([
    'export const B = ({ transfers, n }) => (',
    '  <div>{n > 0 ? transfers.map(t => <Row key={t.id} t={t} />) : null}</div>',
    ');',
    'export const C = ({ a, transfers }) => a > transfers.length && <p>Settled</p>;',
    'const x = new Map<string, Transfer>();',
    'export const D = () => <p>{"Hi there, friend"}</p>;',
  ].join('\n') + '\n');
  assert.equal(r.code, 0, r.out);
});

test('a quoted money word inside JSX braces is reported once, not twice', () => {
  const r = run('export const B = () => <p>{"Your payout arrives Friday"}</p>;\n');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ 1 internal/);
});
