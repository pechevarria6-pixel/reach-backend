// ─── Somewhere a person actually looks ──────────────────────────────────
// There are 208 `console.error` calls in the API routes and nothing reads
// them. They land in Vercel's function logs, which are searchable and which
// nobody searches until somebody already knows something is wrong — so the
// first anybody hears of a fault is a user saying a screen is blank.
//
// Today that cost real time twice. Two unit tests had been failing on every
// deployment for weeks and nothing looked, because the build never ran them.
// And /api/geo answered 200 with an empty list to every search for two
// hours: the route was fine, the data was fine, and no signal existed
// between "it returned" and "somebody noticed".
//
// This is deliberately not @sentry/nextjs. That package wraps the build, and
// the build broke twice today already; a reporter that can take the deploy
// down is worse than no reporter. This posts one event to Sentry's ingest
// endpoint and can fail at nothing but itself.
//
// It no-ops without a DSN, so it is safe to call everywhere and it starts
// working the moment the owner sets one. Swapping it for the real package
// later changes this file and no call sites.

const DSN = process.env.SENTRY_DSN;

/** Pull the bits of a DSN apart: https://KEY@oORG.ingest.sentry.io/PROJECT */
function endpoint(): { url: string; key: string } | null {
  if (!DSN) return null;
  try {
    const u = new URL(DSN);
    const project = u.pathname.replace(/^\//, '');
    if (!u.username || !project) return null;
    return { url: `${u.protocol}//${u.host}/api/${project}/store/`, key: u.username };
  } catch {
    // A malformed DSN is an owner-side typo. Say so once, here, rather than
    // failing silently and looking like "nothing has gone wrong yet".
    console.error('[report] SENTRY_DSN is set but is not a valid DSN — nothing will be reported');
    return null;
  }
}

const TARGET = endpoint();

export interface ReportContext {
  /** Where this happened, in words: 'trips/generate', 'funding'. */
  where: string;
  /** Anything that helps, minus anything personal. */
  extra?: Record<string, unknown>;
}

/**
 * Report a fault, and never become one.
 *
 * Never awaited by a request and never throws. An error reporter that adds
 * latency to a response, or fails a request by failing itself, costs more
 * than every fault it will ever report — which is the same bargain `track()`
 * makes next door.
 */
export function report(err: unknown, ctx: ReportContext): void {
  const message = err instanceof Error ? err.message : String(err);
  // Always to the log, DSN or not. The log is the fallback, not the plan.
  console.error(`[${ctx.where}]`, message, ctx.extra ?? {});
  if (!TARGET) return;

  const body = JSON.stringify({
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: ctx.where,
    environment: process.env.VERCEL_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    exception: {
      values: [{
        type: err instanceof Error ? err.name : 'Error',
        value: message,
        stacktrace: err instanceof Error && err.stack
          ? { frames: framesFrom(err.stack) }
          : undefined,
      }],
    },
    extra: scrub(ctx.extra ?? {}),
  });

  void fetch(TARGET.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${TARGET.key}, sentry_client=reach/1.0`,
    },
    body,
    signal: AbortSignal.timeout(4000),
  }).catch(() => {
    // Unreachable is not worth a second error about the first one.
  });
}

/** Sentry wants frames oldest-first; a stack reads newest-first. */
function framesFrom(stack: string) {
  return stack.split('\n').slice(1, 30).reverse().map(line => ({ filename: line.trim() }));
}

/**
 * Nothing personal leaves the building.
 *
 * The same rule `track()` follows: a name, an address or a phone number in
 * an error report is that data in a third party's system for ever, attached
 * to a fault nobody has read yet.
 */
const PERSONAL = /name|email|phone|address|passport|dob|birth|card|token|secret|key/i;
function scrub(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (PERSONAL.test(k)) { out[k] = '[removed]'; continue; }
    out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  return out;
}

/** Whether anything is listening, for a health check to report honestly. */
export const reportingConfigured = !!TARGET;
