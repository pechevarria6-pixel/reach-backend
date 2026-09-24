// ─── The traveller profile, defined once ─────────────────────────────────
// The quiz's answers and the profile computed from them travel four layers:
//
//   the answers the browser sends         components/reach-app.jsx
//   the row the save route writes         app/api/me/quiz
//   what /api/me hands back               app/api/me
//   what the app reads off `user`         quizFromMe, below
//
// The 21 September bugs were all one shape: a fact written correctly and
// dropped by a hand-written field list one layer short of the screen. So the
// shape lives here, every layer parses through it, and a field added here
// arrives everywhere — traveler_profile cannot be saved and then silently
// vanish on reload.
import { z } from 'zod';
import {
  ARCHETYPES, DIALS, FIRST_MOVE, PLAN, RESTAURANT, LATE, NIGHT_OUT, FREE_AFTERNOON,
  type QuizAnswers as QuizAnswersType, type TravelerProfile as TravelerProfileType,
} from '../traveler-profile.ts';

const keysOf = <T extends object>(o: T) => Object.keys(o) as [string, ...string[]];
const Archetype = z.enum(ARCHETYPES as unknown as [string, ...string[]]);
const Dial = z.enum(DIALS as unknown as [string, ...string[]]);
const shortList = z.array(z.string().trim().min(1).max(80)).max(40);
const dialValue = z.number().finite().min(0).max(100);

/**
 * What the browser may send. Every enum is closed: an answer the scorer does
 * not know is refused at the door rather than scored as nothing.
 */
export const QuizAnswers = z.object({
  first_move: z.enum(keysOf(FIRST_MOVE)).nullish(),
  interests: shortList.nullish(),
  plan: z.enum(keysOf(PLAN)).nullish(),
  restaurant: z.enum(keysOf(RESTAURANT)).nullish(),
  late: z.enum(keysOf(LATE)).nullish(),
  dietary: shortList.nullish(),
  dislikes: shortList.nullish(),
  no_way_text: z.string().max(200).nullish(),
  eat_everything: z.boolean().nullish(),
  drinks: shortList.nullish(),
  seating: shortList.nullish(),
  night_out: z.enum(keysOf(NIGHT_OUT)).nullish(),
  camera_roll: Archetype.nullish(),
  free_afternoon: z.enum(keysOf(FREE_AFTERNOON)).nullish(),
  free_interests: z.string().max(300).nullish(),
  dial_overrides: z.record(Dial, dialValue).nullish(),
  skipped: z.array(z.string().max(40)).max(20).nullish(),
  drip_dismissed: z.record(z.string().max(40), z.string().max(40)).nullish(),
  completed_at: z.string().max(40).nullish(),
}).strip();

/** The profile as stored in users.traveler_profile. */
export const TravelerProfile = z.object({
  primary: Archetype.nullable(),
  secondary: Archetype.nullable(),
  scores: z.record(Archetype, z.number()),
  dials: z.record(Dial, dialValue),
  unanswered: z.array(Dial),
  version: z.literal(3),
  computed_at: z.string(),
});

/** What the save route accepts. */
export const QuizSave = z.object({
  answers: QuizAnswers.default({}),
  /** The six upfront screens (or the v2 upgrade card) were worked through. */
  finish: z.boolean().nullish(),
  /** Skipped the whole thing: starts the 60-day clock. */
  skip: z.boolean().nullish(),
  /** A drip question dismissed with ✕: starts its own 60-day clock. */
  dismiss: z.string().max(40).nullish(),
});

export interface QuizSaveInput {
  answers: QuizAnswersType;
  finish?: boolean;
  skip?: boolean;
  dismiss?: string;
}

/**
 * A save request, parsed. The enums above are built from the scorer's own
 * tables, so anything that passes is an answer scoreQuiz knows.
 */
export function parseQuizSave(v: unknown): { ok: true; data: QuizSaveInput } | { ok: false; fields: string[] } {
  const r = QuizSave.safeParse(v ?? {});
  if (!r.success) return { ok: false, fields: r.error.issues.map(i => i.path.join('.')) };
  return { ok: true, data: r.data as QuizSaveInput };
}

/** The quiz columns on users, as the migration adds them. */
export const QUIZ_COLUMNS = ['quiz_version', 'quiz_answers', 'traveler_profile', 'quiz_skipped_at'] as const;

/** Everything about the quiz that /api/me returns for the person themselves. */
export interface MeQuiz {
  /** 3 once v3 has been worked through; 2 for a v2 account; null before the migration. */
  version: number | null;
  profile: TravelerProfileType | null;
  /** Their own answers. Only ever returned to them. */
  answers: QuizAnswersType;
  skippedAt: string | null;
  /** Whether the database can hold any of this yet (the migration has run). */
  stored: boolean;
}

const parsedOr = <T>(schema: z.ZodType<T>, v: unknown, fallback: T): T => {
  const r = schema.safeParse(v);
  return r.success ? r.data : fallback;
};

/** A users row, as select('*') reads it, into the shape /api/me returns. */
export function quizFromRow(row: Record<string, unknown> | null | undefined): MeQuiz {
  const stored = !!row && 'traveler_profile' in row;
  return {
    version: typeof row?.quiz_version === 'number' ? row.quiz_version : null,
    profile: parsedOr(TravelerProfile.nullable(), row?.traveler_profile ?? null, null) as TravelerProfileType | null,
    answers: parsedOr(QuizAnswers, row?.quiz_answers ?? {}, {}) as QuizAnswersType,
    skippedAt: typeof row?.quiz_skipped_at === 'string' ? row.quiz_skipped_at : null,
    stored,
  };
}

/**
 * The same, read back off /api/me in the browser. Parsed rather than
 * trusted, so a field renamed on one side is a visible null rather than a
 * profile that quietly never arrives.
 */
export function quizFromMe(me: { quiz?: unknown } | null | undefined): MeQuiz {
  const q = (me?.quiz && typeof me.quiz === 'object' ? me.quiz : {}) as Record<string, unknown>;
  return {
    version: typeof q.version === 'number' ? q.version : null,
    profile: parsedOr(TravelerProfile.nullable(), q.profile ?? null, null) as TravelerProfileType | null,
    answers: parsedOr(QuizAnswers, q.answers ?? {}, {}) as QuizAnswersType,
    skippedAt: typeof q.skippedAt === 'string' ? q.skippedAt : null,
    stored: q.stored === true,
  };
}

/** Sixty days, per the traveller-profile rule of 17 September. */
export const QUIET_DAYS = 60;

export function withinQuietPeriod(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now.getTime() - t < QUIET_DAYS * 86400000;
}
