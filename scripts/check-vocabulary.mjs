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
  // How the background jobs talk about what they write down: a "playbook"
  // for an "archetype", the whole "knowledge layer", the "enrichment" run
  // that fills it, a group's "taste profile" and the "distillation" that
  // produces one. Users only ever see the result — a better trip — and none
  // of these words describes anything they asked for. The same trap as
  // "concierge items": machinery that reads like copy.
  'playbook', 'archetype', 'enrichment', 'knowledge layer',
  'taste profile', 'distillation',
];

/**
 * Promises this app has made and could not keep.
 *
 * Not jargon — these read perfectly well, which is exactly why they shipped.
 * Each was on a screen today, and each said Reach was doing something Reach
 * does not do:
 *
 *   "Someone at Reach confirms it with the venue"  — nobody does. There is
 *      no confirmation path in this codebase; the request is written as a
 *      pending row and sits there.
 *   "We're on it"  — Reach is not on it. It was saved, which is a different
 *      claim and a true one.
 *   "Reach will book this" over a table — the member books their own, on
 *      their own card, where their dining benefits live. This was removed
 *      and then reintroduced by a fix to something else, which is precisely
 *      why it belongs in a guard rather than in anybody's memory.
 *
 * A phrase here is banned as a phrase. If the product ever genuinely does
 * one of these, the line comes out of this list in the same commit that
 * makes it true.
 */
const BROKEN_PROMISES = [
  'someone at reach confirms',
  "we're on it",
  'we are on it',
  'reach will confirm',
  'reach will call',
  'we will call the venue',
];

/** Values that are never copy, wherever they turn up in a rendered string. */
const NEVER_RENDERED = ['undefined', 'NaN', '[object Object]'];

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
      for (const word of [...BANNED, ...BROKEN_PROMISES]) {
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
