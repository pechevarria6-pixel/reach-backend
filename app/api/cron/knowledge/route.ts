// ─── /api/cron/knowledge — writing down how a kind of trip works ────────
// A generator that knows a town still does not know the occasion. A ski week
// and a fortieth birthday in the same place are not the same trip: they wake
// at different hours, the money goes to different places, and the group
// falls out over different things. That knowledge does not change with the
// destination, so it is written down once here and read at generation time
// instead of being hoped for on every request.
//
// A few rows per run, on a schedule, never on anybody's request. The batch
// is small on purpose: it keeps the run inside the platform's function
// ceiling and keeps the spend somewhere between small and invisible.
//
// What gets stored is craft and never facts. Nothing written here may name a
// restaurant, a bar, a hotel or an event — what is stored is read into every
// trip of its kind, so one invented name here is not a bad itinerary, it is
// six months of bad itineraries. The prompt says so, and the answer is read
// back and refused if it names anything (lib/playbooks.ts → namedThings).
//
// Runs on a schedule (see vercel.json). Can also be triggered by hand with
// the same secret, which is how you check what it is producing:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/knowledge?format=text
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseModelJSON, textOf } from '@/lib/trip-schema';
import { anthropicOrNull, askForJSON } from '@/lib/anthropic';
import {
  PlaybookSchema, PLAYBOOK_JSON_SCHEMA, researchPrompt, nameCorrection,
  namedThings, expiresAt, startOfLocalDay, positiveInt,
} from '@/lib/playbooks';

export const dynamic = 'force-dynamic';
// A handful of model calls back to back. Generous, but bounded: a stuck run
// should report what it did rather than be killed mid-write.
export const maxDuration = 300;

// Rows per run. Each is a model call, and a run that tries everything at
// once finishes nothing and bills for all of it.
const BATCH_DEFAULT = 3;
// Rows per day, across every run. The cost ceiling, and the reason a broken
// prompt cannot quietly spend a month's budget overnight.
const CAP_DEFAULT = 30;

// Background work that nobody is waiting on, writing prose somebody will
// follow on a Saturday. Worth the capable model.
const MODEL = 'claude-sonnet-5';
const EFFORT = 'medium' as const;
const MAX_TOKENS = 4000;

