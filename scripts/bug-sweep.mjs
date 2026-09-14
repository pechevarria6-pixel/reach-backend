// ─── Bug sweep ───────────────────────────────────────────────────────────
// One detector per bug class that actually reached a user in this codebase.
// Every rule here exists because the thing it looks for shipped.
//
//   node scripts/bug-sweep.mjs            report
//   node scripts/bug-sweep.mjs --quiet    exit code only
//
// It reports; it does not edit. A rule can be confident a pattern is present
// and still be wrong about whether it matters, and a wrong automatic edit in
// a payment path is worse than the bug.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

const QUIET = process.argv.includes('--quiet');
const P = Parser.extend(jsx());

function sources(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) { if (e !== 'node_modules') sources(f, out); }
    else if (/\.(jsx?|tsx?)$/.test(e)) out.push(f);
  }
  return out;
}
const FILES = [...sources('components'), ...sources('app'), ...sources('lib')];

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

const findings = [];
const add = (rule, file, line, detail) => findings.push({ rule, file, line, detail });

for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const isComponentFile = /\.jsx$/.test(file);

  // ── 1. a caught error that reaches neither the user nor the log ────────
  // Shipped as: a failed plan fetch made the itinerary tab claim there were
  // no days, when the truth was that we could not ask.
  let ast = null;
  try { ast = P.parse(src.replace(/^\s*\/\/ @ts-nocheck.*$/m, ''), { ecmaVersion: 'latest', sourceType: 'module', locations: true }); } catch {}
  if (ast) {
    walk(ast, (n, parent) => {
      if (n.type !== 'CatchClause') return;
      const body = src.slice(n.body.start, n.body.end);
      const silent = !/console\.(error|warn|log)|toast|showToast|setMsg|setError|setLoad|setNearby|setReason|setSearchFailed|throw/.test(body);
      if (!silent) return;
      // Storage, clipboard and notification guards are meant to be silent.
      // Read the whole try block, not a few lines above the catch: `new
      // Notification(...)` sits eight lines up from its own catch.
      const tryBlock = parent?.type === 'TryStatement' ? src.slice(parent.block.start, parent.block.end) : '';
      const around = tryBlock || lines.slice(Math.max(0, n.loc.start.line - 4), n.loc.start.line).join('\n');
      // Storage reads, clipboard, notifications and cache lookups are meant to
      // fail quietly and fall through to the real path.
      if (/localStorage|sessionStorage|clipboard|Notification|navigator\.share|JSON\.parse\(cached|return true;/.test(around)) return;
      // A catch whose whole job is to fall back to a value or render nothing.
      if (/^\s*\}?\s*catch\s*\{?\s*(\(\w*\))?\s*\{?\s*return null;/.test(src.slice(n.start, n.end)) || /setUserLocation/.test(body)) return;
      add('silent-catch', file, n.loc.start.line, 'error reaches neither the person nor the log');
    });

    // ── 2. state written from a captured snapshot ───────────────────────
    // Shipped as: two updates in one tick lost the first, the plan vanished
    // from local state, and the screen rendered nothing at all.
    walk(ast, (n) => {
      if (n.type !== 'CallExpression') return;
      const name = n.callee.type === 'Identifier' ? n.callee.name : '';
      if (!/^set[A-Z]/.test(name)) return;
      const arg = n.arguments[0];
      if (!arg) return;
      const usesUpdater = arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression';
      if (usesUpdater) return;
      // Only when the value genuinely reads the state it replaces, as a bare
      // identifier. Text matching counted `draft.step` as a read of `step`,
      // which is a restore from saved input, not a stale-snapshot update.
      const stateName = name[3].toLowerCase() + name.slice(4);
      let reads = false;
      walk(arg, (id, p) => {
        if (id.type !== 'Identifier' || id.name !== stateName) return;
        if (p?.type === 'MemberExpression' && p.property === id && !p.computed) return; // x.step
        if (p?.type === 'Property' && p.key === id && !p.computed) return;              // {step: 1}
        reads = true;
      });
      if (reads) {
        add('stale-state', file, n.loc.start.line, `${name} derives from ${stateName} without an updater`);
      }
    });

    // ── 3. a component that renders nothing ─────────────────────────────
    // Shipped as: the black screen after a trip was confirmed. Only counts a
    // return that is the component's own render path — not a helper, an SSR
    // guard inside an IIFE, or the stack renderer legitimately drawing
    // nothing when no screen is pushed.
    if (isComponentFile) {
      for (const top of ast.body) {
        const d = top.type === 'ExportDefaultDeclaration' || top.type === 'ExportNamedDeclaration' ? top.declaration : top;
        if (d?.type !== 'FunctionDeclaration' || !d.id || !/^[A-Z]/.test(d.id.name)) continue;
        // Statements directly in the component body, not inside a nested
        // function — those are callbacks and may return null freely.
        for (const stmt of d.body.body) {
          const check = (node) => {
            if (!node) return;
            if (node.type === 'ReturnStatement' && node.argument?.type === 'Literal' && node.argument.value === null) {
              add('blank-render', file, node.loc.start.line, `${d.id.name} can render nothing — an empty screen with no way back`);
            }
          };
          check(stmt);
          if (stmt.type === 'IfStatement') { check(stmt.consequent); (stmt.consequent.body ?? []).forEach?.(check); }
        }
      }
    }
  }

  // ── 4. a temp id on its way to the server ─────────────────────────────
  // Shipped repeatedly; the standing rules call this out by name.
  lines.forEach((l, i) => {
    if (!/fetch\(`?\/api\//.test(l) || !/\$\{(planId|groupId|gid|id)\}/.test(l)) return;
    // Only writes. A read with an id the server has never seen is a 404 that
    // changes nothing; a write is a change the person believes was saved.
    const call = lines.slice(i, i + 6).join('\n');
    if (!/method:\s*["'`](POST|PUT|PATCH|DELETE)/.test(call)) return;
    const guarded = lines.slice(Math.max(0, i - 16), i).join('\n');
    if (!/isTempId|g_local_|startsWith\("p"\)/.test(guarded)) {
      add('temp-id', file, i + 1, 'write built from an id that may never have reached the server');
    }
  });

  // ── 5. invented content presented as real ─────────────────────────────
  // Shipped as: six hardcoded experiences, three San Francisco events, a
  // passport expiring in 2029, and eight fabricated local listings.
  lines.forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;
    if (/(Confirmation #|·\s*Local Venue|Exp\.? 20\d\d|···\s*\d{4}|From \$\d+.*Local)/.test(l)) {
      add('fixture-data', file, i + 1, 'looks like invented content presented as real');
    }
  });


  // ── 7. an API failure that leaves no trace ─────────────────────────────
  // The standing rule: every 4xx/5xx branch logs with context. A route that
  // returns 500 silently is a support ticket with no evidence behind it.
  if (/^app\/api\//.test(file)) {
    lines.forEach((l, i) => {
      // 5xx only. A 4xx carries its own explanation in the response — the
      // caller is told what was wrong with the request — while a 5xx is a
      // fault whose only possible evidence is what the route wrote down.
      const m = /status:\s*(5\d\d)/.exec(l);
      if (!m) return;
      // Wide enough to reach a log that sits above a multi-line response body.
      const around = lines.slice(Math.max(0, i - 16), i + 2).join('\n');
      if (!/console\.(error|warn)/.test(around)) {
        add('unlogged-failure', file, i + 1, `returns ${m[1]} with nothing logged`);
      }
    });
  }

  // ── 8. a schema that rejects null ──────────────────────────────────────
  // The standing rule: fields the client may send as null are .nullish(), not
  // .optional(). The client sends null for "cleared", and .optional() rejects
  // it with a validation error that reads like a bug in the form.
  lines.forEach((l, i) => {
    if (!/z\.\w+\(\)[^;]*\.optional\(\)/.test(l)) return;
    if (/nullish|nullable/.test(l)) return;
    add('optional-not-nullish', file, i + 1, 'optional() rejects an explicit null the client may send');
  });

  // ── 6. a loading flag with no path back to false ───────────────────────
  // A stuck spinner is indistinguishable from a hung app.
  const flags = [...src.matchAll(/const \[(\w*[Ll]oading\w*|busy|saving|searching|creating|finishing),\s*(set\w+)\]/g)];
  for (const [, , setter] of flags) {
    const ons = (src.match(new RegExp(`${setter}\\(true\\)`, 'g')) || []).length;
    const offs = (src.match(new RegExp(`${setter}\\((false|null)\\)`, 'g')) || []).length;
    if (ons > 0 && offs === 0) {
      const line = src.slice(0, src.indexOf(`${setter}(true)`)).split('\n').length;
      add('stuck-flag', file, line, `${setter} is set true and never cleared`);
    }
  }
}

const RULES = {
  'silent-catch':  'Failures nobody can see or debug',
  'stale-state':   'State written from a captured snapshot',
  'blank-render':  'Screens that paint nothing',
  'temp-id':       'Client-made ids sent to the server',
  'fixture-data':  'Invented content presented as real',
  'stuck-flag':    'Loading flags that never clear',
  'unlogged-failure':    'Server faults that leave no trace',
  'optional-not-nullish':'Schemas that reject a null the client sends',
};

if (!QUIET) {
  console.log(`\n  swept ${FILES.length} files\n`);
  if (!findings.length) console.log('  ✓ nothing found\n');
  for (const rule of Object.keys(RULES)) {
    const hits = findings.filter(f => f.rule === rule);
    if (!hits.length) continue;
    console.log(`  ${RULES[rule]} — ${hits.length}`);
    for (const h of hits.slice(0, 12)) console.log(`      ${h.file}:${h.line}  ${h.detail}`);
    if (hits.length > 12) console.log(`      …and ${hits.length - 12} more`);
    console.log('');
  }
}
process.exit(findings.length ? 1 : 0);
