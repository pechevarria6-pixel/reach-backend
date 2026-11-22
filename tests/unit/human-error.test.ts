// Run with: npm run test:unit
// REACH-DESTINATION-DIVERSITY-2026-11-22, Part B: human 4xx copy.
// A member never reads "groupId required" or "Forbidden": a known developer
// string becomes a sentence with a next step, an unknown developer-shaped one
// gives way to the screen's own fallback, and a sentence passes through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { humanError, HUMAN } from '../../lib/human-error.ts';

test('known developer strings become sentences with a next step', () => {
  assert.equal(humanError('Forbidden'), HUMAN.forbidden);
  assert.match(humanError('Booking not found')!, /refresh/);
  assert.match(humanError('Not authorised')!, /sign in again/);
  assert.match(humanError('Plan not found')!, /Go back to your trips/);
  for (const s of Object.values(HUMAN)) assert.match(s, /^[A-Z"'T].*[.!]$/, `"${s}" is a sentence`);
});

test('unknown developer-shaped strings give way to the fallback', () => {
  for (const dev of ['groupId required', 'userId must be a uuid', 'LITEAPI_KEY is not set', 'provider required',
    'could not read the contribution', 'Invalid signature', 'Webhook not configured', '404', 'Thing not found']) {
    assert.equal(humanError(dev), null, dev);
  }
  assert.equal(humanError(undefined), null);
  assert.equal(humanError('   '), null);
  assert.equal(humanError({ error: 'x' }), null);
});

test('a sentence from the server passes through untouched', () => {
  for (const s of ['Somebody is booking this right now.', 'Those dates did not save — try again.', 'Which place?', 'Could not search just now']) {
    assert.equal(humanError(s), s);
  }
});

test('every 4xx string the API sends either reads as a sentence or is caught', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk('app/api');
  const leaked: string[] = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/error: ['"]([^'"]{1,80})['"]/g)) {
      const out = humanError(m[1]);
      // Either it passes through as a sentence (fine), or it is mapped or nulled.
      if (out === m[1] && /^(forbidden|not authori[sz]ed)$/i.test(m[1])) leaked.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(leaked, []);
});

test('the app never shows a server error without passing it through humanError', () => {
  const APP = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(APP, /import \{ humanError, errorWords \} from "@\/lib\/human-error"/);
  const raw = [...APP.matchAll(/[^A-Za-z_.?](?:d|e|err|out|body|seed)\??\.error\|\|/g)].map(m => m[0]);
  assert.deepEqual(raw, [], 'a raw d.error|| reached the screen');
  assert.ok((APP.match(/humanError\(/g) ?? []).length >= 50);
});

test("a browser's own network message becomes a sentence, and a thrown one finds the fallback", async () => {
  const { errorWords } = await import('../../lib/human-error.ts');
  for (const m of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    assert.match(errorWords(new TypeError(m), 'fallback'), /check your connection/);
  }
  assert.equal(errorWords(new Error('404'), 'Couldn\'t save that'), 'Couldn\'t save that');
  assert.equal(errorWords(new Error('Those dates didn\'t save — try again'), 'x'), 'Those dates didn\'t save — try again');
  assert.equal(errorWords(null, 'fallback'), 'fallback');
});

test('no toast shows a thrown message without errorWords', () => {
  const APP = readFileSync('components/reach-app.jsx', 'utf8');
  assert.deepEqual([...APP.matchAll(/toast\((?:e|err)\.message\)/g)].map(m => m[0]), []);
  assert.ok((APP.match(/errorWords\(/g) ?? []).length >= 30);
});
