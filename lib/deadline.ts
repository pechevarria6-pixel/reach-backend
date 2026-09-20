// ─── Nothing waits forever ──────────────────────────────────────────────
// Checkout is the screen where somebody has decided to spend money, and
// every step of it was a bare `await fetch` with no deadline. A server that
// hangs rather than refusing leaves that screen saying "loading" until the
// person closes the app, and closing the app during a payment is the worst
// moment to make somebody guess.
//
// The geolocation lesson is the reason this races rather than trusting an
// option. Asked for a position with `timeout: 10000` and permission already
// granted, the browser called back neither way — not success, not error —
// for forty-five seconds and counting, and the timeout it had been given did
// nothing. An API can simply never answer, and the only defence is a clock
// of your own.
//
// So: our own timer, always, even where the underlying call claims to have
// one. `AbortSignal.timeout` is passed as well, because aborting a request
// that will never finish is better than leaving it running behind us.

export class Timeout extends Error {
  readonly what: string;
  constructor(what: string, ms: number) {
    super(`${what} did not answer within ${Math.round(ms / 1000)}s`);
    this.name = 'Timeout';
    this.what = what;
  }
}

/**
 * Whichever finishes first: the work, or the clock.
 *
 * The loser is ignored rather than cancelled, because a promise that never
 * settles cannot be cancelled — that is the whole problem — and leaving it
 * pending costs nothing once nobody is waiting on it.
 */
export function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Timeout(what, ms));
    }, ms);

    work.then(
      value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } },
    );
  });
}

/** A fetch that always comes back, one way or the other. */
export function fetchWithin(
  url: string,
  init: RequestInit = {},
  ms = 12000,
  what = 'the server',
): Promise<Response> {
  // Both: the signal asks the request to stop, the race guarantees we do.
  const signal = init.signal ?? AbortSignal.timeout(ms + 1000);
  return within(fetch(url, { ...init, signal }), ms, what);
}

/**
 * What to tell somebody, and what they can do about it.
 *
 * Never "something went wrong". On the screen where money moves, the two
 * things that matter are whether it was taken and what to do next, and a
 * person who cannot tell will either pay twice or give up.
 */
export function stalled(what: string, paid: boolean): string {
  return paid
    ? `We took your share but ${what} is taking longer than it should. `
      + "Nothing is lost — don't pay again. Reopen this trip in a minute and it will be here."
    : `${what} is taking longer than it should. Nothing has been charged — try again in a moment.`;
}

export function isTimeout(e: unknown): e is Timeout {
  return e instanceof Timeout || (e as { name?: string })?.name === 'Timeout';
}
