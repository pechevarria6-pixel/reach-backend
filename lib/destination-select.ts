// ─── Choosing the place in code (REACH-DESTINATION-DIVERSITY-2026-11-22.md) ──
// Code chooses the place; the model writes the pitch. Asked from free recall,
// a model offers the same handful of headline destinations to everybody, calls
// the neighbours of a famous place its "alternatives", and says "less crowded"
// with nothing behind it. Reach already refuses that one level down — the
// generator may name only venues we hold — and this applies the same rule to
// the destination itself.
//
// Pure functions: no I/O, no model, no clock, no randomness. The same group on
// the same day gets the same picks; day-to-day variety comes from exposure
// dampening and exclusions, so a test can reproduce any answer exactly.
//
// Corrections to the directive's draft, from Task 0 (STATUS.md):
//   · destination_profiles.region is a US state code, not a travel region.
//     Spread is the 150 km rule; region only stands in when either side has
//     no coordinates. Otherwise two NC towns 400 km apart could never be
//     offered together, which is not what "alternatives are neighbours" meant.
//   · A price we do not hold yet is unknown, not cheap. An unpriced candidate
//     can fill a slot with no tier; the route prices it and drops it if it
//     lands over the guardrail.
//   · No budget set means no guardrail to divide by, not "everything is over".
//   · Unknown travel time is not "too far" and carries no penalty.

export type Tier = 'saver' | 'fair' | 'stretch';
export type CrowdTolerance = 'avoid' | 'fine' | 'love';

export interface Candidate {
  id: string;
  name: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
  /** 0..1 from a sourced figure; null = unknown, never "quiet". */
  popularity: number | null;
  /** 0..1 for the trip's month, from a sourced figure; null = unknown. */
  crowdThisMonth: number | null;
  /** From destination_exposure. */
  servedLast30d: number;
  /** Estimate for this group and these dates; null = not priced yet. */
  pricedPerPersonCents: number | null;
  /** From the group's home airports or city; null = unknown. */
  travelMinutes: number | null;
  tags: string[];
  verifiedVenueCount: number;
}

export interface GroupContext {
  /** 0 or less: no budget was set. */
  budgetPerPersonCents: number;
  /** From taste profiles, trip inputs and the blurb's extracted tags. */
  tagWeights: Record<string, number>;
  /** The strictest member's answer wins (strictestCrowd). */
  crowdTolerance: CrowdTolerance;
  /** Dismissed, vetoed, already visited. */
  excludedIds: Set<string>;
  maxTravelMinutes: number | null;
}

export interface Pick {
  /** Null when the place is not priced yet: the route tiers it once it is. */
  tier: Tier | null;
  candidate: Candidate;
  score: number;
  reasons: string[];
}

/** Starting values, in one place, tuned against the tripwire tests. */
export const SELECT_CONFIG = {
  /** Popularity at or above this is a headline destination. */
  headline: 0.8,
  /** No two options closer than this. */
  minSpreadKm: 150,
  /** Below this we cannot write an honest itinerary. */
  minVenues: 5,
  popularityWeight: 0.6,
  exposureWeight: 0.25,
  crowdAvoidWeight: 1.0,
  crowdLoveWeight: 0.3,
  /** At or under this, an "avoid" group's reason may say quiet this month. */
  quietThreshold: 0.3,
  /** Minutes of travel that cost one point. */
  travelMinutesPerPoint: 1200,
  tierSaverMax: 0.8,
  tierFairMax: 1.0,
  tierStretchMax: 1.2,
};
export type SelectConfig = typeof SELECT_CONFIG;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The tier a priced candidate sits in for this group, or null when it is over
 * the guardrail and must never be offered. Undefined when it cannot be said:
 * no price yet, or no budget to measure it against.
 */
export function tierFor(c: Candidate, g: GroupContext, cfg: SelectConfig = SELECT_CONFIG): Tier | null | undefined {
  if (c.pricedPerPersonCents == null || !Number.isFinite(c.pricedPerPersonCents)) return undefined;
  if (!(g.budgetPerPersonCents > 0)) return undefined;
  const r = c.pricedPerPersonCents / g.budgetPerPersonCents;
  if (r <= cfg.tierSaverMax) return 'saver';
  if (r <= cfg.tierFairMax) return 'fair';
  if (r <= cfg.tierStretchMax) return 'stretch';
  return null;
}

