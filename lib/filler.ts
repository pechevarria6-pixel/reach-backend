// ─── A plan that talks about itself ──────────────────────────────────────
// Two real itinerary lines, both in the "main event" slot of a night out:
//
//   "This is the slot for the thing Peter already has in mind for the
//    evening"
//   "Leave this window open — this is the slot for the thing you already
//    know you want to do"
//
// Neither is a plan. They are the model describing the shape of the form it
// is filling in, printed on somebody's evening where the gig should be. The
// prompt already bans "placeholder", "TBD" and "N/A"; it did not occur to
// anybody that filler would arrive as a fluent English sentence about the
// slot.
//
// This is the same family as an invented hotel: text that reads perfectly
// and says nothing true about the world. It is caught rather than trusted,
// because the prompt is an instruction and this is a check.

const META = [
  // Talking about the slot, the window, the space, the placeholder.
  /\bthis (?:is|would be) the (?:slot|spot|space|window|place) for\b/i,
  /\bleave this (?:slot|window|space|one|evening) open\b/i,
  /\b(?:the|a) slot for (?:the|whatever) thing\b/i,
  /\bwhatever you (?:already )?have in mind\b/i,
  /\bthe thing (?:you|they|he|she|[A-Z][a-z]+) already (?:has|have) in mind\b/i,
  /\bfill(?:ed)? in later\b/i,
  // The classics, in case they come back.
  /^\s*(?:placeholder|tbd|t\.b\.d\.|n\/a|activity|event|restaurant)\s*$/i,
  /\bplaceholder\b/i,
  /\bto be (?:confirmed|decided|determined)\b/i,
];

/** The phrase that makes this line a description of a form, or null. */
export function fillerClaim(text: unknown): string | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  for (const r of META) {
    const hit = r.exec(t);
    if (hit) return hit[0];
  }
  return null;
}

/**
 * Whether this line is fit to put on somebody's evening.
 *
 * Deliberately the whole line, not part of it. Unlike a stay claim — where
 * "check into the hotel" sits inside a sentence with three true things
 * around it — a line about the slot is about the slot all the way through.
 * There is nothing to rescue, and rescuing it would mean writing the
 * evening ourselves.
 */
export function isFiller(text: unknown): boolean {
  return fillerClaim(text) !== null;
}
