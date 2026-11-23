// ─── What the model is told on each turn (design §4) ────────────────────
// The model writes one or two spoken sentences and names the move it thinks
// the staff's words call for. It never decides the outcome (machine.ts does),
// never says "booked" (a guard below strips any such reply), and is given no
// payment details and no phone number, so it has none to give away.
import type { CallFacts } from '../script.ts';
import { spokenClock, spokenDate } from '../script.ts';
import type { Heard, Move, Step, Window } from './machine.ts';
import { ALLOWED } from './machine.ts';

export interface Said { speaker: 'assistant' | 'staff'; text: string }

const MOVE_MEANING: Record<Move, string> = {
  answer: 'answer their question or say you will wait (stay on this step)',
  press: 'a phone menu: put the digits to press in heard.digits',
  offered: 'they offered or agreed a time: put it in heard.time as HH:MM 24-hour',
  staff_yes: 'they said yes to the details you read back',
  corrected: 'they corrected the time, date or party you read back',
  full: 'they have no table that night',
  card: 'they need a card or deposit to hold it (heard.depositDollars if they named one)',
  needs_guest: 'they want to speak to the guest themselves',
  no_bots: 'they would rather not speak to an automated assistant',
  do_not_call: 'they asked not to be called again',
  voicemail: 'a recording, voicemail, or a menu with no way to a person',
};

/** The system prompt for one turn: the facts, the step, the moves it may take. */
export function systemPrompt(f: CallFacts, w: Window, step: Step): string {
  const moves = ALLOWED[step].map(m => `- ${m}: ${MOVE_MEANING[m]}`).join('\n');
  const notes = f.notes ? `Notes you may share if asked, word for word: "${f.notes}". Nothing else about the guests.` : 'You have no notes about the guests. If asked, say there is nothing special.';
  return [
    `You are an automated assistant phoning ${f.restaurant} to ask for a table for ${f.firstName}, a Reach member.`,
    'You have already said who you are and that the call is recorded. If asked whether you are a person, say you are an automated assistant.',
    `The request: ${f.partySize} people on ${spokenDate(f.date)}, ideally ${spokenClock(f.time)}, any time from ${spokenClock(w.start)} to ${spokenClock(w.end)}, under the name ${f.firstName}.`,
    notes,
    `Current step: ${step}.${step === 'CONFIRM_BACK' ? ' You have read back the details; listen for a yes or a correction.' : ''}`,
    'When you choose "offered", your reply reads back the party size, the date, the time and the name, and asks them to confirm: for example "Great, so that is four people on Friday, December 4 at 7:30 PM under Sam. Is that right?"',
    'You may only choose one of these moves:',
    moves,
    'Never give, read or ask for a card number, deposit or any payment detail. If they need one, ask them to hold it under the name and say the guest will call with a card.',
    'Never give anyone\'s phone number. Never say the table is booked or reserved.',
    `Never accept a time outside ${spokenClock(w.start)} to ${spokenClock(w.end)}. If offered one, say you will check with ${f.firstName} and call back.`,
    'If they would rather not speak to an automated assistant, apologise and end at once.',
    'Reply in one or two short spoken sentences. No lists, no markdown, no digits read as a long string.',
    'Answer with JSON only, no other text: {"say": "what you say", "move": "one of the moves above", "heard": {"time": "HH:MM or null", "digits": "digits or null", "depositDollars": "a number or null"}}',
  ].join('\n');
}

/** The JSON the model must return. */
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['say', 'move', 'heard'],
  properties: {
    say: { type: 'string' },
    move: { type: 'string' },
    heard: {
      type: 'object',
      additionalProperties: false,
      properties: {
        time: { type: ['string', 'null'] },
        digits: { type: ['string', 'null'] },
        depositDollars: { type: ['number', 'null'] },
      },
    },
  },
} as const;

export interface Reply { say: string; move: string; heard: Heard }

/** The model's text as a Reply, or null when it is not one. */
export function readReply(text: string): Reply | null {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.say !== 'string' || typeof r.move !== 'string') return null;
  const h = (r.heard && typeof r.heard === 'object' ? r.heard : {}) as Record<string, unknown>;
  return {
    say: r.say,
    move: r.move,
    heard: {
      time: typeof h.time === 'string' ? h.time : null,
      digits: typeof h.digits === 'string' ? h.digits : null,
      depositDollars: typeof h.depositDollars === 'number' ? h.depositDollars : null,
    },
  };
}

/** A card number or any long digit run is masked before it is said, stored or sent on. */
export function redact(text: string): string {
  return String(text ?? '').replace(/(?:\d[ -]?){12,19}/g, m => m.replace(/\d/g, '•'));
}

const CLAIMS = /\b(you(?:'re| are) (?:all )?(?:booked|confirmed|reserved)|(?:it|that|the table)(?:'s| is) (?:booked|confirmed|reserved)|i(?:'ve| have) (?:booked|reserved))\b/i;

/**
 * What the assistant may actually say: masked, short, and never claiming a
 * booking. A reply that claims one is replaced, not trimmed — the rule is
 * that only the restaurant's yes is evidence, and the agent's words never are.
 */
export function speakable(say: string): string {
  let s = redact(say).replace(/\s+/g, ' ').trim();
  if (CLAIMS.test(s)) s = 'Thank you.';
  if (s.length > 280) s = s.slice(0, 280).replace(/\s+\S*$/, '') + '.';
  return s;
}

/** The conversation so far, as the model's message list (staff = user, assistant = assistant). */
export function asMessages(turns: Said[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of turns) {
    const role = t.speaker === 'staff' ? 'user' : 'assistant';
    const content = redact(t.text);
    const prev = out.at(-1);
    if (prev && prev.role === role) prev.content += ' ' + content;
    else out.push({ role, content });
  }
  // The API needs the list to start with the user: the opening was ours,
  // said when they picked up, so the pick-up is the first user turn.
  if (out.length && out[0].role === 'assistant') out.unshift({ role: 'user', content: '(The restaurant picks up.)' });
  return out;
}
