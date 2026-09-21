// ─── The craft notes behind a kind of trip ──────────────────────────────
// Two representations of one contract plus the check that decides whether an
// answer may be stored, kept in one file so they cannot drift apart: a JSON
// Schema that constrains what the model writes, a zod schema that validates
// what comes back, and `namedThings`, which refuses an answer that names
// somebody's business.
//
// That last one is the whole point of this file. What is stored here is read
// into every generation of its kind, so an invented restaurant in one of
// these rows is not one bad itinerary — it is every itinerary of that kind
// until somebody notices. The rule is therefore absolute and enforced twice:
// the prompt says it in words, and the answer is read back before it is
// written anywhere.
//
// Nothing here talks to the network or the database, so all of it can be
// tested without either.
import { z } from 'zod';
import { properNames } from './discovery/real-places.ts';

// ─── The shape ──────────────────────────────────────────────────────────

/**
 * What is stored for one kind of trip.
 *
 * `rhythm` and `common_mistakes` are the fields that make a generated
 * itinerary read like a person planned it, so they are the ones the prompt
 * spends its tokens on and the ones required to be non-empty here.
 */
export const PlaybookSchema = z.object({
  archetype: z.string().min(1),
  what_success_feels_like: z.string().min(1),
  ideal_group_size: z.string().min(1),
  ideal_length_days: z.object({ min: z.number(), max: z.number() }),
  rhythm: z.array(z.object({
    phase: z.enum(['arrival', 'day', 'peak', 'last_day']),
    guidance: z.string().min(1),
  })).min(1),
  must_haves: z.array(z.string().min(1)).min(1),
  common_mistakes: z.array(z.string().min(1)).min(1),
  // Fractions of the total, not money. They are a hint for splitting a
  // budget, so they are allowed not to sum to exactly 1 — a model that
  // rounds to 0.99 has still said something useful.
  budget_allocation_hint: z.object({
    stay: z.number(), food: z.number(), activities: z.number(), transport: z.number(),
  }),
  per_person_budget_bands_usd: z.object({
    saver: z.number(), fair: z.number(), stretch: z.number(),
  }),
  // Where groups of this kind fall out. Feeds the words used when somebody
  // votes or vetoes, which is why it is worth asking for separately rather
  // than leaving it inside the prose.
  conflict_points: z.array(z.string().min(1)).min(1),
  // Shapes of a good one, in outline. Never a place: "three nights, two
  // travel days, one big night in the middle" is the answer wanted here.
  great_examples: z.array(z.object({ outline: z.string().min(1) })),
});

export type Playbook = z.infer<typeof PlaybookSchema>;

// The wire format the API constrains generation to. Written by hand rather
// than derived: the SDK's zod helper targets zod 4 and this project is on
// zod 3. tests/unit/playbooks asserts the two agree.
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;

