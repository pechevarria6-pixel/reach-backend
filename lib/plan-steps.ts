// ─── Three checks, in order, before a trip is ready to go ────────────────
// The owner's ask: a trip is finished by walking three pages in order and
// signing each one off — the overview is right, the budget is right, and
// every booking and reservation is done — and only then is it ready to go.
// Before this a plan had no idea whether anybody had looked at it, and
// "done" was whatever you inferred from a progress bar.
//
// One set of rules, used by the screen to lock the tabs and by the server
// to refuse a sign-off out of order, so the two cannot disagree.

export const STEPS = ['overview', 'budget', 'bookings'] as const;
export type Step = typeof STEPS[number];

/** When each step was signed off, and by whom. Absent means not yet. */
export type Review = Partial<Record<Step, { at: string; by: string } | null>>;

export type StepState = 'done' | 'open' | 'locked';

/** Done, open to sign, or waiting on the one before it. */
export function stepStates(review: Review | null | undefined): Record<Step, StepState> {
  const out = {} as Record<Step, StepState>;
  let previousDone = true;
  for (const s of STEPS) {
    const done = !!review?.[s];
    out[s] = done && previousDone ? 'done' : previousDone ? 'open' : 'locked';
    previousDone = previousDone && done;
  }
  return out;
}

/** Why a step cannot be signed yet, or null when it can. */
export function cannotSign(step: Step, review: Review | null | undefined, outstanding = 0): string | null {
  const i = STEPS.indexOf(step);
  if (i < 0) return 'not a step';
  const before = STEPS.slice(0, i).find(s => !review?.[s]);
  if (before) return `Check the ${before === 'overview' ? 'overview' : before} first.`;
  if (step === 'bookings' && outstanding > 0) {
    return `${outstanding} ${outstanding === 1 ? 'thing is' : 'things are'} still to book.`;
  }
  return null;
}

/** Only the lines a booking has to happen for. */
export interface TrackLine {
  id?: string | null;
  type?: string | null;
  booking_mode?: string | null;
  venue_website?: string | null;
  filled?: boolean;
}
export interface TrackBooking { itinerary_item_id?: string | null; status: string }

export interface Tracked<T> { line: T; who: 'reach' | 'you'; done: boolean }

/**
 * Everything that has to be booked for this trip, and whether it has been.
 *
 * Reach's lines are done when their booking is confirmed — the itinerary
 * line itself is never written back, so the booking is the only place that
 * knows. Everything else somebody arranges (a table to book ahead, a ticket
 * from the seller) is done when they have said so. Walk-ins and lines with
 * no booking mode need nothing and are not counted: a checklist that can
 * never reach the end is not a checklist.
 */
export function bookingTracker<T extends TrackLine>(lines: T[], bookings: TrackBooking[] = []): {
  items: Tracked<T>[]; done: number; total: number;
} {
  const confirmed = new Set(bookings.filter(b => b.status === 'confirmed').map(b => b.itinerary_item_id).filter(Boolean));
  const items: Tracked<T>[] = [];
  for (const line of lines ?? []) {
    if (line.booking_mode === 'reach') {
      items.push({ line, who: 'reach', done: !!line.id && confirmed.has(line.id) });
    } else if (line.booking_mode === 'ahead' || (line.type === 'event' && line.venue_website)) {
      items.push({ line, who: 'you', done: !!line.filled });
    }
  }
  return { items, done: items.filter(i => i.done).length, total: items.length };
}
