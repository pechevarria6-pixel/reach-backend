// ─── check:promises ───────────────────────────────────────────────────────
// Finds buttons whose label promises a server action but whose handler never
// makes one.
//
// This exists because "✓ Confirm Booking Request" shipped with a handler that
// was `setBookStep(2)` and a toast, while the next screen told the traveller
// the venue had their request and would confirm within 24 hours. Nothing had
// been sent anywhere. Somebody could have turned up at a restaurant on the
// strength of it. A type checker cannot see that; this can.
import fs from 'node:fs';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

const FILE = 'components/reach-app.jsx';
const src = fs.readFileSync(FILE, 'utf8');
const ast = Parser.extend(jsx()).parse(src, {
  ecmaVersion: 2022, sourceType: 'module', locations: true,
});

// Verbs that tell a person something left their device.
const PROMISES = /\b(send|sends|sent|book|books|confirm|confirms|pay|invite|submit|request|reserve|charge|notify|remind)\b/i;
// Anything that genuinely reaches the server, opens a partner, hands the
// person to a screen that will do the work, or opens the flow that does it.
const DELIVERS = /fetch\(|ToServer|submitBooking|castVote|nudg|window\.open|push\(|updateGroup\(|setBooking\(true\)/;

// A handler is often one call to a function defined elsewhere in the file.
// Checking only the inline body would call `onClick={()=>approveAll(true)}`
// empty when approveAll is the thing doing all the work.
const bodies = new Map();
(function collect(n) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init
      && (n.init.type === 'ArrowFunctionExpression' || n.init.type === 'FunctionExpression')) {
    bodies.set(n.id.name, src.slice(n.init.start, n.init.end));
  }
  if (n.type === 'FunctionDeclaration' && n.id) bodies.set(n.id.name, src.slice(n.start, n.end));
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v.type === 'string') collect(v);
  }
})(ast);

const delivers = (handler, depth = 0) => {
  if (DELIVERS.test(handler)) return true;
  if (depth > 2) return false;
  for (const name of handler.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const body = bodies.get(name[1]);
    if (body && body !== handler && delivers(body, depth + 1)) return true;
  }
  return false;
};

const labelOf = (node) => {
  let out = '';
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'JSXText') out += n.value;
    if (n.type === 'Literal' && typeof n.value === 'string') out += ' ' + n.value;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(node);
  return out.replace(/\s+/g, ' ').trim();
};

const found = [];
(function walk(n) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'JSXElement' && n.openingElement.name.name === 'button') {
    const onClick = n.openingElement.attributes.find(
      a => a.type === 'JSXAttribute' && a.name.name === 'onClick');
    const label = labelOf(n).slice(0, 70);
    if (onClick && PROMISES.test(label)) {
      const handler = src.slice(onClick.start, onClick.end);
      if (!delivers(handler)) {
        found.push({ line: n.loc.start.line, label, handler: handler.replace(/\s+/g, ' ').slice(0, 140) });
      }
    }
  }
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v.type === 'string') walk(v);
  }
})(ast);

if (!found.length) {
  console.log('  ✓ every button that promises an action takes one');
  process.exit(0);
}
console.log('  ✗ buttons that promise more than they do:');
for (const f of found) {
  console.log(`    ${FILE}:${f.line}  "${f.label}"`);
  console.log(`        ${f.handler}`);
}
process.exit(1);
