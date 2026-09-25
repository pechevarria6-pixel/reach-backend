// ─── What everybody going said they want from this trip ─────────────────
// A group trip used to be built from one person's answers. The organiser
// filled in the trip quiz and three destinations came back straight away,
// shaped by what they wanted and by everyone else's standing taste profile —
// which says what somebody likes in general and nothing about this week.
// Everybody else was asked their questions afterwards, about a trip that had
// already been decided around somebody else.
//
// The owner's rule: group trip quizzes wait on each other, so that every
// option is built from everybody's input. So a group trip now exists before
// it has a destination, everyone answers the same questions against it, and
// the options are only built once they all have. This file is the two
// halves of that which are not about the screen:
//
//   - the gate: who we are still waiting on, strictly — a person has either
//     answered for this trip or they have not
//   - the reader: every member's answers, by first name, as the lines the
//     prompt plans around, plus the hard nos as hard constraints
//
// Both stages of generation read through here — the three options, and the
// days of each — so an answer given for a trip cannot reach one and miss
// the other.
//
// Nothing here ever goes back to the group. Readiness is names; the answers
// go to the model and nowhere else — and, for a group, they go to it without
// names, with an instruction never to say who asked for what, because
// whatever the model writes is shown to every one of them. See
// PRIVATE_ANSWERS_RULE below.
import type { SupabaseClient } from '@supabase/supabase-js';
import { splitVetoes } from './weather-no-go.ts';

/**
 * What `plans.destination_style` holds while a group trip is waiting to be
 * given a destination.
 *
 * A group trip is created the moment the organiser finishes the quiz, before
 * anybody knows where it goes, and every screen that would otherwise treat a
 * planning trip as "ready to have its days written" needs to know it has no
 * place yet. That is a fact about the destination, so it lives in the one
 * column about the destination that a missing migration cannot take away.
 * Picking one of the three options clears it.
 */
export const UNDECIDED = 'undecided';

export function isUndecided(plan: { destination_style?: unknown; destStyle?: unknown } | null | undefined): boolean {
  if (!plan) return false;
  return plan.destination_style === UNDECIDED || plan.destStyle === UNDECIDED;
}

export interface AnswerRow {
  user_id?: unknown;
  summary_text?: unknown;
  answers?: unknown;
  submitted_at?: unknown;
  users?: unknown;
}

export interface GroupAnswers {
  /** One line per person who answered: "- Marco: … · … ". Solo only. */
  lines: string[];
  /**
   * The same lines with nobody's name on them and nothing in quote marks:
   * "- One of them: hoping for: … · … ". What a group's prompt carries,
   * because everything the model writes is read by the whole group.
   */
  privateLines: string[];
  /** Everything anybody said to avoid. A constraint, never a hint. */
  vetoes: string[];
  /** Whose answers went in, by id — for the log, never for the screen. */
  userIds: string[];
  /** The lowest budget anybody named for this trip, per person, if any did. */
  lowestBudget: number | null;
  /**
   * Each person's own answers, by id. Server-side only: the organiser's are
   * what frames the trip when somebody else presses the button, and nothing
   * here is ever sent back to a screen.
   */
  byUser: Record<string, { summary: string | null; answers: Record<string, unknown> }>;
}

function firstName(raw: unknown): string {
  const u = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  return String(u?.name || '').trim().split(/\s+/)[0] || 'Someone';
}

/** "custom:thai" is how the quiz stores something typed rather than ticked. */
function word(v: unknown): string {
  const s = String(v ?? '').trim();
  return s.startsWith('custom:') ? s.slice(7).trim() : s;
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(word).filter(Boolean);
  const one = word(v);
  return one ? [one] : [];
}

