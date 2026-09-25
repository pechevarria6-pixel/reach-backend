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
  // Nothing in Reach follows anything up or sorts anything out by itself:
  // there is an inbox, and a person who writes to it. Moab's travellers were
  // told "we'll follow up" over $1,474 and nothing did, because nothing knew.
  "we'll follow up",
  'we will follow up',
  "we'll sort it",
  "we'll sort this",
  // Said of flights Reach hands to the airline, which Reach does not book at all.
  'will be booked directly',
  // A price nobody has read. Walk-up prices are the venue's to say.
  'price at the door',
  // An absolute nobody checked about somebody else's policy.
  'never holds',
  // The quiz's pitch, on Home and on the public share page. The reveal names
  // nothing where we hold no venues ("We're still mapping …"), and the share
  // page is read by exactly the people most likely to live somewhere unswept.
  'then real places near you',
  // The Scout's quiz answers and dial. A place is only named here when it has
  // its own website, so food trucks never appear, and nothing we hold says
  // when a place opened. Both were promised on screen 4 and on the reveal.
  'food truck',
  'opened last month',
  'new openings',
  // Reach holds no climate data, so nothing checks the weather (lib/weather-
  // no-go.ts). "We can't check weather yet." is the only thing said about it;
  // these are the ways copy could claim otherwise.
  'checked the weather',
  'checks the weather',
  'weather checked',
  'weather-checked',
  'avoids the cold',
  'avoided the cold',
  'away from the cold',
];

/**
 * Fake science. Personality quizzes sell themselves with a number — "94%
 * accurate", "40 years of research" — and Reach's quiz is six taps and a
 * lookup table (lib/traveler-profile.ts). The spec for quiz v3 rules these
 * out by name: no claim of accuracy, anywhere. Checked like a broken
 * promise, in JSX text as well as strings, because that is what they are.
 */
const FAKE_SCIENCE = [
  '94%',
  '% accuracy',
  '% accurate',
  'scientifically proven',
  'science-backed',
  '40 years of research',
];

/**
 * Words that say Reach moves money. It does not: settle-up works out who owes
 * whom and opens the payer's own Venmo or Cash App (lib/settle-links.ts), and
 * the payment happens there, between two people. "Transfer" and "payout" are
 * what a money business says about money it holds — the checkout spec rules
 * both out by name, because copy that implies custody is a claim about the
 * product, and a false one.
 *
 * Travel has its own "transfer" — the ride from the airport — and that one is
 * copy we mean ("Airport transfers" is a fixed-cost line). Those phrases are
 * taken out before the money words are looked for, so the ride is allowed and
 * the money is not.
 */
const MONEY_WORDS = ['transfer', 'payout'];
const TRAVEL_TRANSFER = /\b(?:airport|hotel|station|port|ferry|shuttle|ground|private|shared)[ -]transfers?\b|\btransfers? (?:to|from|between) (?:the |your )?(?:airport|hotel|station|port|terminal)s?\b/g;

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

/**
 * Money words in JSX text — "Reach transfers it to Sam" between two tags
 * opens no quote. Read across the whole file, not line by line, and with
 * every `{…}` taken out first: the first version only saw a brace-free run
 * of text on one line, so "Your payout of {amt} is on its way" and copy
 * sitting on its own line between tags — the two usual shapes of settle-up
 * copy — both walked past it.
 *
 * Only text between a tag's `>` and the next `<`, and only when what is left
 * reads as prose: the same word as a type or a variable (settleUp returns
 * Transfer[]) is machinery, not copy. An arrow's `=>` is not a tag.
 */
