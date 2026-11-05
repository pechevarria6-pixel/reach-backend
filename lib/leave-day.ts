// ─── The day they leave ──────────────────────────────────────────────────
// An itinerary wrote one day per night, so a Friday-to-Sunday trip planned
// Friday and Saturday and left Sunday blank — the morning somebody is still
// in town with nothing on the page. Owner, 2026-11-05: plan it, make it
// optional, and fit it to when they actually leave.
//
// What is planned depends on what we hold, never on a guess:
//   - a return flight with a departure time: free until three hours before
//     it (getting to the airport, bags, security);
//       free from 15:00 on → a morning and an afternoon;
//       free from 11:00 on → a morning;
//       earlier than that → nothing; the day is the journey home;
//   - no return flight with a time (driving, or nothing booked yet): a light
//     morning, done by 11:00 — the hour most places expect people out.
// Somebody who does not want it switches it off and the day stays empty.

export type DayPart = 'morning' | 'afternoon';

export interface LeaveDay {
  /** The parts of the last day to plan, in order. Empty = plan nothing. */
  parts: DayPart[];
  /** "HH:MM", local to the trip: everything is over by then. */
  until: string | null;
  /** Why, in words for the prompt and the screen. */
  because: string;
}

/** Hours before a flight somebody should be on their way to the airport. */
export const AIRPORT_HOURS = 3;

const clock = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** "HH:MM" from "2026-12-06T15:52:00" or "15:52", or null. The airport's own local time, as Duffel gives it. */
export function departsAt(departs: unknown): number | null {
  const m = /(?:T|^)(\d{2}):(\d{2})/.exec(String(departs ?? ''));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function leaveDay(input: { wanted: boolean; returnDeparts?: unknown }): LeaveDay {
  if (!input.wanted) return { parts: [], until: null, because: 'switched off' };
  const dep = departsAt(input.returnDeparts);
  if (dep === null) {
    return { parts: ['morning'], until: '11:00', because: 'no return flight time held, so a light morning done by 11' };
  }
  const free = dep - AIRPORT_HOURS * 60;
  if (free >= 15 * 60) return { parts: ['morning', 'afternoon'], until: clock(free), because: `the flight home leaves at ${clock(dep)}` };
  if (free >= 11 * 60) return { parts: ['morning'], until: clock(free), because: `the flight home leaves at ${clock(dep)}` };
  return { parts: [], until: null, because: `the flight home leaves at ${clock(dep)}, so the day is the journey` };
}

/** The last day's slots, with every part they are not there for taken off. */
export function trimLeaveDay<T extends { morning?: unknown; afternoon?: unknown; evening?: unknown }>(day: T, plan: LeaveDay): T {
  return {
    ...day,
    morning: plan.parts.includes('morning') ? day.morning : null,
    afternoon: plan.parts.includes('afternoon') ? day.afternoon : null,
    evening: null,
  };
}
