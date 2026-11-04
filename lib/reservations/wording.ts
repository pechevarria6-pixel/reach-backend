// ─── What a person is told about a reservation call ─────────────────────
// The exact state wording from the 2026-11-04 research:
//
//   calling     "Reach is calling Luigi's to ask for 7:30 for 4."
//   confirmed   "Luigi's confirmed on the call: 7:30 for 4, under Maria."
//   offered     "No 7:30. They offered 9:00. Take it?"
//   not booked  "Not booked. We couldn't reach Luigi's." — with the next
//               options (reserve online, call them) named in the body, and
//               only the ones we actually hold.
//
// Never "booked" while calling, and "confirmed" only for the outcome that
// was proven from the restaurant's own words (lib/reservations/outcome.ts).
// A solo plan says "you"; a group plan says "the group". A test call says it
// was a test, and that nothing was booked, before anything else.

import type { Outcome } from './outcome.ts';
import { clock, spokenDate } from './script.ts';

export interface WordingContext {
  restaurant: string;
  time: string;
  date: string;
  partySize: number;
  firstName: string;
  solo: boolean;
  /** The restaurant's own booking link, when we hold one. */
  reserveUrl?: string | null;
  /** The restaurant's number, for "call them". */
  phone?: string | null;
  test?: boolean;
}

export interface Wording { title: string; body: string }

export type CallState =
  | { state: 'calling' }
  | { state: 'settled'; outcome: Outcome; offeredTime?: string };

/** "+19195550100" → "(919) 555-0100"; anything else as it was given. */
export function prettyPhone(p: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p.trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p.trim();
}

/** The next options we actually hold, as one sentence — or a plain "pick another" when we hold none. */
export function nextOptions(c: WordingContext): string {
  const opts: string[] = [];
  if (c.reserveUrl) opts.push('reserve online');
  if (c.phone) opts.push(`call them on ${prettyPhone(c.phone)}`);
  const whose = c.solo ? 'your' : "the group's";
  if (!opts.length) return c.solo ? 'Pick another place on your plan.' : 'Pick another place on the plan.';
  const list = opts.length === 2 ? `${opts[0]} or ${opts[1]}` : opts[0];
  return `Next: ${list} — it's on ${whose} plan.`;
}

const NOT_BOOKED: Record<Exclude<Outcome, 'confirmed' | 'alternative_offered'>, (c: WordingContext) => string> = {
  voicemail: c => `Not booked. We couldn't reach ${c.restaurant}.`,
  no_answer: c => `Not booked. We couldn't reach ${c.restaurant}.`,
  no_availability: c => `Not booked. ${c.restaurant} has no table at ${clock(c.time)}.`,
  refused: c => `Not booked. ${c.restaurant} didn't want to take the call.`,
  do_not_call: c => `Not booked. ${c.restaurant} didn't want to take the call.`,
  needs_guest: c => (c.solo
    ? `Not booked. ${c.restaurant} wants to hear from you to book it.`
    : `Not booked. ${c.restaurant} wants to hear from someone in the group to book it.`),
  unclear: c => `Not booked. We couldn't get a clear yes from ${c.restaurant}.`,
  failed_to_place: c => `Not booked. The call to ${c.restaurant} didn't go through.`,
};

function live(s: CallState, c: WordingContext): Wording {
  const at = `${clock(c.time)} for ${c.partySize}`;
  if (s.state === 'calling') {
    return {
      title: `Reach is calling ${c.restaurant} to ask for ${at}.`,
      body: c.solo ? "You'll see their answer here." : "The group will see their answer here.",
    };
  }
  if (s.outcome === 'confirmed') {
    return {
      title: `${c.restaurant} confirmed on the call: ${at}, under ${c.firstName}.`,
      body: c.solo
        ? `Your table on ${spokenDate(c.date)} is on your plan.`
        : `The group's table on ${spokenDate(c.date)} is on the plan.`,
    };
  }
  if (s.outcome === 'alternative_offered' && s.offeredTime) {
    const offered = clock(s.offeredTime);
    const how = c.phone ? `call ${c.restaurant} on ${prettyPhone(c.phone)}` : `contact ${c.restaurant}`;
    return {
      title: `No ${clock(c.time)}. They offered ${offered}. Take it?`,
      body: c.solo
        ? `Reach only asked. To take ${offered}, ${how}${c.reserveUrl ? ' or reserve online' : ''}.`
        : `Reach only asked. If the group wants ${offered}, ${how}${c.reserveUrl ? ' or reserve online' : ''}.`,
    };
  }
  const outcome = s.outcome === 'alternative_offered' ? 'unclear' : s.outcome;
  const title = NOT_BOOKED[outcome](c);
  const body = outcome === 'unclear'
    ? `They may still be holding something, so check before you go. ${nextOptions(c)}`
    : nextOptions(c);
  return { title, body };
}

export function callWording(s: CallState, c: WordingContext): Wording {
  const w = live(s, c);
  if (!c.test) return w;
  return {
    title: `Test call — ${w.title}`,
    body: "Nothing was booked: this was a practice call to Reach's own test number, not the restaurant.",
  };
}
