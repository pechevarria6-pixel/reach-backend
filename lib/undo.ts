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
  type Entry = { id: number; key: string; job: Undoable; timer: Timer; held: boolean };
  let current: Entry | null = null;
  // Commits that have been sent and not yet answered. A screen that reads
  // money or bookings waits on these (idle), so it never shows the figure
  // from before a change it is about to be told has happened.
  const inflight = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  const tell = () => { for (const l of [...listeners]) { try { l(); } catch { /* a listener's fault is its own */ } } };

  const fire = (c: Entry): Promise<void> => {
    // Exactly once: only whoever takes it off `current` sends it.
    if (current !== c) return Promise.resolve();
    current = null;
    clearT(c.timer);
    const sent: Promise<void> = Promise.resolve()
      .then(() => c.job.commit(c.key))
      .then(() => undefined, err => {
        // Reverted, then said: neither may stop the other, nor leave the
        // send unanswered for whoever is waiting on it (idle).
        try { c.job.revert?.(); } catch (e) { console.error('[undo] revert failed', e); }
        try { c.job.onFail?.(err); } catch (e) { console.error('[undo] onFail failed', e); }
      })
      .finally(() => { inflight.delete(sent); });
    inflight.add(sent);
    tell();
    return sent;
  };
  const idle = (): Promise<void> => Promise.all([...inflight]).then(() => undefined, () => undefined);

  return {
    /** The screen has already changed; this sends it when the time runs out. */
    schedule(job: Undoable): Pending {
      if (current) void fire(current);
      const id = ++seq;
      const c: Entry = { id, key: mint(), job, timer: null, held: false };
      current = c;
      c.timer = setT(() => { void fire(c); }, ms);
      tell();
      return { id, key: c.key };
    },
    /** Undo: nothing was sent, so nothing needs taking back on the server. */
    undo(id: number): boolean {
      if (!current || current.id !== id) return false;
      const c = current;
      current = null;
      clearT(c.timer);
      c.job.revert?.();
      tell();
      return true;
    },
    /**
     * Stop the clock while somebody is on the Undo (a pointer over it, focus
     * in it): five seconds is not long enough for everybody, and a change
     * must never go through while the way to take it back is in their hand.
     */
    hold(id: number): void {
      const c = current;
      if (!c || c.id !== id || c.held) return;
      c.held = true;
      clearT(c.timer);
      c.timer = null;
      tell();
    },
    /**
     * The clock starts again, a fresh window in full: somebody who reached
     * the Undo and moved off it gets as long as anybody else to change
     * their mind, and the toast's own fade restarts with it.
     */
    release(id: number): void {
      const c = current;
      if (!c || c.id !== id || !c.held) return;
      c.held = false;
      c.timer = setT(() => { void fire(c); }, ms);
      tell();
    },
    /**
     * Send whatever is waiting now — leaving the page, moving to another
     * screen, or starting another change — and resolve once every change
     * sent so far has been answered.
     */
    flush(): Promise<void> {
      if (current) void fire(current);
      return idle();
    },
    /** Resolves once nothing sent is still unanswered. Sends nothing itself. */
    idle,
    pending(): (Pending & { held: boolean }) | null {
      return current ? { id: current.id, key: current.key, held: current.held } : null;
    },
    /** Told whenever the waiting change is scheduled, held, sent or undone. */
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export type UndoQueue = ReturnType<typeof createUndoQueue>;
