// Reads an Anthropic API key from the macOS clipboard and writes it into
// .env.local, replacing the existing line.
//
// Doing this through a shell one-liner fails whenever the clipboard holds a
// character the shell treats specially — a pipe, a quote, a backtick. The key
// never passes through a command line here, and this script never prints it.
//
//   node scripts/set-anthropic-key.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ENV = '.env.local';
const NAME = 'ANTHROPIC_API_KEY';

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

if (!existsSync(ENV)) fail(`${ENV} not found. Run this from the project root.`);

let key;
try {
  key = execFileSync('pbpaste', { encoding: 'utf8' }).trim();
} catch {
  fail('Could not read the clipboard (pbpaste failed).');
}

if (!key) fail('The clipboard is empty. Copy your key first.');

if (!key.startsWith('sk-ant-')) {
  // Say what it looks like without showing it.
  const shape = key.length > 40 ? 'a long string' : `${key.length} characters`;
  fail(
    `That does not look like an Anthropic key — it is ${shape} and does not ` +
    `start with "sk-ant-".\n    If you copied the command instead of the key, ` +
    `copy the key from console.anthropic.com and run this again.`,
  );
}

if (/\s/.test(key)) fail('The clipboard has whitespace inside the key. Copy just the key.');

const before = readFileSync(ENV, 'utf8');
const line = `${NAME}=${key}`;
const pattern = new RegExp(`^${NAME}=.*$`, 'm');
const after = pattern.test(before)
  ? before.replace(pattern, line)
  : `${before.replace(/\n*$/, '')}\n${line}\n`;

writeFileSync(ENV, after);

console.log(`\n  ✓ ${NAME} written to ${ENV}`);
console.log(`    starts with sk-ant-, ${key.length} characters, no whitespace`);
console.log('    (the value was never printed or passed through a shell)\n');
