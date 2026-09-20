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

// ─── A Clerk id where this app's id belongs ─────────────────────────────
// Clerk knows somebody as `user_2abc...`; every table here knows them as a
// uuid. Both are strings, both truthy, so reaching for the wrong one does
// not crash: a filter matches no row and reads as an empty account, an
// insert writes a row belonging to nobody.
//
// /api/me returned `dbUser?.id || clerkId`, so a new account whose row was
// not there yet handed the client a Clerk id as its own id.
//
// The columns that hold this app's id for a person, and never Clerk's.
const OWNER_COLUMNS = '(user_id|created_by|booked_by|fulfilled_by|accepted_by|booked_by|organiser_id|organizer_id)';
// `clerkId` and `clerk_id` say what they hold. `userId` does not — it is a
// perfectly good name for this app's uuid, and is only Clerk's when it came
// straight out of auth() unrenamed, which is checked per file below.
const CLERK_VALUE = '(clerk[Ii]d|clerk_id)';
const CLERK_MISUSE = [
  // .eq('user_id', clerkId)
  new RegExp(`\\.(eq|in|match)\\(\\s*['\"]${OWNER_COLUMNS}['\"]\\s*,\\s*${CLERK_VALUE}\\b`),
  // { user_id: clerkId }
  new RegExp(`${OWNER_COLUMNS}\\s*:\\s*${CLERK_VALUE}\\b`),
  // id: dbUser?.id || clerkId
  new RegExp(`\\b(id|user_id)\\s*:[^,;\\n]*\\|\\|\\s*${CLERK_VALUE}\\b`),
];

for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;                 // a comment about it is fine
    if (/clerk_id['\"]\s*,\s*clerk/i.test(line)) return;      // filtering the clerk_id column by a clerk id is correct
    for (const re of CLERK_MISUSE) {
      if (!re.test(line)) continue;
      problems.push({ file, line: i + 1, text: line.trim().slice(0, 72) });
      break;
    }
  });
}

// ─── Reading a table nothing writes ─────────────────────────────────────
// `payments` belongs to a payment path that was replaced by funding, which
// writes `contributions`. The table holds zero rows and nothing in the
// client calls /api/payments any more — but Profile and the GDPR export
// still read it, so somebody who had paid $2,810 across five contributions
// was shown an empty payment history and given an export with no record of
// any of it.
//
// Reads are the failure. The two legacy writes are harmless and left alone;
// reading the dead table is what shows somebody a lie about their own money.
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    if (!/\.from\(\s*['\"]payments['\"]\s*\)\s*\.select\(/.test(line)) return;
    // The legacy path may read its own table; it writes those rows. The
    // sentence has to be there, as everywhere else in this file.
    const why = readFileSync(file, 'utf8').split('\n').slice(Math.max(0, i - 8), i).join('\n');
    if (/deliberately|legacy/i.test(why)) return;
    problems.push({ file, line: i + 1, text: line.trim().slice(0, 72) });
  });
}

console.log('');
if (problems.length) {
  console.log(`  ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(`  ${p.file}:${p.line}  ${p.text}`);
  console.log('\n  Read the error, or say on the line above why it does not matter.');
  console.log('  A Clerk id in an owner column: resolve through requireUser() and pass ctx.user.id.');
  console.log("  A read of `payments`: money lives in `contributions` — that is what funding writes.");
  process.exit(1);
}
console.log(`  ✓ every write in ${files.length} files reads its result, and no Clerk id reaches an owner column\n`);
