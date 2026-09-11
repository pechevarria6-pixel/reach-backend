#!/usr/bin/env node
// ─── Reach doctor ────────────────────────────────────────────────────────
// Checks everything the app needs in order to actually work, and says
// precisely what to do about anything that is wrong.
//
//   npm run doctor              check .env.local
//   npm run doctor -- --prod    check against the deployed site too
//
// Exits 0 when the app can run, 1 when something is blocking.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const CHECK_PROD = args.has('--prod');

// ── output helpers ───────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const blockers = [];
const warnings = [];

const ok = (m, d) => console.log(`  ${C.green}✓${C.reset} ${m}${d ? `  ${C.dim}${d}${C.reset}` : ''}`);
const bad = (m, fix) => { console.log(`  ${C.red}✗${C.reset} ${m}`); blockers.push({ m, fix }); };
const warn = (m, fix) => { console.log(`  ${C.yellow}!${C.reset} ${m}`); warnings.push({ m, fix }); };
const section = t => console.log(`\n${C.bold}${t}${C.reset}`);

// ── load .env.local without a dependency ─────────────────────────────────
function loadEnv(file = '.env.local') {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return null;
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// ── what each table needs, and which file creates it ─────────────────────
const TABLES = {
  'sql/core-schema.sql': [
    'users', 'groups', 'group_members', 'plans', 'votes',
    'itinerary_items', 'payments', 'audit_logs', 'loyalty_programs',
    'deletion_requests',
  ],
  'sql/bookings.sql': ['bookings'],
  'sql/engine-v3.sql': ['connected_accounts', 'contributions', 'expenses'],
  'sql/savings-v1.sql': ['savings_goals', 'savings_checkins'],
  'sql/invites-v1.sql': ['group_invites'],
};

const ENV_GROUPS = [
  {
    title: 'Core — the app cannot start without these',
    blocking: true,
    vars: [
      ['NEXT_PUBLIC_SUPABASE_URL', v => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v),
        'must look like https://<project>.supabase.co'],
      // Server routes read this at runtime, so it survives a build that could
      // not see the NEXT_PUBLIC_ value (Vercel hides Sensitive vars from builds).
      ['SUPABASE_URL', v => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v),
        'same value as NEXT_PUBLIC_SUPABASE_URL, without the prefix — add it in Vercel as a NON-sensitive variable'],
      // Supabase issues two generations of keys. Legacy ones are long JWTs
      // starting "eyJ"; current ones are sb_secret_… / sb_publishable_…
      // Accept both, or a valid new-format key reads as a placeholder.
      ['SUPABASE_SERVICE_ROLE_KEY', v => /^sb_secret_/.test(v) || v.length > 100,
        'Supabase → Settings → API Keys → the secret key (sb_secret_…), or the legacy service_role JWT'],
      ['NEXT_PUBLIC_SUPABASE_ANON_KEY', v => /^sb_publishable_/.test(v) || v.length > 100,
        'Supabase → Settings → API Keys → the publishable key (sb_publishable_…), or the legacy anon JWT'],
      ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', v => /^pk_(test|live)_/.test(v), 'starts with pk_test_ or pk_live_'],
      ['CLERK_SECRET_KEY', v => /^sk_(test|live)_/.test(v), 'starts with sk_test_ or sk_live_'],
    ],
  },
  {
    title: 'Money — funding, checkout and receipts fail without these',
    blocking: true,
    vars: [
      ['STRIPE_SECRET_KEY', v => /^sk_(test|live)_/.test(v), 'Stripe → Developers → API keys'],
      ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', v => /^pk_(test|live)_/.test(v), 'same page, publishable key'],
      ['STRIPE_WEBHOOK_SECRET', v => /^whsec_/.test(v), 'Stripe → Developers → Webhooks → your endpoint → signing secret'],
    ],
  },
  {
    title: 'Security',
    blocking: true,
    vars: [
      ['CLERK_WEBHOOK_SECRET', v => v && v !== 'placeholder',
        'Clerk → Webhooks → your endpoint → Signing Secret. Production refuses unsigned payloads.'],
      ['ENCRYPTION_KEY', v => /^[0-9a-fA-F]{64}$/.test(v),
        'exactly 64 hex characters — generate with: openssl rand -hex 32'],
    ],
  },
  {
    title: 'Optional — each feature degrades on its own',
    blocking: false,
    vars: [
      ['ANTHROPIC_API_KEY', v => v.startsWith('sk-ant-'), 'trip generation falls back to a curated list'],
      ['RESEND_API_KEY', v => v.startsWith('re_'), 'invite and receipt emails will not send'],
      ['TICKETMASTER_API_KEY', v => v.length > 8, 'Discover falls back to generic events'],
      ['LITEAPI_KEY', v => v.length > 8, 'hotel booking lane stays off'],
      ['TEQUILA_API_KEY', v => v.length > 8, 'flight booking lane stays off'],
      ['VIATOR_API_KEY', v => v.length > 8, 'activity booking lane stays off'],
      ['AEROAPI_KEY', v => v.length > 8, 'live flight status stays off'],
    ],
  },
];

