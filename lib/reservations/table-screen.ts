// ─── What the table screens say about each answer ───────────────────────
// The screens (components/reach-app.jsx TableReserve) call one route to book
// a table — POST /api/bookings/[id]/reserve, or approval in checkout, which
// runs the same code — and read GET /api/plans/[id]/reservations and GET
// /api/bookings/[id]/call. This turns each answer into what is shown and
// what may be pressed, so every refusal keeps its own words and its next
// options, and a test can hold each one to its screen.
//
// The rules it keeps:
//   - A hold is not a booking. Press one shows the restaurant's policy, the
//     platform's terms with their links, any fee exactly as given, and a
//     countdown; the button reads exactly the label the server returned.
//   - "It may already be booked" offers nothing to press — anything offered
//     would be a second table.
//   - "Have Reach call" only when the server offered a call (it does only
//     while the calling gate is live) AND the call route says it is
//     available with no call made yet. Never in test mode.
//   - A call that offered another time is taken by ringing them: Reach makes
//     one call per table, and never accepts another time on its own.
//
// Client-safe: no database, no provider, no environment.
import { clockSaid } from '../line-when.ts';
import { shortClock } from './reserve-state.ts';

export type Option = { kind: string; label: string; what: string; href?: string | null };

export interface Hold {
  holdId: string;
  platform?: string;
  platformLabel?: string;
  date?: string;
  time?: string;
  covers?: number;
  expiresAt?: string;
  cancellationPolicy?: string | null;
  policies?: string[];
  terms?: { text: string; links?: { label: string; url: string }[]; version: string } | null;
  fee?: { label: string; amountCents: number; taxCents?: number | null; currency?: string | null } | null;
  cancelBy?: string | null;
  notes?: string | null;
}

export type TableAnswer =
  /** Held, not booked: the terms, then the returned button. */
  | { kind: 'hold'; hold: Hold; button: string; title: string; body: string; changeNote: string | null; alternatives: Option[] }
  /** Confirmed by the platform or on the call, or it already was. */
  | { kind: 'done'; title: string; body: string; href: string | null; warning: string | null }
  /** Not booked yet: a card owed on the platform's page, a call ringing, or handed to them. */
  | { kind: 'not_yet'; outcome: string; title: string; body: string; href: string | null; warning: string | null; alternatives: Option[] }
  /** Not at that time; another was offered. */
  | { kind: 'other_time'; title: string; error: string; offered: string[]; alternatives: Option[] }
  /** The hold lapsed or the slot went: nothing was booked, and a new hold is one press. */
  | { kind: 'hold_again'; code: string; error: string; alternatives: Option[] }
  /** It was handed to them: have they booked it already? */
  | { kind: 'ask_first'; error: string; alternatives: Option[] }
  /** A night or a time to pick first. */
  | { kind: 'needs'; missing: ('date' | 'time')[]; error: string; alternatives: Option[] }
  /** Somebody else's press, or a call, has it now. Nothing more is sent. */
  | { kind: 'busy'; error: string }
  /** It may already be booked. Nothing to press. */
  | { kind: 'unknown'; title: string; error: string }
  /** Not booked, with its own reason and the next options. */
  | { kind: 'refused'; code: string | null; error: string; alternatives: Option[]; platformUrl: string | null };

export const MAY_BE_BOOKED = "It may already be booked — don't book it anywhere else";

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const opts = (v: unknown): Option[] => (Array.isArray(v) ? v.filter(o => o && typeof o === 'object' && typeof (o as Option).label === 'string') as Option[] : []);

/**
 * One answer from the reserve route (or approval, for a table), as the screen
 * shows it. `status` 0 means no answer came back. `pressTwo` is a press that
 * could have booked — the second press, or a call that may already be
 * ringing — where no answer is "it may be booked", never "try again".
 */
