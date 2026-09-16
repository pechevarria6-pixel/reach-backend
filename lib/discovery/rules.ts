// ─── Rules about people, not about providers ─────────────────────────────
// This lived in the Yelp module, which meant every other source had to
// import Yelp in order to respect somebody's hard nos.

/**
 * Anything a hard no matches never reaches the screen, whatever it scored.
 *
 * Whole words only. A plain substring test rules out a Departures Bar for
 * somebody who said no to art, and a cartwheel class along with it — which is
 * the worst way for this to fail, because the person never sees what was
 * taken away or why.
 */
export function notRuledOut(text: string, avoid: string[]): boolean {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return !avoid.some(raw => {
    const a = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (a.length < 3) return false;
    return hay.includes(` ${a} `);
  });
}

// ─── Can somebody actually turn up to this? ──────────────────────────────
// Discover is for evenings, not for suppliers and institutions. A caterer
// cooks for your party somewhere else. A university enrols you for a term.
// Both answer a search for "cooking class", and neither is a thing to go and
// do on a Thursday.
//
// Matched on the provider's own category first, because "collegeuniv" and
// "Monmouth University" are the same fact said two ways, and a category is
// the provider's considered answer rather than a word that happens to be in
// a name. Names are matched only on phrases that are hard to mistake: a
// place called "College Park Diner" is somewhere you can eat.

/** Provider categories that are never somewhere you spend an evening. */
const NOT_A_PLACE_TO_GO = [
  // They come to you, or you order from them.
  'caterer', 'caterers', 'catering', 'personalchefs', 'personal chefs',
  'fooddeliveryservices', 'food delivery services', 'meal delivery',
  'wholesalers', 'wholesale stores', 'wholesalestores', 'distributor',
  // Enrolment, not an evening out.
  'collegeuniv', 'colleges & universities', 'universities', 'highschools',
  'high schools', 'elementaryschools', 'elementary schools', 'preschools',
  'middleschools', 'specialtyschools', 'tutoring', 'testprep', 'test preparation',
  'driving schools', 'drivingschools', 'adulteducation', 'adult education',
];

/** Name phrases that say the same thing when a category is missing. */
const NOT_A_PLACE_BY_NAME = [
  'catering', 'caterers', 'wholesale', 'school district', 'community college',
  'university', 'board of education', 'tutoring center', 'tutoring centre',
];

export function canTurnUp(name: string, categories: string[] = []): boolean {
  const cats = categories.map(c => c.trim().toLowerCase()).filter(Boolean);
  if (cats.some(c => NOT_A_PLACE_TO_GO.includes(c))) return false;
  const hay = ` ${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return !NOT_A_PLACE_BY_NAME.some(phrase => hay.includes(` ${phrase} `));
}
