// ─── Lock it in → the itinerary becomes bookings ─────────────────────────
// REACH-PILOT-GATE-2026-11-08.md §A4: the bridge runs on the organiser's
// "Lock it in", not only when somebody later opens checkout. The bridge
// itself is POST /api/plans/[planId]/bookable — idempotent (a line already
// booked is skipped, and bookings_one_live_per_thing refuses a second live
// row), with failures named per line. Checkout still asks it on the way in,
// and the funding target is read after it, from the same rows.
//
// This is what the organiser is told once it has run: what was priced, and
// each line that was not, by name — never a count with nothing behind it.

export interface BridgeAnswer {
  created?: number;
  repriced?: number;
  failed?: number;
  alreadyBooked?: number;
  failures?: { title?: string | null; error?: string | null; stillPriced?: boolean }[];
  skipped?: { title?: string | null; why?: string | null }[];
  unlinked?: string[] | null;
}

export interface LockInReport {
  /** One sentence for the toast. */
  message: string;
  /** Each line that was not priced, and why, for the screen to keep. */
  notPriced: { title: string; why: string }[];
  /** The bridge did not answer: nothing is known about the rows. */
  unknown: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function lockInReport(answer: BridgeAnswer | null, opts: { solo: boolean }): LockInReport {
  const locked = opts.solo ? 'Locked in' : 'Locked in for everyone';
  if (!answer) {
    return {
      message: `${locked}. We couldn't price it just now — checkout tries again when it opens, and nothing is charged until you pay.`,
      notPriced: [], unknown: true,
    };
  }
  const notPriced = [
    ...(answer.failures ?? []).filter(f => !f.stillPriced).map(f => ({ title: String(f.title || 'Something'), why: String(f.error || 'it could not be priced') })),
    ...(answer.skipped ?? []).map(s => ({ title: String(s.title || 'Something'), why: String(s.why || 'Reach does not book this one') })),
  ];
  const priced = Math.max(0, (answer.created ?? 0) + (answer.repriced ?? 0) + (answer.alreadyBooked ?? 0));
  if (!priced && !notPriced.length) {
    return { message: `${locked}. Nothing here is booked through Reach.`, notPriced, unknown: false };
  }
  const head = priced ? `${locked} — ${plural(priced, 'thing', 'things')} priced` : `${locked}`;
  if (!notPriced.length) return { message: `${head}. Checkout has the prices; nothing is charged until you pay.`, notPriced, unknown: false };
  const first = notPriced[0].title;
  const tail = notPriced.length === 1
    ? `${first} couldn't be priced — checkout says why.`
    : `${first} and ${plural(notPriced.length - 1, 'other', 'others')} couldn't be priced — checkout says why.`;
  return { message: `${head}. ${tail}`, notPriced, unknown: false };
}
