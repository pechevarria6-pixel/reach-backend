// ─── A claim needs its evidence (REACH-DESTINATION-DIVERSITY-2026-11-22, Task 4) ──
// Asked about travel, models say "less crowded", "eco-friendly" and "hidden
// gem" about places with nothing behind the words, and the more often a
// place is called quiet the less quiet it gets. In a pitch Reach writes, a
// claim word may appear only when the selector holds the evidence for it
// (the `evidence:` reasons from lib/destination-select.ts score()); a few
// phrases are never allowed at all, because nothing could stand behind them.
//
// This is the one file allowed to spell these phrases out:
// scripts/check-vocabulary.mjs bans them in every other string, and the
// prompt that forbids them builds its sentence from these lists.
//
// No imports, so the route, the guard and node's test runner all load it bare.

/** Each claim phrase, and the evidence reason it needs. */
export const CLAIM_EVIDENCE: Record<string, string> = {
  'less crowded': 'evidence:quiet-this-month',
  'uncrowded': 'evidence:quiet-this-month',
  'off the beaten path': 'evidence:low-popularity',
  'eco-friendly': 'evidence:sustainability-source',
  'sustainable': 'evidence:sustainability-source',
};

/** Never, whatever we hold. */
export const BANNED_ALWAYS = ['hidden gem', 'best-kept secret', 'undiscovered'];

/** The phrases in this text that nothing stands behind. */
export function unsupportedClaims(text: string, reasons: string[]): string[] {
  const t = String(text ?? '').toLowerCase();
  const bad = BANNED_ALWAYS.filter(w => t.includes(w));
  for (const [phrase, key] of Object.entries(CLAIM_EVIDENCE)) {
    if (t.includes(phrase) && !reasons.includes(key)) bad.push(phrase);
  }
  return bad;
}

/** The fields of an option card the model writes as prose. */
export const PITCH_FIELDS = ['tagline', 'vibe', 'why_this_group', 'food_scene', 'music_scene'] as const;

/** Every unsupported phrase in an option's pitch, field by field. Empty when clean. */
export function pitchHits(trip: Record<string, unknown>, reasons: string[]): { field: string; phrases: string[] }[] {
  const out: { field: string; phrases: string[] }[] = [];
  for (const f of PITCH_FIELDS) {
    const v = trip[f];
    if (typeof v !== 'string') continue;
    const phrases = unsupportedClaims(v, reasons);
    if (phrases.length) out.push({ field: f, phrases });
  }
  return out;
}

/**
 * The second strike: every sentence carrying one of the phrases goes. What
 * is left is still true; an empty field is better than a false one.
 */
export function stripClaims(text: string, phrases: string[]): string {
  const low = phrases.map(p => p.toLowerCase());
  const sentences = String(text ?? '').match(/[^.!?]+[.!?]*\s*/g) ?? [];
  return sentences.filter(s => !low.some(p => s.toLowerCase().includes(p))).join('').trim();
}

/** The sentence a prompt uses to forbid them, built from the lists above. */
export function forbiddenClaimsLine(): string {
  const quoted = (xs: string[]) => xs.map(x => `"${x}"`).join(', ');
  return `Never use the words ${quoted([...Object.keys(CLAIM_EVIDENCE), ...BANNED_ALWAYS])} — Reach holds no evidence for them about these places.`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COUNT = ['No one', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/**
 * "Why this", built in code from the reasons — never written by the model.
 * Each part traces to something a member said or to a figure we hold. No
 * reasons, no line.
 *
 *   pickers: how many members chose each tag (destination-context tagPickersFrom)
 *   asked:   tags the trip's own words asked for
 */
export function whyThisLine(
  reasons: string[],
  ctx: { pickers: Record<string, number>; asked: string[]; solo: boolean; month: number | null; travelMinutes?: number | null },
): string | null {
  const tags = reasons.filter(r => r.startsWith('tag:')).map(r => r.slice(4));
  const parts: string[] = [];
  const said = tags
    .map(t => ({ t, n: ctx.pickers[t] ?? 0, asked: ctx.asked.includes(t) }))
    .sort((a, b) => Number(b.asked) - Number(a.asked) || b.n - a.n || a.t.localeCompare(b.t));
  for (const s of said.slice(0, 2)) {
    if (s.asked) parts.push(`You asked for ${s.t}`);
    else if (ctx.solo && s.n >= 1) parts.push(`You picked ${s.t}`);
    else if (s.n >= 1) parts.push(`${COUNT[Math.min(s.n, 10)]} of you picked ${s.t}`);
  }
  if (ctx.travelMinutes != null && ctx.travelMinutes > 0) {
    const h = ctx.travelMinutes / 60;
    parts.push(h < 1 ? `${Math.round(ctx.travelMinutes)} min away` : `${Math.round(h * 10) / 10} h away`);
  }
  if (reasons.includes('evidence:quiet-this-month') && ctx.month && ctx.month >= 1 && ctx.month <= 12) {
    parts.push(`quiet in ${MONTHS[ctx.month - 1]}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
