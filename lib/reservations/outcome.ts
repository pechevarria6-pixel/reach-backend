// ─── What happened on the call, read from what the restaurant said ──────
// The one failure that matters most here is a model saying "you're
// confirmed" when nobody at the restaurant did. So the provider's post-call
// extraction is treated as a claim, and only two outcomes need proof:
//
//   confirmed            — the staff's own words, found in a STAFF turn of
//                          the transcript, say yes; that turn and every
//                          staff turn after it say nothing like no; the
//                          time and party asked for were said in that turn
//                          or in the question it answers; and the
//                          extraction names the same time and party (it is
//                          never defaulted to what was asked). The
//                          assistant's turns are never evidence of a yes:
//                          it was told not to say "booked", and if it did
//                          anyway that proves nothing. The question a yes
//                          answers is read only to know what the yes was to.
//   alternative_offered  — the time offered appears in a staff turn.
//
// Every other outcome means "not booked", which is safe to say even when the
// reading is wrong. A claim that fails its proof becomes 'unclear', which is
// also not booked and tells the person to check with the restaurant.
//
// Whether to stop calling a number is read separately from the outcome and
// errs towards stopping: the extraction OR the transcript is enough.

import type { CallFacts } from './script.ts';
import { DISCLOSURE_PARTS } from './script.ts';

export type Outcome =
  | 'confirmed'
  | 'alternative_offered'
  | 'no_availability'
  | 'voicemail'
  | 'no_answer'
  | 'refused'
  | 'do_not_call'
  | 'needs_guest'
  | 'unclear'
  | 'failed_to_place';

export const OUTCOMES: readonly Outcome[] = [
  'confirmed', 'alternative_offered', 'no_availability', 'voicemail', 'no_answer',
  'refused', 'do_not_call', 'needs_guest', 'unclear', 'failed_to_place',
];

export interface Turn { speaker: 'assistant' | 'staff'; text: string }

/** What the provider's post-call extraction says. Every field may be missing. */
export interface Extraction {
  outcome?: string | null;
  /** The staff's own words that answered the request, verbatim. */
  staff_quote?: string | null;
  held_time?: string | null;
  held_party?: number | string | null;
  name_on_booking?: string | null;
  offered_time?: string | null;
  asked_not_to_call?: boolean | string | null;
}

/** What the telephony said, separately from the conversation. */
export interface Signals {
  noAnswer?: boolean;
  voicemail?: boolean;
}

