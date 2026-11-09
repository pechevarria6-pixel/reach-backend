// ─── The pilot's two questions, as rules both sides read ────────────────
// The organiser's post-trip debrief (REACH-PILOT-GATE-2026-11-08.md A7,
// business-model §4G M2) and "When did you last see this group in person?"
// (M3). Shared by the routes that store the answers, the screens that ask,
// and the unit tests — so the choices a screen offers are exactly the ones a
// route accepts, and the readouts in docs/pilot/READOUTS.md can name the
// numbers each choice is stored as.
//
// No imports on purpose: a screen, a route and node's test runner all load
// this file, and none of them should pull the others' world in with it.

// ── The debrief ─────────────────────────────────────────────────────────

/**
 * Rough answers, tapped rather than typed. Nobody counts their hours to the
 * minute after a trip, and a number field asks them to pretend they did.
 * Each choice is stored as the number in `hours` — the middle of its range,
 * the top one a deliberate round figure — and READOUTS.md is written against
 * these exact values. Changing one changes a pre-registered readout.
 *
 * The edges sit either side of the 19-hour baseline (one of the readouts),
 * so "more than 20" is unambiguously at or above it.
 */
export const HOURS_CHOICES = [
  { id: 'under_1', label: 'Under an hour', hours: 0.5 },
  { id: '1_3', label: '1–3 hours', hours: 2 },
  { id: '3_6', label: '3–6 hours', hours: 4.5 },
  { id: '6_10', label: '6–10 hours', hours: 8 },
  { id: '10_20', label: '10–20 hours', hours: 15 },
  { id: 'over_20', label: 'More than 20', hours: 25 },
] as const;

/** Messages sent, roughly. The baseline is 83; "more than 100" is above it. */
export const MESSAGE_CHOICES = [
  { id: 'under_10', label: 'Under 10', count: 5 },
  { id: '10_30', label: '10–30', count: 20 },
  { id: '30_60', label: '30–60', count: 45 },
  { id: '60_100', label: '60–100', count: 80 },
  { id: 'over_100', label: 'More than 100', count: 130 },
] as const;

export const NPS_SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** "What almost made you quit?" — a tweet's worth, and optional. */
export const ALMOST_QUIT_MAX = 280;

export type HoursId = typeof HOURS_CHOICES[number]['id'];
export type MessagesId = typeof MESSAGE_CHOICES[number]['id'];

export interface Debrief {
  hours: number;
  /** Null when they did not say: optional, and never guessed. */
  messages: number | null;
  nps: number;
  would_run_again: boolean;
  almost_quit: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Narrow a Parsed to its refusal. A type predicate rather than `!p.ok`,
 * because this project compiles with `strict: false` and TypeScript does not
 * narrow on a literal discriminant without strictNullChecks (see isFail in
 * lib/auth.ts for the same reason).
 */
export function refused<T>(p: Parsed<T>): p is { ok: false; error: string } {
  return !p.ok;
}

/**
 * What a request body may say, and nothing else.
 *
 * Takes the choice ids, not numbers, so a client cannot store 19.0001 hours
 * or a thousand: what reaches the table is always one of the values above.
 * Hours, NPS and "would you run the next one?" are required — the three taps.
 * Messages and the note are optional.
 */
export function parseDebrief(body: unknown): Parsed<Debrief> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const hours = HOURS_CHOICES.find(c => c.id === b.hours);
  if (!hours) return { ok: false, error: 'Pick roughly how many hours it took.' };

  let messages: number | null = null;
  if (b.messages !== undefined && b.messages !== null && b.messages !== '') {
    const m = MESSAGE_CHOICES.find(c => c.id === b.messages);
    if (!m) return { ok: false, error: 'That message count is not one of the choices.' };
    messages = m.count;
  }

  const nps = b.nps;
  if (typeof nps !== 'number' || !Number.isInteger(nps) || nps < 0 || nps > 10) {
    return { ok: false, error: 'Pick a score from 0 to 10.' };
  }

  if (typeof b.would_run_again !== 'boolean') {
    return { ok: false, error: 'Say whether you would run the next one.' };
  }

  let almost_quit: string | null = null;
  if (b.almost_quit !== undefined && b.almost_quit !== null) {
    if (typeof b.almost_quit !== 'string') return { ok: false, error: 'That note could not be read.' };
    const t = b.almost_quit.trim();
    if (t.length > ALMOST_QUIT_MAX) return { ok: false, error: `Keep it under ${ALMOST_QUIT_MAX} characters.` };
    almost_quit = t || null;
  }

