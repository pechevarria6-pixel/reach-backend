// ─── A group's plans, in the order they happen ───────────────────────────
// A list of plans in whatever order the server returned them is not a
// calendar. What somebody wants to know when they open a group is what is
// next, and after that what else is coming.
//
// Three groups, in this order:
//   Coming up — soonest first, because the nearest thing is the one being
//               decided, paid for or packed for.
//   No date yet — a plan somebody added by hand and never dated. It cannot be
//               sorted with the rest without inventing a date for it, and an
//               invented date would quietly put it in the wrong place.
//   Been and gone — most recent first, because last weekend matters more than
//               last year.
//
// Pure, so the rule can be tested without a browser.

export type DatedPlan = { id?: string; startDate?: unknown; endDate?: unknown };
export type PlanSection<T> = { key: 'upcoming' | 'undated' | 'past'; label: string; plans: T[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A plan's own day, or null when nobody ever gave it one.
 *
 * The shape is not enough: "2026-13-45" matches the pattern and is not a date.
 * Parsing it and checking it comes back as the same day is what separates a
 * real date from a plausible one — and a plausible one would sort into
 * "Coming up" at a position no real date occupies.
 */
export function planDay(plan: DatedPlan): string | null {
  const v = plan?.startDate;
  if (typeof v !== 'string' || !ISO.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

/**
 * A plan counts as over the day after it ends, so a trip is still "coming up"
 * while you are on it rather than dropping into the past on the morning you
 * arrive. A night out ends the day it starts.
 */
function lastDay(plan: DatedPlan): string | null {
  const end = plan?.endDate;
  if (typeof end === 'string' && ISO.test(end)) return end;
  return planDay(plan);
}

/**
 * Plans split into what is coming, what has no date, and what is over.
 * `today` is passed in rather than read from the clock, so the rule can be
 * tested and so a screen open at midnight does not disagree with itself.
 */
export function planSections<T extends DatedPlan>(plans: T[], today: string): PlanSection<T>[] {
  const all = Array.isArray(plans) ? plans.filter(Boolean) : [];

  const upcoming: T[] = [];
  const undated: T[] = [];
  const past: T[] = [];
  for (const plan of all) {
    const day = planDay(plan);
    if (!day) { undated.push(plan); continue; }
    ((lastDay(plan) as string) >= today ? upcoming : past).push(plan);
  }

  // Soonest first for what is ahead; most recent first for what is behind.
  upcoming.sort((a, b) => (planDay(a) as string).localeCompare(planDay(b) as string));
  past.sort((a, b) => (planDay(b) as string).localeCompare(planDay(a) as string));

  return [
    { key: 'upcoming', label: 'Coming up', plans: upcoming },
    { key: 'undated', label: 'No date yet', plans: undated },
    { key: 'past', label: 'Been and gone', plans: past },
  ].filter(s => s.plans.length) as PlanSection<T>[];
}

/**
 * How far away a plan is, in the words somebody would use. Null for a plan
 * with no date, so the screen can say nothing rather than guess.
 */
export function daysAway(plan: DatedPlan, today: string): string | null {
  const day = planDay(plan);
  if (!day || !ISO.test(today)) return null;
  // A trip that started on Monday and ends on Friday is not "Yesterday" on
  // Wednesday. It is happening, and saying anything else contradicts the
  // section it is sitting under.
  const ends = lastDay(plan);
  if (day <= today && ends && ends >= today) return day === today ? 'Today' : 'On now';
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const days = Math.round(ms / 86_400_000);
  // Something finished is described by when it finished. A trip that ran the
  // tenth to the fifteenth ended yesterday; measuring from the day it began
  // called that "6 days ago", which is true of nothing anybody cares about.
  if (days < 0) {
    const ended = lastDay(plan) as string;
    const overBy = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ended}T00:00:00Z`)) / 86_400_000,
    );
    if (overBy === 1) return 'Yesterday';
    if (overBy > 1 && overBy < 7) return `${overBy} days ago`;
    return null;
  }
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days >= 7 && days < 14) return 'Next week';
  return null;
}
