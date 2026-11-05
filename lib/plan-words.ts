// ─── What a plan's screens say about where it stands ────────────────────
// Each of these was a sentence worked out inline, in one place, and said
// differently — or wrongly — somewhere else. QA walk of 5 November with two
// accounts (an organiser and a member) found every one:
//
//   · the member being waited on was told "Waiting on NEW…" about herself;
//   · the same plan read "Waiting" to one of them and "Planning" to the other,
//     and "Planning" while it was out for a vote;
//   · a failure on Home said "Try again shortly" with nothing to press, and
//     hid the server's own reason;
//   · "Couldn't check where this plan stands" showed while the check was
//     still on its way.
//
// Pure, relative imports only, so the client bundle can take it and the rule
// is tested where it is decided.

/** "Marco", "Marco and Sam", "Marco, Sam and Priya". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const first = (name: unknown) => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';

export interface WaitMember { userId: string; name: string; ready?: boolean; answered?: boolean }
export interface WaitRead { members?: WaitMember[] | null; solo?: boolean; wentAhead?: boolean }

export interface WaitingFor {
  /** The reader is one of those being waited on. */
  mine: boolean;
  /** Everybody else being waited on, by first name. */
  others: string[];
  /** The sentence, or null when nobody is being waited on. */
  sentence: string | null;
}

/**
 * Who a plan is waiting on, said to the person reading it. The server's
 * sentence ("Waiting on NEW to say what they want…") names everybody, the
 * reader included, which reads as being talked about in the third person on
 * your own phone. Here the reader is "you", and only the others are named.
 *
 * `strict` reads `answered` (has answered for this trip) rather than the
 * lenient `ready`; `votes` is a plan whose options are out, where what is
 * held up is the vote.
 */
export function waitingFor(read: WaitRead | null | undefined, me: string | null | undefined,
  opts: { strict?: boolean; votes?: boolean; night?: boolean } = {}): WaitingFor {
  const none: WaitingFor = { mine: false, others: [], sentence: null };
  if (!read || read.solo || read.wentAhead) return none;
  const out = (read.members ?? []).filter(m => !(opts.strict ? m.answered : (m.ready ?? m.answered)));
  if (!out.length) return none;
  const mine = !!me && out.some(m => m.userId === me);
  const others = out.filter(m => m.userId !== me).map(m => first(m.name));
  const what = opts.night ? 'this night out' : 'this trip';
  let sentence: string;
  if (mine && !others.length) {
    sentence = `You haven't said what you want from ${what} yet.${opts.votes ? ' Votes open once you have.' : ''}`;
  } else if (mine) {
    sentence = `You and ${list(others)} haven't said what you want from ${what} yet.${opts.votes ? " Votes open once you've all answered." : ''}`;
  } else {
    sentence = opts.votes
      ? `Votes open when everyone's in — waiting on ${list(others)}.`
      : `Waiting on ${list(others)} to say what they want from ${what}.`;
  }
  return { mine, others, sentence };
}

export type StageLabel = 'Waiting' | 'Voting' | 'Planning';

/**
 * The status chip for a plan that is still being decided — before it is
 * locked in or anything is moving. One answer from the plan's own status and
 * who has answered, so the organiser and the member read the same word: it
 * used to be whichever next step the reader had, and the organiser saw
 * "Waiting" where the member, asked to answer, saw "Planning".
 */
export function planStageLabel(p: {
  status: string | null | undefined;
  /** Options or saved ideas are out for the group. */
  hasOptions: boolean;
  readiness: WaitRead | null | undefined;
  solo: boolean;
}): StageLabel {
  if (p.solo) return 'Planning';
  const r = p.readiness;
  const someoneOut = !!r && !r.solo && !r.wentAhead
    && (r.members ?? []).some(m => !(m.ready ?? m.answered));
  if (someoneOut) return 'Waiting';
  if (p.status === 'voting' && p.hasOptions) return 'Voting';
  return 'Planning';
}

/**
 * The line on a plan's next-step card while what it stands on is unread.
 * "Couldn't check" only once the read has actually failed; until then it is
 * still checking, which is true.
 */
export function planStandsLine(p: { fundingFailed: boolean; funding: unknown; bookingsLoaded: boolean }): string | null {
  if (p.funding && p.bookingsLoaded) return null;
  if (p.fundingFailed && !p.funding) return "Couldn't check where this plan stands just now — reopen it in a moment.";
  return 'Checking where this plan stands…';
}