// How long a claimed row stays claimed. A run that is killed mid-flight
// leaves its rows marked as being worked on, and with eleven rows in the
// table one stranded row is a kind of trip that never gets written at all.
const STALE_CLAIM_MS = 30 * 60_000;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when one is set.
  // With no secret configured this endpoint would spend money for anybody
  // who found the URL, so it refuses rather than running open.
  if (!secret) {
    console.error('[cron/knowledge] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

type Outcome = { kind: string; status: string; detail?: string };

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const asText = req.nextUrl.searchParams.get('format') === 'text';
  const db = createServerClient();
  const batchSize = positiveInt(process.env.KNOWLEDGE_BATCH_SIZE, BATCH_DEFAULT);
  const dailyCap = positiveInt(process.env.KNOWLEDGE_DAILY_CAP, CAP_DEFAULT);
  const report: Outcome[] = [];

  const answer = (
    body: Record<string, unknown>,
    status = 200,
  ) => {
    if (!asText) return NextResponse.json(body, { status });
    const rows = report.map(r => `${r.kind.padEnd(22)} ${r.status.padEnd(10)} ${r.detail ?? ''}`.trimEnd());
    return new NextResponse([...rows, rows.length ? '' : null, JSON.stringify(body)].filter(v => v !== null).join('\n'), {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  };

  // ── What has already been spent today ────────────────────────────────
  // `refreshed_at` is stamped whenever a call was spent on a row, whether it
  // worked or not, so a run of failures counts against the day exactly like
  // a run of successes. The day is the local one: counting against a UTC day
  // hands back a fresh allowance at eight in the evening in New York.
  const { count: spentToday, error: capError } = await db
    .from('trip_playbooks')
    .select('id', { count: 'exact', head: true })
    .gte('refreshed_at', startOfLocalDay());

  if (capError) {
    console.error('[cron/knowledge] could not count what today has cost', capError.message);
    return answer({ error: capError.message }, 500);
  }

  const room = Math.max(0, dailyCap - (spentToday ?? 0));
  if (room === 0) {
    return answer({
      processed: 0, ready: 0, failed: 0,
      remaining_queued: await stillQueued(db),
      note: `daily cap of ${dailyCap} reached`,
    });
  }

  // ── What is due ──────────────────────────────────────────────────────
  // Never written, or written long enough ago that it should be written
  // again, or claimed by a run that never came back. Oldest first, so no row
  // can be skipped forever by newer ones.
  const now = new Date();
  const nowIso = now.toISOString();
  const staleClaim = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();

  const { data: due, error: dueError } = await db
    .from('trip_playbooks')
    .select('id, archetype, status, refreshed_at, created_at')
    .or([
      'status.eq.queued',
      `and(status.eq.ready,expires_at.lt.${nowIso})`,
      `and(status.eq.enriching,locked_at.lt.${staleClaim})`,
      `and(status.eq.enriching,locked_at.is.null)`,
    ].join(','))
    .order('refreshed_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(Math.min(batchSize, room));

  if (dueError) {
    console.error('[cron/knowledge] could not read what is due', dueError.message);
    return answer({ error: dueError.message }, 500);
  }
  if (!due?.length) {
    return answer({ processed: 0, ready: 0, failed: 0, remaining_queued: 0, note: 'nothing due' });
  }

  // ── Claim them ───────────────────────────────────────────────────────
  // Marked before any call is made, so two overlapping runs do not both pay
  // for the same row. `locked_at` is what lets a later run take back a claim
  // from a run that died holding it.
  const ids = due.map(r => r.id);
  const { error: claimError } = await db
    .from('trip_playbooks')
    .update({ status: 'enriching', locked_at: nowIso })
    .in('id', ids);

  if (claimError) {
    console.error('[cron/knowledge] could not claim rows', claimError.message);
    return answer({ error: claimError.message }, 500);
  }

  // A missing key is a dormant lane, not a fault. Put the claims straight
  // back so the next run — or the next deploy with a key — picks them up.
  const client = anthropicOrNull();
  if (!client) {
    console.error('[cron/knowledge] ANTHROPIC_API_KEY is not set — nothing to do');
    const { error: released } = await db
      .from('trip_playbooks')
      .update({ status: 'queued', locked_at: null })
      .in('id', ids);
    if (released) console.error('[cron/knowledge] could not release rows', released.message);
    return answer({
      processed: 0, ready: 0, failed: 0,
      remaining_queued: await stillQueued(db),
      note: 'no model key set',
    }, 503);
  }

  let ready = 0;
  let failed = 0;

  for (const row of due) {
    const kind = String(row.archetype);
    let stored: Record<string, unknown> | null = null;
    let problem: string | null = null;
    let transient = false;
    let named: string[] = [];

    try {
      // One call, then at most one more — and only when the first answer
      // broke the one rule that matters, with the offending words quoted
      // back at it. A malformed answer is not retried here: it is a job for
      // whoever tunes the prompt, and retrying it costs the same as a
      // working one.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await askForJSON({
          client,
          model: MODEL,
          maxTokens: MAX_TOKENS,
          prompt: researchPrompt(kind) + (named.length ? nameCorrection(named) : ''),
          schema: PLAYBOOK_JSON_SCHEMA as unknown as Record<string, unknown>,
          label: 'cron knowledge',
          effort: EFFORT,
        });

        const raw = textOf(res);
        const parsed = parseModelJSON(raw, PlaybookSchema, 'cron knowledge');
        if (!parsed) {
          // parseModelJSON has already logged which of the two it was. The
          // tail goes in the row so it can be read without the logs.
          problem = `did not validate: ${raw.slice(-300)}`;
          break;
        }

        // The rule, checked rather than trusted.
        named = namedThings(parsed);
        if (named.length) {
          console.error('[cron/knowledge] answer named real things', { kind, named: named.slice(0, 8) });
          problem = `named real things: ${named.slice(0, 12).join(', ')}`;
          continue;
        }

        // The model is asked to echo the kind back; it is overwritten here
        // anyway, because the row it belongs to is the authority on that.
        stored = { ...parsed, archetype: kind };
        problem = null;
        break;
      }
    } catch (e: any) {
      // The call itself failed — a rate limit, a timeout, a 5xx. Nothing is
      // wrong with the row, so it goes back in the queue rather than being
      // marked as a failure somebody has to go and look at.
      transient = true;
      problem = `call failed: ${String(e?.message ?? e).slice(0, 200)}`;
      console.error('[cron/knowledge] call failed', { kind, message: e?.message });
    }

    if (stored) {
      const { error: wrote } = await db
        .from('trip_playbooks')
        .update({
          playbook: stored,
          status: 'ready',
          error: null,
          refreshed_at: new Date().toISOString(),
          expires_at: expiresAt(),
          locked_at: null,
        })
        .eq('id', row.id);

      if (wrote) {
        // The row stays claimed and falls out of the claim window on its
        // own, so a write that failed is tried again rather than lost.
        console.error('[cron/knowledge] could not store the answer', { kind, error: wrote.message });
        failed++;
        report.push({ kind, status: 'write_failed', detail: wrote.message });
        continue;
      }
      ready++;
      report.push({ kind, status: 'ready' });
      continue;
    }

    const { error: marked } = await db
      .from('trip_playbooks')
      .update({
        // Transient means the row is fine and the world was busy. A content
        // failure is a job for whoever tunes the prompt, so it stops here
        // and waits to be looked at rather than being retried on a loop.
        status: transient ? 'queued' : 'failed',
        error: (problem ?? 'unknown').slice(0, 500),
        // Not stamped for a transient failure: no answer was produced, so it
        // must not eat a slot out of the day's cap.
        ...(transient ? {} : { refreshed_at: new Date().toISOString() }),
        locked_at: null,
      })
      .eq('id', row.id);

    if (marked) console.error('[cron/knowledge] could not record the failure', { kind, error: marked.message });
    if (!transient) failed++;
    report.push({ kind, status: transient ? 'retry_next_run' : 'failed', detail: problem?.slice(0, 120) });
  }

  const summary = {
    processed: due.length,
    ready,
    failed,
    remaining_queued: await stillQueued(db),
  };
  console.log('[cron/knowledge]', JSON.stringify({ ...summary, report }));
  return answer(summary);
}

/** How many are still waiting. Reported, never acted on, so a count that
 *  cannot be read is a zero in the report rather than a failed run. */
async function stillQueued(db: ReturnType<typeof createServerClient>): Promise<number> {
  const { count, error } = await db
    .from('trip_playbooks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'queued');
  if (error) {
    console.error('[cron/knowledge] could not count what is left', error.message);
    return 0;
  }
  return count ?? 0;
}