function money(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Every submitted answer for a trip, turned into what the prompt reads.
 *
 * Two shapes are understood, because both are in the table: the three-field
 * form this screen used to be (summary, mustDo, noWay) and the trip quiz it
 * is now (goalBlurb, tripType, accommodation, pace, budget, the hard nos,
 * and the night-out questions). An answer nobody gave is left out rather
 * than written as "no preference", which would read as a preference.
 */
export function answersFrom(rows: AnswerRow[] | null | undefined): GroupAnswers {
  const lines: string[] = [];
  const privateLines: string[] = [];
  const vetoes: string[] = [];
  const userIds: string[] = [];
  const budgets: number[] = [];
  const byUser: GroupAnswers['byUser'] = {};

  for (const r of rows ?? []) {
    if (!r || !r.submitted_at) continue;
    const a = (r.answers && typeof r.answers === 'object' ? r.answers : {}) as Record<string, unknown>;
    const who = firstName(r.users);
    const parts: string[] = [];

    const said = String(r.summary_text || a.goalBlurb || '').trim();
    if (said) parts.push(`"${said.slice(0, 300)}"`);
    // The unnamed line carries the wish, not the sentence: out of quote
    // marks, and labelled as something to plan around rather than repeat.
    const unnamed: string[] = said ? [`hoping for (in their words — never repeat them): ${said.slice(0, 300)}`] : [];

    const types = list(a.tripType);
    if (types.length) parts.push(`kind of trip: ${types.join(', ')}`);
    const nightKind = list(a.nightKind);
    if (nightKind.length) parts.push(`kind of night: ${nightKind.join(', ')}`);
    const food = list(a.nightFood);
    if (food.length) parts.push(`hungry for: ${food.join(', ')}`);
    if (a.nightEnergy) parts.push(`energy: ${word(a.nightEnergy)}`);
    const stay = list(a.accommodation);
    if (stay.length) parts.push(`would stay in: ${stay.join(', ')}`);
    if (a.pace) parts.push(`pace: ${word(a.pace)}`);

    const budget = money(a.budgetPerPerson) ?? money(a.budget);
    if (budget) {
      parts.push(`budget: about $${budget} each`);
      budgets.push(budget);
    }

    if (a.mustDo) parts.push(`must do: ${word(a.mustDo)}`);

    const nos = [...list(a.noWayJose), ...list(a.noWay)];
    if (nos.length) {
      // A weather no-go is carried, but never as "will not": nothing can
      // check it (lib/weather-no-go.ts), and the route says so once.
      const { hard, weather } = splitVetoes(nos);
      if (hard.length) parts.push(`will not: ${hard.join(', ')}`);
      if (weather.length) parts.push(`would rather avoid, unchecked: ${weather.join(', ')}`);
      vetoes.push(...nos);
    }

    if (r.user_id) {
      userIds.push(String(r.user_id));
      byUser[String(r.user_id)] = { summary: said || null, answers: a };
    }
    if (parts.length) lines.push(`- ${who}: ${parts.join(' · ')}`);
    const rest = said ? parts.slice(1) : parts;
    unnamed.push(...rest);
    if (unnamed.length) privateLines.push(`- One of them: ${unnamed.join(' · ')}`);
  }

  return {
    lines,
    privateLines,
    vetoes: [...new Set(vetoes)],
    userIds,
    lowestBudget: budgets.length ? Math.min(...budgets) : null,
    byUser,
  };
}

/**
 * The block a solo prompt carries: the one person's own answers, which the
 * plan may say back to them. Empty when nothing usable was said.
 *
 * Never for a group — see answersBlock.
 */
export function wantedBlock(lines: string[]): string {
  if (!lines.length) return '';
  return `\nWHAT THEY ASKED FOR, FOR THIS TRIP — these are the answers that
matter most here, because they were given about this trip and not about trips
in general. Plan around them:\n${lines.join('\n')}\n`;
}

/**
 * Answers are private within a group.
 *
 * Everybody was told so — on the quiz, on the wait, in the email: the group
 * sees that you have answered, never what you said. And everything the model
 * writes for a group trip is shown to all of them: used_suggestions on every
 * option card, saved as the trip's why_chosen on its Overview, the days
 * themselves. So a model told to "plan around them by name" put "Sam won't
 * fly more than 4 hours" in front of the whole group, and the promise was
 * broken by our own prompt.
 *
 * The group's wishes still shape every option. They are described the way a
 * friend who heard everybody out would put it — "a beach within a short
 * flight" — never who wanted it, never in anybody's words.
 */
export const PRIVATE_ANSWERS_RULE = `THESE ANSWERS ARE PRIVATE WITHIN THE GROUP. Everything you write is shown to
every one of them, and each was promised the others would never see what they
said. So, everywhere in your answer — used_suggestions, why_this_group,
tagline, every plan line and tip:
- never name who asked for something, and never attribute a wish, a budget
  or a hard no to anybody ("one of you", "someone" is attribution too)
- never quote anyone, or repeat their words back
- describe what the group wants in general terms: "a beach within a short
  flight", never "[name] won't fly more than 4 hours"; "kept to the lower end of
  what the group is spending", never whose budget that is.`;

/**
 * The block a prompt carries for everybody's answers to this trip.
 *
 * A group gets the unnamed lines and the rule above; one person travelling
 * alone gets their own words, which are theirs to have read back.
 */
export function answersBlock(
  read: Pick<GroupAnswers, 'lines' | 'privateLines'>,
  opts: { group: boolean },
): string {
  if (!opts.group) return wantedBlock(read.lines);
  if (!read.privateLines.length) return '';
  return `\nWHAT THE GROUP ASKED FOR, FOR THIS TRIP — one line per person, unnamed on
purpose. These are the answers that matter most here, because they were given
about this trip and not about trips in general. Plan around all of them
together:\n${read.privateLines.join('\n')}\n\n${PRIVATE_ANSWERS_RULE}\n`;
}

/**
 * Each member's standing "what are trips about for you" answer, for the
 * options prompt. Named and quotable for one person; for a group, unnamed,
 * and under the same rule as this trip's answers.
 */
export function standingWishesBlock(
  said: Array<{ name: string; text: string }>,
  opts: { group: boolean },
): string {
  const usable = said.filter(x => x.text.trim());
  if (!usable.length) return '';
  const lines = opts.group
    ? usable.map(x => `- One of them, in general: ${x.text.trim().slice(0, 300)}`)
    : usable.map(x => `${x.name || 'Someone'} said: "${x.text.trim().slice(0, 300)}"`);
  const how = opts.group
    ? `Answer these. For every option, used_suggestions lists which of these wishes
it acts on and how, in general terms and naming nobody: "somewhere with snow
for a birthday — this is a ski town". If an option genuinely acts on none of
them, send an empty array rather than inventing one.

${PRIVATE_ANSWERS_RULE}`
    : `Answer these. For every option, used_suggestions lists which of them it acts
on and how: "somewhere your sister can see snow — this is a ski town". If an
option genuinely acts on none of them, send an empty array rather than
inventing one. Do not repeat a wish back as though quoting it were the same as
planning around it.`;
  return `\nWHAT THEY SAID THEY WANT FROM TRIPS IN GENERAL:\n${lines.join('\n')}\n
These are standing answers about trips in general. Where one disagrees with
what they said THIS trip is, this trip wins — a note about snow does not
override "in Aspen to celebrate a birthday", and an option whose
used_suggestions only mentions a standing answer has ignored the thing
actually being planned.

${how}\n`;
}

/**
 * The group's trip, from everybody's answers rather than the organiser's.
 *
 * The lines the options prompt leads with — what the trip is for, where they
 * would stay, the pace — were filled from whoever set the trip up, with
 * everyone else's answers in a block further down. For a group those are
 * everybody's: every kind of trip anybody asked for, every kind of place
 * anybody would stay, and the pace most of them chose. A tie goes to the
 * slower pace, because a packed week somebody asked not to have is worse
 * than a quiet one somebody would have filled.
 *
 * Empty fields mean nobody said, and the caller keeps what it had.
 */
const PACE_ORDER = ['relaxed', 'balanced', 'packed'];
export function groupFraming(read: Pick<GroupAnswers, 'byUser'>): {
  tripTypes: string[]; accommodation: string[]; pace: string | null;
} {
  const types = new Set<string>();
  const stay = new Set<string>();
  const paces = new Map<string, number>();
  for (const { answers: a } of Object.values(read.byUser || {})) {
    for (const t of list(a.tripType)) types.add(t);
    for (const s of list(a.accommodation)) stay.add(s);
    const p = a.pace ? word(a.pace) : '';
    if (p) paces.set(p, (paces.get(p) ?? 0) + 1);
  }
  const rank = (p: string) => {
    const i = PACE_ORDER.indexOf(p);
    return i === -1 ? 1 : i; // something unrecognised sits in the middle
  };
  let pace: string | null = null;
  for (const [p, n] of paces) {
    const best = pace ? paces.get(pace)! : -1;
    if (n > best || (n === best && rank(p) < rank(pace!))) pace = p;
  }
  return { tripTypes: [...types], accommodation: [...stay], pace };
}

/**
 * What came back, read against the same promise.
 *
 * The prompt tells the model never to say who asked for what. This checks it
 * did as it was told: a line naming anybody in the group, or repeating six
 * words in a row of what somebody wrote, is dropped. A name that is in the
 * trip's own title is not private — everybody can see the title — so a trip
 * called "Kyle's fortieth" may still say it is for Kyle's fortieth.
 */
/** First names that are also ordinary English words. */
const WORD_NAMES = new Set(['will', 'may', 'june', 'april', 'august', 'mark', 'grace', 'hope', 'joy', 'faith',
  'rose', 'art', 'bill', 'pat', 'ray', 'dawn', 'sky', 'summer', 'autumn', 'jack', 'don', 'sue', 'guy', 'rob',
  'hunter', 'miles', 'chase', 'drew', 'harper', 'reed', 'wade', 'lane', 'river', 'brook', 'ivy', 'holly',
  'robin', 'sunny', 'penny', 'max', 'frank', 'earnest', 'major', 'king', 'bay', 'star', 'honey', 'amber']);

export function attributes(
  text: string,
  who: { names: string[]; said: string[]; title?: string | null },
): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  const title = String(who.title || '').toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const raw of who.names) {
    const n = String(raw || '').trim();
    if (n.length < 2) continue;
    // Matched case-blind, "We will hike" was dropped in a group with a Will
    // in it. A name that is also an everyday word only counts capitalised;
    // any other name counts however it is written ("which marco asked for").
    const cap = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
    const re = WORD_NAMES.has(n.toLowerCase())
      ? new RegExp(`\\b${esc(cap)}\\b`)
      : new RegExp(`\\b${esc(n)}\\b`, 'i');
    if (new RegExp(`\\b${esc(n)}\\b`, 'i').test(title)) continue;
    if (re.test(t)) return true;
  }
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const hay = ` ${words(t).join(' ')} `;
  const titleWords = ` ${words(title).join(' ')} `;
  for (const s of who.said) {
    const w = words(s);
    for (let i = 0; i + 6 <= w.length; i++) {
      const run = w.slice(i, i + 6).join(' ');
      if (titleWords.includes(` ${run} `)) continue;
      if (hay.includes(` ${run} `)) return true;
    }
  }
  return false;
}

