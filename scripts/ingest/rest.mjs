// ─── Talking to the database from a GitHub runner ────────────────────────
// The ingest scripts run on a bare runner with nothing but Node and osmium,
// so they speak to PostgREST with fetch rather than pulling in the whole app
// to get supabase-js. Two rules follow from the repository being public:
//
//   - credentials come from the environment and nowhere else, and are never
//     printed — not in a log line, not in an error message;
//   - every failure is returned as a value the caller has to look at, the
//     same bargain supabase-js makes, because a write that fails quietly is
//     how "one venue failed to store on every run" lasted for weeks.
import { existsSync, readFileSync } from 'node:fs';

/**
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment. On a
 * laptop, .env.local fills in whatever the shell has not set (the app calls
 * the URL NEXT_PUBLIC_SUPABASE_URL there). Exits, naming only the variable,
 * when either is missing.
 */
export function credentials() {
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) { console.error('SUPABASE_URL is not set'); process.exit(1); }
  if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY is not set'); process.exit(1); }
  return { url: url.replace(/\/$/, ''), key };
}

/** A small PostgREST client. Returns { data, error, status }, never throws. */
export function rest({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function call(method, path, body, prefer) {
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      if (!res.ok) {
        // PostgREST's own error body: code, message, hint. Nothing of ours.
        const e = parsed && typeof parsed === 'object' ? parsed : { message: String(text).slice(0, 200) };
        return { data: null, status: res.status, error: { code: e.code ?? String(res.status), message: e.message ?? '', hint: e.hint ?? null } };
      }
      return { data: parsed, status: res.status, error: null };
    } catch (err) {
      return { data: null, status: 0, error: { code: 'network', message: err instanceof Error ? err.message : 'request failed' } };
    }
  }

  return {
    get: (path) => call('GET', path),
    /** Upsert on a named conflict target; the row itself is not sent back. */
    upsert: (table, rows, onConflict) =>
      call('POST', `${table}?on_conflict=${encodeURIComponent(onConflict)}`, rows, 'resolution=merge-duplicates,return=minimal'),
    insert: (table, row) => call('POST', `${table}?select=id`, row, 'return=representation'),
    patch: (pathWithFilter, body) => call('PATCH', pathWithFilter, body, 'return=minimal'),
  };
}

/** Every row a GET would return, a thousand at a time. */
export async function getAll(db, path, page = 1000) {
  const out = [];
  for (let offset = 0; ; offset += page) {
    const sep = path.includes('?') ? '&' : '?';
    const { data, error } = await db.get(`${path}${sep}limit=${page}&offset=${offset}`);
    if (error) return { data: null, error };
    out.push(...(data ?? []));
    if (!data || data.length < page) return { data: out, error: null };
  }
}
