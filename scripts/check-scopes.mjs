// Finds identifiers a component uses but never declares — the ReferenceError
// class that has bitten this file repeatedly: isSoloGroup declared in the
// wrong component, buildingItinerary borrowed from another screen, _sp3
// referenced across a boundary, realId read outside its try block.
//
//   node scripts/check-scopes.mjs
import { readFileSync } from 'node:fs';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

const FILE = process.argv[2] || 'components/reach-app.jsx';
const P = Parser.extend(jsx());
const src = readFileSync(FILE, 'utf8');
const ast = P.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

const GLOBALS = new Set([
  'window','document','navigator','localStorage','sessionStorage','console','fetch','setTimeout',
  'clearTimeout','setInterval','clearInterval','JSON','Math','Date','Object','Array','String','Number',
  'Boolean','Promise','Set','Map','RegExp','Error','isNaN','parseInt','parseFloat','encodeURIComponent',
  'decodeURIComponent','undefined','NaN','Infinity','React','require','process','globalThis','structuredClone',
  'AbortController','URL','URLSearchParams','Intl','crypto','alert','confirm','prompt','location','history',
  'Notification','FormData','Blob','File','FileReader','IntersectionObserver','ResizeObserver','matchMedia',
]);

// names bound by a pattern (params, destructuring, catch clauses)
function bind(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': out.add(node.name); break;
    case 'ObjectPattern': for (const p of node.properties) bind(p.value ?? p.argument, out); break;
    case 'ArrayPattern': for (const e of node.elements) bind(e, out); break;
    case 'AssignmentPattern': bind(node.left, out); break;
    case 'RestElement': bind(node.argument, out); break;
  }
}

// every name declared anywhere inside a subtree (hoisting-ish, deliberately
// generous so we only report identifiers with no declaration at all)
function declaredWithin(node, out = new Set()) {
  walk(node, (n) => {
    if (n.type === 'VariableDeclarator') bind(n.id, out);
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) out.add(n.id.name);
    if (n.type === 'CatchClause') bind(n.param, out);
    // Not chained to the above: a named function declaration has to contribute
    // its own name AND bind its parameters, and an else-if gave only the name.
    if (/Function/.test(n.type)) for (const p of n.params) bind(p, out);
  });
  return out;
}

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

// module scope: imports + top-level declarations
const moduleScope = new Set(GLOBALS);
for (const n of ast.body) {
  if (n.type === 'ImportDeclaration') for (const sp of n.specifiers) moduleScope.add(sp.local.name);
  else if (n.type === 'VariableDeclaration') for (const d of n.declarations) bind(d.id, moduleScope);
  else if (n.type === 'FunctionDeclaration' && n.id) moduleScope.add(n.id.name);
  else if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') {
    const d = n.declaration;
    if (d?.type === 'FunctionDeclaration' && d.id) moduleScope.add(d.id.name);
    if (d?.type === 'VariableDeclaration') for (const x of d.declarations) bind(x.id, moduleScope);
  }
}

// each top-level component
const components = [];
for (const n of ast.body) {
  const d = n.type === 'ExportDefaultDeclaration' || n.type === 'ExportNamedDeclaration' ? n.declaration : n;
  if (d?.type === 'FunctionDeclaration' && d.id && /^[A-Z]/.test(d.id.name)) components.push(d);
}

const problems = [];
for (const fn of components) {
  const scope = new Set([...moduleScope, ...declaredWithin(fn)]);
  const used = new Map(); // name -> first line
  walk(fn, (n, parent) => {
    if (n.type !== 'Identifier') return;
    if (parent) {
      // property keys, member accesses, labels are not references
      if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
      if (parent.type === 'Property' && parent.key === n && !parent.computed) return;
      if (parent.type === 'JSXAttribute' && parent.name === n) return;
      if (/Function/.test(parent.type) && parent.params.includes(n)) return;
      if (parent.type === 'VariableDeclarator' && parent.id === n) return;
    }
    if (!scope.has(n.name) && !used.has(n.name)) used.set(n.name, n.loc.start.line);
  });
  for (const [name, line] of used) {
    problems.push({ component: fn.id.name, name, line });
  }
}

