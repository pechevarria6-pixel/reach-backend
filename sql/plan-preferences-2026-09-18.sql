-- ─── Preferences a member gives for one trip ────────────────────────────
-- Adapted from sql/2026-09-18-feedback.sql in the field-feedback package.
-- One change, and the package flagged it as the thing to check: user_id is
-- UUID here, not the Clerk text id. Verified against the live schema before
-- writing this — group_members.user_id and bookings.booked_by are both uuid
-- referencing users(id), and the app resolves a Clerk session to that row in
-- lib/auth.ts. A text column would have joined to nothing.
--
-- Run in the Supabase SQL editor. "Success. No rows returned" is expected.
-- Safe to re-run. Nothing existing changes.

create table if not exists public.plan_preferences (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  -- Whose answers these are. Cascades with the person, because preferences
  -- are theirs and should not outlive their account.
  user_id uuid not null references public.users(id) on delete cascade,
  -- The quiz answers as given for this trip. Optional in v1: the app still
  -- reads the standing answers on users, and this is where a trip-specific
  -- one will go.
  answers jsonb,
  -- "What's this trip about? Anything you're hoping happens?" — feeds both
  -- generation and free-text interest matching.
  summary_text text,
  -- Null means they have not had their say yet. This is the readiness gate:
  -- votes open when nobody is left to hear from.
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per person per trip, so a second submission edits the first.
  unique (plan_id, user_id)
);

create index if not exists plan_preferences_plan on public.plan_preferences (plan_id);

-- A trip somebody is taking alone has nobody to wait for: no readiness gate,
-- no voting, no chips.
alter table public.plans add column if not exists solo_mode boolean not null default false;

-- ── Deliberately no RLS policies ────────────────────────────────────────
-- Consistent with every other table here: the anon key never reaches this
-- data, and authorization is done in lib/auth.ts on the service-role client.
-- Adding a policy without a matching route change would be a half-measure
-- that reads as protection.
--
-- ── What this does NOT do ───────────────────────────────────────────────
-- It does not copy anybody's standing quiz answers into this table, and it
-- does not make one member's answers readable by another. Readiness is a
-- yes or no; the answers stay with the person who gave them.
