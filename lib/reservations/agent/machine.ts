// ─── The calling agent's conversation rules (design §3) ─────────────────
// The model words each reply; this decides what happens next. A move the
// current step does not allow, or a fact that does not hold up (a "yes" to
// a time outside the member's window), never moves the call forward: the
// rules, not the model, are what a restaurant's staff can rely on Reach to
// keep to.
//
// Steps:  REQUEST ──offered a time in the window──▶ CONFIRM_BACK ──staff yes──▶ confirmed
//            │                                            └─ corrected (once) ─▶ REQUEST
//            └─ full · outside the window · card · not to bots · don't call · wants the guest
//               · voicemail / menu with no person ─▶ an ending
// Any step: 24 staff turns or 4 minutes ─▶ failed.

export type Step = 'REQUEST' | 'CONFIRM_BACK';

/** How a call ends, as stored on reservation_calls.agent_status. */
export type Ending =
  | 'confirmed' | 'needs_card' | 'declined' | 'declined_bot' | 'no_answer' | 'failed';

export type Move =
  | 'answer'        // answer a question (the name, the notes), or "one moment": stay
  | 'press'         // a phone menu: press heard.digits
  | 'offered'       // they offered heard.time: in the window → confirm it back
  | 'staff_yes'     // CONFIRM_BACK: they said yes to what was read back
  | 'corrected'     // CONFIRM_BACK: they corrected the time or the party
  | 'full'          // no tables that night
  | 'card'          // they need a card or deposit to hold it
  | 'needs_guest'   // they want to speak to the guest
  | 'no_bots'       // they would rather not speak to an automated assistant
  | 'do_not_call'   // they asked not to be called again
  | 'voicemail';    // a recording, or a menu with no way to a person

export const ALLOWED: Record<Step, readonly Move[]> = {
  REQUEST: ['answer', 'press', 'offered', 'full', 'card', 'needs_guest', 'no_bots', 'do_not_call', 'voicemail'],
  CONFIRM_BACK: ['answer', 'staff_yes', 'corrected', 'card', 'needs_guest', 'no_bots', 'do_not_call'],
};

export const LIMITS = { staffTurns: 24, millis: 4 * 60_000, presses: 3, corrections: 1 } as const;

export interface Window { start: string; end: string }

export interface Heard {
  /** HH:MM, 24-hour: a time they offered or agreed to. */
  time?: string | null;
  /** Digits for a phone menu, 0-9 # * only. */
  digits?: string | null;
  /** A deposit they named, in whole dollars. */
  depositDollars?: number | null;
}

export interface State {
  step: Step;
  /** The time in the window that was read back for a yes. */
  agreedTime: string | null;
  /** A time offered outside the window, kept so the member can be told it. */
  offeredOutside: string | null;
  presses: number;
  corrections: number;
  depositDollars: number | null;
}

export const start = (): State => ({
  step: 'REQUEST', agreedTime: null, offeredOutside: null, presses: 0, corrections: 0, depositDollars: null,
});

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether HH:MM falls inside the member's window, ends included. */
export function inWindow(time: string, w: Window): boolean {
  if (!CLOCK.test(time) || !CLOCK.test(w.start) || !CLOCK.test(w.end)) return false;
  return mins(time) >= mins(w.start) && mins(time) <= mins(w.end);
}

export type Next =
  | { kind: 'continue'; state: State; press?: string }
  | { kind: 'end'; state: State; ending: Ending; askedNotToCall: boolean; why: string };

const end = (state: State, ending: Ending, why: string, askedNotToCall = false): Next =>
  ({ kind: 'end', state, ending, why, askedNotToCall });

/** One step of the conversation. Pure: the same inputs always give the same answer. */
export function step(s: State, move: string, heard: Heard, w: Window): Next {
  if (!(ALLOWED[s.step] as readonly string[]).includes(move)) {
    return end(s, 'failed', `move "${move}" is not allowed at ${s.step}`);
  }
  const m = move as Move;
  const dep = typeof heard.depositDollars === 'number' && Number.isFinite(heard.depositDollars) ? heard.depositDollars : s.depositDollars;
  switch (m) {
    case 'answer':
      return { kind: 'continue', state: s };
    case 'press': {
      const d = String(heard.digits ?? '');
      if (!/^[0-9#*]{1,3}$/.test(d)) return end(s, 'no_answer', 'a menu with no digits we can press');
      if (s.presses >= LIMITS.presses) return end(s, 'no_answer', 'too many menus, no person');
      return { kind: 'continue', state: { ...s, presses: s.presses + 1 }, press: d };
    }
    case 'offered': {
      const t = String(heard.time ?? '');
      if (!CLOCK.test(t)) return { kind: 'continue', state: s }; // not heard clearly: ask again
      if (!inWindow(t, w)) return end({ ...s, offeredOutside: t }, 'declined', `offered ${t}, outside ${w.start}–${w.end}`);
      return { kind: 'continue', state: { ...s, step: 'CONFIRM_BACK', agreedTime: t } };
    }
    case 'staff_yes':
      if (!s.agreedTime) return end(s, 'failed', 'a yes with nothing read back');
      return end(s, 'confirmed', `staff said yes to ${s.agreedTime}`);
    case 'corrected':
      if (s.corrections >= LIMITS.corrections) return end(s, 'declined', 'corrected more than once');
      return { kind: 'continue', state: { ...s, step: 'REQUEST', agreedTime: null, corrections: s.corrections + 1 } };
    case 'full': return end(s, 'declined', 'no tables');
    case 'card': return end({ ...s, depositDollars: dep }, 'needs_card', 'a card or deposit is needed to hold it');
    case 'needs_guest': return end(s, 'needs_card', 'they want to speak to the guest');
    case 'no_bots': return end(s, 'declined_bot', 'they would rather not speak to an automated assistant');
    case 'do_not_call': return end(s, 'declined_bot', 'asked not to be called again', true);
    case 'voicemail': return end(s, 'no_answer', 'a recording or a menu with no person');
  }
}

/** What Reach says last, from code, never from the model. */
export const CLOSING: Record<Ending, string> = {
  confirmed: 'Thank you so much, that is everything. Have a good day.',
  needs_card: 'Thank you. They will call you directly to finish that. Have a good day.',
  declined: 'No problem at all, thank you for checking. Have a good day.',
  declined_bot: 'Of course, I am sorry to have bothered you. Have a good day.',
  no_answer: '',
  failed: 'I am sorry, I will have them call you directly. Thank you.',
};
