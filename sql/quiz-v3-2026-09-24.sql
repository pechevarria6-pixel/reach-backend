-- ─── Onboarding quiz v3: what somebody said, and what it adds up to ─────
-- Spec: REACH-QUIZ-V3-2026-09-24.md, section 6.
--
-- The preferences live on `users` — there is no separate preferences table.
-- Checked against the live schema on 2026-09-24 with read-only PostgREST
-- GETs: users has favorite_activities, no_way_jose, dietary_needs,
-- drink_style, dining_vibe, trip_summary and none of the four columns below
-- (each answered 42703). groups.taste_profile already exists (jsonb) and is
-- not touched here.
--
-- The code works before this runs: every read and write of these columns
-- falls back on 42703 / PGRST204 / 42P01 to the v2 columns alone (see
-- lib/quiz-store.ts). Until it runs, a finished quiz still saves interests,
-- restrictions and hard nos, and the reveal is shown from the profile the
-- server computed — it just is not kept, so Discover cannot rank by it.
--
-- Run in the Supabase SQL editor. Safe to re-run.

alter table public.users add column if not exists quiz_version int default 2;
-- Raw answers per screen id, drip answers and drip dismissals included.
-- PRIVATE: holds dietary restrictions, dislikes and free text. Nothing that a
-- group member can read ever selects this column.
alter table public.users add column if not exists quiz_answers jsonb;
-- scoreQuiz(quiz_answers), recomputed by the server on every save. Never
-- written from a client value. Holds scores and dials only — nothing private.
alter table public.users add column if not exists traveler_profile jsonb;
-- The 60-day rule: skipping the quiz (or the v2 upgrade card) is not asked
-- again before this plus 60 days.
alter table public.users add column if not exists quiz_skipped_at timestamptz;

-- `default 2` stamps every existing row as a v2 account, which is what they
-- are. A v2 account with no v2 answers is simply somebody who never did the
-- quiz; the app tells the two apart by the answers, not by this number.

-- PostgREST caches the schema; without this the new columns answer PGRST204
-- until the cache next reloads.
notify pgrst, 'reload schema';
