// ─── check:solo-copy ──────────────────────────────────────────────────────
// Finds copy that makes a claim about other people, on a screen a person
// travelling alone can reach.
//
// CLAUDE.md's common-sense check says: "Solo trip gets singular copy ('You're
// all set'), never group copy ('Everyone's in')." That rule had nothing
// enforcing it, and the first scan found the exact sentence it names —
// the home screen's ready-to-book card read "Everyone's in — let's see what
// we can get booked" for a trip somebody was taking on their own.
//
// The tell was that `solo()` was defined four lines above it and used by the
// action directly below it. The app held the fact; one call site dropped it.
//
// ── What this looks for, and what it deliberately does not ──
//
// Only a CLAIM ABOUT OTHER PEOPLE — a sentence that is false when there are
// none. "Everyone has voted" is one. "Deletes the group for everyone" is not:
// that describes the scope of an action, on a screen about a group, and a
// guard that flagged it would cry wolf 46 times and be switched off. The
// first pass did exactly that; this is the narrowed version.
//
// ── Solo-awareness is usually one variable away ──
//
// The plan screen's "Waiting on the group" button looked unguarded and is
// not: it is gated on `votingOpen`, and `votingOpen` is
//
//   const votingOpen = !prefs || prefs.solo || prefs.allReady;
//
// so a check that only read the condition itself reported a false positive on
// correct code. It resolves local variables two hops before complaining.
import fs from 'node:fs';
import ts from 'typescript';

/**
 * Code only, comments stripped.
 *
 * Strings are left alone deliberately: a string is not a guard, and stripping
 * quotes would be a second way to be wrong.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'api') continue;
      out.push(...walkFiles(full));
    } else if (/\.(tsx|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = [...walkFiles('app'), ...walkFiles('components')]
  .filter((f, i, a) => a.indexOf(f) === i).sort();

/** Sentences that assert something about people other than the reader. */
const CLAIMS_ABOUT_OTHERS = [
  /\beveryone('s| is| has| have)?\s+(in|voted|paid|said|chipped|answered|made it)\b/i,
  /\bwaiting (on|for) (the |everyone|the rest|others|somebody)/i,
  /\bthe rest of (the group|them|you)\b/i,
  /\ba few people still\b/i,
  /\beveryone can make it\b/i,
  /\bcollect everyone's\b/i,
  /\beveryone has already\b/i,
];

/** Anything that means the code knows how many people are involved. */
const KNOWS_HOW_MANY = /isSolo|isSoloGroup|isAlone|soloMode|solo_mode|\bsolo\b|memberIds|memberCount|travelers\.length|members\.length|\balone\b|\bheads\b/;

// Reviewed and correct: each of these is on a screen a solo plan cannot
// reach, and the reason is what makes the entry allowed, not the line number.
// A new claim gets reviewed the same way or made solo-aware — it does not get
// added here to make the check quiet.
const REVIEWED = [
  {
    match: /Everyone has voted|have voted\. The trip is waiting on the rest|Collect everyone's share/,
    why: 'voting screens. A group of one gets the same flow with the voting UI absent and enable_voting false (reach-app.jsx, "Solo mode is first-class"), so no solo plan ever reaches a vote.',
  },
  {
    match: /Waiting for the group/,
    why: 'the awaiting_approval label in BOOKING_STATE, a lookup table with no access to the plan. Solo plans no longer enter that queue: /api/bookings sets executeNow for a group of one, after a solo trip was told it was waiting on others who did not exist.',
  },
  {
    match: /A few people still need to chip in|Everyone has already paid/,
    why: 'the funding flow. A solo plan\'s share is the whole target, so paying it funds the plan outright and the waiting phase is unreachable; the reminder toast needs somebody to remind.',
  },
];

let checked = 0;
const problems = [];

for (const file of FILES) {
  const source = ts.createSourceFile(
    file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  );

  // name -> what it was assigned, so a condition one hop from solo counts.
  const assigned = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      assigned.set(node.name.text, node.initializer.getText());
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const soloAware = (expression, hop = 0) => {
    if (!expression) return false;
    // Comments first, always. `getText()` hands back the comments attached to
    // a node, and this check went green on the very bug it was written for
    // because the comment above that line explains that the fix is
    // solo-aware — the guard read its own documentation as proof the code
    // was correct. A guard that goes wrong quietly is worse than no guard.
    const code = withoutComments(expression);
    if (KNOWS_HOW_MANY.test(code)) return true;
    if (hop >= 2) return false;
    // Three characters and up. This resolved `p` — an arrow-function
    // parameter — against an unrelated file-global `const p` that happened to
    // mention memberIds, and pronounced the home screen's "Everyone's in"
    // correctly guarded when it was the bug this file was written for. There
    // is no scope analysis here, so short names are collisions waiting to
    // happen and are not worth the one real case they might catch.
    for (const name of code.match(/[A-Za-z_$][\w$]{2,}/g) ?? []) {
      if (assigned.has(name) && soloAware(assigned.get(name), hop + 1)) return true;
    }
    return false;
  };

  const visit = (node) => {
    const isCopy = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isJsxText(node) || ts.isTemplateExpression(node);
    if (isCopy) {
      const text = (node.getText?.() ?? node.text ?? '').trim();
      if (text && CLAIMS_ABOUT_OTHERS.some(r => r.test(text))) {
        checked++;
        let parent = node.parent, guarded = false, depth = 0;
        while (parent && depth++ < 14) {
          if (ts.isConditionalExpression(parent) && soloAware(parent.condition.getText())) { guarded = true; break; }
          if (ts.isBinaryExpression(parent) && /&&|\|\|/.test(parent.operatorToken.getText())
              && soloAware(parent.left.getText())) { guarded = true; break; }
          if (ts.isIfStatement(parent) && soloAware(parent.expression.getText())) { guarded = true; break; }
          // A call, checked on its own text and never through an identifier.
          // This is how `.filter(p => … && !solo(p.group))` guards the row it
          // builds — a real pattern two lines below the bug that prompted all
          // this. Resolving identifiers here was what let an arrow parameter
          // named `p` collide with an unrelated global and wave the bug
          // through, so this branch reads the code in front of it and nothing
          // else.
          if (ts.isCallExpression(parent)
              && KNOWS_HOW_MANY.test(withoutComments(parent.getText().slice(0, 400)))) { guarded = true; break; }
          parent = parent.parent;
        }
        if (!guarded && !REVIEWED.some(r => r.match.test(text))) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          problems.push({ file, line: line + 1, text: text.slice(0, 90).replace(/\s+/g, ' ') });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length) {
  console.error('\n  ✗ copy that speaks for other people, where there may be none\n');
  for (const p of problems) {
    console.error(`    ${p.file}:${p.line}`);
    console.error(`      ${p.text}\n`);
  }
  console.error('  Branch on whether anybody else is on this plan, the way the');
  console.error('  ready-to-book card on the home screen does:\n');
  console.error('    sub: solo(p.group)');
  console.error('      ? "You\'re all set — let\'s see what we can get booked"');
  console.error('      : "Everyone\'s in — let\'s see what we can get booked"\n');
  console.error('  If the screen genuinely cannot be reached alone, add it to');
  console.error('  REVIEWED in this file with the reason why — the reason is');
  console.error('  what makes it allowed, not the fact that it is listed.\n');
  process.exit(1);
}

console.log(`  ✓ nothing speaks for people who may not be there (${checked} checked)`);
