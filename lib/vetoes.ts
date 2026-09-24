// ─── A veto is a rule about the output, not a line in the prompt ─────────
// "Every veto is absolute" was only ever said to the model. Nothing read
// what came back, so a group where somebody ticked "hiking" could still be
// handed a sunrise trek, and the one person who said no is the one who
// finds out. This checks the words of each line against what can be
// checked from words; the rest (long flights, cold weather, crowds, noise,
// queues, standing, dressing up) are about the place, not the sentence, and
// stay with the prompt — they are not claimed here.

const PATTERNS: Record<string, RegExp> = {
  camping: /\b(camp(ing|site|sites|ground|grounds)?|tents?|glamping)\b/i,
  hiking: /\b(hik(e|es|ing)|trek(s|king)?|backpacking)\b/i,
  // Nightclubs, not every room called a club: a jazz club, a comedy club and
  // a supper club are a seat and a show.
  clubs: /\b(night ?clubs?|clubbing|dance clubs?)\b/i,
  'early mornings': /\b(sunrise|dawn|daybreak)\b/i,
  earlyMornings: /\b(sunrise|dawn|daybreak)\b/i,
};

/** Quiz ids and night-out phrases that name a feeling, not a word to find. */
const NOT_FROM_WORDS = new Set([
  'longFlights', 'coldWeather', 'crowded', 'big crowds', 'loud rooms',
  'long queues', 'standing all night', 'dressing up',
]);

function escape(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Which veto this text breaks, or null. A typed veto ("seafood", "karaoke")
 * is matched as whole words; one longer than three words is a sentence, not
 * a thing to find, and is left to the prompt.
 */
export function vetoBreach(text: string, vetoes: string[]): string | null {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const raw of vetoes) {
    const v = String(raw || '').replace(/^custom:/, '').trim();
    if (!v || NOT_FROM_WORDS.has(v)) continue;
    const known = PATTERNS[v] ?? PATTERNS[v.toLowerCase()];
    if (known) { if (known.test(t)) return v; continue; }
    if (v.split(/\s+/).length > 3) continue;
    if (new RegExp(`\\b${escape(v)}\\b`, 'i').test(t)) return v;
  }
  return null;
}

type Slot = { plan?: unknown; venue?: unknown } | string | null | undefined;
const words = (s: Slot) => typeof s === 'string' ? s : s ? `${String(s.plan ?? '')} ${String(s.venue ?? '')}` : '';

/**
 * The day with every line that breaks a veto taken out, and what went. A
 * slot keeps its place and loses its plan, the way a second dinner does; a
 * daytime suggestion is simply not offered.
 */
export function withoutVetoed<D extends { morning?: Slot; afternoon?: Slot; evening?: Slot; daytime?: Slot[] }>(
  day: D, vetoes: string[],
): { day: D; dropped: Array<{ veto: string; text: string }> } {
  if (!vetoes.length) return { day, dropped: [] };
  const out = { ...day } as Record<string, unknown>;
  const dropped: Array<{ veto: string; text: string }> = [];
  for (const k of ['morning', 'afternoon', 'evening'] as const) {
    const s = out[k] as Slot;
    const hit = vetoBreach(words(s), vetoes);
    if (!hit) continue;
    dropped.push({ veto: hit, text: words(s).trim() });
    out[k] = typeof s === 'string' ? '' : { ...(s as object), plan: '', venue: null };
  }
  if (Array.isArray(day.daytime)) {
    out.daytime = day.daytime.filter(s => {
      const hit = vetoBreach(words(s), vetoes);
      if (hit) dropped.push({ veto: hit, text: words(s).trim() });
      return !hit;
    });
  }
  return { day: out as D, dropped };
}
