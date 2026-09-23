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
// go to the model and nowhere else.
import type { SupabaseClient } from '@supabase/supabase-js';

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
  /** One line per person who answered: "- Marco: … · … ". */
  lines: string[];
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
      parts.push(`will not: ${nos.join(', ')}`);
      vetoes.push(...nos);
    }

    if (r.user_id) {
      userIds.push(String(r.user_id));
      byUser[String(r.user_id)] = { summary: said || null, answers: a };
    }
    if (parts.length) lines.push(`- ${who}: ${parts.join(' · ')}`);
  }

  return {
    lines,
    vetoes: [...new Set(vetoes)],
    userIds,
    lowestBudget: budgets.length ? Math.min(...budgets) : null,
    byUser,
  };
}

/** The block the prompt carries. Empty when nobody said anything usable. */
export function wantedBlock(lines: string[]): string {
  if (!lines.length) return '';
  return `\nWHAT EACH OF THEM ASKED FOR, FOR THIS TRIP — these are the
answers that matter most here, because they were given about this trip and not
about trips in general. Plan around them by name:\n${lines.join('\n')}\n`;
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
    return { lines: [], vetoes: [], userIds: [], lowestBudget: null, byUser: {}, error: error.code || 'read failed' };
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
