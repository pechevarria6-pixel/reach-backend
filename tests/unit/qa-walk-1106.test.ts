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

test('an empty Groups tab has one way to start, not "+ New" beside "Start planning"', () => {
  assert.match(app, /\{\(loading\|\|groups\.length>0\)&&<button className="bsm bsm-p" onClick=\{\(\)=>push\("createGroup"\)\}>\+ New<\/button>\}/);
  assert.match(app, />Nothing planned yet</);
  assert.doesNotMatch(app, />No groups yet</);
});

test('a trip card credits its photo on one line, over a scrim', () => {
  const at = app.indexOf('title={`Photo: ${p.photo.credit}`}');
  assert.ok(at > 0);
  assert.match(app.slice(at, at + 500), /whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"/);
});

test('"Sort one evening" opens a fresh plan that remembers it is an evening', () => {
  assert.match(app, /cta:"Sort one evening →",action:\(\)=>push\("createPlan",\{fresh:true,evening:true\}\)/);
  assert.match(app, /const \[allKinds,setAllKinds\]=useState\(!evening\);/);
  assert.match(app, /\.filter\(t=>allKinds\|\|t\.id===planType\|\|t\.id==="restaurant"\|\|t\.id==="concert"\)/);
  assert.match(app, /Planning something bigger\? A trip or a weekend →/);
});

test('with nobody to pick, the first plan screen still offers friends, by starting a group', () => {
  assert.match(app, /\{withOthers\.length===0&&\(\s*\n\s*<div \{\.\.\.pressable\} onClick=\{\(\)=>push\("createGroup"\)\}/);
  assert.match(app, />With friends</);
  assert.doesNotMatch(app, /Select a group and what you're planning\./);
});
