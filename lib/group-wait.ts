// ─── Who the group is waiting on, as faces ───────────────────────────────
// Wherever a group plan waits on its people — answers, the vote, the money,
// travel details — the screen shows one face per person: ✓ for done, grey
// for still to do. Never an amount, never a vote choice, never what anybody
// answered (owner decision 13, 2026-09-25). A tap on a grey face nudges that
// one person through POST /api/plans/[id]/notify { kind, userId }.
//
// Everything a screen says about a nudge is worked out here from what the
// server actually answered, so the words cannot run ahead of the delivery:
// "waiting in their Reach notifications" was once said whenever anybody was
// reached, including when only a phone push got through. And a 429 used to
// be read as "a minute" at most, when the server's twelve-hour limit (lib/
// nudge.ts) can mean hours.
import { namesList } from './group-answers.ts';

export type NudgeKind = 'vote' | 'funding' | 'prefs';

/** One face, as GET /api/plans/[id]/notify answers it. */
export interface Face {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  isYou: boolean;
  done: boolean;
  /** False for somebody with nothing to do here — nothing to pay. */
  needed: boolean;
  nudgedUntil?: string | null;
  canNudge: boolean;
}

/**
 * The faces worth drawing. Somebody with nothing to do here is not a face on
 * this wait — a grey face would say they owe something they do not.
 */
export function facesShown(people: unknown): Face[] {
  if (!Array.isArray(people)) return [];
  return (people as Face[]).filter(p => p && typeof p.userId === 'string' && p.needed !== false);
}

/** Whether anybody other than the reader is still to do it. */
export function othersPending(faces: Face[]): boolean {
  return faces.some(f => !f.isYou && !f.done);
}

/** "40 seconds", "a minute", "25 minutes", "3 hours". Never a cap. */
export function waitWords(seconds: unknown): string {
  const s = Math.max(1, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  if (m === 1) return 'a minute';
  if (m < 60) return `${m} minutes`;
  const h = Math.ceil(m / 60);
  return h === 1 ? 'an hour' : `${h} hours`;
}

/** What the server's 429 said to wait, in whole seconds — hours if it said hours. */
export function retryAfter(body: unknown): number {
  const n = Number((body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 60;
}

interface NudgeBody {
  error?: string;
  message?: string;
  notified?: number;
  inApp?: number;
  pushed?: number;
  emailed?: number;
  nudged?: { userId: string; name: string }[];
  held?: { userId: string; name: string; retryAfterSeconds?: number }[];
  muted?: { userId: string; name: string }[];
  retryAfterSeconds?: number;
}

export interface NudgeOutcome {
  /** Somebody was reached by this press. */
  ok: boolean;
  /** One line for the toast, as the server said it. */
  text: string;
  /** Seconds the press is held for, when the server held it. */
  waitSeconds: number | null;
}

/**
 * What one press of a face, or "Remind everyone", did. `status` and `body`
 * are the response's own.
 */
export function nudgeOutcome(status: number, body: unknown): NudgeOutcome {
  const d = (body ?? {}) as NudgeBody;
  if (status === 429) {
    return { ok: false, text: d.error || 'They were nudged lately — try again later.', waitSeconds: retryAfter(d) };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, text: d.error || d.message || "Couldn't send that nudge — try again in a moment.", waitSeconds: null };
  }
  const names = (d.nudged ?? []).map(n => n?.name).filter((n): n is string => !!n);
  const held = (d.held ?? []).map(n => n?.name).filter((n): n is string => !!n);
  const muted = (d.muted ?? []).map(n => n?.name).filter((n): n is string => !!n);
  const off = muted.length
    ? `${namesList(muted)} ${muted.length === 1 ? 'has' : 'have'} reminders for this trip turned off`
    : '';
  if (names.length) {
    const lately = held.length ? ` · ${namesList(held)} ${held.length === 1 ? 'was' : 'were'} nudged in the last 12 hours` : '';
    return { ok: true, text: `Nudged ${namesList(names)}${lately}${off ? ` · ${off}` : ''}`, waitSeconds: null };
  }
  if (off) return { ok: false, text: `${off}, so nothing was sent.`, waitSeconds: null };
  if (d.message) return { ok: false, text: d.message, waitSeconds: null };
  // 200 and nobody reached: nothing went to them, so nothing is claimed.
  return { ok: false, text: "That didn't reach anyone just now.", waitSeconds: null };
}

/**
 * The answers screen's line after asking the others. Says only the ways it
 * actually went: the bell (inApp), a phone (pushed), email (emailed).
 */
export function askNote(body: unknown): string {
  const d = (body ?? {}) as NudgeBody;
  const names = (d.nudged ?? []).map(n => n?.name).filter((n): n is string => !!n);
  const reached = Number(d.notified) || 0;
  const muted = (d.muted ?? []).map(n => n?.name).filter((n): n is string => !!n);
  const off = muted.length ? ` ${namesList(muted)} ${muted.length === 1 ? 'has' : 'have'} reminders for this trip turned off.` : '';
  if (!reached) return off ? off.trim() : (d.message || 'Everyone else has already answered.');
  const who = names.length ? namesList(names) : `${reached} ${reached === 1 ? 'person' : 'people'}`;
  const inApp = Number(d.inApp) || 0, pushed = Number(d.pushed) || 0, emailed = Number(d.emailed) || 0;
  const ways = [
    inApp ? 'in their Reach notifications' : null,
    pushed ? (pushed === 1 ? 'on their phone' : `on ${pushed} phones`) : null,
    emailed ? 'by email' : null,
  ].filter(Boolean) as string[];
  return (ways.length ? `Nudged ${who} — ${namesList(ways)}.` : `Nudged ${who}.`) + off;
}
