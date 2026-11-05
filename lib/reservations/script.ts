// ─── What the assistant is told, and what it says first ─────────────────
// A call request is built only from facts Reach holds: the restaurant and
// its own number from our venue table, the date and clock time the person
// chose, the party size, the first name of the person asking, and notes they
// wrote. Nothing is defaulted. The bookable route used to send '19:00' when
// a line had no time and the trip's first day for every dinner; a call made
// from either would ask a real restaurant for a table nobody wanted.
//
// The opening sentence is ours, not the model's. It is passed to the
// provider word for word as the first thing said, and the transcript is
// checked afterwards to see that it was (lib/reservations/outcome.ts).

export interface CallFacts {
  restaurant: string;
  /** The venue's own number, E.164, from our venue table. */
  venuePhone: string;
  /** YYYY-MM-DD, the night of the reservation. */
  date: string;
  /** HH:MM, 24-hour, as the person chose it. */
  time: string;
  partySize: number;
  /** First name of the person the table is for. */
  firstName: string;
  /** What they wrote for the restaurant, if anything. */
  notes?: string | null;
  /**
   * They asked Reach to watch for this table (lib/watch/tables.ts): if there
   * is none, ask whether the restaurant keeps a cancellation list. The
   * assistant still gives no number and puts nobody on anything itself.
   */
  cancellationList?: boolean;
}

export type FactProblem = 'restaurant' | 'venue_phone' | 'date' | 'time' | 'party_size' | 'first_name' | 'notes';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Every fact the call needs, or the list of what is missing. Never a default. */
export function checkFacts(f: Partial<CallFacts>): { ok: true; facts: CallFacts } | { ok: false; missing: FactProblem[] } {
  const missing: FactProblem[] = [];
  const restaurant = String(f.restaurant ?? '').trim();
  const venuePhone = String(f.venuePhone ?? '').trim();
  const date = String(f.date ?? '').trim();
  const time = String(f.time ?? '').trim();
  const firstName = String(f.firstName ?? '').trim().split(/\s+/)[0] ?? '';
  const notes = f.notes == null ? null : String(f.notes).trim().slice(0, 280) || null;
  const party = Number(f.partySize);
  if (!restaurant) missing.push('restaurant');
  if (!/^\+[1-9]\d{6,14}$/.test(venuePhone)) missing.push('venue_phone');
  const d = DATE.exec(date);
  if (!d || Number.isNaN(Date.UTC(+d[1], +d[2] - 1, +d[3])) || new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).getUTCDate() !== +d[3]) missing.push('date');
  if (!CLOCK.test(time)) missing.push('time');
  if (!Number.isInteger(party) || party < 1 || party > 20) missing.push('party_size');
  if (!firstName || firstName.length > 40) missing.push('first_name');
  if (missing.length) return { ok: false, missing };
  return { ok: true, facts: { restaurant, venuePhone, date, time, partySize: party, firstName, notes, ...(f.cancellationList === true ? { cancellationList: true } : {}) } };
}

/** "19:30" → "7:30". The research's own wording ("ask for 7:30 for 4"). */
export function clock(time: string): string {
  const m = CLOCK.exec(time);
  if (!m) return time;
  const h = Number(m[1]) % 12 || 12;
  return `${h}:${m[2]}`;
}

/** "19:30" → "7:30 PM", for the call itself, where a.m. and p.m. matter. */
export function spokenClock(time: string): string {
  const m = CLOCK.exec(time);
  if (!m) return time;
  return `${clock(time)} ${Number(m[1]) < 12 ? 'AM' : 'PM'}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-06" → "Friday, November 6". Read from its parts, never through a time zone. */
export function spokenDate(date: string): string {
  const m = DATE.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * The first sentence of every call. It says, before anything else, that
 * this is an automated AI assistant, that it is from Reach, who it is
 * calling for, and that the call is recorded — the best practice that
 * satisfies every regime the research found (FCC 24-17, CA AB 2905, Maine
 * 10 M.R.S. §1500-DD, all-party recording states).
 */
export function opening(f: CallFacts): string {
  return `Hi, this is an automated AI assistant from Reach, calling for ${f.firstName}. This call is recorded. `
    + `Do you have a table for ${f.partySize} on ${spokenDate(f.date)} at ${spokenClock(f.time)}?`;
}

/** The words a transcript's first assistant turn must contain for the call to count as disclosed. */
export const DISCLOSURE_PARTS = ['automated ai assistant', 'from reach', 'this call is recorded'];

/**
 * The rules the assistant follows, passed as a variable the provider's
 * agent prompt includes. The agent may ask, listen and end the call. It may
 * not accept a different time, give anybody's phone number, agree to a
 * deposit or card hold, or say the table is booked: whether it is booked is
 * read from what the restaurant said, afterwards, never from the assistant.
 */
export function instructions(f: CallFacts): string {
  return [
    `You are an automated AI assistant from Reach, calling ${f.restaurant} for ${f.firstName}.`,
    `You want a table for ${f.partySize} on ${spokenDate(f.date)} at ${spokenClock(f.time)}, under the name ${f.firstName}.`,
    f.notes ? `If they ask, the guest's note is: ${f.notes}` : 'There is no note from the guest.',
    'Always say you are an AI assistant if asked whether you are a person or a robot. Never claim to be human.',
    'If they object to an AI calling, or to the recording, apologise, thank them and end the call at once.',
    'If they ask not to be called again, say you will not call again, thank them and end the call.',
    `Ask only for ${spokenClock(f.time)} for ${f.partySize}. If that time is not available, ask which times near it they have, `
      + `thank them, say ${f.firstName} will call back to take one, and end the call. Never accept a different time or party size yourself.`,
    ...(f.cancellationList ? [
      `If they have no table for ${spokenClock(f.time)}, ask whether they keep a cancellation list or a waitlist for that night, and how ${f.firstName} can get on it. `
        + 'Do not give a phone number or put anybody on a list yourself: thank them and say the guest will contact them.',
    ] : []),
    'If they need a phone number, a card, a deposit or to speak to the guest, say the guest will contact them directly, thank them and end the call.',
    'If you reach voicemail or an automated menu with no way to a person, hang up without leaving a message.',
    'Never say the table is booked or confirmed yourself. If they confirm it, repeat back the time, party size and name, thank them and end the call.',
    'Keep the call under three minutes.',
  ].join('\n');
}