export function score(c: Candidate, g: GroupContext, cfg: SelectConfig = SELECT_CONFIG): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;

  // 1. Fit to what the group actually said. The only positive term.
  for (const t of [...new Set(c.tags)].sort()) {
    const w = g.tagWeights[t];
    if (w && w > 0) { s += w; reasons.push(`tag:${t}`); }
  }

  // 2. Popularity: unknown gets no bonus and no penalty.
  if (c.popularity != null) {
    s -= cfg.popularityWeight * c.popularity;
    if (c.popularity < 0.2) reasons.push('evidence:low-popularity');
  }

  // 3. Crowds, only when we hold a real figure for this month.
  if (c.crowdThisMonth != null) {
    if (g.crowdTolerance === 'avoid') s -= cfg.crowdAvoidWeight * c.crowdThisMonth;
    if (g.crowdTolerance === 'love') s += cfg.crowdLoveWeight * c.crowdThisMonth;
    if (g.crowdTolerance === 'avoid' && c.crowdThisMonth <= cfg.quietThreshold) reasons.push('evidence:quiet-this-month');
  }

  // 4. The more groups sent here lately, the less we push it.
  s -= cfg.exposureWeight * Math.log1p(Math.max(0, c.servedLast30d));

  // 5. Shorter journeys win ties. Unknown costs nothing.
  if (c.travelMinutes != null) s -= c.travelMinutes / cfg.travelMinutesPerPoint;

  return { score: s, reasons };
}

function compatible(c: Candidate, chosen: Candidate[], cfg: SelectConfig): boolean {
  for (const o of chosen) {
    const coords = c.lat != null && c.lng != null && o.lat != null && o.lng != null;
    if (coords) {
      if (haversineKm({ lat: c.lat!, lng: c.lng! }, { lat: o.lat!, lng: o.lng! }) < cfg.minSpreadKm) return false;
    } else if (c.region && o.region && c.region === o.region) {
      // No coordinates to measure: the shared region is the only spread we can see.
      return false;
    }
    if ((c.popularity ?? 0) >= cfg.headline && (o.popularity ?? 0) >= cfg.headline) return false;
  }
  return true;
}

/** Eligible, scored and in a stable order — the list pickThree draws from. */
export function ranked(all: Candidate[], g: GroupContext, cfg: SelectConfig = SELECT_CONFIG) {
  return all
    .filter(c => !g.excludedIds.has(c.id))
    .filter(c => c.verifiedVenueCount >= cfg.minVenues)
    .filter(c => g.maxTravelMinutes == null || c.travelMinutes == null || c.travelMinutes <= g.maxTravelMinutes)
    .map(c => ({ c, tier: tierFor(c, g, cfg), ...score(c, g, cfg) }))
    // Over the guardrail is never offered; a pick must trace to something said.
    .filter(x => x.tier !== null && x.reasons.some(r => r.startsWith('tag:')))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
}

/** Up to three picks, one per tier where possible. Fewer is a valid, honest answer. */
export function pickThree(all: Candidate[], g: GroupContext, cfg: SelectConfig = SELECT_CONFIG): Pick[] {
  const list = ranked(all, g, cfg);
  const picks: Pick[] = [];
  const taken = () => picks.map(p => p.candidate);

  for (const tier of ['saver', 'fair', 'stretch'] as Tier[]) {
    const hit = list.find(x => x.tier === tier &&
      !picks.some(p => p.candidate.id === x.c.id) && compatible(x.c, taken(), cfg));
    if (hit) picks.push({ tier, candidate: hit.c, score: hit.score, reasons: hit.reasons });
  }
  // Empty tiers take the best remaining compatible candidate of any tier,
  // including one not priced yet (tier null until the route prices it).
  for (const x of list) {
    if (picks.length >= 3) break;
    if (picks.some(p => p.candidate.id === x.c.id)) continue;
    if (!compatible(x.c, taken(), cfg)) continue;
    picks.push({ tier: (x.tier ?? null) as Tier | null, candidate: x.c, score: x.score, reasons: x.reasons });
  }
  return picks;
}

/**
 * "Want us to widen the search?" Travel time is relaxed first, then spread.
 * The tag-match rule never is: a wider search is still about what they said.
 */
export function widened(g: GroupContext, cfg: SelectConfig, step: 1 | 2): { g: GroupContext; cfg: SelectConfig } {
  if (step === 1) return { g: { ...g, maxTravelMinutes: null }, cfg };
  return { g: { ...g, maxTravelMinutes: null }, cfg: { ...cfg, minSpreadKm: Math.round(cfg.minSpreadKm / 2) } };
}

/** The strictest answer in the group: one "avoid" outweighs any number of "love". */
export function strictestCrowd(answers: (string | null | undefined)[]): CrowdTolerance {
  if (answers.includes('avoid')) return 'avoid';
  if (answers.includes('fine')) return 'fine';
  if (answers.includes('love')) return 'love';
  return 'fine';
}

/** Share of all servings taken by the k most-served destinations. The study's headline metric. */
export function topKShare(servedIds: string[], k = 5): number {
  if (servedIds.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const id of servedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0);
  return top / servedIds.length;
}
