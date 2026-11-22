// ─── "Busy places?" (REACH-DESTINATION-DIVERSITY-2026-11-22, Task 5) ─────
// One quiz screen, skippable, editable in Profile. Like every quiz screen it
// takes as many answers as fit and ends with Done (the owner's rule, held by
// tests/unit/quiz-fast.test.ts): somebody who loves a buzzing market and
// would rather avoid a packed beach is both, and the picks blend.
//
// The blend is stored once, as users.crowd_tolerance ('avoid' | 'fine' |
// 'love'), which is what the destination selector reads; the group's value
// is its strictest member's (lib/destination-select.ts strictestCrowd).
// The picks themselves stay in quiz_answers.crowd, so Profile can show them.
//
// No imports: the screen list, the contract and the store all read it.

/** The options, and where each sits between avoiding crowds (0) and loving them (1). */
export const CROWD: Record<string, number> = { love: 1, fine: 0.5, avoid: 0 };

export const CROWD_OPTIONS = [
  { v: 'love', e: '🎉', l: 'Love the buzz' },
  { v: 'fine', e: '🙂', l: "Don't mind" },
  { v: 'avoid', e: '🌿', l: 'Rather avoid' },
];

export type CrowdTolerance = 'avoid' | 'fine' | 'love';

/**
 * Several picks, one stored answer: the average, read back into thirds.
 * Nothing picked is not an answer — null, never "fine".
 */
export function crowdFromPicks(picks: unknown): CrowdTolerance | null {
  const list = (Array.isArray(picks) ? picks : typeof picks === 'string' ? [picks] : [])
    .filter((p): p is string => typeof p === 'string' && p in CROWD);
  if (!list.length) return null;
  const avg = list.reduce((a, p) => a + CROWD[p], 0) / list.length;
  if (avg < 1 / 3) return 'avoid';
  if (avg > 2 / 3) return 'love';
  return 'fine';
}
