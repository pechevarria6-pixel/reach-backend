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

// JSX element names resolve like identifiers too
if (problems.length) {
  console.log(`\n  ${problems.length} identifier(s) used without a declaration in scope:\n`);
  for (const p of problems) {
    console.log(`  ${FILE}:${String(p.line).padEnd(5)} ${p.component.padEnd(22)} ${p.name}`);
  }
  process.exit(1);
}
console.log(`\n  ✓ every identifier in ${components.length} components resolves\n`);
