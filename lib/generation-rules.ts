// ─── What a set of generated options has to be true of ──────────────────
// The model is asked for three options, tiered by cost, and told where they
// may be. It mostly obliges. "Mostly" is the problem: a live run came back
// with four trips, one destination twice, and cost lines that did not sum to
// their own headline — so what it sends is checked rather than trusted.
//
// The checks are split by what can be done about them, which is the useful
// distinction:
//
//   fixable — ordering and tier labels. If three good options come back in
//             the wrong order, reordering them is better than asking again
//             and spending somebody's time to be told the same three things.
//
//   fatal   — being in the wrong place. Somebody who asked for Breckenridge
//             and is shown Aspen has not been given a choice, they have been
//             ignored. That is worth a second attempt and then an apology.
import type { z } from 'zod';

export type Tier = 'saver' | 'on_budget' | 'stretch';
export const TIERS: Tier[] = ['saver', 'on_budget', 'stretch'];

/**
 * Only the four fields these rules read. Every one optional, because this
 * runs on what a model just sent: the caller's schema is stricter, and a
 * stricter type here would refuse the very shapes worth checking.
 */
export interface TripLike {
  destination?: string | null;
  city?: string | null;
  total_per_person?: number | null;
  tier?: string | null;
}

export interface ModeRule {
  /** A place all three must be at, or null when the group only gave a goal. */
  location: string | null;
}

/** Words that say nothing about which place this is. */
const NOISE = new Set([
  'the', 'a', 'an', 'of', 'in', 'at', 'on', 'and', 'city', 'town', 'area',
  'usa', 'us', 'uk', 'resort', 'village',
]);

function terms(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !NOISE.has(w));
}

/**
 * Is this option at the place they asked for?
 *
 * Generous on purpose. "Breckenridge" should match "Breckenridge, Colorado"
 * and "Breckenridge Ski Resort", because those are the same holiday. It is
 * not so generous that Colorado alone would pass: at least one distinctive
 * word of the requested place has to appear, and a request of several words
 * is met when any of them does — "Lake Tahoe" is satisfied by "Tahoe".
 */
export function atLocation(trip: TripLike, location: string): boolean {
  const wanted = terms(location);
  if (!wanted.length) return true;                 // nothing asked, nothing to fail
  const have = new Set([...terms(trip.destination ?? ''), ...terms(trip.city ?? '')]);
  return wanted.some(w => have.has(w));
}

export interface RuleReport {
  /** Put right without asking the model again. */
  fixed: string[];
  /** Worth one more attempt, then an honest apology. */
  fatal: string[];
}

/**
 * The options as they should be shown, and what was wrong with them.
 *
 * Ordering and tier labels are corrected here rather than reported: three
 * good options in the wrong order is not a reason to make somebody wait
 * again. Cost is the ordering, because cost is what the tier means — a run
 * that labelled its dearest option "saver" was telling the truth about the
 * price and a lie about the word.
 */
export function applyRules<T extends TripLike>(trips: T[], rule: ModeRule): RuleReport & { trips: T[] } {
  const fixed: string[] = [];
  const fatal: string[] = [];
  const list = [...(trips ?? [])];

  if (list.length !== 3) {
    // Not fatal: fewer than three real options still beats an error, and the
    // route already refuses an empty list.
    fixed.push(`expected 3 options, got ${list.length}`);
  }

  const ordered = [...list].sort((a, b) => (a.total_per_person ?? 0) - (b.total_per_person ?? 0));
  if (ordered.some((t, i) => t !== list[i])) fixed.push('options were not cheapest-first');

  // The tier is a name for the position, so it is assigned from the order
  // rather than believed. Only meaningful for exactly three.
  const relabelled = ordered.map((t, i) => {
    const should = ordered.length === 3 ? TIERS[i] : t.tier;
    if (should && t.tier !== should) {
      fixed.push(`"${t.destination}" was labelled ${t.tier} at position ${i + 1}`);
      // The caller's own trip type is preserved: this only rewrites the tier,
      // which the caller types more narrowly than this module needs to.
      return { ...t, tier: should };
    }
    return t;
  });

  if (rule.location) {
    const strays = relabelled.filter(t => !atLocation(t, rule.location as string));
    // Being in the wrong place is not a labelling slip. Somebody asked to go
    // somewhere and was shown three other holidays.
    for (const s of strays) fatal.push(`"${s.destination}" is not at ${rule.location}`);
  }

  return { fixed, fatal, trips: relabelled as T[] };
}

/** What to tell the model it got wrong, when asking a second time. */
export function correctionNote(report: RuleReport, rule: ModeRule): string {
  const lines = [...report.fatal];
  if (rule.location) {
    lines.push(`Every option must be at ${rule.location}. Vary the plan and the budget, never the destination.`);
  }
  return `Your last answer was rejected:\n${lines.map(l => `- ${l}`).join('\n')}\nReturn corrected JSON in the same shape.`;
}

// Re-exported for the route, which builds its own zod types.
export type Schema<T> = z.ZodType<T>;

// ─── One sit-down meal per evening ───────────────────────────────────────
// The night prompt offered dinner in all three slots — "if the evening
// starts at dinner, say so there", the main event can be "the dinner", and
// the evening is "dinner, dessert, a last drink" — and nothing checked what
// came back. The one double dinner that reached a screen (Vic's and Vinny's,
// the same Raleigh evening) was a stale booking, but nothing would have
// stopped the model writing it. The first meal stays; a later one goes
// rather than being relabelled — "an evening of two real things beats three".
const MEAL = /\b(dinner|supper|tasting menu|prix[- ]fixe|brunch|lunch|sit[- ]down meal)\b/i;
const slotText = (v: unknown) => typeof v === 'string' ? v : String((v as { plan?: unknown } | null)?.plan ?? '');

export function oneMealPerEvening<D extends { morning?: unknown; afternoon?: unknown; evening?: unknown }>(day: D): { day: D; dropped: string[] } {
  const order = ['morning', 'afternoon', 'evening'] as const;
  let seen = false;
  const dropped: string[] = [];
  const out = { ...day } as Record<string, unknown>;
  for (const k of order) {
    const text = slotText(out[k]);
    if (!text || !MEAL.test(text)) continue;
    if (!seen) { seen = true; continue; }
    dropped.push(text);
    out[k] = typeof out[k] === 'string' ? '' : { ...(out[k] as object), plan: '' };
  }
  return { day: out as D, dropped };
}