/**
 * Everyone's answers for one plan, read from the table.
 *
 * `error` is set when the read failed, so a caller can say so rather than
 * build a plan quietly from nobody's answers.
 */
export async function readGroupAnswers(
  db: SupabaseClient,
  planId: string,
): Promise<GroupAnswers & { error: string | null }> {
  const { data, error } = await db
    .from('plan_preferences')
    .select('user_id, summary_text, answers, submitted_at, users(name)')
    .eq('plan_id', planId)
    .not('submitted_at', 'is', null);
  if (error) {
    console.error('[group answers] could not read what the group asked for', { plan: planId, code: error.code });
    return { lines: [], privateLines: [], vetoes: [], userIds: [], lowestBudget: null, byUser: {}, error: error.code || 'read failed' };
  }
  return { ...answersFrom(data as AnswerRow[]), error: null };
}

export interface Answered {
  userId: string;
  name: string;
  /** Submitted for this trip. No grace: this is the strict question. */
  answered: boolean;
}

export interface Gate {
  open: boolean;
  /** First names, for "waiting on Marco and Sam". */
  waitingOn: string[];
}

/**
 * Whether the options may be built yet.
 *
 * Strict where readiness for a vote is lenient. planReadiness lets a plan
 * nobody has answered for through, because trips from before the question
 * existed must not freeze; a plan that is waiting for its options was made
 * by this flow, so there is no old trip to spare, and letting "nobody has
 * answered" through would build it from nobody's answers — the exact thing
 * this exists to prevent.
 *
 * A group we could not read is closed, never open: an empty member list is
 * not "everybody has answered".
 */
