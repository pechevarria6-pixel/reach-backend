#!/usr/bin/env node
// ─── Words that are ours, not theirs ────────────────────────────────────
// "concierge lane", "funding gate", "quote drift" are how this codebase
// talks about itself. They reached the app: checkout printed "+ concierge
// items priced after confirmation" under somebody's total, which is the same
// class of bug as printing the raw enum "restaurant" as a dinner's name.
//
// This reads string literals only. A comment may say concierge all it likes;
// a string a person can read may not.
import fs from 'fs';
import path from 'path';

const BANNED = [
  'concierge', 'funding gate', 'quote drift', 'fulfillment mode',
  'vertical', 'awaiting_approval', 'no_key', 'provider_error',
];

// Lines that are plainly machinery rather than anything a person reads: a
// log, a database column list, a key built for comparison.
const MACHINERY = /console\.|\.select\(|\.eq\(|\.in\(|\.order\(|import\s|require\(/;
// And strings that are shaped like data: comma-separated column lists, or a
// key joined with pipes.
const DATA_SHAPED = /^[a-z_, ]+$|\|/;

const files = [];
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next|test-results/.test(p)) walk(p); }
    else if (/\.(tsx?|jsx)$/.test(e.name)) files.push(p);
  }
};
walk('components'); walk('app'); walk('lib');

let found = 0;
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    // A block comment is a comment too. This only stripped `//`, so a comment
    // explaining the very rule it enforces tripped it — which is a checker
    // that is wrong about itself.
    const trimmed = code.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (MACHINERY.test(code)) return;
    // Only sentences: several words, in quotes, that a person could read.
    const strings = code.match(/["'`][^"'`]{12,}["'`]/g) || [];
    for (const raw of strings) {
      const text = raw.slice(1, -1);
      if (!/\s/.test(text)) continue;
      if (DATA_SHAPED.test(text)) continue;
      for (const word of BANNED) {
        if (text.toLowerCase().includes(word)) {
          console.log(`  ${f}:${i + 1}  ${text.slice(0, 68)}`);
          found++;
        }
      }
    }
  });
}

if (found) {
  console.log(`\n  \u2717 ${found} internal word(s) in copy a person can read\n`);
  process.exit(1);
}
console.log(`\n  \u2713 no internal vocabulary in user-facing copy (${files.length} files)\n`);