export const PLAYBOOK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    archetype: str,
    what_success_feels_like: str,
    ideal_group_size: str,
    ideal_length_days: {
      type: 'object',
      properties: { min: num, max: num },
      required: ['min', 'max'],
      additionalProperties: false,
    },
    rhythm: {
      // No minItems above 1 anywhere in here: the API rejects the whole
      // schema outright for it, which is a 400 on every single call rather
      // than a slightly thin answer. The counts are asked for in the prompt
      // and checked by the zod schema instead.
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phase: { type: 'string', enum: ['arrival', 'day', 'peak', 'last_day'] },
          guidance: str,
        },
        required: ['phase', 'guidance'],
        additionalProperties: false,
      },
    },
    must_haves: { type: 'array', items: str },
    common_mistakes: { type: 'array', items: str },
    budget_allocation_hint: {
      type: 'object',
      properties: { stay: num, food: num, activities: num, transport: num },
      required: ['stay', 'food', 'activities', 'transport'],
      additionalProperties: false,
    },
    per_person_budget_bands_usd: {
      type: 'object',
      properties: { saver: num, fair: num, stretch: num },
      required: ['saver', 'fair', 'stretch'],
      additionalProperties: false,
    },
    conflict_points: { type: 'array', items: str },
    great_examples: {
      type: 'array',
      items: {
        type: 'object',
        properties: { outline: str },
        required: ['outline'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'archetype', 'what_success_feels_like', 'ideal_group_size', 'ideal_length_days',
    'rhythm', 'must_haves', 'common_mistakes', 'budget_allocation_hint',
    'per_person_budget_bands_usd', 'conflict_points', 'great_examples',
  ],
  additionalProperties: false,
} as const;

// ─── What to ask for ────────────────────────────────────────────────────

/** 'bachelor_party' as somebody would say it out loud. */
export function saidAloud(kind: string): string {
  return String(kind || '').replace(/_/g, ' ').trim();
}

/**
 * The question asked of the model.
 *
 * Two instructions do the real work. The first is that this is about how a
 * kind of trip goes, not about anywhere in particular — the notes are read
 * for a group going to a town the model has never been told about, so a
 * sentence about one town is worse than useless. The second is the standing
 * rule of this codebase: nothing unverified gets stated, and since nothing
 * here is verified against anything, nothing here may name a real thing.
 *
 * The "lower case" instruction is not style. It makes the rule checkable:
 * the check downstream looks for capitals in the middle of a sentence, so a
 * model that follows this passes it and a model that reaches for a brand
 * name does not.
 */
export function researchPrompt(kind: string): string {
  const said = saidAloud(kind);
  return [
    `You are writing the internal notes a world-class group-trip planner keeps`,
    `about one kind of trip: a ${said}.`,
    '',
    `These notes are read later by a planning engine that is working on a`,
    `real group going somewhere you will not be told about. So write about`,
    `how a ${said} goes — its pace, what it costs, what makes one good and`,
    `what wrecks one — and never about any particular place.`,
    '',
    'ABSOLUTE RULES, and they matter more than the quality of the writing:',
    '- Name no business, restaurant, bar, club, hotel, resort, tour company,',
    '  app, brand, festival, event, city, region or country. Not a famous one,',
    '  not an obvious one, not one you are certain about. If you name one we',
    '  cannot check it, and it would then be repeated to every group planning',
    `  a ${said} from now on.`,
    '- State no fact about a named place: no prices at a venue, no opening',
    '  hours, no awards, no "known for".',
    '- Write in plain lower case. Capitalise only the first word of a',
    '  sentence and the days of the week. Anything else capitalised reads as',
    '  a name and the answer will be rejected.',
    '- Where money appears, it is a rough band in US dollars per person, and',
    '  the text may say it is an estimate. Never quote a real price list.',
    '',
    'What is wanted instead of names:',
    `- the shape of the days — when a ${said} should be loose and when it`,
    '  needs something booked, and what the first and last day are for',
    '- the mistakes groups actually make, stated plainly enough to act on',
    '- where a group of this kind disagrees, and what the disagreement is',
    '  really about',
    '- how the money splits between staying, eating, doing and moving',
    '',
    'Spend most of your effort on the mistakes and on the shape of the days.',
    'Those two are what make a plan feel like a professional wrote it.',
    '',
    `Set the first field to exactly: ${kind}`,
    '',
    'Reply with JSON only. No preamble, no explanation, no markdown fences.',
  ].join('\n');
}

/** The note added when a first answer named things it should not have. */
export function nameCorrection(named: string[]): string {
  return [
    '',
    'Your previous answer was rejected. It contained these, which read as',
    `names of real things: ${named.slice(0, 12).join(', ')}.`,
    'Write it again with none of them, and with nothing capitalised except',
    'the first word of a sentence and the days of the week. Describe kinds',
    'of place ("a late-night place near where you are staying"), never one',
    'place.',
  ].join('\n');
}

// ─── The check, because a prompt rule is a request ──────────────────────
// Everything above asks. Asking works most of the time, and most of the time
// is not the standard when the answer is stored and reused: one invented
// restaurant in fifty rows is a restaurant recommended to every group taking
// that kind of trip, for six months, in Reach's own voice.

/**
 * Capitalised words that are not somebody's business.
 *
 * Days of the week only, plus the word "I". A rhythm genuinely needs them —
 * "land on Friday and keep the first night loose" is craft, not a claim —
 * and there is nothing to invent about a Tuesday.
 */
const NOT_A_NAME = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'i', 'us', 'usd',
]);

/** Every string anywhere inside a parsed answer, however deep. */
export function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsIn(v, out);
  return out;
}

