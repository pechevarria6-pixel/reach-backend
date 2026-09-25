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
import { answersFromV2, type QuizAnswers, type V2Columns } from './traveler-profile.ts';

// `plan` and `late` are Q3 and Q5 asked on their own. A v2 account's two-tap
// upgrade card asks Q1 and Q4; section 7 sends the other two through here, so
// pace and late nights are asked eventually rather than left at 50 for good.
export const DRIP_IDS = ['drinks', 'seating', 'night_out', 'camera_roll', 'plan', 'late', 'free_interests', 'free_afternoon', 'upgrade'] as const;
export type DripId = typeof DRIP_IDS[number];

/**
 * "Anything you're weirdly into?" (free_interests) feeds Moments, and Moments
 * does not exist yet — so the answer would reach no screen. The question is
 * off until it does. The code, the contract field and any answers already
 * saved are kept; turn this on in the commit that gives the answer a screen.
 */
export const MOMENTS_ENABLED = false;

/** Drip questions whose answer has nowhere to go yet. */
export function dripHasAHome(id: DripId, moments = MOMENTS_ENABLED): boolean {
  if (id === 'free_interests') return moments;
  return true;
}

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
    case 'plan': return has(a?.plan);
    case 'late': return has(a?.late);
    case 'free_interests': return has(a?.free_interests);
    case 'free_afternoon': return has(a?.free_afternoon);
    // The v2 upgrade card asks Q1 and Q4.
    case 'upgrade': return has(a?.first_move) && has(a?.restaurant);
  }
}

export interface DripContext {
  answers: QuizAnswers | null | undefined;
  /**
   * The v2 columns. A v2 account answered drinks and seating long before
   * quiz_answers existed, and "never one already answered" includes those.
   */
  v2?: V2Columns | null;
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
  if (!dripHasAHome(id)) return false;
  if ((NO_DRIP_SCREENS as readonly string[]).includes(ctx.screen)) return false;
  // One per session. The same card re-rendering is still that one card.
  if (ctx.shownThisSession && ctx.shownThisSession !== id) return false;
  if (dripAnswered(id, { ...answersFromV2(ctx.v2), ...(ctx.answers ?? {}) })) return false;
  // A screen tapped past with Skip in the quiz was a "not now" already; the
  // drip does not ask it again on the next screen they open.
  if ((id === 'plan' || id === 'late') && ctx.answers?.skipped?.includes(id)) return false;
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

/**
 * A browser-storage key for one account. What this browser remembers about
 * the quiz — a result it could not keep yet, drips answered or dismissed — is
 * somebody's own, and a shared laptop is two people. No account, no key:
 * nothing is read or written rather than something shared.
 */
export function localKey(base: string, userId: string | null | undefined): string | null {
  return typeof userId === 'string' && userId.trim() ? `${base}:${userId.trim()}` : null;
}
