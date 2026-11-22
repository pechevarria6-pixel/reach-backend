-- ─── Destination diversity (REACH-DESTINATION-DIVERSITY-2026-11-22.md, Task 1) ──
-- Written by Claude Code, run by the owner in the Supabase SQL editor after a
-- dry run (wrap in begin; … rollback; first). Names checked against the live
-- schema on 2026-11-22 — see STATUS.md, "Task 0 ground truth".
--
-- Corrections to the directive's draft:
--   · destination_profiles.region, lat, lng ALREADY EXIST (region holds a US
--     state code). They are not added again.
--   · popularity_score is constrained to 0..1 and may not be set without the
--     source it came from: a number nobody can trace is the kind of claim this
--     work exists to stop.
--   · Exposure is counted by a function that increments in one statement.
--     A read-then-upsert from the app is two requests racing (CLAUDE.md:
--     "read-then-write is not idempotent"), and two groups shown the same
--     place at once would count it once.
--   · users is public.users; crowd_tolerance is nullable — not answered is
--     not "fine".
--
-- Not in here, and the owner's call (data, not schema): Cancun, Nassau and
-- San Juan are each three rows because region is NULL and NULL defeats
-- UNIQUE (city, region, country). Dedupe them before seeding coordinates.

begin;

-- Candidate metadata the selector needs.
alter table public.destination_profiles
  add column if not exists popularity_score numeric,          -- 0 (obscure) .. 1 (headline); null = unknown
  add column if not exists popularity_source text,            -- where the figure came from
  add column if not exists crowd_by_month jsonb,              -- {"1":0.2,...,"12":0.9}; null if unknown
  add column if not exists evidence jsonb not null default '{}'::jsonb;

alter table public.destination_profiles
  drop constraint if exists destination_profiles_popularity_range,
  add constraint destination_profiles_popularity_range
    check (popularity_score is null or (popularity_score >= 0 and popularity_score <= 1)),
  drop constraint if exists destination_profiles_popularity_sourced,
  add constraint destination_profiles_popularity_sourced
    check (popularity_score is null or coalesce(btrim(popularity_source), '') <> ''),
  drop constraint if exists destination_profiles_crowd_shape,
  add constraint destination_profiles_crowd_shape
    check (crowd_by_month is null or jsonb_typeof(crowd_by_month) = 'object');

-- How often each destination has been offered, across all groups, per day.
create table if not exists public.destination_exposure (
  destination_id uuid not null references public.destination_profiles(id) on delete cascade,
  served_on date not null default current_date,
  served_count integer not null default 0 check (served_count >= 0),
  primary key (destination_id, served_on)
);

-- Server-only: the service role writes and reads it; nobody signed in does.
alter table public.destination_exposure enable row level security;
revoke all on public.destination_exposure from anon, authenticated;

-- One statement per offer set: insert or add, never read-then-write.
create or replace function public.bump_destination_exposure(ids uuid[], day date default current_date)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.destination_exposure (destination_id, served_on, served_count)
  select id, day, count(*) from unnest(ids) as id group by id
  on conflict (destination_id, served_on)
  do update set served_count = public.destination_exposure.served_count + excluded.served_count;
$$;
revoke execute on function public.bump_destination_exposure(uuid[], date) from public, anon, authenticated;
grant execute on function public.bump_destination_exposure(uuid[], date) to service_role;

-- One-tap onboarding answer. Null until they answer (or if they skip).
alter table public.users
  add column if not exists crowd_tolerance text;
alter table public.users
  drop constraint if exists users_crowd_tolerance_check,
  add constraint users_crowd_tolerance_check
    check (crowd_tolerance is null or crowd_tolerance in ('avoid', 'fine', 'love'));

commit;

-- Verify after running:
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='destination_profiles'
--      and column_name in ('popularity_score','popularity_source','crowd_by_month','evidence');   -- 4 rows
--   select to_regclass('public.destination_exposure');                                            -- not null
--   select public.bump_destination_exposure(array[]::uuid[]);                                     -- no error
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='users' and column_name='crowd_tolerance';         -- 1 row