  return { ok: true, value: { hours: hours.hours, messages, nps, would_run_again: b.would_run_again, almost_quit } };
}

/**
 * What goes into the `debrief_submitted` event: numbers and booleans only.
 *
 * Two things this has to know about lib/track.ts scrubProps:
 *   · it drops any key matching /message/ — so the count travels as `msgs`.
 *     A prop called `messages` would be silently thrown away, and the
 *     messages readout would read "no data" for every trip.
 *   · it drops prose, which is correct, and is why the note never comes
 *     here: it lives in pilot_debriefs (sql/pilot-debrief-2026-11-08.sql).
 */
export function debriefEventProps(d: Debrief, ctx: { solo: boolean }): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {
    hours: d.hours,
    nps: d.nps,
    would_run_again: d.would_run_again,
    solo: ctx.solo,
  };
  if (d.messages !== null) out.msgs = d.messages;
  return out;
}

export type DebriefWhy = 'not_organiser' | 'cancelled' | 'not_over' | 'nothing_held' | 'no_dates' | 'submitted';

/**
 * Whether to ask this person for the debrief on this plan.
 *
 * The organiser only — it is their hours being measured. A trip that
 * happened: not called off, over (by its own dates, or closed as completed),
 * and something on it actually held, so we are not asking somebody how a
 * trip went that never got off the ground. And only once.
 */
export function debriefGate(p: {
  organiser: boolean;
  status: string | null | undefined;
  /** closeAsk(...).why from lib/trip-close.ts, or null when it would ask. */
  closeWhy: string | null;
  held: boolean;
  submitted: boolean;
}): { ask: boolean; why: DebriefWhy | null } {
  if (!p.organiser) return { ask: false, why: 'not_organiser' };
  if (p.status === 'cancelled') return { ask: false, why: 'cancelled' };
  if (!p.held) return { ask: false, why: 'nothing_held' };
  const over = p.status === 'completed' || p.closeWhy === null || p.closeWhy === 'joined_after';
  if (!over) return { ask: false, why: p.closeWhy === 'no_dates' ? 'no_dates' : 'not_over' };
  if (p.submitted) return { ask: false, why: 'submitted' };
  return { ask: true, why: null };
}

/** The three required taps, for the screen. */
export function debriefReady(s: { hours?: string | null; nps?: number | null; }): boolean {
  return !!HOURS_CHOICES.find(c => c.id === s.hours) && typeof s.nps === 'number' && s.nps >= 0 && s.nps <= 10;
}

// ── "When did you last see this group in person?" ───────────────────────

export const RECONNECTION_ANSWERS = [
  { id: 'this_month', label: 'This month' },
  { id: '1_3_months', label: '1–3 months ago' },
  { id: '3_6_months', label: '3–6 months ago' },
  { id: '6_12_months', label: '6–12 months ago' },
  { id: 'over_a_year', label: 'Over a year ago' },
  { id: 'never', label: "We haven't met up yet" },
] as const;

/** Skipping is an answer too: it is recorded so the question is not asked again. */
export const RECONNECTION_SKIPPED = 'skipped';

export type ReconnectionAnswer = typeof RECONNECTION_ANSWERS[number]['id'] | typeof RECONNECTION_SKIPPED;

export function parseReconnection(body: unknown): Parsed<ReconnectionAnswer> {
  const a = (body && typeof body === 'object' ? (body as Record<string, unknown>).answer : undefined);
  if (a === RECONNECTION_SKIPPED) return { ok: true, value: RECONNECTION_SKIPPED };
  const found = RECONNECTION_ANSWERS.find(r => r.id === a);
  if (!found) return { ok: false, error: 'That is not one of the answers.' };
  return { ok: true, value: found.id };
}

/** Postgres/PostgREST saying the table is not there yet. */
export function tableMissing(e: { code?: string | null; message?: string | null } | null | undefined, table: string): boolean {
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  const m = String(e.message ?? '');
  return m.includes(table) && /schema cache|does not exist|could not find/i.test(m);
}

/**
 * A client-made id the server has never seen (the same rule as isTempId in
 * components/reach-app.jsx): a group still `g_local_…`, a plan still `p<ms>`.
 * Asking about one is a 404; answering for one is a write that never lands.
 */
export function isTempId(id: unknown): boolean {
  return typeof id === 'string' && (/^g_local_/.test(id) || /^p\d{10,}$/.test(id));
}
