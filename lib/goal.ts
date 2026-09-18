// ─── Reading what somebody already told us ──────────────────────────────
// The trip quiz opens with one free question — "What's this trip about?" —
// and then asks a series of lists. Somebody who has just written "a week
// somewhere warm on a beach before the baby arrives" should not be asked
// next what sort of trip they want. They said.
//
// So the goal is read for the answers it already contains, and those
// questions are not asked again. Deliberately conservative: a question
// skipped wrongly is an answer nobody gave, which is worse than one extra
// tap. Only an unmistakable word counts, and anything ambiguous is left to
// be asked properly.

/** The tripType option ids the quiz offers, and what plainly means each. */
const TRIP_TYPE_WORDS: Record<string, string[]> = {
  beach: ['beach', 'beaches', 'seaside', 'coast', 'coastal', 'sunbathing', 'snorkel', 'snorkelling', 'surf', 'surfing'],
  city: ['city break', 'museums', 'galleries', 'sightseeing', 'architecture'],
  nature: ['hiking', 'hike', 'mountains', 'national park', 'camping', 'wildlife', 'safari', 'forest', 'trails'],
  party: ['party', 'partying', 'clubbing', 'nightlife', 'bar crawl', 'stag', 'hen', 'bachelor', 'bachelorette'],
  wellness: ['spa', 'wellness', 'yoga', 'retreat', 'detox'],
  adventure: ['ski', 'skiing', 'snowboard', 'snowboarding', 'climbing', 'diving', 'rafting', 'trek', 'trekking', 'adventure'],
};

/**
 * Trip types the goal plainly states, or an empty list.
 *
 * Matched on whole words so "skiing" counts and "whisky" does not, and so
 * "beach" is found inside "beaches" only through the listed plural rather
 * than by loose substring matching — which is how a matcher starts booking a
 * sunset cruise because somebody mentioned the sea.
 */
export function tripTypesFromGoal(goal: string | null | undefined): string[] {
  const text = String(goal || '').toLowerCase();
  if (text.trim().length < 4) return [];
  const found: string[] = [];
  for (const [type, words] of Object.entries(TRIP_TYPE_WORDS)) {
    const hit = words.some(w => {
      // Word boundaries on both ends. A phrase like "city break" is matched
      // whole, so "city" alone does not qualify — too many trips mention one.
      const pattern = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
      return pattern.test(text);
    });
    if (hit) found.push(type);
  }
  return found;
}

/**
 * Whether the goal says enough to stop asking what sort of trip this is.
 *
 * One clear type is enough; several is better. Nothing found means the
 * question still gets asked, which is the safe direction to be wrong in.
 */
export function goalAnswersTripType(goal: string | null | undefined): boolean {
  return tripTypesFromGoal(goal).length > 0;
}
