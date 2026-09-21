// ─── Reading what somebody already told us ──────────────────────────────
// Both quizzes open with one free question — "What's this trip about?",
// "What's this night about?" — and then ask a series of lists. Somebody who
// has just written "a week somewhere warm on a beach before the baby
// arrives" should not be asked next what sort of trip they want. They said.
//
// So the opening answer is read for the answers it already contains, and
// those questions are not asked again. Deliberately conservative: a question
// skipped wrongly is an answer nobody gave, which is worse than one extra
// tap. Only an unmistakable word counts, and anything ambiguous is left to
// be asked properly.
//
// The hard part is not finding the words. It is that half of what people
// write is what they do NOT want — "Tim's 40th, he hates clubs, somewhere we
// can actually talk" — and a matcher that only looks for words finds
// "clubs" there and books one. So every match is checked for what comes
// before it, and a negated want becomes a hard no rather than a want.

/** Which quiz option each phrase plainly means. */
type Vocab = Record<string, Record<string, string[]>>;

const WANTS: Vocab = {
  tripType: {
    beach: ['beach', 'beaches', 'seaside', 'coast', 'coastal', 'sunbathing', 'snorkel', 'snorkelling', 'surf', 'surfing'],
    city: ['city break', 'museums', 'galleries', 'sightseeing', 'architecture'],
    nature: ['hiking', 'hike', 'mountains', 'national park', 'camping', 'wildlife', 'safari', 'forest', 'trails'],
    party: ['party', 'partying', 'clubbing', 'nightlife', 'bar crawl', 'stag', 'hen', 'bachelor', 'bachelorette'],
    wellness: ['spa', 'wellness', 'yoga', 'retreat', 'detox'],
    adventure: ['ski', 'skiing', 'snowboard', 'snowboarding', 'climbing', 'diving', 'rafting', 'trek', 'trekking', 'adventure'],
  },
  accommodation: {
    hotel: ['hotel'],
    resort: ['all inclusive', 'all-inclusive', 'resort'],
    airbnb: ['airbnb', 'vacation rental', 'rental house', 'self catering', 'self-catering'],
    villa: ['villa'],
    boutique: ['boutique hotel', 'boutique'],
    hostel: ['hostel', 'hostels'],
  },
  pace: {
    relaxed: ['relaxed', 'relaxing', 'slow', 'chill out', 'unwind', 'decompress', 'lazy'],
    packed: ['see everything', 'packed', 'jam packed', 'jam-packed', 'action packed'],
    spontaneous: ['spontaneous', 'no plan', 'wing it', 'play it by ear'],
    romantic: ['romantic', 'honeymoon', 'anniversary', 'just the two of us'],
    wild: ['go wild', 'messy', 'blowout', 'rowdy'],
  },
  nightWhere: {
    water: ['by the water', 'waterfront', 'harbour', 'harbor', 'riverside', 'on the river', 'seafront'],
    city: ['downtown', 'in town', 'city centre', 'city center'],
    local: ['local', 'low key', 'low-key', 'nearby', 'round the corner', 'neighbourhood', 'neighborhood'],
  },
  nightKind: {
    dinner: ['dinner', 'a meal', 'eat', 'supper'],
    drinks: ['drinks', 'cocktails', 'a pint', 'pints', 'wine bar', 'beers'],
    livemusic: ['live music', 'a gig', 'gig', 'band', 'jazz', 'concert'],
    game: ['a game', 'the game', 'match', 'ballgame'],
    show: ['a show', 'theatre', 'theater', 'comedy', 'stand up', 'stand-up'],
  },
  nightFood: {
    italian: ['italian', 'pasta', 'pizza'],
    japanese: ['japanese', 'sushi', 'omakase', 'ramen'],
    mexican: ['mexican', 'tacos', 'taqueria', 'burritos'],
    steak: ['steak', 'steakhouse'],
    seafood: ['seafood', 'oysters', 'fish', 'shellfish'],
    smallplates: ['small plates', 'tapas', 'sharing plates', 'mezze'],
  },
  nightEnergy: {
    chilled: ['chilled', 'chill', 'quiet', 'relaxed', 'mellow', 'actually talk', 'can talk', 'hear each other'],
    lively: ['lively', 'buzzy', 'busy', 'fun'],
    big: ['big one', 'big night', 'messy', 'blowout', 'go big'],
  },
};

/**
 * Cuisines the lists do not offer, kept as what somebody actually said.
 *
 * "night out with my buddy who loves thai food" answered nothing, because
 * the food question offers six cuisines and thai is not one of them. The
 * question has a free-text box underneath it for exactly this, so a cuisine
 * we recognise but cannot tick becomes the typed answer instead — which is
 * what somebody would have written there themselves.
 *
 * `custom:` is the shape the quiz already uses for a typed answer, so
 * nothing downstream needs to learn a new one.
 */
