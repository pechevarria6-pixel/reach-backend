// ─── Writes that report success without checking ────────────────────────
// Supabase does not throw. A failed insert returns `{ error }` and an
// unawaited-for result is simply dropped, so a route that never reads it
// carries on and returns 200. The row is not there and nothing said so.
//
// Found by hand this way, more than once:
//
//   · /api/bookings quoted every item and stored none of them, and still
//     returned the quotes, so a booking nobody could act on read as one
//     that had worked.
//   · a plan delete that failed left its bookings behind, pointing at a
//     plan that no longer existed and impossible to act on from any screen.
//
// A handful of writes genuinely are fire-and-forget — bookkeeping for a
// background job that must never fail a screen — so the opt-out is a comment
// saying so on the line above. Having to write the sentence is the point: it
// makes the decision deliberate rather than accidental.
//
//   node scripts/check-writes.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app/api', 'lib'];
const WRITE = /\.(insert|update|upsert|delete)\s*\(/;
// The result is being read when it is destructured or assigned.
const CHECKED = /(const|let|var)\s*(\{|\[)|=\s*await\b|return\s+await\b|return\s+\w+\.from\(/;
const ALLOWED = /deliberately unchecked|fire-and-forget|never fail a screen|bookkeeping/i;

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (['.ts', '.tsx'].includes(extname(entry))) files.push(path);
  }
}
for (const root of ROOTS) { try { walk(root); } catch { /* optional */ } }

const problems = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // The statement has to start here — `await x.from(...)` — rather than be
    // the continuation of one whose result was captured lines above.
    if (!/^\s*await\s+[\w.]*\.?from\s*\(/.test(line)) return;

    // Read forward to the end of the statement so a write whose method sits
    // on a later line is still seen. Chained builders run several lines.
    const statement = lines.slice(i, i + 12).join('\n');
    if (!WRITE.test(statement)) return;
    if (CHECKED.test(line)) return;

    // A sentence above saying this one is on purpose.
    const context = lines.slice(Math.max(0, i - 4), i).join('\n');
    if (ALLOWED.test(context)) return;

    problems.push({ file, line: i + 1, text: line.trim().slice(0, 72) });
  });
}

console.log('');
if (problems.length) {
  console.log(`  ${problems.length} write(s) whose result is never read:\n`);
  for (const p of problems) console.log(`  ${p.file}:${p.line}  ${p.text}`);
  console.log('\n  Read the error, or say on the line above why it does not matter.');
  process.exit(1);
}
console.log(`  ✓ every write in ${files.length} files reads its result\n`);