export interface Settled {
  outcome: Outcome;
  /** Never call this number again. */
  stopCalling: boolean;
  /** For confirmed: the time, party and name held. */
  held?: { time: string; party: number; name: string };
  /** For alternative_offered: the HH:MM they offered. */
  offeredTime?: string;
  /** The staff words the outcome rests on, when there are any. */
  staffQuote?: string | null;
  /**
   * Whether the first assistant turn carried the full disclosure. null when
   * the assistant never spoke (no answer, busy, a voicemail it never spoke
   * to): nothing was said, so nothing was said without the disclosure.
   */
  disclosed: boolean | null;
  /** Why a claim was not believed, for the log and the row. */
  doubt?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9': ]+/g, ' ').replace(/\s+/g, ' ').trim();

const STOP_CALLING = /\b(don'?t|do not|stop|never|quit)\s+(call|calling|ring|ringing|phone|phoning)\b|\btake (us|me|this number|our number) off\b|\bremove (us|me|this number|our number)\b|\bno more (calls|robot|robots)\b|\bput (us|me) on (your|the) do not call\b/;
const REFUSES_AI = /\b(don'?t|do not|won'?t|will not|not going to|can'?t)\s+(talk|speak|deal)\s+(to|with)\s+(a |an )?(robot|machine|ai|bot|computer)s?\b|\bno (robots|bots|ai|machines)\b|\b(don'?t|do not) (consent|agree) to (being |this |the )?record|\b(don'?t|do not) (want|like) (to be |being )?record/;
const AFFIRM = /\b(yes|yeah|yep|yup|sure|absolutely|of course|confirmed|booked|you'?re (all )?set|you'?re booked|we (have|got|can fit) (you|that)|got (you|it) (down|in)|see you (then|on|at)|that works|we can do (that|it)|perfect|great|certainly|okay|ok)\b/;
const NEGATE = /\b(no|not|sorry|unfortunately|can'?t|cannot|fully booked|booked up|don'?t have|nothing (at|for|available)|unavailable|we'?re full|no tables?)\b/;
/** "Sure, one moment" is a yes to holding, not to the table. */
const HOLDING = /\b(one|a) (moment|minute|min|sec|second)\b|\bhold (on|please)\b|\bplease hold\b|\bjust a (moment|minute|sec|second)\b|\blet me (check|see|look|ask)\b|\bhang on\b|\bbear with\b/;
const POLITE = /\b(no problem|not a problem|no worries)\b/g;

const PARTY_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** Whether a party size is said: "4", "four", "party of four". */
export function mentionsParty(text: string, n: number): boolean {
  const t = norm(text);
  const forms = [String(n)];
  if (PARTY_WORDS[n]) forms.push(PARTY_WORDS[n]);
  return forms.some(f => new RegExp(`(^|[^0-9:a-z])${f}($|[^0-9:a-z])`).test(t));
}

/** A clock time, said any of the ways a transcript writes it. "19:30" matches "7:30", "seven thirty", "half past seven". */
export function mentionsTime(text: string, hhmm: string): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return false;
  const t = norm(text);
  const h24 = Number(m[1]); const mm = m[2]; const h = h24 % 12 || 12;
  const WORDS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const hw = WORDS[h];
  const forms = [`${h}:${mm}`, `${m[1]}:${mm}`, `${h24}:${mm}`];
  if (mm === '00') forms.push(`${h} o'clock`, `${h} oclock`, `${h} pm`, `${h} am`, `${h}pm`, `${h}am`, `${hw} o'clock`, `${hw} pm`, `${hw} am`, `at ${h}`, `at ${hw}`);
  if (mm === '30') forms.push(`half past ${h}`, `half past ${hw}`, `${hw} thirty`, `${h} thirty`);
  if (mm === '15') forms.push(`quarter past ${h}`, `quarter past ${hw}`, `${hw} fifteen`);
  if (mm === '45') forms.push(`${hw} forty five`, `${hw} forty-five`);
  return forms.some(f => new RegExp(`(^|[^0-9:])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9])`).test(t));
}

/** "7:30", "19:30", "7:30 pm" → "19:30" given the time asked for (to settle a.m. / p.m.). */
export function asClock(raw: unknown, near: string): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]); const mm = m[2] ?? '00';
  if (h > 23 || Number(mm) > 59) return null;
  const suffix = m[3]?.replace(/\./g, '');
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  if (!suffix && h <= 12) {
    // No a.m./p.m. given: the reading nearest the time asked for.
    const asked = Number(near.slice(0, 2));
    const a = h % 12, b = (h % 12) + 12;
    h = Math.abs(a - asked) <= Math.abs(b - asked) ? a : b;
  }
  return `${String(h).padStart(2, '0')}:${mm}`;
}

const truthy = (v: unknown) => v === true || /^(true|yes|1)$/i.test(String(v ?? ''));

/** Whether the first assistant turn said every part of the disclosure. */
export function disclosedIn(turns: Turn[]): boolean | null {
  const first = turns.find(t => t.speaker === 'assistant' && t.text.trim());
  if (!first) return null;
  const said = norm(first.text);
  return DISCLOSURE_PARTS.every(p => said.includes(norm(p)));
}

