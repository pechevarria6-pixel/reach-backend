import { createClient } from '@supabase/supabase-js';

// ─── Supabase clients ────────────────────────────────────────────────────
// `NEXT_PUBLIC_*` variables are inlined into the bundle at BUILD time, not
// read at runtime. Vercel does not expose variables marked Sensitive to the
// build, so a sensitive NEXT_PUBLIC_ value compiles in as `undefined` and
// every call then fails with the unhelpful "supabaseUrl is required".
//
// Server code therefore prefers plain, server-only variables, which are read
// at runtime and unaffected by how the build was configured. The public names
// remain as a fallback so existing setups keep working.
//
//   SUPABASE_URL            preferred on the server
//   SUPABASE_ANON_KEY       preferred on the server
//   NEXT_PUBLIC_SUPABASE_*  fallback, and the only option in the browser

function required(name: string, value: string | undefined): string {
  if (value) return value;
  throw new Error(
    `${name} is not set. On Vercel, check that it is NOT marked Sensitive — ` +
    `sensitive variables are hidden from the build, so any NEXT_PUBLIC_ value ` +
    `compiles in as undefined. Run \`npm run doctor\` for the full picture.`
  );
}

// Browser client — anon key, respects RLS. Must use the public names, since
// nothing else reaches the browser.
export function createBrowserClient() {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

// Server client — service role, bypasses RLS.
// Only use in API routes and server components — never in the browser.
//
// Every read goes out with `cache: 'no-store'`.
//
// supabase-js calls the global fetch, and inside Next that is a patched
// fetch with a data cache behind it. A cached database read is a wrong
// answer that looks like a right one: the playbooks job reported eight rows
// still queued on three consecutive runs while the real number went five,
// two, nought — the count was correct code reading a stale response.
//
// That one was only a line in a report. The same staleness on a booking, a
// contribution or a member list is somebody acting on a row that has already
// changed, and this codebase reads back after every write precisely because
// those reads have to be true. A database is the authority or it is not.
export function createServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  return createClient(
    required('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)', url),
    required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
    }
  );
}
