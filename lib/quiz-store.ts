// ─── Reading and writing the quiz, before and after its migration ────────
// sql/quiz-v3-2026-09-24.sql adds four columns to users. Until the owner runs
// it, naming any of them fails the whole statement — and the statements they
// sit in are the ones Discover and the quiz save are built on. So every read
// and write here tries with the new columns, and on 42703 / PGRST204 / 42P01
// does the v2 part alone and says so, rather than taking the feature down.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  scoreQuiz, answersFromV2, columnsFromAnswers,
  type QuizAnswers, type TravelerProfile, type V2Columns,
} from './traveler-profile.ts';
import { QuizAnswers as QuizAnswersSchema, TravelerProfile as TravelerProfileSchema } from './contracts/traveler-profile.ts';

type PgError = { code?: string; message?: string } | null | undefined;

/** The migration has not run: a column or table this names does not exist yet. */
export function quizColumnsMissing(e: PgError): boolean {
  if (!e) return false;
  return e.code === '42703' || e.code === 'PGRST204' || e.code === '42P01'
    || /quiz_version|quiz_answers|traveler_profile|quiz_skipped_at/.test(e.message || '');
}

const V2_SELECT = 'favorite_activities, activity_vibe, no_way_jose, dietary_needs, drink_style, dining_vibe, trip_summary';
const V3_SELECT = `${V2_SELECT}, quiz_version, quiz_answers, traveler_profile, quiz_skipped_at`;

export interface QuizRow {
  v2: V2Columns;
  answers: QuizAnswers;
  profile: TravelerProfile | null;
  version: number | null;
  skippedAt: string | null;
  /** False until the migration has run. */
  stored: boolean;
}

/** One person's quiz, whichever side of the migration the database is on. */
export async function readQuiz(db: SupabaseClient, userId: string): Promise<QuizRow | null> {
  const full = await db.from('users').select(V3_SELECT).eq('id', userId).maybeSingle();
  if (!full.error) {
    const row = (full.data ?? {}) as Record<string, unknown>;
    const answers = QuizAnswersSchema.safeParse(row.quiz_answers ?? {});
    const profile = TravelerProfileSchema.nullable().safeParse(row.traveler_profile ?? null);
    return {
      v2: row as V2Columns,
      answers: (answers.success ? answers.data : {}) as QuizAnswers,
      profile: (profile.success ? profile.data : null) as TravelerProfile | null,
      version: typeof row.quiz_version === 'number' ? row.quiz_version : null,
      skippedAt: typeof row.quiz_skipped_at === 'string' ? row.quiz_skipped_at : null,
      stored: true,
    };
  }
  if (!quizColumnsMissing(full.error)) {
    console.error('[quiz] could not read the quiz', { code: full.error.code });
    return null;
  }
  const v2 = await db.from('users').select(V2_SELECT).eq('id', userId).maybeSingle();
  if (v2.error) {
    console.error('[quiz] could not read the v2 answers', { code: v2.error.code });
    return null;
  }
  return { v2: (v2.data ?? {}) as V2Columns, answers: {}, profile: null, version: null, skippedAt: null, stored: false };
}

/** Just the profile, for Discover. Null when there is none or no column yet. */
export async function readProfile(db: SupabaseClient, userId: string): Promise<TravelerProfile | null> {
  const { data, error } = await db.from('users').select('traveler_profile').eq('id', userId).maybeSingle();
  if (error) {
    if (!quizColumnsMissing(error)) console.error('[quiz] could not read the profile', { code: error.code });
    return null;
  }
  const parsed = TravelerProfileSchema.nullable().safeParse((data as { traveler_profile?: unknown } | null)?.traveler_profile ?? null);
  return parsed.success ? (parsed.data as TravelerProfile | null) : null;
}

export interface SaveRequest {
  answers: QuizAnswers;
  finish?: boolean;
  skip?: boolean;
  dismiss?: string;
}

export interface SaveResult {
  ok: boolean;
  profile: TravelerProfile;
  stored: boolean;
  /** Set when the write failed for a reason other than the migration. */
  error?: string;
}

/**
 * Merge what was just answered onto what was already known, recompute the
 * profile here — never from anything the browser computed — and write both
 * the v3 columns and the v2 columns the rest of the app already reads.
 */
export async function saveQuiz(db: SupabaseClient, userId: string, req: SaveRequest, now: Date = new Date()): Promise<SaveResult> {
  const current = await readQuiz(db, userId);
  if (!current) return { ok: false, profile: scoreQuiz({}, now), stored: false, error: 'read' };

  // Whatever v3 already holds, then the v2 columns, then this request. The
  // v2 columns win over v3's copy of the same fact because Profile's full
  // list still writes them directly — a hard no removed there must not come
  // back from a stale quiz_answers. The one exception is a multi answer the
  // single v2 column cannot hold: [Wine, Beer] is kept while the column
  // still says what it implies.
  const fromV2 = answersFromV2(current.v2);
  const stillSays = (k: 'drinks' | 'seating') => {
    const mine = current.answers[k];
    if (!Array.isArray(mine) || !mine.length) return false;
    const implied = columnsFromAnswers({ [k]: mine }, null);
    return k === 'drinks' ? implied.drink_style === current.v2.drink_style : implied.dining_vibe === current.v2.dining_vibe;
  };
  // An empty column is an answer too — "no hard nos" — and has to be able to
  // clear v3's copy, which answersFromV2 alone would leave standing.
  fromV2.interests = fromV2.interests ?? [];
  fromV2.dislikes = fromV2.dislikes ?? [];
  fromV2.dietary = fromV2.dietary ?? [];
  if (stillSays('drinks')) delete fromV2.drinks;
  if (stillSays('seating')) delete fromV2.seating;
  const merged: QuizAnswers = { ...current.answers, ...fromV2, ...req.answers };
  if (req.answers.dial_overrides) {
    merged.dial_overrides = { ...(current.answers.dial_overrides ?? {}), ...req.answers.dial_overrides };
  }
  if (req.dismiss) {
    merged.drip_dismissed = { ...(current.answers.drip_dismissed ?? {}), [req.dismiss]: now.toISOString() };
  }
  if (req.finish) merged.completed_at = now.toISOString();

  // Only what this request spoke to: a drip answer about drinks must not
  // rewrite somebody's hard nos from a stale copy.
  const v2 = columnsFromAnswers(req.answers, current.v2);
  // The interests that are kept are the interests that count. The screen
  // shows twelve tiles; the six it does not show are still theirs.
  if (v2.favorite_activities) merged.interests = v2.favorite_activities;
  const profile = scoreQuiz(merged, now);

  const v3: Record<string, unknown> = { quiz_answers: merged, traveler_profile: profile };
  if (req.finish) v3.quiz_version = 3;
  if (req.skip) v3.quiz_skipped_at = now.toISOString();

  if (current.stored) {
    const { error } = await db.from('users').update({ ...v2, ...v3 }).eq('id', userId);
    if (!error) return { ok: true, profile, stored: true };
    if (!quizColumnsMissing(error)) {
      console.error('[quiz] save failed', { code: error.code, message: error.message });
      return { ok: false, profile, stored: false, error: 'write' };
    }
  }

  // Before the migration: the v2 columns alone. Interests, restrictions and
  // nos still reach Discover and generation; the profile is returned for the
  // reveal and not kept.
  if (Object.keys(v2).length) {
    const { error } = await db.from('users').update(v2).eq('id', userId);
    if (error) {
      console.error('[quiz] v2 save failed', { code: error.code, message: error.message });
      return { ok: false, profile, stored: false, error: 'write' };
    }
  }
  return { ok: true, profile, stored: false };
}