// ─── Read before it is declared ──────────────────────────────────────────
// A different failure with the same symptom. Discover crashed in production
// with "Cannot access 'F' before initialization": the list of places
// somebody had dismissed was read on line 1085 and declared on line 1110.
//
// The check above cannot see it — the name does resolve, just later — and
// nothing else sees it either. It compiles, because ordering is legal to a
// bundler and only wrong at run time. Type-check passes. Unit tests do not
// render the component.
//
// Narrow on purpose: only a const or let read inside the initialiser of an
// earlier const in the same component. Those run top to bottom, every time,
// so this is a certainty rather than a suspicion. A reference from inside a
// function stored for later — an effect, a click handler — is fine and is
// not reported, because by the time it runs the declaration has happened.
/** Walk a subtree but stop at nested functions — a different scope entirely. */
function walkOwnScope(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  if (node !== parent && /Function/.test(node.type) && parent !== null) return;
  fn(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === 'string') walkOwnScope(c, fn, node); }
    else if (child && typeof child.type === 'string') walkOwnScope(child, fn, node);
  }
}

/** Every function in the file, so nested ones are checked in their own right. */
const scopesToCheck = [];
for (const fn of components) {
  walk(fn, (n) => { if (/Function/.test(n.type) && n.body) scopesToCheck.push({ owner: fn.id.name, node: n }); });
  scopesToCheck.push({ owner: fn.id.name, node: fn });
}

const seen = new Set();
for (const { owner, node: fn } of scopesToCheck) {
  // Declarations at this level only. A `const plan` inside a sibling
  // function is not this scope's `plan`, and treating it as one reported a
  // function parameter as read-before-declared.
  const declaredAt = new Map();
  walkOwnScope(fn.body, (n) => {
    if (n.type !== 'VariableDeclaration' || n.kind === 'var') return;
    for (const d of n.declarations) {
      const names = new Set();
      bind(d.id, names);
      for (const name of names) if (!declaredAt.has(name)) declaredAt.set(name, d.id.loc.start.line);
    }
  });
  if (!declaredAt.size) continue;

  walkOwnScope(fn.body, (n) => {
    if (n.type !== 'VariableDeclarator' || !n.init) return;
    const line = n.id.loc.start.line;

    // `const f = () => x` is a function somebody calls later, so a name it
    // mentions is not read now. `const y = list.filter(e => x)` is not: the
    // arrow is an argument to a call that happens immediately, which is
    // exactly the shape that took Discover down.
    if (/Function/.test(n.init.type)) return;

    // Names the initialiser binds for itself — an arrow's parameters, most
    // often. `list.filter(b => b.status)` mentions `b`, and that `b` is the
    // callback's own, not the `for (const b of ...)` fifty lines below it.
    const ownNames = new Set();
    walk(n.init, (fnNode) => {
      if (!/Function/.test(fnNode.type)) return;
      for (const param of fnNode.params) bind(param, ownNames);
    });

    walk(n.init, (ref, parent) => {
      if (ref.type !== 'Identifier') return;
      if (ownNames.has(ref.name)) return;
      if (parent) {
        if (parent.type === 'MemberExpression' && parent.property === ref && !parent.computed) return;
        if (parent.type === 'Property' && parent.key === ref && !parent.computed) return;
        if (/Function/.test(parent.type) && parent.params.includes(ref)) return;
      }
      const at = declaredAt.get(ref.name);
      if (at !== undefined && at > line) {
        const key = `${owner}:${ref.name}:${line}`;
        if (seen.has(key)) return;
        seen.add(key);
        problems.push({ component: owner, name: `${ref.name} (declared on line ${at})`, line });
      }
    });
  });
}

// JSX element names resolve like identifiers too
if (problems.length) {
  console.log(`\n  ${problems.length} identifier(s) used without a declaration in scope:\n`);
  for (const p of problems) {
    console.log(`  ${FILE}:${String(p.line).padEnd(5)} ${p.component.padEnd(22)} ${p.name}`);
  }
  process.exit(1);
}
console.log(`\n  ✓ every identifier in ${components.length} components resolves\n`);
