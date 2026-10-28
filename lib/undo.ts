// ─── "Undo" for five seconds, then it happens ───────────────────────────
// Skip, Change, Remove and Leave used to ask "are you sure?" and then act at
// once. A question before every tap trains people to tap through it, and
// once they have, nothing can be taken back. Undo turns it round: the screen
// changes now, a toast offers Undo for five seconds, and only when the toast
// runs out is the one request sent — with an idempotency key, so a flush on
// the way out of the page and the timer are the same request, never two.
//
// Confirms stay for the two things Undo cannot cover, because their effect
// reaches outside Reach: deleting a plan, and cancelling a booking.
//
// One at a time. Starting a second sends the first straight away — a queue
// of hidden pending changes is a screen that is lying about what has
// happened.

export const UNDO_MS = 5000;

export interface Undoable {
  /** Sends the one request. Rejecting reverts and says so (onFail). */
  commit: (key: string) => Promise<unknown> | unknown;
  /** Puts the screen back. Called on Undo, and on a failed commit. */
  revert?: () => void;
  /** After a failed commit has been reverted: say what happened. */
  onFail?: (error: unknown) => void;
}

export interface Pending {
  id: number;
  key: string;
}

type Timer = unknown;

export function undoKey(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `undo:${c.randomUUID()}`;
  } catch { /* fall through */ }
  return `undo:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createUndoQueue(opts: {
  ms?: number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
  key?: () => string;
} = {}) {
  const ms = opts.ms ?? UNDO_MS;
  const setT = opts.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
  const clearT = opts.clearTimer ?? ((t: Timer) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const mint = opts.key ?? undoKey;
  let seq = 0;
  type Entry = { id: number; key: string; job: Undoable; timer: Timer };
  let current: Entry | null = null;

  const fire = (c: Entry) => {
    // Exactly once: only whoever takes it off `current` sends it.
    if (current !== c) return;
    current = null;
    clearT(c.timer);
    Promise.resolve()
      .then(() => c.job.commit(c.key))
      .catch(err => {
        try { c.job.revert?.(); } finally { c.job.onFail?.(err); }
      });
  };

  return {
    /** The screen has already changed; this sends it when the time runs out. */
    schedule(job: Undoable): Pending {
      if (current) fire(current);
      const id = ++seq;
      const c: Entry = { id, key: mint(), job, timer: null };
      current = c;
      c.timer = setT(() => fire(c), ms);
      return { id, key: c.key };
    },
    /** Undo: nothing was sent, so nothing needs taking back on the server. */
    undo(id: number): boolean {
      if (!current || current.id !== id) return false;
      const c = current;
      current = null;
      clearT(c.timer);
      c.job.revert?.();
      return true;
    },
    /** Send whatever is waiting now — leaving the page, or starting another. */
    flush(): void {
      if (current) fire(current);
    },
    pending(): Pending | null {
      return current ? { id: current.id, key: current.key } : null;
    },
  };
}

export type UndoQueue = ReturnType<typeof createUndoQueue>;
