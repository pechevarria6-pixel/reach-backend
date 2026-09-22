// ─── Writing somebody into a room nobody booked ──────────────────────────
// A real plan in the table — Moab, seven nights, approved — opens with
// "Arrive in Moab, check into the hotel, unpack and get oriented", has "an
// afternoon doing nothing in particular back at the hotel pool" in the
// middle, and ends with "Check out of the hotel and head to the airport".
//
// That trip has no hotel. No item of type hotel, no hotel booking, nothing
// held anywhere that says where those people sleep. The hotel came from one
// word in the prompt: accommodation defaulted to 'hotel' when a group had
// not said what they wanted, so the model was told they were in a hotel and
// wrote the days around one. Then it added a pool.
//
// The prompt no longer says it. This is the part that does not depend on the
// prompt being obeyed, because the first thing somebody does with the first
// line of a plan is act on it — and "check into the hotel" sends them to a
// reception desk that is not expecting them.

/**
 * Phrases that assert a booked place to sleep.
 *
 * Deliberately about the *stay*, not the word. "The hotel bar is the best in
 * town" names a business; that is the venue-verification rule's job and it
 * has one. This is about being written into a room: arriving at it, leaving
 * it, going back to it, eating what comes with it.
 */
const STAY = new RegExp([
  'check[- ]?(?:in|into|ing in)\\b(?![^.]*\\bflight\\b)',
  'check[- ]?out(?:\\s+of)?\\b(?![^.]*\\bflight\\b)',
  // "at the hotel" in any position: "back at the hotel", "the rooftop bar at
  // the hotel", "dinner at the hotel restaurant". Naming a business that has
  // Hotel in its name — Hotel Congress — is a different question with its own
  // rule, and this does not match it.
  '\\bat (?:the|your) (?:hotel|hostel|apartment|flat|villa|airbnb|room|place)\\b',
  '(?:the|your) (?:hotel|hostel|villa|airbnb) (?:pool|lobby|bar|gym|spa|terrace|roof|rooftop|breakfast)',
  'breakfast (?:is )?included',
  'drop (?:your |the )?bags at (?:the|your) (?:hotel|hostel|room|place)',
  '(?:in|to) your room\\b',
].join('|'), 'i');

/** The phrase a line uses to put somebody in a room, or null. */
export function stayClaim(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const hit = STAY.exec(text);
  return hit ? hit[0] : null;
}

/**
 * The same line with the clause about the stay taken out.
 *
 * Clause by clause, because these arrive as "Arrive in Moab, check into the
 * hotel, unpack and get oriented with a slow walk around downtown" — three
 * true things and one invented one, and throwing the whole line away loses a
 * real day. Removing only the middle clause leaves a sentence that is still
 * a day and is now true.
 *
 * When nothing survives, the caller gets `null` and decides. There is no
 * generic sentence in here: inventing a replacement is how this started.
 */
export function withoutStayClaim(text: string): { text: string | null; removed: string | null } {
  const claim = stayClaim(text);
  if (!claim) return { text, removed: null };

  const clauses = text.split(/([,;]\s*)/);
  const kept: string[] = [];
  for (let i = 0; i < clauses.length; i += 2) {
    const clause = clauses[i];
    if (clause && !stayClaim(clause)) kept.push(clause.trim());
  }

  const joined = kept.filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
  // A fragment is not a sentence. Three words left over reads like a bug,
  // which is what it would be.
  if (joined.split(/\s+/).filter(Boolean).length < 4) return { text: null, removed: claim };

  const tidy = joined
    .replace(/^(and|then|but)\s+/i, '')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/[,;]\s*$/, '');
  return { text: tidy.charAt(0).toUpperCase() + tidy.slice(1), removed: claim };
}
