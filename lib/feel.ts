// ─── How the app feels under a thumb ─────────────────────────────────────
// Small, shared, and safe to call anywhere: on a server, in a test, in a
// browser that has none of these things. Each one does nothing rather than
// throw when what it needs is not there.

/** Whether this person asked their system for less movement. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

type Vibrating = { vibrate?: (ms: number) => boolean };

/**
 * A light tap under the finger when something is confirmed. Android Chrome
 * has navigator.vibrate; iOS Safari does not, and that is fine — this is a
 * courtesy, never the only sign something happened. 10ms is a tick, not a
 * buzz.
 */
export function haptic(nav: Vibrating | undefined = typeof navigator !== 'undefined' ? (navigator as Vibrating) : undefined): boolean {
  try {
    if (!nav || typeof nav.vibrate !== 'function') return false;
    return nav.vibrate(10) !== false;
  } catch {
    return false;
  }
}

/**
 * What a person reads when an optimistic change has to be taken back. The
 * server's own sentence when it sent one — it knows why — and otherwise a
 * plain one that says the screen is back to how it was. Never a status code
 * or a stack trace.
 */
export function revertWords(serverError: unknown, what: string): string {
  const said = typeof serverError === 'string' ? serverError.trim().replace(/[.!]+$/, '') : '';
  const machine = /^(internal|bad request|unauthori[sz]ed|forbidden|not found|failed to fetch|network|load failed|typeerror|\d{3}\b)/i;
  if (said && !machine.test(said) && said.length <= 160) {
    return `${said}, so ${what} is back to how it was.`;
  }
  return `That didn't save, so ${what} is back to how it was. Try again in a moment.`;
}
