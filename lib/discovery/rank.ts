import type { Finding } from './types.ts';
import { profileBoost, type TravelerProfile } from '../traveler-profile.ts';

/**
 * Something found because of an interest outranks something found by being
 * nearby. That is the whole point of asking what somebody is into: a pottery
 * studio they will actually go to beats a stadium show they will not, and
 * sorting by distance or date buries it every time.
 */
export function rank(findings: Finding[], interests: string[], profile: TravelerProfile | null = null): Finding[] {
  const wanted = interests.map(i => i.toLowerCase());
  const score = (f: Finding) => {
    let s = 0;
    if (f.because) s += 100;                       // found because of them
    // A class beats the studio that runs it: "Thursday, £60" is an evening
    // somebody can have, and "there is a pottery near you" is homework.
    if (f.source === 'harvest') s += 60;
    const hay = `${f.title} ${f.category} ${f.meta}`.toLowerCase();
    if (wanted.some(w => w.length > 2 && hay.includes(w))) s += 40;
    if (f.price) s += 5;                           // a price is a kindness
    // Something happening on a date is a plan. A place that is simply open is
    // homework: you still have to decide when, and whether anything is on.
    if (f.date) s += 25;
    // The onboarding quiz's raw signals — what they chase and how they like
    // to travel — shade the order among the rest. Never the label alone, and
    // never enough to outrank something they said they are into.
    s += profileBoost(f, profile);
    return s;
  };
  // Interleave by source so one prolific provider cannot take the whole page.
  const bySource = new Map<string, Finding[]>();
  for (const f of [...findings].sort((a, b) => score(b) - score(a))) {
    if (!bySource.has(f.source)) bySource.set(f.source, []);
    bySource.get(f.source)!.push(f);
  }
  const lanes = [...bySource.values()];
  const out: Finding[] = [];
  for (let i = 0; out.length < findings.length; i++) {
    let moved = false;
    for (const lane of lanes) {
      if (lane[i]) { out.push(lane[i]); moved = true; }
    }
    if (!moved) break;
  }
  return out;
}

// ─── The same city, a different evening ──────────────────────────────────
// Discover was showing the same things in the same order every day. Ranking
// is deterministic, which is right — the best match should not move because a
// coin landed differently — but it means a small pool reads as a frozen one,
// and the pilot area has twelve venues in it.
//
// So the order is nudged by the day and the person: enough that Tuesday does
// not look like Monday, not so much that the strongest matches fall off the
// screen. Nothing is invented and nothing is hidden — the same findings, met
// in a different order.

/** A small, stable number from a string. Same input, same answer, anywhere. */
export function seedOf(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const part of parts.join('|')) {
    h ^= part.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A deterministic shuffle: the same seed always deals the same hand. */
function dealt<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift, so the sequence does not repeat over a page of results.
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Rotate within bands rather than across the whole list, so the top of the
 * page stays the best matches and the order inside each band moves daily.
 * A band of four keeps a strong result on the first screen while making the
 * screen itself different.
 */
export function rotateDaily<T>(items: T[], seed: number, band = 4): T[] {
  if (items.length <= 1) return items;
  const out: T[] = [];
  for (let i = 0; i < items.length; i += band) {
    out.push(...dealt(items.slice(i, i + band), seedOf(seed, i)));
  }
  return out;
}

/**
 * Below this, a city's list is thin enough that shuffling it would be the
 * only thing changing. The screen says so instead of implying depth.
 */
export const THIN_POOL = 15;

