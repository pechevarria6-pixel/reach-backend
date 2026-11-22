#!/usr/bin/env node
// ─── No new raw colours (REACH-DESTINATION-DIVERSITY-2026-11-22, Part B) ──
// Every colour should come from the tokens: PALETTE in components/reach-app.jsx
// (dark and light), lib/brand.ts, components/pilot/tokens.js. On 2026-11-22
// about 150 raw hex colours sat outside them, across the app and the public
// pages. Converting them all at once is a visual change on every screen; this
// is the ratchet that stops the number growing while they are converted.
//
// It fails when a file holds MORE raw hex colours than its baseline in
// scripts/raw-hex-baseline.json, and says by how much. When a file goes down,
// run `node scripts/check-raw-hex.mjs --write` to lower its baseline, so the
// count can never creep back. The goal is an empty baseline.
//
// Not counted: the token definitions themselves, comments, and email HTML
// (lib/email.ts), which mail clients render without CSS variables.
import fs from 'fs';
import path from 'path';

const BASELINE = 'scripts/raw-hex-baseline.json';
const TOKEN_FILES = new Set(['lib/brand.ts', 'components/pilot/tokens.js', 'lib/email.ts']);
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g;

const files = [];
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); }
    else if (/\.(tsx|jsx|ts|js|css)$/.test(e.name)) files.push(p);
  }
};
walk('components'); walk('app');

function count(file) {
  if (TOKEN_FILES.has(file)) return 0;
  let src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // The palette and the token list in the app are the tokens.
  if (file === 'components/reach-app.jsx') {
    const start = src.indexOf('const PALETTE = {');
    const end = start >= 0 ? src.indexOf('\n};', start) : -1;
    if (start >= 0 && end > start) src = src.slice(0, start) + src.slice(end + 3);
  }
  return (src.match(HEX) || []).length;
}

const now = Object.fromEntries(files.map(f => [f, count(f)]).filter(([, n]) => n > 0).sort());
if (process.argv.includes('--write')) {
  fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  console.log(`  wrote ${BASELINE}: ${Object.values(now).reduce((a, b) => a + b, 0)} raw hex colours in ${Object.keys(now).length} files`);
  process.exit(0);
}
const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
let bad = 0;
for (const [f, n] of Object.entries(now)) {
  const allowed = base[f] ?? 0;
  if (n > allowed) { console.log(`  ${f}: ${n} raw hex colours, baseline ${allowed} — use a token (C.*, BRAND) instead`); bad++; }
}
const total = Object.values(now).reduce((a, b) => a + b, 0);
const was = Object.values(base).reduce((a, b) => a + b, 0);
if (bad) { console.log(`\n  ${bad} file(s) gained raw colours`); process.exit(1); }
console.log(`  ✓ no new raw colours (${total} left to convert${total < was ? `; ${was - total} fewer than the baseline — run with --write to lock that in` : ''})`);
