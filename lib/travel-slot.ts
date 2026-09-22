// ─── A slot that is the journey, not a place ─────────────────────────────
// The model answers in three slots a day and the last one is typed as a
// restaurant, because on every other day it is dinner. On the last day it is
// often the trip home, and Puerto Vallarta held this:
//
//   restaurant · book ahead · "Flight home."
//
// A flight filed as a table somebody should reserve. It is booked, if at all,
// on the trip's own flight line; this slot is only the moment you leave, and
// nothing about it is a reservation.
//
// Anchored to the start of the line on purpose. "Dinner near the airport" is
// dinner, and "Free time to pack before heading to the airport" is free time;
// only a slot whose first words are the journey is the journey.

const JOURNEY = [
  /^(?:take |catch |board )?(?:the |your )?flights? (?:home|back|out)\b/i,
  /^fly (?:home|back|out)\b/i,
  /^(?:head|go|drive|get|transfer|travel|leave)(?: back)? (?:to|for) the airport\b/i,
  /^(?:head|drive|travel|fly|go) home\b/i,
  /^depart(?:ure)?\b/i,
];

/** Whether a slot's text is the journey itself rather than something to do. */
export function isJourney(text: unknown): boolean {
  const t = String(text ?? '').trim();
  return !!t && JOURNEY.some(r => r.test(t));
}
