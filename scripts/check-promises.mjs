// ─── check:promises ───────────────────────────────────────────────────────
// Finds buttons whose label promises something happened beyond this screen,
// but whose handler never makes it happen.
//
// Two real bugs it was written for:
//
//   "✓ Confirm Booking Request" — the handler was setBookStep(2) and a toast,
//   while the next screen told the traveller the venue had their request and
//   would confirm within 24 hours. Nothing had been sent anywhere.
//
//   "Allow →" in onboarding — advanced the step and nothing else, so location
//   was never requested and push permission was never asked for. Onboarding
//   sold two features and switched neither of them on.
//
// A type checker cannot see either. This can. It reads .jsx and .tsx through
// the TypeScript parser, so a bug cannot hide behind a type annotation.
import fs from 'node:fs';
import ts from 'typescript';

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      // API routes render nothing; node_modules is not ours.
      if (entry.name === 'node_modules' || entry.name === 'api') continue;
      out.push(...walkFiles(full));
    } else if (/\.(tsx|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = [...walkFiles('app'), ...walkFiles('components')]
  .filter((f, i, a) => a.indexOf(f) === i).sort();

// Two kinds of promise, because they are kept in different ways.
//
// An action verb says something left the device. Navigating to the screen
// that does the work counts — "Invite someone" opening the invite screen is
// an honest button.
const ACTION = /\b(send|sends|sent|book|books|confirm|confirms|pay|invite|submit|request|reserve|charge|notify|remind)\b/i;
// A permission verb says the platform granted something. Only the platform
// can keep that promise, and navigating away emphatically does not — which is
// exactly how "Allow →" shipped doing nothing but advancing a step.
const PERMISSION = /\b(allow|enable|grant|connect)\b/i;

const KEEPS_ACTION = /fetch\(|ToServer|submitBooking|castVote|nudg|window\.open|push\(|updateStatus\(|setBooking\(true\)|signOut|openSignIn/;
const KEEPS_PERMISSION = /requestFor|requestPermission|getCurrentPosition|getUserMedia|\.requestAccess/;

// Names the search must not follow into. updateGroup writes local state and,
// on one optional branch, saves — so following it made every handler that
// touched local state look like it had reached the server. That is how a
// "Send to the group for a vote" button that told the server nothing came
// back clean.
const LOCAL_ONLY = new Set(['updateGroup', 'setGroups', 'setStack', 'setPlans']);

const found = [];

for (const file of FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  const lineOf = pos => sf.getLineAndCharacterOfPosition(pos).line + 1;

  // A handler is often one call to a function defined elsewhere in the file.
  // Reading only the inline body would call `onClick={()=>approveAll(true)}`
  // empty when approveAll is the thing doing all the work.
  const bodies = new Map();
  (function collect(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
        && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      bodies.set(n.name.text, n.initializer.getText(sf));
    }
    if (ts.isFunctionDeclaration(n) && n.name) bodies.set(n.name.text, n.getText(sf));
    ts.forEachChild(n, collect);
  })(sf);

  const delivers = (handler, kept, depth = 0) => {
    if (kept.test(handler)) return true;
    if (depth > 2) return false;
    // Follow both `doThing(...)` and a bare `onClick={doThing}`, which is how
    // the onboarding handler was written and how it slipped past the first
    // version of this check.
    const names = new Set();
    for (const call of handler.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) names.add(call[1]);
    const bare = /^onClick=\{([A-Za-z_$][\w$]*)\}$/.exec(handler.replace(/\s+/g, ''));
    if (bare) names.add(bare[1]);
    for (const name of names) {
      if (LOCAL_ONLY.has(name)) continue;
      const body = bodies.get(name);
      if (body && body !== handler && delivers(body, kept, depth + 1)) return true;
    }
    return false;
  };

  // What this button can say, one entry per thing it can say.
  //
  // Two traps, both of which let a real bug through. Walking the whole element
  // swept up every string in the style attribute — "100%", "pointer",
  // "inherit" — and pushed the actual words out of reach. And joining the
  // branches of `{saving ? 'Setting up…' : isLast ? 'Get started' : 'Allow →'}`
  // into one string made a perfectly ordinary button look like a paragraph of
  // prose, so the length rule below threw it away. Each branch is its own
  // label, because each is what somebody actually reads.
  const labelsOf = (node) => {
    const out = [];
    let text = '';
    const flush = () => { const t = text.replace(/\s+/g, ' ').trim(); if (t) out.push(t); text = ''; };
    const walk = (n) => {
      if (ts.isJsxText(n)) { text += n.text; return; }
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { flush(); out.push(n.text.trim()); return; }
      // A nested element's own attributes are styling, not words on a button.
      if (ts.isJsxElement(n)) { n.children.forEach(walk); return; }
      if (ts.isJsxSelfClosingElement(n)) return;
      ts.forEachChild(n, walk);
    };
    node.children.forEach(walk);
    flush();
    return out.filter(Boolean);
  };

  (function walk(n) {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'button') {
      const onClick = n.openingElement.attributes.properties.find(
        a => ts.isJsxAttribute(a) && a.name.getText(sf) === 'onClick');
      // A button says a few words. Anything longer is a card with prose in it,
      // where "nothing to vote on" is a description rather than a promise.
      const labels = labelsOf(n).filter(l => l.length <= 44);
      const label = labels.find(l => PERMISSION.test(l) || ACTION.test(l)) || '';
      const kind = !label ? null : PERMISSION.test(label) ? 'permission' : 'action';
      if (onClick && kind) {
        const handler = onClick.getText(sf);
        const kept = kind === 'permission' ? KEEPS_PERMISSION : KEEPS_ACTION;
        if (!delivers(handler, kept)) {
          found.push({ file, line: lineOf(n.pos), label, kind,
            handler: handler.replace(/\s+/g, ' ').slice(0, 140) });
        }
      }
    }
    ts.forEachChild(n, walk);
  })(sf);
}

if (!found.length) {
  console.log(`  ✓ every button that promises an action takes one (${FILES.length} files)`);
  process.exit(0);
}
console.log('  ✗ buttons that promise more than they do:');
for (const f of found) {
  console.log(`    ${f.file}:${f.line}  [${f.kind}] "${f.label}"`);
  console.log(`        ${f.handler}`);
}
process.exit(1);