function jsxMoney(f, source, stringHits) {
  for (const m of source.matchAll(/(?<![=\-])>([^<>]*)</g)) {
    let text = m[1];
    for (let prev; prev !== text;) { prev = text; text = text.replace(/\{[^{}]*\}/g, ' '); }
    if (!/[A-Za-z]/.test(text)) continue;
    // Code, not copy: an unbalanced brace, an operator, a call, a property.
    if (/[{}=;()\[\]]|&&|\|\||\s\?\s|\w\.\w/.test(text)) continue;
    // The line the words are on, not the line the tag closed on.
    const line = source.slice(0, m.index + 1 + m[1].search(/\S/)).split('\n').length;
    const money = text.toLowerCase().replace(/\s+/g, ' ').replace(TRAVEL_TRANSFER, ' ');
    for (const word of MONEY_WORDS) {
      if (!money.includes(word)) continue;
      // Already reported as a quoted string on the line where the text starts.
      if (stringHits.get(line)?.has(word)) continue;
      console.log(`  ${f}:${line}  "${word}" in: ${text.replace(/\s+/g, ' ').trim().slice(0, 68)}`);
      found++;
    }
  }
}

for (const f of files) {
  const stringHits = new Map();
  // Block comments removed whole, before anything is read line by line.
  //
  // Stripping `//` and lines beginning `*` or `/*` missed a JSX comment —
  // `{/* … */}` — and every continuation line inside one. Two of the three
  // hits on the first honest run were comments explaining why a banned
  // phrase had been removed, which is a checker tripping over its own
  // paperwork. Newlines are kept so the line numbers it reports stay true.
  const source = fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  source.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    // A block comment is a comment too. This only stripped `//`, so a comment
    // explaining the very rule it enforces tripped it — which is a checker
    // that is wrong about itself.
    const trimmed = code.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (MACHINERY.test(code)) return;
    // Only sentences: several words, in quotes, that a person could read.
    //
    // The content class excludes only the SAME quote that opened the string.
    // It used to exclude all three, so any sentence containing an apostrophe
    // was invisible — which in English user-facing copy is most of them.
    // "We're on it" sat in BOOKING_STATE, on the banned list, on screen, and
    // green on every run: eleven characters and an apostrophe, and the check
    // could see neither.
    //
    // Eight characters rather than twelve for the same reason. "We're on it"
    // is eleven and is a promise the app cannot keep.
    const strings = [...code.matchAll(/(["'`])((?:(?!\1).){8,})\1/g)];
    const inStrings = new Set();
    stringHits.set(i + 1, inStrings);
    for (const match of strings) {
      const text = match[2];
      if (!/\s/.test(text)) continue;
      if (DATA_SHAPED.test(text)) continue;
      for (const word of [...BANNED, ...BROKEN_PROMISES, ...FAKE_SCIENCE]) {
        if (text.toLowerCase().includes(word)) {
          console.log(`  ${f}:${i + 1}  "${word}" in: ${text.slice(0, 68)}`);
          found++;
          inStrings.add(word);
        }
      }
      const money = text.toLowerCase().replace(TRAVEL_TRANSFER, ' ');
      for (const word of MONEY_WORDS) {
        if (money.includes(word)) {
          console.log(`  ${f}:${i + 1}  "${word}" in: ${text.slice(0, 68)}`);
          found++;
          inStrings.add(word);
        }
      }
    }
    // A promise is a promise wherever it is written: in JSX text between
    // tags, or on the continuation line of an email's template string, where
    // no quote opens and closes on the line. "Reach never holds your money"
    // sat in the terms page and the receipt email, both read by the person
    // whose money it was, and the quoted-string scan saw neither. Entities
    // are read as the characters they draw.
    const plain = code.toLowerCase().replace(/&rsquo;|&#39;|&apos;/g, "'").replace(/[\u2018\u2019]/g, "'");
    for (const word of [...BROKEN_PROMISES, ...FAKE_SCIENCE]) {
      if (!inStrings.has(word) && plain.includes(word)) {
        console.log(`  ${f}:${i + 1}  "${word}" in: ${code.trim().slice(0, 68)}`);
        found++;
      }
    }
  });
  if (/\.(tsx|jsx)$/.test(f)) jsxMoney(f, source, stringHits);
}

if (found) {
  console.log(`\n  \u2717 ${found} internal word(s) in copy a person can read\n`);
  process.exit(1);
}
console.log(`\n  \u2713 no internal vocabulary in user-facing copy (${files.length} files)\n`);