// ── run ──────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}Reach doctor${C.reset}`);

const env = loadEnv();
if (!env) {
  section('Environment file');
  bad('.env.local is missing', 'Run:  npx vercel env pull .env.local');
  report();
  process.exit(1);
}

section('Environment variables');
const sensitiveCount = Object.values(env).filter(v => v === '[SENSITIVE]').length;
if (sensitiveCount) {
  console.log(`${C.dim}  ${sensitiveCount} value(s) came back as [SENSITIVE]: Vercel cannot read Secret-type`);
  console.log(`  variables back, so \`vercel env pull\` will never recover them.${C.reset}`);
}
for (const group of ENV_GROUPS) {
  console.log(`${C.dim}  ${group.title}${C.reset}`);
  for (const [name, valid, hint] of group.vars) {
    const v = env[name];
    // `vercel env pull` writes this literal for values stored as Secret type,
    // which Vercel will not read back. Treat it as absent, not as a value.
    if (v === '[SENSITIVE]') {
      const msg = `${name} came back as [SENSITIVE]`;
      const how = 'Vercel stores this as a Secret and will not reveal it.\n' +
                  `      Copy it from the source instead — see the table in GETTING-LIVE.md — and paste it into .env.local directly.`;
      group.blocking ? bad(msg, how) : warn(msg, how);
      continue;
    }
    if (!v) {
      group.blocking
        ? bad(`${name} is not set`, `${hint}\n      Set it in Vercel → Settings → Environment Variables, then: npx vercel env pull .env.local`)
        : warn(`${name} is not set`, hint);
    } else if (!valid(v)) {
      group.blocking
        ? bad(`${name} is set but looks wrong`, hint)
        : warn(`${name} looks wrong`, hint);
    } else {
      ok(name, `${v.slice(0, 6)}…${v.length} chars`);
    }
  }
}

// ── Supabase reachability and schema ─────────────────────────────────────
section('Database');
const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY || '';

