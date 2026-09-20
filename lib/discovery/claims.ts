// ─── Which tips are claims, and which are just advice ───────────────────
// An itinerary carries a line of insider knowledge under each item, and it
// is the part that makes the whole thing feel worth having. It is also
// generated, and some of it is generated about other people's businesses:
//
//   "Milt's is cash-only and has no ATM inside"
//   "Woody's charges a cover only after 9pm on weekends"
//   "Antica Forma's bar seats fill fast after 6pm — go right at open (5pm)"
//   "MARC will fire and hold your glazed pottery … they'll ship it for a fee"
//
// Every one of those is confident, specific, checkable, and was checked by
// nobody. Somebody plans an evening around the 5pm opening and finds a dark
// window; somebody goes to Milt's with a card.
//
// The rest of the same field is not like that at all:
//
//   "Corona Arch gets brutally hot by 11am in summer — start before 8am"
//   "Goblin Valley has almost no cell signal — screenshot your park map"
//   "Mesa Arch at sunrise means a crowd of photographers shoulder to shoulder"
//
// That is advice about weather, terrain and crowds. It is the kind of thing
// a person says to another person, being wrong about it costs an hour rather
// than an evening, and stripping it would leave the product plainer for no
// gain in honesty.
//
// So the line is drawn at the claim, not at the sentence: does this assert
// something a business decides — what it charges, when it opens, what it
// takes, what it will do for you — which that business could change tomorrow
// and which we have never asked anybody about?

/** What kind of assertion a tip is making, when it makes one. */
export type ClaimKind = 'money' | 'hours' | 'availability' | 'service' | 'named';

/**
 * Things a business decides, which is exactly what we cannot know without
 * asking. Deliberately about the claim rather than about the name: a tip
 * does not become safe by leaving the restaurant unnamed, and every one of
 * these reads as fact whoever it is about.
 */
const CLAIMS: [ClaimKind, RegExp][] = [
  ['money', /\b(cash[- ]only|cash only|takes? (only )?(cash|cards?)|no (cards?|amex|atm)|card[- ]only|atm|no cover|cover (charge|only|if|after)|surcharge|no fee|small fee|a fee|the fee|charges? (a|you|only)|free refills?|byob|corkage|happy hour|prices? (are|drop)|cheaper|noticeably lower|deposit)\b/i],
  // No bare clock times here on purpose. "start before 8am and bring more
  // water than you think" is advice about heat and had nothing to do with
  // anybody's opening hours, and matching `before \d+(am|pm)` stripped it.
  // The times that matter come attached to a policy, and the policy words
  // are what catch them: "charges a cover only after 9pm" is money already.
  // "the open kitchen" is a room you can see into, not an opening time, and
  // a bare `opens?` read it as a claim about a restaurant's hours. An hour
  // has to be attached to something for this to be about hours at all.
  ['hours',  /\b(opens? (at|early|late|from)|right at open|open (until|till|from)|closes? (at|early|late)|closing time|opening (time|hours)|last (seating|orders?|call)|kitchen (shuts|closes)|doors? (open|at))\b/i],
  ['availability', /\b(sells? out|sold out|books? up|fills? (up |fast)|book (at least |ahead|a week)|reserve ahead|walk[- ]ins?|waitlist|no reservations|queue|line up)\b/i],
  ['service', /\b(they'?ll|will (ship|hold|fire|store|deliver|let you)|offers?|provides?|lets? you|can arrange|ask [A-Z]|ask (for|them)|bring your own)\b/i],
  // Somewhere with a name, being described.
  //
  // This is the signal the others kept missing, because the danger was never
  // in the vocabulary — it was in who the sentence is about. "Corona Arch
  // gets brutally hot by 11am" is about the desert and cannot be wrong in a
  // way that costs anybody anything. "Tamarisk's patio tables all face the
  // river but the counter inside gets the same view" is about a restaurant's
  // dining room, and we have never been in it.
  //
  // What follows the possessive is what separates naming a place from making
  // a claim about it, and getting this wrong flagged fourteen ordinary item
  // titles:
  //
  //   "dancing at Woody's Tavern"          Tavern is part of the name
  //   "Lunch at Ren's Ramen House"         so is Ramen House
  //   "Tamarisk's patio tables face..."    patio tables is a claim about it
  //   "Woody's charges a cover..."         so is charges
  //
  // A capitalised word after the apostrophe belongs to the name. A lowercase
  // one begins a description, and a description is something we would have
  // had to go and see.
  ['named', /\b[A-Z][\w&]*['’]s\s+[a-z]/],
];

export interface TipClaim {
  kind: ClaimKind;
  /** The words that make it a claim, for a human reviewing the call. */
  matched: string;
}

/**
 * What a tip asserts about how somewhere is run, if anything.
 *
 * Returns every kind it matches, because one sentence often makes two
 * claims — "cash-only and has no ATM" is money twice over, and "charges a
 * cover only after 9pm" is money and hours at once.
 */
export function claimsIn(tip: string, ignore: Set<string> = new Set()): TipClaim[] {
  // The town's own name, possessive and incidental. "screenshot your park
  // map before you leave Moab's wifi range" is advice about cell signal in
  // the desert that happens to mention where the signal stops, and reading
  // it as a claim about a business cost a genuinely useful sentence.
  const text = [...ignore].reduce(
    (acc, word) => acc.replace(new RegExp(`\\b${word}(['’]s)?\\b`, 'gi'), ' '),
    String(tip || ''),
  );
  if (!text.trim()) return [];
  const found: TipClaim[] = [];
  for (const [kind, re] of CLAIMS) {
    const m = text.match(re);
    if (m) found.push({ kind, matched: m[0] });
  }
  return found;
}

/**
 * Is this a sentence we are not entitled to say?
 *
 * Advice about weather, crowds, terrain and driving is not a claim on
 * anybody's business and stays. Anything asserting what a place charges,
 * when it opens, whether it will have room or what it will do for you
 * needs a source, and we almost never have one.
 */
export function needsSource(tip: string, ignore: Set<string> = new Set()): boolean {
  return claimsIn(tip, ignore).length > 0;
}
