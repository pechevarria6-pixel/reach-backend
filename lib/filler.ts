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

// ─── Text that came back broken ──────────────────────────────────────────
// Rows in the table, shown to people as written:
//   "…before dinner.a the CCAroundRaleigh at your own pace.\n p22"
//   "…once you've parked near the pub.morplinsert1"
// Model output that frayed at the edges. Nothing checked for it, because
// every other check here is about what a sentence claims, not whether it is
// one. Where it starts, so a line can be cut there or dropped; -1 when clean.
const ALLOWED_DOTS = /\b(?:e\.g\.|i\.e\.|a\.m\.|p\.m\.|u\.s\.|etc\.|vs\.|approx\.|st\.|dr\.|mt\.|ft\.|no\.)|\b[a-z0-9-]+\.(?:com|org|net|io|co|us|uk|ca|mx|es|fr|de|it|travel|info|biz)\b/gi;
const BREAKS: RegExp[] = [
  /[a-z][.!?][a-z]/,                      // "dinner.a", "pub.morplinsert"
  /\n\s*\S{1,6}\s*$/,                     // a stray "\n p22" at the end
  /[A-Z]{2,}[A-Z][a-z]+[A-Z]/,            // "CCAroundRaleigh"
  /\b[a-z]{2,}\d+\b/,                     // "morplinsert1", "p22" glued to letters
];

export function corruptionAt(text: unknown): number {
  const raw = String(text ?? '');
  if (!raw.trim()) return -1;
  // Blank out what looks like a break but is ordinary: abbreviations, web
  // addresses. Same length, so positions still line up with the original.
  const t = raw.replace(ALLOWED_DOTS, m => ' '.repeat(m.length));
  let at = -1;
  for (const re of BREAKS) {
    const m = re.exec(t);
    if (m && (at < 0 || m.index < at)) at = m.index;
  }
  return at;
}

/** The text up to the last full sentence before the break, or null if there isn't one worth keeping. */
export function beforeCorruption(text: string): string | null {
  const at = corruptionAt(text);
  if (at < 0) return text;
  const head = text.slice(0, at + 1);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  const kept = end > 0 ? head.slice(0, end + 1).trim() : '';
  return kept.length >= 20 ? kept : null;
}
