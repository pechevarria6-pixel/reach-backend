// ─── A veto is a rule about the output, not a line in the prompt ─────────
// "Every veto is absolute" was only ever said to the model. Nothing read
// what came back, so a group where somebody ticked "hiking" could still be
// handed a sunrise trek, and the one person who said no is the one who
// finds out. This checks the words of each line against what can be
// checked from words; the rest (long flights, crowds, noise, queues,
// standing, dressing up) are about the place, not the sentence, and stay
// with the prompt — they are not claimed here. Cold weather and extreme heat
// are about the place too, and are checked against the climate we hold for
// it (lib/climate.ts climateBreach, applied in the trips route), never
// against words: "escape the cold weather" is not a cold trip.

import { isNegated } from './goal.ts';

/**
 * The weather no-gos that name a kind of weather, not a thing somebody would
 * do: "escape the cold weather" is not a cold trip, so these are judged only
 * against the climate (lib/climate.ts). A one-word no-go that is also a
 * weather — "snow", "heat", "freezing", "cold" — is still a word too: the
 * person who typed "snow" does not want snow tubing in a mild March, and the
 * climate rule alone would keep it.
 */
const WEATHER_ONLY = /^(coldweather|cold weather|extremeheat|extreme heat|hot weather)$/i;

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
    if (!v || NOT_FROM_WORDS.has(v) || WEATHER_ONLY.test(v.replace(/\s+/g, ' '))) continue;
    const known = PATTERNS[v] ?? PATTERNS[v.toLowerCase()];
    if (!known && v.split(/\s+/).length > 3) continue;
    const re = new RegExp((known ?? new RegExp(`\\b${escape(v)}\\b`, 'i')).source, 'gi');
    // A mention that says no is keeping the veto, not breaking it: "no
    // hiking needed" is the sentence you want somebody who hates hiking to
    // read. Same reading as the goal parser's (lib/goal.ts isNegated).
    for (const m of t.matchAll(re)) if (!isNegated(t, m.index ?? 0)) return v;
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

/**
 * Which veto a trip idea breaks, read across everything its card says: the
 * tagline, the vibe, why it suits them, the food and music, and where they
 * would stay. An idea built around a campsite for a group with a camper-hater
 * in it is not one of their three choices.
 */
export function tripBreach(trip: {
  destination?: unknown; tagline?: unknown; vibe?: unknown; why_this_group?: unknown;
  food_scene?: unknown; music_scene?: unknown;
  costs?: { accommodation?: { example?: unknown; details?: unknown } | null; activities?: { details?: unknown } | null } | null;
}, vetoes: string[]): string | null {
  if (!vetoes.length) return null;
  const said = [
    trip.tagline, trip.vibe, trip.why_this_group, trip.food_scene, trip.music_scene,
    trip.costs?.accommodation?.example, trip.costs?.accommodation?.details, trip.costs?.activities?.details,
  ].map(x => String(x ?? '')).filter(Boolean);
  for (const line of said) {
    const hit = vetoBreach(line, vetoes);
    if (hit) return hit;
  }
  return null;
}
