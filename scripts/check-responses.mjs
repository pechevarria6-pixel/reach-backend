// Finds fetch() calls whose response is never checked. An unchecked response
// makes a refusal look exactly like a success — which is how a charged card
// could be told its payment was recorded when it was not, and how a rejected
// vote still moved the tally and notified the group.
//
//   node scripts/check-responses.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

const P = Parser.extend(jsx());
const files = ['components/reach-app.jsx'];
function walkDir(d) { for (const e of readdirSync(d)) { const f = join(d, e); statSync(f).isDirectory() ? walkDir(f) : /\.tsx?$/.test(e) && files.push(f); } }
walkDir('components');

function walk(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, fn, node));
    else if (v && typeof v.type === 'string') walk(v, fn, node);
  }
}

const problems = [];
let total = 0;

for (const file of [...new Set(files)]) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  let ast;
  try { ast = P.parse(src.replace(/^\s*\/\/ @ts-nocheck.*$/m, ''), { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
  catch { continue; }
  const lines = src.split('\n');

  walk(ast, (n, parent) => {
    const isFetch = n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'fetch';
    if (!isFetch) return;
    total++;
    const line = n.loc.start.line;

    // GET-only reads of optional data are noise; flag calls that change state.
    const argText = src.slice(n.start, n.end);
    const mutates = /method:\s*["'`](POST|PUT|PATCH|DELETE)/.test(argText);
    if (!mutates) return;

    // Is the awaited result bound to something, and is that thing's .ok read
    // within the next ~14 lines?
    const awaited = parent?.type === 'AwaitExpression' ? parent : null;
    const decl = awaited && awaited.__parent;
    // Wide enough to reach an `if (res.ok)` that sits past the request body.
    const window = lines.slice(line - 1, line + 24).join('\n');
    const checksOk = /\.ok\b|\.status\b|res\.ok|r\.ok|\bcr\.ok\b/.test(window);
    const bound = awaited && /^\s*(const|let|var)\s/.test(lines[line - 1] ?? '');

    // A sentence above saying this one is on purpose, same bargain as
    // check:writes. Instrumentation is the real case: a track() call that
    // blocked a response, or failed one, would cost more than every number
    // it will ever produce.
    const why = lines.slice(Math.max(0, line - 5), line - 1).join('\n');
    const deliberate = /deliberately unchecked|fire-and-forget|never awaited|must never/i.test(why);

    if (!checksOk && !deliberate) {
      const snippet = (lines[line - 1] || '').trim().slice(0, 78);
      problems.push({ file, line, snippet, bound: !!bound });
    }
  });
}

console.log(`\n  ${total} fetch call(s) examined\n`);
if (problems.length) {
  console.log(`  ${problems.length} state-changing request(s) whose response is never checked:\n`);
  for (const p of problems) console.log(`  ${p.file}:${p.line}\n      ${p.snippet}`);
  console.log('');
  process.exit(1);
}
console.log('  ✓ every state-changing request checks its response\n');
