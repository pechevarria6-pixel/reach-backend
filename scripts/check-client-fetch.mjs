// ─── The browser talks to us, and we talk to everybody else ─────────────
// Four calls to nominatim.openstreetmap.org sat in the client bundle and
// every one of them failed in production. Blocked by CORS, so: somebody's
// city rendered as "Your location", the home-city fallback silently did
// nothing, and both place searches returned nothing at all. The e2e suite
// had been reporting it for who knows how long as two failing assertions
// about console noise, which is what a real bug looks like before anybody
// reads the message.
//
// There is a second reason beyond it not working. A third-party service
// called from a page is anonymous traffic: a browser will not let a script
// set a User-Agent, and Nominatim's usage policy requires one identifying
// the application. Proxying it server-side is both the fix and the polite
// thing to do.
//
// So: no client file may name a third-party API host. Server routes may,
// and do.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Hosts that must be reached from a route, never from a page. */
const OFF_LIMITS = [
  'nominatim.openstreetmap.org',
  'overpass-api.de',
  'overpass.kumi.systems',
  'overpass.private.coffee',
  'api.openstreetmap.org',
  'app.ticketmaster.com',
  'api.yelp.com',
  'api.duffel.com',
  'en.wikipedia.org/w/api.php',
  'commons.wikimedia.org/w/api.php',
  'api.anthropic.com',
];

/** Where the browser's code lives. Everything under app/api is a server. */
const CLIENT_DIRS = ['components', 'app'];
const SERVER = /^app\/api\//;

function filesUnder(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

const offences = [];
for (const file of CLIENT_DIRS.flatMap(d => filesUnder(d))) {
  if (SERVER.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  // A server component or a server-only module in app/ is allowed to. The
  // marker is explicit so the exemption is a decision somebody wrote down.
  if (/^\s*import\s+['"]server-only['"]/m.test(source)) continue;

  source.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
    for (const host of OFF_LIMITS) {
      if (line.includes(host)) offences.push({ file, line: i + 1, host, text: line.trim().slice(0, 90) });
    }
  });
}

if (!offences.length) {
  console.log('  ✓ the browser calls nobody but us');
  process.exit(0);
}

console.error('\n  ✗ a third-party API is called from code that runs in the browser.');
console.error('    It will be blocked by CORS, and it cannot send the User-Agent');
console.error('    these services ask for. Add a route under app/api and call that.\n');
for (const o of offences) {
  console.error(`    ${o.file}:${o.line}  → ${o.host}`);
  console.error(`      ${o.text}`);
}
process.exit(1);