export function optionsGate(members: Answered[], solo: boolean): Gate {
  if (solo) return { open: true, waitingOn: [] };
  const waitingOn = members
    .filter(m => !m.answered)
    .map(m => (m.name || '').trim().split(/\s+/)[0] || 'someone');
  return { open: members.length > 0 && waitingOn.length === 0, waitingOn };
}

/** "Marco", "Marco and Sam", "Marco, Sam and Priya". */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Why nothing has been built yet, naming who it is waiting for.
 *
 * `then` is what happens once they have: the itinerary stage writes the
 * plan, the options stage finds the trips. Same shape of sentence for both,
 * so a group sees one rule rather than two.
 */
export function notYetAnswered(names: string[], then: string): string {
  if (!names.length) return `Everyone has answered. ${then}`;
  const verb = names.length === 1 ? "hasn't" : "haven't";
  return `${namesList(names)} ${verb} said what they want from this trip yet. ${then}`;
}

/**
 * A night out's own answers — food, kind of night, energy — as the night
 * prompt reads them, from what was stored for the plan. A rebuild sent none,
 * so "my buddy who loves Thai food" reached the first build and not the
 * eight after it. The organiser's first, then anybody's.
 */
export function nightPrefsFrom(read: Pick<GroupAnswers, 'byUser'>, organiser?: string | null): { food?: string[]; kind?: string[]; energy?: string } {
  const people = Object.entries(read.byUser ?? {});
  people.sort(([a], [b]) => Number(b === organiser) - Number(a === organiser));
  const out: { food?: string[]; kind?: string[]; energy?: string } = {};
  for (const [, u] of people) {
    const a = u.answers ?? {};
    if (!out.food) { const f = list(a.nightFood); if (f.length) out.food = f; }
    if (!out.kind) { const k = list(a.nightKind); if (k.length) out.kind = k; }
    if (!out.energy && a.nightEnergy) out.energy = word(a.nightEnergy);
  }
  return out;
}