export function settle(facts: CallFacts, turns: Turn[], x: Extraction | null | undefined, sig: Signals = {}): Settled {
  const ext = x ?? {};
  const staff = turns.filter(t => t.speaker === 'staff');
  const staffText = staff.map(t => norm(t.text));
  const said = (re: RegExp) => staffText.some(t => re.test(t));
  const disclosed = disclosedIn(turns);
  const claimed = String(ext.outcome ?? '').trim().toLowerCase();

  const refusedAI = said(REFUSES_AI) || claimed === 'refused';
  const stopCalling = said(STOP_CALLING) || truthy(ext.asked_not_to_call) || claimed === 'do_not_call' || refusedAI;
  const base = { stopCalling, disclosed };

  // Nobody spoke to us: the telephony is the only witness, and it is enough
  // for "not booked".
  if (!staff.length || sig.noAnswer || sig.voicemail) {
    if (sig.voicemail || claimed === 'voicemail') return { ...base, outcome: 'voicemail' };
    if (sig.noAnswer || !staff.length) return { ...base, outcome: 'no_answer' };
  }
  if (refusedAI) return { ...base, outcome: 'refused' };

  const quote = String(ext.staff_quote ?? '').trim();
  const quoted = quote ? norm(quote) : '';
  const quoteIsStaff = !!quoted && quoted.length >= 2 && staffText.some(t => t.includes(quoted));

  if (claimed === 'confirmed') {
    const doubt = (why: string): Settled => ({ ...base, outcome: stopCalling ? 'do_not_call' : 'unclear', staffQuote: quote || null, doubt: why });
    if (!quoted) return doubt('no staff words given for the confirmation');
    if (!quoteIsStaff) return doubt('the confirming words are not in anything the restaurant said');
    const withoutPolite = (s: string) => s.replace(POLITE, ' ');
    if (!AFFIRM.test(withoutPolite(quoted)) || NEGATE.test(withoutPolite(quoted))) return doubt('the restaurant\'s words do not say yes');
    // The turn the quote sits in — the last one, so a later turn is never
    // hidden behind an earlier "sure" — and everything staff said after it.
    let at = -1;
    turns.forEach((t, i) => { if (t.speaker === 'staff' && norm(t.text).includes(quoted)) at = i; });
    const turn = norm(turns[at].text);
    if (NEGATE.test(withoutPolite(turn))) return doubt('the rest of the restaurant\'s answer says no');
    if (HOLDING.test(turn)) return doubt('the restaurant\'s words agree to hold, not to the table');
    if (turns.slice(at + 1).some(t => t.speaker === 'staff' && NEGATE.test(withoutPolite(norm(t.text))))) {
      return doubt('the restaurant said no after the words given as a yes');
    }
    // A yes is to the time and party only when they were said: by staff in
    // that turn, or in the question that turn answers.
    let asked = '';
    for (let i = at - 1; i >= 0; i--) {
      if (turns[i].speaker === 'assistant') { asked = turns[i].text; break; }
    }
    if (!mentionsTime(turns[at].text, facts.time) && !mentionsTime(asked, facts.time)) return doubt('the time asked for was not said before the yes');
    if (!mentionsParty(turns[at].text, facts.partySize) && !mentionsParty(asked, facts.partySize)) return doubt('the party asked for was not said before the yes');
    // The extraction must name what was held; a missing one is not a match.
    if (ext.held_time == null || ext.held_time === '') return doubt('no time held was given');
    const heldTime = asClock(ext.held_time, facts.time);
    if (heldTime !== facts.time) return doubt(`the time held (${String(ext.held_time)}) is not the time asked for`);
    if (ext.held_party == null || ext.held_party === '') return doubt('no party held was given');
    const heldParty = Number(ext.held_party);
    if (heldParty !== facts.partySize) return doubt(`the party held (${String(ext.held_party)}) is not the party asked for`);
    return {
      ...base, outcome: 'confirmed', staffQuote: quote,
      held: { time: facts.time, party: facts.partySize, name: facts.firstName },
    };
  }

  if (claimed === 'alternative_offered') {
    const offered = asClock(ext.offered_time, facts.time);
    if (offered && offered !== facts.time && staff.some(t => mentionsTime(t.text, offered))) {
      return { ...base, outcome: stopCalling ? 'do_not_call' : 'alternative_offered', offeredTime: offered, staffQuote: quote || null };
    }
    return { ...base, outcome: stopCalling ? 'do_not_call' : 'unclear', doubt: 'the time offered is not in anything the restaurant said' };
  }

  if (stopCalling) return { ...base, outcome: 'do_not_call', staffQuote: quote || null };
  if (claimed === 'no_availability') return { ...base, outcome: 'no_availability', staffQuote: quote || null };
  if (claimed === 'needs_guest') return { ...base, outcome: 'needs_guest', staffQuote: quote || null };
  if (claimed === 'voicemail') return { ...base, outcome: 'voicemail' };
  if (claimed === 'no_answer') return { ...base, outcome: 'no_answer' };
  return { ...base, outcome: 'unclear', doubt: claimed ? `unrecognised outcome "${claimed}"` : 'no outcome extracted' };
}
