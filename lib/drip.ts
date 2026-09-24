// ─── Drip questions: the rest of the quiz, one at a time ─────────────────
// Six upfront taps are all the quiz asks before the reveal. Everything else
// is asked later, as a single card, on the screen where the answer is
// obviously useful — "Where would you rather sit?" on a restaurant, not in a
// form. These are the rules for when one may appear, kept pure so they can
// be tested without a browser:
//
//   · at most ONE drip question per session;
//   · never during checkout, voting or trip creation;
//   · never one already answered;
//   · ✕ dismisses it for sixty days.
import { withinQuietPeriod } from './contracts/traveler-profile.ts';
import type { QuizAnswers } from './traveler-profile.ts';

export const DRIP_IDS = ['drinks', 'seating', 'night_out', 'camera_roll', 'free_interests', 'free_afternoon', 'upgrade'] as const;
export type DripId = typeof DRIP_IDS[number];

/**
 * Screens a drip card may never appear on. The card components are not
 * mounted there either; this is the rule written down so a new call site
 * cannot quietly break it.
 */
export const NO_DRIP_SCREENS = ['checkout', 'vote', 'createPlan', 'groupTrip', 'planPrefs', 'taste', 'planDetail'] as const;

/** Whether a drip question already has its answer. */
export function dripAnswered(id: DripId, a: QuizAnswers | null | undefined): boolean {
  const has = (v: unknown) => Array.isArray(v) ? v.length > 0 : v != null && v !== '';
  switch (id) {
    case 'drinks': return has(a?.drinks);
    case 'seating': return has(a?.seating);
    case 'night_out': return has(a?.night_out);
    case 'camera_roll': return has(a?.camera_roll);
    case 'free_interests': return has(a?.free_interests);
    case 'free_afternoon': return has(a?.free_afternoon);
    // The v2 upgrade card asks Q1 and Q4.
    case 'upgrade': return has(a?.first_move) && has(a?.restaurant);
  }
}

export interface DripContext {
  answers: QuizAnswers | null | undefined;
  /** What this browser remembers, for before the migration: id → when. */
  local?: Record<string, string> | null;
  /** Answered in this browser but not kept by the server (no migration yet). */
  answeredLocally?: string[] | null;
  /** The drip already shown this session, if any. */
  shownThisSession?: string | null;
  screen: string;
  now?: Date;
}

/** May this drip question be shown here, now? */
export function dripAllowed(id: DripId, ctx: DripContext): boolean {
  if ((NO_DRIP_SCREENS as readonly string[]).includes(ctx.screen)) return false;
  // One per session. The same card re-rendering is still that one card.
  if (ctx.shownThisSession && ctx.shownThisSession !== id) return false;
  if (dripAnswered(id, ctx.answers)) return false;
  if (ctx.answeredLocally?.includes(id)) return false;
  const now = ctx.now ?? new Date();
  if (withinQuietPeriod(ctx.answers?.drip_dismissed?.[id], now)) return false;
  if (withinQuietPeriod(ctx.local?.[id], now)) return false;
  return true;
}

/** The first of several candidates that may be shown, or null. */
export function pickDrip(candidates: DripId[], ctx: DripContext): DripId | null {
  for (const id of candidates) if (dripAllowed(id, ctx)) return id;
  return null;
}