/**
 * What a failed request says, and when to ask again on its own. The server's
 * own words when it gave any — it knows whether the problem is ours, and
 * "Still checking the towns near you" is more use than "try again shortly".
 * `retryIn` is the Retry-After it sent, in seconds (capped), or null.
 */
export function failureFrom(status: number, body: unknown, retryAfterHeader: string | null | undefined,
  fallback: string): { message: string; retryIn: number | null } {
  const said = (body as { error?: unknown } | null)?.error;
  const message = typeof said === 'string' && said.trim() ? said.trim() : fallback;
  const n = Number(retryAfterHeader);
  const retryIn = retryAfterHeader != null && retryAfterHeader !== '' && Number.isFinite(n) && n >= 0
    ? Math.min(30, Math.max(1, Math.round(n))) : null;
  return { message, retryIn: status === 503 || status === 429 ? retryIn : null };
}

/** The availability count, said as being about dates — it sits under "Everyone has answered". */
export function datesTally(respondents: number, members: number): string {
  return `Dates: ${respondents} of ${members} ${members === 1 ? 'has' : 'have'} said when they're free.`;
}

/**
 * The heading over a vote. Where the place is already set, the vote is on
 * which plan for it — "Where should we go?" over options for Charleston asks
 * a question the plan has already answered.
 */
export function voteHeading(p: { night: boolean; undecided: boolean; city: string | null | undefined }): string {
  const city = String(p.city ?? '').trim();
  if (!p.undecided && city) return p.night ? `Which night out in ${city}?` : `Which plan for ${city}?`;
  return p.night ? 'Which plan for the night?' : 'Where should we go?';
}

/**
 * Where a tied vote stands for the reader: the organiser is given the pick
 * between the tied options; everybody else is told who settles it.
 */
export function tieWords(p: { tied: string[]; organiserIsMe: boolean; organiserName: string | null | undefined }): string | null {
  if (p.tied.length < 2) return null;
  if (p.organiserIsMe) return `It's a tie between ${list(p.tied)}. It's your call — pick the one the group goes with.`;
  return `Waiting on ${String(p.organiserName ?? '').trim() || 'the organiser'} to settle the tie.`;
}

/** Placeholder titles that are not a name for the plan. */
const UNNAMED = new Set(['where next?', '']);

/** The plan's name for a sentence, or "this trip" / "this night out" where it has none. */
export function planCalled(p: { title?: string | null; type?: string | null }): string {
  const t = String(p.title ?? '').trim();
  if (!UNNAMED.has(t.toLowerCase())) return t;
  return p.type === 'restaurant' ? 'this night out' : 'this trip';
}

/**
 * Whether a refusal is the plan waiting on somebody's answers: a 409 whose
 * body names who (`waitingOn`). Only that one may be re-said in the reader's
 * own words. The same routes answer 409 for a trip called off, a pick
 * already made or no destination yet, and a client read of who has answered
 * that is a moment stale must not replace those with "You haven't said…".
 */
export function waitRefusal(status: number, body: unknown): boolean {
  return status === 409 && Array.isArray((body as { waitingOn?: unknown } | null)?.waitingOn);
}

/** `planCalled` at the start of a sentence: "This trip is being voted on". */
export function planCalledAtStart(p: { title?: string | null; type?: string | null }): string {
  const c = planCalled(p);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

type ChangeLine = { type?: string | null; venue_name?: string | null; title?: string | null };

/**
 * Why the weather ping's `&change=<line>` cannot open the Change sheet on
 * this line, or null when it can. The ping goes to every member, so `may` is
 * the screen's own rule for its Change button (lib's `mayChange` in the plan
 * screen): the link opens nothing the screen would hide. Each sentence is
 * true of the line it is said about — "isn't on the plan any more" only when
 * it isn't (it used to be said of a café that was there, not changeable).
 */
export function changeRefusal(line: ChangeLine | null | undefined, rules: {
  may: (l: ChangeLine) => boolean;
  changeable: (l: ChangeLine) => boolean;
  locked: (l: ChangeLine) => boolean;
  unpriced: (l: ChangeLine) => boolean;
}): string | null {
  if (!line) return "That line isn't on the plan any more — here's the plan as it stands.";
  if (rules.may(line)) return null;
  const name = line.venue_name?.trim() || line.title?.trim() || 'That line';
  if (!rules.changeable(line)) return `${name} can't be swapped from Reach — here's the plan as it stands.`;
  if (rules.locked(line)) return `The plan is locked in, so changing ${name} is the organiser's call.`;
  if (rules.unpriced(line)) return `${name} has nothing priced yet to compare a change with.`;
  return `${name} can't be changed from here — here's the plan as it stands.`;
}