export function readTableAnswer(
  status: number, body: unknown,
  ctx: { asked?: string | null; pressTwo?: boolean; path?: string | null } = {},
): TableAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const error = str(b.error);
  const alternatives = opts(b.alternatives);
  const code = str(b.code) ?? str(b.reserveCode);

  if (!status) {
    if (ctx.pressTwo || ctx.path === 'call') {
      return { kind: 'unknown', title: MAY_BE_BOOKED, error: ctx.path === 'call' && !ctx.pressTwo
        ? "We didn't hear back, so Reach may be calling them now. Check again in a minute."
        : "We didn't hear back, so it may have gone through. Check again in a minute." };
    }
    return { kind: 'refused', code: null, error: "We didn't hear back. Nothing was booked — try again.", alternatives: [], platformUrl: null };
  }

  if (status >= 200 && status < 300) {
    const outcome = str(b.outcome) ?? 'confirmed';
    const title = str(b.title) ?? '';
    const said = str(b.body) ?? '';
    const href = str(b.href);
    const warning = str(b.warning);
    if (outcome === 'confirmed' || outcome === 'already' || b.already === true) return { kind: 'done', title, body: said, href, warning };
    return { kind: 'not_yet', outcome, title, body: said, href, warning, alternatives };
  }

  if (code === 'terms_required' && b.hold && typeof b.hold === 'object' && typeof (b.hold as Hold).holdId === 'string') {
    return {
      kind: 'hold', hold: b.hold as Hold, button: str(b.button) ?? 'Book this table',
      title: str(b.title) ?? '', body: str(b.body) ?? '', changeNote: str(b.changeNote), alternatives,
    };
  }
  if (code === 'outcome_unknown') return { kind: 'unknown', title: MAY_BE_BOOKED, error: error ?? "We couldn't tell whether this went through." };
  if (code === 'other_time') {
    const offered = (Array.isArray(b.offeredTimes) ? b.offeredTimes : []).filter((t): t is string => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t));
    if (offered.length) return { kind: 'other_time', title: offeredTitle(ctx.asked ?? null, offered[0]), error: error ?? '', offered, alternatives };
  }
  if (code === 'hold_expired' || code === 'hold_missing' || code === 'slot_gone') {
    return { kind: 'hold_again', code, error: error ?? 'The hold ran out. Nothing was booked.', alternatives };
  }
  if (code === 'ask_first') return { kind: 'ask_first', error: error ?? 'Have you booked it already?', alternatives };
  if (code === 'missing_facts') {
    const missing = (Array.isArray(b.missing) ? b.missing : []).filter((m): m is 'date' | 'time' => m === 'date' || m === 'time');
    if (missing.length) return { kind: 'needs', missing, error: error ?? 'Pick a time first.', alternatives };
  }
  if (code === 'in_progress' || code === 'calling' || code === 'already_in_progress') {
    return { kind: 'busy', error: error ?? 'Somebody is booking this right now. Nothing more was sent.' };
  }
  return { kind: 'refused', code, error: error ?? 'Not booked. Nothing was sent.', alternatives, platformUrl: str(b.platformUrl) };
}

/** "No 7:30 — they offered 9:00. Take it?" */
export function offeredTitle(asked: string | null, offered: string): string {
  return asked ? `No ${shortClock(asked)} — they offered ${shortClock(offered)}. Take it?` : `They offered ${shortClock(offered)}. Take it?`;
}

/** A fee exactly as the platform gave it: its own label, and its own amount. */
export function feeSaid(fee: Hold['fee']): string | null {
  if (!fee || !str(fee.label) || !Number.isFinite(Number(fee.amountCents))) return null;
  const money = (c: number) => {
    const cur = /^[A-Z]{3}$/.test(String(fee.currency ?? '')) ? String(fee.currency) : 'USD';
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100); }
    catch { return `${(c / 100).toFixed(2)} ${cur}`; }
  };
  const tax = Number(fee.taxCents);
  return `${fee.label}: ${money(Number(fee.amountCents))}${Number.isFinite(tax) && tax > 0 ? ` + ${money(tax)} tax` : ''}`;
}

/** Seconds left on a hold, or null when it carries no time. */
export function holdLeft(expiresAt: string | null | undefined, nowMs: number): number | null {
  const t = Date.parse(String(expiresAt ?? ''));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((t - nowMs) / 1000));
}

