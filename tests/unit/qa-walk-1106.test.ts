// Run with: npm run test:unit
// 2026-11-06: what the production logs and the e2e failure screenshot showed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('components/reach-app.jsx', 'utf8');

test('Discover never waits on a hung request: twelve seconds, then one more ask', () => {
  const at = app.indexOf('const loadLocalRecs=async()=>{');
  assert.ok(at > 0);
  const body = app.slice(at, at + 2500);
  assert.match(body, /const ask=async\(ms\)=>\{/);
  assert.match(body, /try\{res=await ask\(12000\);\}/);
  assert.match(body, /res=await ask\(20000\);/);
  assert.doesNotMatch(body, /const res=await fetch\(url\);/, 'a bare fetch waits as long as the server does');
});
