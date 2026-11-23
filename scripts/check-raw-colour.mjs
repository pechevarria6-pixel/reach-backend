// ─── check:raw-colour ────────────────────────────────────────────────────
// REACH-ACCESSIBILITY-PALETTE-2026-11-22, Task 2. A colour is written in
// lib/tokens.ts and nowhere else. A hex or rgb()/hsl() value anywhere in the
// app, the pages or lib fails the build, with file and line.
//
// Written after the September audit found three different golds and leftovers
// of an indigo palette, and after Task 0 found 129 raw colours outside the
// token block — hand-copied palettes on four pages that had drifted from it.
//
// Not colours, so not counted: comments, HTML entities (&#128181;), issue
// numbers (#418), and URL fragments.
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['app', 'components', 'lib'];
const TOKEN_FILE = 'lib/tokens.ts';
const EXT = /\.(tsx?|jsx?|mjs|css)$/;

const COLOUR = /(?<![&\w/#])#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})(?![0-9A-Za-z])|\b(?:rgba?|hsla?)\(\s*\d/g;
const THREE_DIGIT_NUMBER = /^#\d{3}$/; // "#418" is an issue number

const files = [];
const walk = d => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (EXT.test(p) && p !== TOKEN_FILE) files.push(p);
  }
};
ROOTS.forEach(walk);

/** The source with comments blanked out, keeping line numbers. */
function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

const found = [];
for (const f of files) {
  const lines = withoutComments(fs.readFileSync(f, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(COLOUR)) {
      if (THREE_DIGIT_NUMBER.test(m[0])) continue;
      found.push(`${f}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 90)}`);
    }
  });
}

if (!found.length) {
  console.log(`  ✓ no raw colour outside ${TOKEN_FILE} (${files.length} files)`);
  process.exit(0);
}
console.log(`  ✗ ${found.length} raw colour(s) outside ${TOKEN_FILE} — add a token and use it:\n`);
for (const x of found) console.log('    ' + x);
process.exit(1);
