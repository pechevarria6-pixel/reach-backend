-- ─── The organiser's post-trip debrief ──────────────────────────────────
-- Written 2026-11-08 by the Verify track (REACH-PILOT-GATE-2026-11-08.md A7,
-- business-model §4G M2). NOT RUN — the coordinator runs it, in the A2 order,
-- after sql/pilot-gate-2026-11-08.sql. Safe to run twice.
--
-- Why a table and not only the event. POST /api/plans/[planId]/debrief writes
-- a `debrief_submitted` event with the numbers (hours, messages, nps,
-- would_run_again, solo). The free-text answer to "What almost made you
-- quit?" cannot go there: lib/track.ts scrubProps drops prose from props by
-- design, because `events` is read by people building charts and must never
-- hold anything somebody typed. So the answer is kept here, server-only,
-- with the numbers beside it so one row is the whole debrief.
--
-- Until this runs the route still records the numbers as an event and says
-- the note was not kept ({ noteSaved: false }); nothing fails.
--
-- `hours` and `messages` hold the representative value of the range tapped
-- (components/pilot/rules.ts HOURS_CHOICES / MESSAGE_CHOICES), never a free
-- number — docs/pilot/READOUTS.md is written against those exact values.

create table if not exists public.pilot_debriefs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  -- set null, never cascade: deleting a trip must not delete the evidence
  -- of what it cost the person who organised it.
  plan_id          uuid references public.plans(id) on delete set null,
  group_id         uuid references public.groups(id) on delete set null,
  -- cascade on the person: account deletion removes what they typed.
  user_id          uuid not null references public.users(id) on delete cascade,
  hours            numeric(5,1) not null check (hours in (0.5, 2, 4.5, 8, 15, 25)),
  messages         integer check (messages is null or messages in (5, 20, 45, 80, 130)),
  nps              smallint not null check (nps between 0 and 10),
  would_run_again  boolean not null,
  almost_quit      text check (almost_quit is null or char_length(almost_quit) <= 280),
  solo             boolean not null default false
);

-- Once per person per trip. A double tap is two concurrent requests, so this
-- is an index, not a check in the route (the route checks too, and answers
-- 409 on 23505). Rows whose plan was deleted (plan_id null) do not collide.
create unique index if not exists pilot_debriefs_one_per_person
  on public.pilot_debriefs (plan_id, user_id);

create index if not exists pilot_debriefs_by_time on public.pilot_debriefs (created_at desc);

alter table public.pilot_debriefs enable row level security;
-- No policies: written and read only by the server with the service role.
-- Nothing in a browser may read another person's note.

comment on table public.pilot_debriefs is
  'One post-trip debrief per organiser per plan (pilot gate A7). almost_quit is free text: server-only, never copied into events.';

-- Verification (run after; each must return a row):
--   select 1 from information_schema.tables where table_name = 'pilot_debriefs';
--   select 1 from pg_indexes where indexname = 'pilot_debriefs_one_per_person';