/**
 * The single capitalised words in a sentence's middle.
 *
 * `properNames` finds runs of two or more, which is the right shape for
 * "El Charro Loco" and the wrong shape for "Airbnb" — a one-word brand is a
 * run of one and slips straight through it. A word capitalised mid-sentence
 * in prose that was told to stay lower case is a name or it is nothing, so
 * it is treated as a name.
 *
 * The first word of a sentence is skipped: it is capitalised because a
 * sentence started, which is the mistake that made the first version of the
 * venue checker reject every plan ever written.
 */
function loneCapitals(text: string): string[] {
  const found: string[] = [];
  // The same sentence split `properNames` uses, so the two agree about
  // where a sentence begins.
  for (const sentence of String(text || '').split(/(?<=[.!?;:])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) {
      const bare = words[i].replace(/^[("'“‘]+/, '').replace(/[.,;:!?)"'”’]+$/, '');
      // A capital followed by at least one lower-case letter. All-caps is a
      // unit or an acronym ("USD", "TSA"), which names no business.
      if (!/^[A-Z][a-z'’-]*[a-z][\w'’-]*$/.test(bare)) continue;
      if (NOT_A_NAME.has(bare.toLowerCase())) continue;
      found.push(bare);
    }
  }
  return found;
}

/**
 * Everything in an answer that reads like the name of a real thing.
 *
 * Deliberately eager, and the cost of being wrong is deliberately lopsided:
 * a false positive means one row is written again tomorrow, a false negative
 * means a made-up restaurant is quietly recommended for six months.
 */
export function namedThings(value: unknown): string[] {
  const found = new Set<string>();
  for (const text of stringsIn(value)) {
    for (const name of properNames(text)) found.add(name);
    for (const word of loneCapitals(text)) found.add(word);
  }
  return [...found];
}

// ─── Time, in the calendar somebody actually lives in ───────────────────

/** How long what is stored stays trusted. Craft ages slowly. */
export const TTL_DAYS = 180;

/** When an answer written now stops being trusted. */
export function expiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + TTL_DAYS * 86400_000).toISOString();
}

/**
 * The instant this local day began.
 *
 * The daily spend cap counts what was done "today", and `toISOString()` gives
 * the day in Greenwich — which in New York rolls over at eight in the
 * evening. Counting against a UTC day would hand back a fresh allowance
 * halfway through an evening and then refuse the first run of the morning.
 *
 * `now` is a parameter so the rule can be tested at an hour a test would
 * otherwise have to wait for.
 */
export function startOfLocalDay(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

/** A whole number from the environment, or the default when it is nonsense. */
export function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── Percentages and fractions are not the same number ──────────────────
// The first real run produced two playbooks with budget_allocation_hint as
// fractions — {stay: 0.35, food: 0.2, …} — and one with the same idea as
// whole percentages: {stay: 30, food: 20, …}. Both satisfy `z.number()`,
// and they differ by a factor of a hundred.
//
// Nothing downstream could tell them apart. A budget multiplied by the
// second is a hundred times the intended figure, and it would arrive on a
// screen looking like a number somebody had worked out.
//
// The model's meaning is not in doubt either way: thirty per cent of the
// budget goes on the stay. So the certain case is repaired rather than
// thrown away — losing a good playbook and a paid call over a unit slip
// helps nobody — and the uncertain case is refused, because a set of
// weights that sums to neither one nor a hundred is not a rounding slip,
// it is an answer we do not understand.

export interface Allocation {
  stay: number; food: number; activities: number; transport: number;
}

/** The four weights as fractions of one, or null when they make no sense. */
export function normaliseAllocation(hint: Partial<Allocation> | null | undefined): Allocation | null {
  if (!hint) return null;
  const keys: (keyof Allocation)[] = ['stay', 'food', 'activities', 'transport'];
  const values = keys.map(k => Number(hint[k]));
  if (values.some(v => !Number.isFinite(v) || v < 0)) return null;

  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  // Already fractions, allowing for a model that rounds to two places.
  if (total > 0.9 && total < 1.1) return scale(hint, keys, 1);
  // Whole percentages.
  if (total > 90 && total < 110) return scale(hint, keys, 100);
  // Neither. We do not know what was meant, so we do not guess.
  return null;
}

function scale(hint: Partial<Allocation>, keys: (keyof Allocation)[], by: number): Allocation {
  const out = {} as Allocation;
  for (const k of keys) out[k] = Number(hint[k]) / by;
  return out;
}
