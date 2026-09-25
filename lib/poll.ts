// ─── Polling that stops when nobody is looking ───────────────────────────
// On 2026-09-24 production answered 957 bell requests, 312 dismissal reads
// and 202 tracking calls in seven minutes, in bursts, from one deployment —
// while the bell is meant to ask once a minute. It could not be reproduced
// from a fresh tab, and the likeliest source was a tab left open across a
// deploy. Whatever set it off, nothing stood in its way: every poll ran in
// hidden tabs, kept going after the session had gone (53 answers of 401),
// and could start while the last request was still out.
//
// This is the one way the app polls now:
//   - only while the page is visible, with one catch-up read on return;
//   - never two at once for the same poll;
//   - stopped for good when the load says so (a 401: nobody to poll for).

export type PollResult = void | 'stop';

type Doc = {
  visibilityState: string;
  addEventListener: (t: string, f: () => void) => void;
  removeEventListener: (t: string, f: () => void) => void;
};
type Timers = {
  setInterval: (f: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

export function pollWhileVisible(
  load: () => Promise<PollResult> | PollResult,
  everyMs: number,
  env: { doc?: Doc | null; timers?: Timers } = {},
): () => void {
  const doc = env.doc === undefined ? (typeof document !== 'undefined' ? document : null) : env.doc;
  const timers = env.timers ?? { setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>) };
  let busy = false;
  let stopped = false;
  const visible = () => !doc || doc.visibilityState === 'visible';

  const run = async () => {
    if (stopped || busy || !visible()) return;
    busy = true;
    try {
      if ((await load()) === 'stop') stop();
    } catch {
      // A failed load is the load's to report; the poll just tries again later.
    } finally {
      busy = false;
    }
  };
  const onShow = () => { if (visible()) void run(); };
  const id = timers.setInterval(() => { void run(); }, everyMs);
  doc?.addEventListener('visibilitychange', onShow);
  void run();

  function stop() {
    if (stopped) return;
    stopped = true;
    timers.clearInterval(id);
    doc?.removeEventListener('visibilitychange', onShow);
  }
  return stop;
}
