// ─── What a person reads about a table Reach books ───────────────────────
// Solo and group are different sentences, not one with a word swapped: a
// table for one is "you", and a table for a group says whose name it is
// under, because that is the person the restaurant will ask for.
import { PLATFORM_LABEL, type TablePlatform } from './types.ts';

export interface TableWho {
  restaurant: string;
  platform: TablePlatform;
  date: string;
  time: string;
  covers: number;
  /** First name the table is under. */
  under: string;
  solo: boolean;
}

/** "Fri, Nov 6", from YYYY-MM-DD, without the server's time zone moving the day. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "7:30 PM" from "19:30". */
export function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** Said once the platform has sent its reservation id — and only then. */
export function bookedCopy(w: TableWho, ref: string): { title: string; body: string } {
  const when = `${dayLabel(w.date)} at ${clockLabel(w.time)}`;
  const p = PLATFORM_LABEL[w.platform];
  return w.solo
    ? { title: `You're booked at ${w.restaurant}`, body: `${when}, for ${people(w.covers)}. ${p} confirmation ${ref}.` }
    : { title: `${w.restaurant} is booked`, body: `${when}, for ${people(w.covers)}, under ${w.under}. ${p} confirmation ${ref}.` };
}

/** A table held while somebody reads the terms. Never "booked". */
export function heldCopy(w: TableWho, minutes: number, button: string): { title: string; body: string } {
  return {
    title: `Held for ${minutes} minutes — not booked yet`,
    body: `${PLATFORM_LABEL[w.platform]} is holding ${clockLabel(w.time)} on ${dayLabel(w.date)} for ${people(w.covers)} at ${w.restaurant}. Read the restaurant's policy below, then tap ${button}.`,
  };
}

/** Pending on the platform's page: something is still owed, so it is not booked. */
export function pendingCopy(w: TableWho): { title: string; body: string } {
  return {
    title: `Not booked yet — ${PLATFORM_LABEL[w.platform]} needs a card`,
    body: `${PLATFORM_LABEL[w.platform]} is holding ${clockLabel(w.time)} at ${w.restaurant} until a card is added on its page. It isn't booked until then.`,
  };
}

/** The label of the button that books, by platform. OpenTable names it in its terms. */
export const BOOK_BUTTON: Record<TablePlatform, string> = { opentable: 'Complete reservation', yelp: 'Book this table' };

export const TABLE_COPY = {
  /** Yelp cannot move a booking. Said plainly, before anything is cancelled. */
  yelpNoChange:
    "Yelp can't change a booking. To move it, cancel this table and book the new time — the new time isn't held while you do, so check it's still open first.",
  outcomeUnknown:
    "We asked for this table and never heard back, so we can't tell yet whether it was booked. Don't book it again — check the platform's confirmation email, or ring the restaurant.",
  inProgress: 'Somebody is booking this table right now.',
  changedMeanwhile: 'This changed while you were looking — nothing was booked. Reopen it.',
  holdMissing: 'That hold has gone — nothing was booked. Pick the time again.',
  termsNotAccepted: "Accept the platform's terms and the restaurant's policy first — nothing was booked.",
  needsTime: 'Pick a time first. Reach only asks a restaurant for a time somebody chose.',
  /** A table Reach asked for that OpenTable still holds until a card is added. Not booked, and not "somebody is booking it". */
  pendingCard: (platform: string) =>
    `${platform} is holding this table until a card is added on its page — it isn't booked yet. Add the card there, or cancel it; if ${platform} lets it go, Reach can book the dinner again.`,
  /**
   * Cancelling a table whose booking never answered. Reach may have booked
   * it, so it never says it did not — and it cannot cancel what it holds no
   * reservation number for.
   */
  outcomeUnknownCancel: (platform: string) =>
    `We asked ${platform} for this table and never heard back, so we can't tell whether it was booked — and without ${platform}'s reservation number Reach can't cancel it. Look for ${platform}'s confirmation email under your name and cancel it from there, or ring the restaurant.`,
  needsGuest: 'We need your first and last name, email and phone number on your profile before a table can be booked under them.',
} as const;