// ─── Planning with who has answered ─────────────────────────────────────
// The wait above is strict, and strict on its own means one slow friend
// stalls the trip for ever. So the organiser — and only the organiser — may
// go ahead with the answers that are in, once somebody besides them has
// answered or the trip is two days old, whichever is first. Members who
// have not answered still go (party size is always the members), but add
// no wishes to the prompt: we do not know what they want from this trip.
//
// Going ahead is a fact about the trip, not about one request: the days of
// each idea, the vote and a later rebuild all have to agree it happened. It
// is recorded as an audit row keyed on the plan (no new column), and
// planReadiness reads it back.

export const PLANNED_WITH_ANSWERED = 'planned_with_answered';
export const GO_AHEAD_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Whether the organiser may plan with who has answered yet: at least one
 * member other than whoever created the trip has answered, or 48 hours have
 * passed since it was created. A missing or unreadable created time is not
 * "long ago" — it only opens on an answer.
 *
 * Either way somebody must have answered. Planning "with who's answered"
 * when nobody has — the organiser's own answers failed to save, say —
 * built three ideas from no one's wishes.
 */
export function mayGoAhead(p: {
  members: Pick<Answered, 'userId' | 'answered'>[];
  createdBy: string | null;
  createdAt: string | null | undefined;
  now?: number;
}): boolean {
  if (!p.members.some(m => m.answered)) return false;
  const someoneElse = p.members.some(m => m.answered && m.userId !== p.createdBy);
  if (someoneElse) return true;
  const made = p.createdAt ? Date.parse(p.createdAt) : NaN;
  if (!Number.isFinite(made)) return false;
  return (p.now ?? Date.now()) - made >= GO_AHEAD_AFTER_MS;
}

