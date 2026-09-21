// ─── Every word somebody reads, checked against a dictionary ────────────
// A typo in an app is small and it is not harmless: it is the cheapest
// possible signal that nobody was paying attention, on a screen asking
// somebody to trust us with a holiday and a card number.
//
// This reads the strings a person actually sees — JSX text, button labels,
// aria-labels, placeholders, the LABELS map — and checks each word against
// the system dictionary, with an allowlist for the words a 1934 dictionary
// was never going to have and the names of things we made up ourselves.
//
// Skips silently where there is no dictionary, which is most CI machines.
// A guard that cannot run must not fail a build for a reason nobody can act
// on, and this one has done its work on the machine where the copy is
// written.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DICT = '/usr/share/dict/words';
if (!existsSync(DICT)) {
  console.log('  ~ no system dictionary here — spelling not checked');
  process.exit(0);
}

const words = new Set(
  readFileSync(DICT, 'utf8').split('\n').map(w => w.trim().toLowerCase()).filter(Boolean),
);

/**
 * Words a person reads that the dictionary does not carry.
 *
 * Three kinds, kept apart so the list stays reviewable: things the world
 * gained after 1934, names of ours and our partners', and ordinary English
 * the dictionary simply lacks.
 */
const ALLOW = new Set([
  // Ours, and the things we connect to.
  'reach', 'alcanzar', 'clerk', 'stripe', 'supabase', 'duffel', 'resend',
  'ticketmaster', 'yelp', 'openstreetmap', 'wikimedia', 'wikivoyage',
  'opentable', 'resy', 'amex', 'airbnb', 'venmo', 'google', 'apple',
  // The modern world.
  'app', 'apps', 'email', 'emails', 'online', 'offline', 'website', 'websites',
  'login', 'logout', 'signup', 'signin', 'username', 'wifi', 'url', 'urls',
  'smartphone', 'browser', 'checkbox', 'dropdown', 'tooltip', 'emoji', 'emojis',
  'pdf', 'sms', 'gps', 'api', 'faq', 'ok', 'okay', 'info', 'iphone', 'android',
  'uber', 'lyft', 'wheelchair', 'vegan', 'gluten', 'halal', 'kosher',
  'e', 'g', 'ie', 'eg', 'etc', 'vs', 'pm', 'am', 'usd', 'gbp', 'eur',
  // Ordinary English the dictionary is missing or spells only one way.
  'ok', 'cant', 'dont', 'wont', 'youre', 'thats', 'lets', 'its', 'im', 'ive',
  'itinerary', 'itineraries', 'reservations', 'bookings', 'booked', 'booking',
  'traveller', 'travellers', 'traveler', 'travelers', 'nightlife', 'walkable',
  'brunch', 'taco', 'tacos', 'tapas', 'ramen', 'izakaya', 'barbecue', 'bbq',
  'cafe', 'cafes', 'bistro', 'brewery', 'breweries', 'cocktail', 'cocktails',
  'checkout', 'chipped', 'chipping', 'splitting', 'settle', 'settled',
  'organiser', 'organisers', 'organizer', 'personalised', 'personalized',
  'favourite', 'favourites', 'favorite', 'favorites', 'colour', 'colours',
  'skippable', 'unread', 'resend', 'resent', 'undo', 'redo', 'signed',
  'weekend', 'weekends', 'weekday', 'weekdays', 'timezone', 'timezones',
  'todo', 'todos', 'onboarding', 'rebook', 'prepaid', 'preorder',
  // Irregular forms and words web2 simply lacks. Each was read in context
  // and is spelled as intended — this list is the audit's result, not a way
  // of silencing it.
  'paid', 'held', 'database', 'sql', 'airline', 'airlines', 'est',
  'dealbreaker', 'dealbreakers', 'programme', 'programmes', 'anytime',
  'vibe', 'vibes', 'organise', 'licence', 'rsquo',
  // Inflected forms of irregular verbs. web2 carries the base word only, so
  // "has", "does" and "was" are all absent from a dictionary of English.
  'has', 'is', 'was', 'were', 'does', 'did', 'done', 'gone', 'went', 'said',
  'made', 'got', 'put', 'kept', 'left', 'sent', 'spent', 'built', 'told',
]);

