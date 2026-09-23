// ─── Travel essentials — what an airline needs before it will sell a seat ──
// No airline issues a ticket without a legal name, a date of birth and a
// gender marker, because every one of them is checked against the document
// you travel on. Everything else here is a convenience: a Known Traveler
// Number saves a queue, a home airport saves a question, a seat preference
// saves a conversation.
//
// This module is deliberately pure. It decides what is missing and what is
// safe to show other people; the routes decide who is asking. Keeping the two
// apart is what makes the visibility rule testable — see tests/essentials.
//
// Nothing here logs. These values do not belong in a log line, an error
// message or an exception, so they never travel through one.

/** What an airline requires, in the order a person would fill it in. */
export const REQUIRED = ['legal name', 'date of birth', 'gender', 'phone number'] as const;

export type Gender = 'female' | 'male' | 'x' | 'unspecified';

/**
 * The genders a booking API will accept. Airlines carry the IATA/ICAO set,
 * and 'x' is the marker on passports issued as non-binary. 'unspecified' is
 * stored for someone who has told us they would rather not say — it is not a
 * value a ticket can carry, so it does not count as answered.
 */
export const GENDERS: Gender[] = ['female', 'male', 'x', 'unspecified'];

/** What we hold for one person. Every field is optional until they fill it. */
export interface Essentials {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;   // YYYY-MM-DD
  gender?: string | null;
  /**
   * The airline's requirement, not ours. A real Duffel order came back
   * "Field 'phone_number' can't be blank" — it is how the carrier reaches
   * somebody when a flight moves, and no ticket is issued without one.
   */
  phone?: string | null;
  knownTravelerNumber?: string | null;
  homeAirport?: string | null;
  seatPreference?: string | null;
}

/** What a group member is allowed to see about somebody else. */
export interface Readiness {
  userId: string;
  name: string;
  ready: boolean;
  /** Field names, never values: "date of birth", not the date. */
  missing: string[];
}

/** A date of birth is a real past date, not a typo and not tomorrow. */
export function validBirthDate(value: string | null | undefined, today = new Date()): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  // Date() rolls 2025-02-30 forward to March. Comparing the parts back
  // catches that, so a day that does not exist is refused rather than moved.
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  if (date.getTime() > today.getTime()) return false;
  // The oldest person on record reached 122. Anything past that is a slip of
  // the century digit, and a 1024 birth year fails at the airline anyway.
  if (y < today.getUTCFullYear() - 123) return false;
  return true;
}

/**
 * A number that could actually be somebody's.
 *
 * Deliberately shaped like E.164, because that is what the airline checks
 * against: a real country and area code, and the right number of digits. A
 * looser rule was worse than none — seven digits passed, the traveller was
 * told they were ready to fly, and the order came back "Field 'phone_number'
 * is invalid" at the moment of booking. Telling somebody they are ready when
 * they are not is the one thing this file exists to prevent.
 *
 * It cannot be exhaustive. Numbering plans are a moving target and the
 * carrier is the final judge; this catches the wrong shape, not the wrong
 * number.
 */
export function plausiblePhone(phone: string | null | undefined): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '');
  // E.164 allows up to 15 digits, and no country has a subscriber number
  // short enough to make a total under 8 workable for an airline.
  if (digits.length < 8 || digits.length > 15) return false;
  // A number that is all one digit is a placeholder somebody typed to get
  // past the form.
  if (/^(\d)\1+$/.test(digits)) return false;
  return true;
}

/**
 * What this person still has to provide before a ticket can be issued.
 * Returns field names in the order of REQUIRED — the list is shown to the
 * person themselves, and to their group as a readiness chip.
 */
export function missingFor(e: Essentials | null | undefined, today = new Date()): string[] {
  const missing: string[] = [];
  const first = (e?.firstName ?? '').trim();
  const last = (e?.lastName ?? '').trim();
  // Both halves, because a ticket carries both and "Cher" is not a case we
  // are solving in v1 — somebody with one name can put it in both fields.
  if (!first || !last) missing.push('legal name');
  if (!validBirthDate(e?.dateOfBirth, today)) missing.push('date of birth');
  const gender = (e?.gender ?? '').trim().toLowerCase();
  // 'unspecified' is a stored answer, and not one an automated booking can
  // carry — see duffelGender. It is still counted as answered here: that
  // flight is handed to the airline's own site when it is quoted (see
  // airlineHandoff), so somebody who has told us is not left looking at an
  // unfinished form for ever.
  if (!gender || !GENDERS.includes(gender as Gender)) missing.push('gender');
  if (!plausiblePhone(e?.phone)) missing.push('phone number');
  return missing;
}

/** True when this person could be put on a flight today. */
export function isReady(e: Essentials | null | undefined, today = new Date()): boolean {
  return missingFor(e, today).length === 0;
}

/**
 * The only shape that may describe somebody else. Takes a full record and
 * returns status without a single value from it: no name parts, no date, no
 * gender, no document number. The display name is not an essential — it is
 * already on every member list in the group.
 */
export function readinessOf(
  userId: string,
  displayName: string,
  e: Essentials | null | undefined,
  today = new Date(),
): Readiness {
  const missing = missingFor(e, today);
  return { userId, name: displayName, ready: missing.length === 0, missing };
}

/**
 * Who is not ready, named, for a message shown to the group. Names only —
 * "Marco and Priya still need their details" tells the organizer exactly
 * enough to go and ask them, and nothing about what the answers are.
 */
export function blockingMessage(readiness: Readiness[]): string | null {
  const notReady = readiness.filter(r => !r.ready).map(r => r.name.trim() || 'someone');
  if (!notReady.length) return null;
  const names = notReady.length === 1
    ? notReady[0]
    : `${notReady.slice(0, -1).join(', ')} and ${notReady[notReady.length - 1]}`;
  const needs = notReady.length === 1 ? 'needs' : 'need';
  return `${names} ${needs} to add their travel details before flights can be booked.`;
}

/**
 * A document number proves itself by its last four characters and nothing
 * else — the same rule the passport field already follows. Used even for the
 * owner's own screen, so a shoulder-surfed phone does not give up a KTN.
 */
export function maskNumber(value: string | null | undefined): { present: boolean; last4?: string } {
  if (!value) return { present: false };
  return { present: true, last4: value.slice(-4) };
}