/** "4:59" */
export function leftSaid(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface CallInfo {
  available?: boolean;
  test?: boolean;
  call?: { status?: string; outcome?: string | null; title?: string; body?: string; offeredTime?: string | null } | null;
}

/**
 * Whether "Have Reach call" is shown: the server offered a call for this
 * table (only while the calling gate is live) and the call route agrees, with
 * no call made yet. Hidden entirely otherwise — never a greyed-out promise.
 */
export function callShown(entry: { open?: boolean; path?: string; alternatives?: Option[] } | null, info: CallInfo | null): boolean {
  if (!entry?.open || !info) return false;
  const offered = entry.path === 'call' || (entry.alternatives ?? []).some(a => a.kind === 'call');
  return offered && info.available === true && info.test !== true && !info.call;
}

/**
 * The words for a table Reach is calling about, or called: the call's own
 * wording (the research's — "Luigi's confirmed on the call: 7:30 for 4,
 * under Maria.") where the call route has it, else the row's.
 */
export function callWords(
  entry: { path?: string; state?: string | null; title?: string | null; body?: string | null } | null, info: CallInfo | null,
): { title: string; body: string } | null {
  const c = info?.call;
  // Only while the row still stands where the call left it: a table booked
  // some other way after a call that got none is the row's to tell, never
  // the call's "no table" beside a tick. Confirmed on both, or on neither.
  const agrees = !!entry?.state && (entry.state === 'confirmed') === (c?.outcome === 'confirmed');
  if (entry?.path === 'call' && c && agrees && str(c.title) && info?.test !== true) return { title: String(c.title), body: str(c.body) ?? '' };
  return str(entry?.title) ? { title: String(entry!.title), body: str(entry!.body) ?? '' } : null;
}

/** "7:30 PM", for a button. */
export function timeLabel(hhmm: string): string {
  return clockSaid(hhmm) ?? hhmm;
}

// ─── What one row offers ────────────────────────────────────────────────

export interface TableEntry {
  open?: boolean;
  path?: string;
  status?: string | null;
  state?: string | null;
  needs?: ('date' | 'time')[];
  offeredTimes?: string[];
  alternatives?: Option[];
  ownAccount?: { label: string; href: string; perk?: string | null } | null;
}

/**
 * Whether checkout's Book it sends this table, so the row need not offer its
 * own button: the same rows its loop sends to approval and no others — open,
 * Reach's to book on a platform, still awaiting approval (approval refuses
 * anything else), and with nothing to pick first (Book it sends no night or
 * time). A table that fails any of these keeps its own Book it.
 */
export function bookItCovers(entry: TableEntry | null, step: string | null): boolean {
  return step === 'book' && !!entry?.open && entry.path === 'instant'
    && entry.status === 'awaiting_approval' && !(entry.needs ?? []).length;
}

/**
 * Whether a press's answer is still the thing to show, or the row has
 * caught up and says it in its own words. A row read before the press (a
 * list nobody re-read, a seed on checkout's problems) still shows it.
 */
export function answerShown(answer: TableAnswer | null, entry: TableEntry | null): TableAnswer | null {
  if (!answer || !entry) return answer;
  if (answer.kind === 'done') return entry.open && entry.state !== 'confirmed' ? answer : null;
  if (answer.kind === 'not_yet') {
    const caught = answer.outcome === 'calling' ? entry.state === 'calling' || entry.state === 'requested' : entry.state === answer.outcome;
    return caught ? null : answer;
  }
  return answer;
}

export interface TableControls {
  /** The one thing Reach does: Book it, take an offered time, ring to take it, or call. */
  primary: 'book' | 'take' | 'call_take' | 'call' | null;
  ownAccount: boolean;
  alternatives: Option[];
  /** Night and time inputs: only where a press below sends what is picked. */
  pickers: ('date' | 'time')[];
  /** Show the row's "what Reach will do" — not while an answer says where it stands. */
  showWhat: boolean;
}

const NOT_AFTER_BOOK = new Set(['other_time', 'hold_again', 'ask_first', 'busy']);

/**
 * What one table row offers, given its reservation and the answer to the
 * last press. Booked, or handed over by that answer, offers nothing more to
 * book with: a second way in beside a confirmation is a second table.
 */
export function tableControls(
  entry: TableEntry, answer: TableAnswer | null, ctx: { noPrimary?: boolean; mayCall?: boolean } = {},
): TableControls {
  const none: TableControls = { primary: null, ownAccount: false, alternatives: [], pickers: [], showWhat: true };
  const inDoubt = answer?.kind === 'unknown' || entry.state === 'in_doubt';
  if (inDoubt || answer?.kind === 'hold') return none;
  if (answer?.kind === 'done') return { ...none, showWhat: false };
  if (answer?.kind === 'not_yet') return { ...none, alternatives: answer.alternatives, showWhat: false };

  const answerAlts = answer && 'alternatives' in answer && answer.alternatives.length ? answer.alternatives : null;
  if (!entry.open) {
    return { ...none, alternatives: entry.state === 'card_owed' ? answerAlts ?? entry.alternatives ?? [] : [] };
  }

  const offered = entry.state === 'offered' && (entry.offeredTimes ?? []).length > 0;
  const hasPhone = (entry.alternatives ?? []).some(a => a.kind === 'phone' && a.href);
  let primary: TableControls['primary'] = null;
  if (ctx.noPrimary && !answer) primary = null;
  else if (offered) primary = entry.path === 'instant' ? 'take' : hasPhone ? 'call_take' : null;
  else if (entry.path === 'instant' && !NOT_AFTER_BOOK.has(answer?.kind ?? '')) primary = 'book';
  else if (entry.path === 'call' && ctx.mayCall && answer?.kind !== 'ask_first' && answer?.kind !== 'busy') primary = 'call';

  const alternatives = answerAlts ?? entry.alternatives ?? [];
  const callAlt = !!ctx.mayCall && entry.path !== 'call' && alternatives.some(a => a.kind === 'call');
  const needs = [...new Set([...(entry.needs ?? []), ...(answer?.kind === 'needs' ? answer.missing : [])])];
  const sends = primary === 'book' || primary === 'call' || callAlt;
  return { primary, ownAccount: !!entry.ownAccount, alternatives, pickers: sends ? needs : [], showWhat: true };
}