const OTHER_CUISINES: Record<string, string[]> = {
  thai: ['thai'],
  indian: ['indian', 'curry'],
  chinese: ['chinese', 'dim sum', 'szechuan', 'sichuan'],
  korean: ['korean', 'bbq korean', 'korean bbq'],
  vietnamese: ['vietnamese', 'pho', 'banh mi'],
  greek: ['greek', 'souvlaki'],
  french: ['french', 'bistro'],
  spanish: ['spanish', 'paella'],
  'middle eastern': ['lebanese', 'turkish', 'middle eastern', 'falafel'],
  caribbean: ['caribbean', 'jerk'],
  ethiopian: ['ethiopian'],
  american: ['burgers', 'barbecue', 'bbq', 'southern'],
  vegetarian: ['vegetarian', 'veggie', 'vegan', 'plant based', 'plant-based'],
};

/**
 * Which quiz this is, when the opening answer plainly says.
 *
 * "night out with my buddy" is somebody telling us it is one evening, and
 * they were still asked to choose between a night out and a trip on the very
 * next screen. Only unmistakable words count: "a night away" is a trip, and
 * "trip" inside "tripping" is not a word at all.
 */
const MODE_WORDS: Record<string, string[]> = {
  night: ['night out', 'a night out', 'evening out', 'dinner tonight', 'drinks tonight',
          'tonight', 'this evening', 'a night', 'one night out', 'go out tonight'],
  trip: ['trip', 'weekend away', 'getaway', 'holiday', 'vacation', 'week away',
         'long weekend', 'days away', 'travel to', 'fly to'],
};

export function modeFromGoal(goal: string | null | undefined): 'night' | 'trip' | null {
  const text = String(goal || '').toLowerCase().replace(/[’]/g, "'");
  if (text.trim().length < 4) return null;

  const at = (words: string[]) => words
    .map(w => findPhrase(text, w))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)[0] ?? -1;

  const night = at(MODE_WORDS.night);
  const trip = at(MODE_WORDS.trip);
  if (night < 0 && trip < 0) return null;
  if (night < 0) return 'trip';
  if (trip < 0) return 'night';
  // Both said. Whichever came first is what the sentence is about — "a night
  // out before the trip" is a night out.
  return night <= trip ? 'night' : 'trip';
}

/**
 * What a hard no becomes, per quiz.
 *
 * A negated want is only recorded when there is an option that actually says
 * it. "Not a beach holiday" has nowhere to go on the trip quiz's list of
 * absolute nos, so it is dropped rather than forced somewhere approximate —
 * the beach question simply gets asked.
 */
const NO_WAY: Record<string, string[]> = {
  // The trip quiz's own options, by id.
  camping: ['camping', 'camp', 'tents', 'tent'],
  longFlights: ['long flights', 'long flight', 'long haul', 'long-haul'],
  coldWeather: ['cold', 'cold weather', 'freezing', 'snow'],
  crowded: ['crowds', 'crowded', 'busy places', 'tourist traps'],
  earlyMornings: ['early mornings', 'early starts', 'early morning'],
  hiking: ['hiking', 'hikes', 'walking miles'],
  // The night out's own options, which are phrases rather than camelCase.
  'big crowds': ['big crowds', 'crowds', 'crowded'],
  'loud rooms': ['loud', 'loud rooms', 'noisy'],
  clubs: ['clubs', 'clubbing', 'a club', 'nightclub', 'nightclubs'],
  'long queues': ['queues', 'queueing', 'lines', 'waiting in line'],
  'standing all night': ['standing', 'standing all night'],
  'dressing up': ['dressing up', 'dress code', 'smart dress'],
};

/** Words that turn a want into its opposite. */
const NEGATORS = [
  'no', 'not', 'none', 'never', 'without', 'avoid', 'avoiding', 'skip', 'skipping',
  'hate', 'hates', 'hated', 'loathe', 'loathes', 'cant stand', "can't stand",
  'dont want', "don't want", 'doesnt want', "doesn't want", 'rather not',
  'anything but', 'except', 'less', 'nothing',
];

function escape(w: string): string {
  return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where a phrase appears, as whole words, or -1. */
export function findPhrase(text: string, phrase: string): number {
  const re = new RegExp(`(^|[^a-z])${escape(phrase)}([^a-z]|$)`, 'i');
  const m = re.exec(text);
  if (!m) return -1;
  return m.index + (m[1] ? m[1].length : 0);
}

/**
 * Is this mention a refusal?
 *
 * Only the words just before it count. A goal can say "no clubs, but we do
 * want live music" and both halves have to survive, so the window is short —
 * about six words — and stops at a comma or a full stop, because that is
 * where one clause ends and the next begins.
 */
export function isNegated(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 44), at);
  // Back to the start of this clause only. "no clubs, live music" must not
  // read the "no" as attaching to the music.
  const clause = before.split(/[,.;:—]|\band\b|\bbut\b/).pop() ?? '';
  return NEGATORS.some(n => new RegExp(`(^|[^a-z])${escape(n)}([^a-z]|$)`, 'i').test(clause));
}