/**
 * What the server does with "plan with who's answered". Organiser first:
 * anybody else is refused whatever state the trip is in.
 */
export function goAheadDecision(p: { organiser: boolean; allowed: boolean }):
  { action: 'go' } | { action: 'refuse'; status: 403 | 409; error: string } {
  if (!p.organiser) {
    return { action: 'refuse', status: 403, error: "Only whoever set up this trip can plan it with who's answered." };
  }
  if (!p.allowed) {
    return { action: 'refuse', status: 409, error: "Somebody besides you needs to answer first — or give it 48 hours from when the trip was made." };
  }
  return { action: 'go' };
}

/** "3 of 4 have answered." — counts only, for the organiser's wait. */
export function answeredCount(members: Pick<Answered, 'answered'>[]): string {
  const n = members.filter(m => m.answered).length;
  return `${n} of ${members.length} ${n === 1 ? 'has' : 'have'} answered.`;
}

/**
 * The organiser's wait: the count, and what is true about going ahead from
 * where they stand. The members' wait keeps "we wait until everyone has
 * answered"; the organiser's used to say it too — "Nothing gets picked on
 * one person's say-so" — directly above a button that plans on exactly
 * that, so theirs says what the button does instead.
 */
export function organiserWaitCopy(p: {
  members: Pick<Answered, 'userId' | 'answered'>[];
  mayGoAhead: boolean;
  createdBy: string | null;
  createdAt: string | null | undefined;
  me: string | null;
  night: boolean;
}): { title: string; body: string } {
  const title = answeredCount(p.members);
  const ideas = p.night ? 'ideas for the night' : 'trip ideas';
  if (p.mayGoAhead) {
    return { title, body: `Your three ${ideas} are built from the answers that are in when you plan. You can go ahead now, or wait for the rest.` };
  }
  if (!p.members.some(m => m.answered)) {
    return { title, body: `Nobody has answered yet, and your three ${ideas} are built from what you say you want — so there's nothing to plan from until somebody does.` };
  }
  const besides = p.createdBy && p.createdBy === p.me ? 'somebody besides you' : 'somebody besides whoever set it up';
  const made = p.createdAt ? Date.parse(p.createdAt) : NaN;
  const orTime = Number.isFinite(made) ? ', or two days after the trip was made' : '';
  return { title, body: `You can plan with who's answered once ${besides} has answered${orTime}.` };
}

/**
 * Whose standing profile shapes the prompt. Everybody, normally. When the
 * organiser went ahead, only those who answered: somebody who has not said
 * what they want from this trip adds no wishes to it. `everyone` is still
 * what the party size is counted from, and still where dietary needs and
 * hard nos come from — those are constraints on the trip they are going on,
 * not wishes, and dropping them would plan dinner around an allergy.
 */
export function whoShapesIt<T extends { id?: unknown }>(everyone: T[], answeredOnly: Set<string> | null): T[] {
  if (!answeredOnly) return everyone;
  return everyone.filter(p => answeredOnly.has(String(p.id)));
}