const keyLooksReal = /^sb_secret_/.test(key) || key.length > 100;
if (!url || !keyLooksReal) {
  bad('Skipped — Supabase credentials are missing or malformed',
      'Fix the variables above first, then run this again.');
} else if (!/supabase\.co$/.test(new URL(url).hostname)) {
  const ref = url.match(/\/project\/([a-z0-9]{20})/);
  bad(`NEXT_PUBLIC_SUPABASE_URL points at ${new URL(url).hostname}, not your project's API host`,
      ref
        ? `That is the dashboard URL. The API host is:\n      https://${ref[1]}.supabase.co`
        : 'Copy the Project URL from Supabase → Settings → API.');
} else {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const missing = [];
  let reachable = true;

  for (const [file, tables] of Object.entries(TABLES)) {
    for (const t of tables) {
      try {
        const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=0`, { headers });
        if (r.status === 200) ok(`table ${t}`);
        else if (r.status === 404) { bad(`table ${t} is missing`); missing.push([file, t]); }
        else if (r.status === 401 || r.status === 403) {
          bad('Supabase rejected the service_role key',
              'Copy it again from Supabase → Settings → API → service_role. It is a long JWT.');
          reachable = false; break;
        } else {
          warn(`table ${t} returned HTTP ${r.status}`);
        }
      } catch (e) {
        bad(`Cannot reach Supabase (${e.message})`, 'Check the project URL and that the project is not paused.');
        reachable = false; break;
      }
    }
    if (!reachable) break;
  }

  if (missing.length) {
    const files = [...new Set(missing.map(([f]) => f))];
    blockers.push({
      m: `${missing.length} table(s) missing`,
      fix: `Run these in Supabase → SQL Editor, in this order:\n      ${files.join('\n      ')}`,
    });
  }

  // Has the Clerk-id migration been run? Clerk ids start with "user_".
  if (reachable && !missing.some(([, t]) => ['bookings', 'contributions', 'expenses'].includes(t))) {
    let stale = 0;
    for (const [t, col] of [['bookings', 'booked_by'], ['contributions', 'user_id'], ['expenses', 'paid_by']]) {
      try {
        const r = await fetch(`${url}/rest/v1/${t}?select=${col}&${col}=like.user_*&limit=1`, { headers });
        if (r.ok && (await r.json()).length) stale++;
      } catch {}
    }
    stale
      ? bad(`${stale} table(s) still hold Clerk ids instead of user ids`,
            'Run sql/migrate-clerk-ids-to-user-ids.sql in the Supabase SQL Editor.')
      : ok('user ids are consistent', 'migration applied or not needed');
  }
}

// ── Third-party reachability ─────────────────────────────────────────────
section('Third-party services');
async function ping(name, url, headers, fix) {
  try {
    const r = await fetch(url, { headers });
    if (r.ok) ok(name);
    else if (r.status === 401) bad(`${name} rejected the key`, fix);
    else warn(`${name} returned HTTP ${r.status}`, fix);
  } catch (e) { warn(`${name} unreachable (${e.message})`, fix); }
}

if (env.CLERK_SECRET_KEY?.startsWith('sk_')) {
  await ping('Clerk', 'https://api.clerk.com/v1/users?limit=1',
    { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` }, 'Check CLERK_SECRET_KEY.');
}
if (env.STRIPE_SECRET_KEY?.startsWith('sk_')) {
  await ping('Stripe', 'https://api.stripe.com/v1/balance',
    { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }, 'Check STRIPE_SECRET_KEY.');

  // The contribution webhook is what opens the funding gate.
  try {
    const r = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100',
      { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    if (r.ok) {
      const { data = [] } = await r.json();
      const live = data.filter(e => e.status === 'enabled');
      const covers = live.some(e =>
        e.url.includes('/api/webhooks/stripe') &&
        e.enabled_events.some(ev => ev === '*' || ev === 'payment_intent.succeeded'));
      covers
        ? ok('Stripe webhook covers payment_intent.succeeded')
        : bad('No enabled Stripe webhook for payment_intent.succeeded at /api/webhooks/stripe',
              'Without it, contributions never mark as collected and no booking can be approved.\n' +
              '      Stripe → Developers → Webhooks → Add endpoint:\n' +
              '        URL    https://<your-domain>/api/webhooks/stripe\n' +
              '        Events payment_intent.succeeded, payment_intent.payment_failed, charge.refunded');
    }
  } catch {}
}
if (env.ANTHROPIC_API_KEY?.startsWith('sk-ant-')) {
  await ping('Anthropic', 'https://api.anthropic.com/v1/models?limit=1',
    { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    'Check ANTHROPIC_API_KEY.');
}

// ── Deployment ───────────────────────────────────────────────────────────
if (CHECK_PROD) {
  section('Deployment');
  const site = (env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!site) warn('NEXT_PUBLIC_APP_URL is not set', 'Invite links fall back to the request origin.');
  else {
    try {
      const r = await fetch(`${site}/sign-in`, { redirect: 'manual' });
      r.status < 400 ? ok(`${site} is serving`, `HTTP ${r.status}`)
                     : bad(`${site} returned HTTP ${r.status}`, 'Check the latest Vercel deployment.');
    } catch (e) { bad(`${site} unreachable (${e.message})`); }
  }
}

// ── summary ──────────────────────────────────────────────────────────────
function report() {
  console.log('');
  if (!blockers.length && !warnings.length) {
    console.log(`${C.green}${C.bold}Everything checks out. The app should work.${C.reset}\n`);
    return;
  }
  if (blockers.length) {
    console.log(`${C.red}${C.bold}${blockers.length} blocking problem(s)${C.reset}`);
    blockers.forEach((b, i) => {
      console.log(`\n  ${i + 1}. ${C.bold}${b.m}${C.reset}`);
      if (b.fix) console.log(`     ${b.fix.split('\n').join('\n     ')}`);
    });
    console.log('');
  }
  if (warnings.length) {
    console.log(`${C.yellow}${warnings.length} optional feature(s) inactive${C.reset}`);
    warnings.forEach(w => console.log(`  · ${w.m}${w.fix ? ` ${C.dim}— ${w.fix}${C.reset}` : ''}`));
    console.log('');
  }
}

report();
process.exit(blockers.length ? 1 : 0);
