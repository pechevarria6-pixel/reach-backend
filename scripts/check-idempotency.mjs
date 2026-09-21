// ─── Money-moving calls carry an idempotency key ────────────────────────
// Creating a payment intent is a write, and the check that decides whether
// to create one is a read. A fast double-tap sends two requests; both read
// "no payment in flight" before either writes one, and both create an
// intent. The person can then be charged twice for the same share.
//
// Stripe solves this properly: the same Idempotency-Key returns the original
// object instead of making another. The guard exists because the failure is
// invisible in testing — you need two requests in the same instant to see
// it — and expensive in production.
//
// Anything that creates a charge, an intent or a checkout session must send
// one, or say in a comment on the same line why it need not.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Calls that move money or create something that will. */
const CREATES_MONEY = [
  /paymentIntents\.create\s*\(/,
  /checkout\.sessions\.create\s*\(/,
  /charges\.create\s*\(/,
  /refunds\.create\s*\(/,
  /transfers\.create\s*\(/,
  /payouts\.create\s*\(/,
  /api\.stripe\.com\/v1\/(payment_intents|charges|refunds|transfers|payouts|checkout\/sessions)['"`]/,
];

/** How the key can be supplied, by SDK or by raw request. */
const HAS_KEY = [
  /idempotencyKey/i,
  /['"]Idempotency-Key['"]/i,
];

/** Written down, on purpose, as a decision rather than an oversight. */
const EXEMPT = /deliberately no idempotency key/i;

/** How far after the call to look for the key. */
const WINDOW = 25;

function filesUnder(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(full))) out.push(full);
  }
  return out;
}

const offences = [];
for (const file of [...filesUnder('app'), ...filesUnder('lib')]) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
    if (!CREATES_MONEY.some(re => re.test(line))) return;

    // The call and the lines around it — a raw request builds its headers
    // before the URL as often as after.
    const near = lines.slice(Math.max(0, i - WINDOW), i + WINDOW).join('\n');
    if (HAS_KEY.some(re => re.test(near))) return;
    if (EXEMPT.test(near)) return;

    offences.push({ file, line: i + 1, text: line.trim().slice(0, 88) });
  });
}

if (!offences.length) {
  console.log('  ✓ every money-moving call carries an idempotency key');
  process.exit(0);
}

console.error('\n  ✗ a call that moves money has no idempotency key.');
console.error('    Two requests in the same instant will both go through, and');
console.error('    somebody gets charged twice. Send an Idempotency-Key, or write');
console.error('    "deliberately no idempotency key — <reason>" beside it.\n');
for (const o of offences) {
  console.error(`    ${o.file}:${o.line}`);
  console.error(`      ${o.text}`);
}
process.exit(1);