export interface GoalAnswers {
  /** Question id → the option ids it plainly asked for. */
  answers: Record<string, string[]>;
  /** Absolute nos, as the quizzes' own option ids. */
  noWay: string[];
  /** Which phrase produced each answer, so a person can be shown why. */
  because: Record<string, string>;
}

/**
 * Every question the opening answer settles, and every hard no it states.
 *
 * `single` names the questions that take one answer rather than several, so
 * only the first clear match is kept for those — offering somebody two paces
 * would be answering a question they were never asked.
 */
export function answersFromGoal(
  goal: string | null | undefined,
  single: string[] = ['pace', 'nightWhere', 'nightEnergy'],
): GoalAnswers {
  const text = String(goal || '').toLowerCase().replace(/[’]/g, "'");
  const out: GoalAnswers = { answers: {}, noWay: [], because: {} };
  if (text.trim().length < 4) return out;

  // Refusals first, because the same word can appear twice — "no big crowds
  // but somewhere lively" — and what somebody rules out should win.
  for (const [option, phrases] of Object.entries(NO_WAY)) {
    for (const phrase of phrases) {
      const at = findPhrase(text, phrase);
      if (at >= 0 && isNegated(text, at)) {
        if (!out.noWay.includes(option)) out.noWay.push(option);
        break;
      }
    }
  }

  // A cuisine the list does not offer, said as the typed answer the question
  // already accepts underneath its six options.
  for (const [cuisine, phrases] of Object.entries(OTHER_CUISINES)) {
    for (const phrase of phrases) {
      const at = findPhrase(text, phrase);
      if (at < 0 || isNegated(text, at)) continue;
      const got = out.answers.nightFood ?? [];
      const value = `custom:${cuisine}`;
      if (!got.includes(value)) {
        out.answers.nightFood = [...got, value];
        out.because[`nightFood:${value}`] = phrase;
      }
      break;
    }
  }

  for (const [question, options] of Object.entries(WANTS)) {
    // Every option that matched, with where and how much of the sentence it
    // claimed, so overlapping ones can be settled before anything is kept.
    const hits: { option: string; phrase: string; at: number; end: number }[] = [];
    for (const [option, phrases] of Object.entries(options)) {
      for (const phrase of phrases) {
        const at = findPhrase(text, phrase);
        if (at < 0) continue;
        // Mentioned, but as something they do not want. It has already been
        // recorded as a hard no where the quiz has one; either way it is
        // never an answer.
        if (isNegated(text, at)) break;
        hits.push({ option, phrase, at, end: at + phrase.length });
        break;
      }
    }

    // "boutique hotel" contains "hotel", so a plain word search answered the
    // same question twice — boutique and hotel both — from one phrase
    // somebody wrote once. The longer phrase is the one they meant, and a
    // match sitting inside another match is not a second answer.
    const kept = hits.filter(h => !hits.some(o => o !== h && o.at <= h.at && o.end >= h.end && (o.end - o.at) > (h.end - h.at)));

    // Earliest first, because a sentence leads with what it is mainly about.
    kept.sort((a, b) => a.at - b.at);
    for (const hit of kept) {
      const got = out.answers[question] ?? [];
      if (single.includes(question) && got.length) break;
      out.answers[question] = [...got, hit.option];
      out.because[`${question}:${hit.option}`] = hit.phrase;
    }
  }
  return out;
}

/** Trip types the goal plainly states, or an empty list. */
export function tripTypesFromGoal(goal: string | null | undefined): string[] {
  return answersFromGoal(goal).answers.tripType ?? [];
}

/** Whether the goal says enough to stop asking what sort of trip this is. */
export function goalAnswersTripType(goal: string | null | undefined): boolean {
  return tripTypesFromGoal(goal).length > 0;
}

/**
 * One line naming what was taken from the opening answer.
 *
 * Shown rather than assumed. Skipping a question quietly is how somebody
 * ends up with a plan built on something they never said, and the fix for
 * that is not to skip less but to say what was read.
 */
export function summarise(
  found: GoalAnswers,
  label: (question: string, option: string) => string,
): string | null {
  const parts: string[] = [];
  for (const [question, options] of Object.entries(found.answers)) {
    for (const option of options) parts.push(label(question, option));
  }
  for (const option of found.noWay) parts.push(`no ${label('noWayJose', option)}`);
  const said = parts.filter(Boolean);
  if (!said.length) return null;
  return said.join(' · ');
}
