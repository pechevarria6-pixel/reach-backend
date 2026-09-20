// ─── Tests that cannot fail ──────────────────────────────────────────────
// The suite was green for months with a test in it that asserted nothing
// about this app: it looked for `.card`, a class the screen has never used,
// and an empty match is not a failure in Playwright unless somebody asserts
// on it. It passed every run and covered nothing.
//
// That is worse than having no test. No test is an admitted gap; a green one
// is a claim that something was checked.
//
// Two checks, both narrow on purpose — a guard that cries wolf gets muted,
// and a muted guard is another thing that cannot fail:
//
//   1. A class selector in a test that appears nowhere in the app. Either
//      the screen changed and the test was left behind, or it never matched.
//   2. A test with no assertion in it at all.
//
//   node scripts/check-tests.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SOURCE_DIRS = ['components', 'app', 'lib'];
const TEST_FILES = [];

function walk(dir, into) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, into);
    else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(entry))) into.push(path);
  }
}

const sources = [];
for (const dir of SOURCE_DIRS) { try { walk(dir, sources); } catch { /* not every repo has all three */ } }
try { walk('tests', TEST_FILES); } catch { /* no tests is its own problem */ }

const haystack = sources.map(f => readFileSync(f, 'utf8')).join('\n');

let problems = 0;

for (const file of TEST_FILES) {
  const text = readFileSync(file, 'utf8');

  // ── 1. class selectors nothing in the app has ────────────────────────
  // Only plain class selectors: `.exp-card`, `.nb-btn`. Anything with a
  // space, a colon or a bracket is a real query and is left alone, because
  // guessing at those produces noise rather than findings.
  const classes = new Set(
    [...text.matchAll(/\.locator\('(\.[a-zA-Z][\w-]*)'\)/g)].map(m => m[1].slice(1)),
  );
  for (const name of classes) {
    // How a class reaches the DOM here: className="x", className="a x b",
    // or inside a styled string. Checked as a whole word so `card` does not
    // match `exp-card`, which is the distinction that hid this in the first
    // place.
    const used = new RegExp(`["'\`\\s]${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["'\`\\s]`).test(haystack);
    if (!used) {
      console.log(`  ✗ ${file}: .${name} — nothing in the app has this class`);
      problems++;
    }
  }

  // ── 2. an assertion that is true whatever the app does ───────────────
  // `expect(locator).toBeTruthy()` is the trap. page.locator() returns an
  // object whether or not it matches anything, and an object is truthy, so
  // the assertion passes on an empty page. The working form awaits a method
  // that returns a boolean — `await x.isVisible().catch(() => false)` — and
  // that is what the specs here already do.
  //
  // Counts have their own version: a count is never below zero, so
  // toBeGreaterThanOrEqual(0) agrees with an empty result.
  const bareLocators = new Set(
    [...text.matchAll(/const\s+(\w+)\s*=\s*page\.locator\(/g)].map(m => m[1]),
  );
  for (const m of text.matchAll(/expect\(\s*(\w+)\s*\)\.toBeTruthy\(\)/g)) {
    if (bareLocators.has(m[1])) {
      console.log(`  ✗ ${file}: expect(${m[1]}).toBeTruthy() — a locator is truthy even when it matches nothing`);
      problems++;
    }
  }
  for (const m of text.matchAll(/\.toBeGreaterThanOrEqual\(\s*0\s*\)/g)) {
    void m;
    console.log(`  ✗ ${file}: toBeGreaterThanOrEqual(0) — a count is never below zero`);
    problems++;
  }

  // ── 3. a test with nothing asserted ──────────────────────────────────
  // Split on test boundaries and look inside each. A block with no expect
  // and no assert runs some code and then agrees with whatever happened.
  const blocks = text.split(/\n(?=\s*(?:test|it)\s*\()/).slice(1);
  for (const block of blocks) {
    const title = (block.match(/(?:test|it)\s*\(\s*['"`](.+?)['"`]/) || [])[1];
    if (!title) continue;
    if (/\.(setup|config)\./.test(file)) continue;   // fixtures assert nothing by design
    if (!/\b(expect|assert)\b/.test(block)) {
      console.log(`  ✗ ${file}: "${title}" — runs, asserts nothing`);
      problems++;
    }
  }
}

console.log('');
if (problems) {
  console.log(`  ${problems} test${problems === 1 ? '' : 's'} that cannot fail`);
  process.exit(1);
}
console.log(`  ✓ every test in ${TEST_FILES.length} files can fail`);