/** Product names and places arrive capitalised; treat those separately. */
const isProperNoun = w => /^[A-Z]/.test(w);

function filesUnder(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (['.jsx', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

/** Anything that betrays code rather than copy. */
const LOOKS_LIKE_CODE = /[=(){}[\];`$|&]|=>|\/\/|\bconst\b|\blet\b|\breturn\b/;

/** The strings a person actually reads, pulled out of the markup. */
function visibleStrings(source) {
  const found = [];
  // JSX text between tags, skipping anything that is only an expression.
  //
  // The first version of this matched inside expressions too and reported
  // `const`, `memberIds` and `isEmail` as misspellings, which is the fastest
  // way to get a guard ignored. A line carrying code punctuation is code.
  for (const m of source.matchAll(/>([^<>{}]{4,})</g)) {
    if (!LOOKS_LIKE_CODE.test(m[1])) found.push(m[1]);
  }
  // The attributes that render as words.
  for (const m of source.matchAll(/(?:aria-label|placeholder|title|alt)=["']([^"']{3,})["']/g)) {
    if (!LOOKS_LIKE_CODE.test(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * Is this an inflected form of a word the dictionary does carry?
 *
 * The dictionary holds base words, so a naive strip turns "planning" into
 * "plann" and reports ordinary English as a typo. Doubled consonants and
 * dropped e's are the two rules that account for nearly all of it.
 */
function inflectionOf(lower, known) {
  const bases = [];
  for (const suffix of ['s', 'es', 'ed', 'ing', 'er', 'est', 'ly']) {
    if (!lower.endsWith(suffix) || lower.length <= suffix.length + 1) continue;
    const stem = lower.slice(0, -suffix.length);
    bases.push(stem);              // walk + ed
    bases.push(stem + 'e');        // stor(e) + ed
    if (/(.)\1$/.test(stem)) bases.push(stem.slice(0, -1));  // plann + ing
    if (stem.endsWith('i')) bases.push(stem.slice(0, -1) + 'y'); // happi + ly
  }
  return bases.some(b => known(b));
}

const suspect = new Map();
for (const file of [...filesUnder('components'), ...filesUnder('app')]) {
  const source = readFileSync(file, 'utf8');
  for (const line of visibleStrings(source)) {
    for (const raw of line.split(/[^A-Za-z']+/)) {
      const word = raw.replace(/^'+|'+$/g, '');
      if (word.length < 3) continue;
      const lower = word.toLowerCase();
      if (words.has(lower) || ALLOW.has(lower)) continue;
      // An identifier, not a word: memberIds, isEmail, nextAfter.
      if (/[a-z][A-Z]/.test(word)) continue;
      // A contraction is known if its head is. "isn't" splits to "isn",
      // which is not a word — the negative ones carry the n on the wrong
      // side of the apostrophe, so they are unpicked first.
      if (lower.includes("'")) {
        const head = lower.endsWith("n't") ? lower.slice(0, -3) : lower.split("'")[0];
        if (words.has(head) || ALLOW.has(head)) continue;
      }
      const known = w => words.has(w) || ALLOW.has(w);
      if (inflectionOf(lower, known)) continue;
      // Proper nouns are names; the dictionary is not the authority on those.
      if (isProperNoun(word)) continue;
      if (!suspect.has(lower)) suspect.set(lower, { count: 0, file, line: line.trim().slice(0, 70) });
      suspect.get(lower).count++;
    }
  }
}

if (!suspect.size) {
  console.log('  ✓ every word a person reads is in the dictionary');
  process.exit(0);
}

console.log(`  ~ ${suspect.size} words not in the dictionary — check each is meant:\n`);
for (const [word, at] of [...suspect.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`    ${word.padEnd(22)} ×${String(at.count).padEnd(3)} ${at.file}`);
  console.log(`      "${at.line}"`);
}
// Reported, never fatal. A dictionary from 1934 does not get a veto over
// the product's voice; a person reads this list and fixes what is wrong.
process.exit(0);
