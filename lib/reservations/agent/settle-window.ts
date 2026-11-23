// ─── Settling a call whose member approved a window, not one time ───────
// outcome.ts settle() proves a "confirmed" against one time: the one asked
// for. The calling agent may accept another time inside the window the
// member approved (6:30–8:00, say), so the proof is run against the time the
// restaurant agreed to — but only when that time is inside the window. The
// staff must still have said it, and said yes to it; nothing about the
// proof is relaxed, only which time it is proved against.
import type { CallFacts } from '../script.ts';
import type { Extraction, Settled, Signals, Turn } from '../outcome.ts';
import { asClock, settle } from '../outcome.ts';
import type { Window } from './machine.ts';
import { inWindow } from './machine.ts';

export function settleWithin(facts: CallFacts, window: Window, turns: Turn[], x: Extraction | null | undefined, sig: Signals = {}): Settled {
  const held = x?.held_time == null ? null : asClock(x.held_time, facts.time);
  const asked = held && held !== facts.time && inWindow(held, window) ? { ...facts, time: held } : facts;
  return settle(asked, turns, x, sig);
}

/** The window a call may accept: the member's, or only the time they chose. Never wider. */
export function windowFor(facts: CallFacts, start?: string | null, end?: string | null): Window {
  const ok = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (ok(start) && ok(end) && start <= facts.time && facts.time <= end) return { start, end };
  return { start: facts.time, end: facts.time };
}
