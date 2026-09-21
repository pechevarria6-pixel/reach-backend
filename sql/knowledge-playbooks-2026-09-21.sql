-- ─── What a kind of trip is actually like, written down once ────────────
-- A generator that knows a place still does not know the shape of the
-- occasion. A ski week and a fortieth birthday in the same town are not the
-- same trip: they wake at different hours, they disagree about different
-- things, and the money goes to different places. That knowledge is the
-- same every time, so it is worth writing down once rather than hoping for
-- it on every generation.
--
-- One row per kind of trip. The row is filled in by a background job on a
-- schedule; nothing a person does waits on it, and a row that has never been
-- filled in simply says nothing.
--
-- What goes in the jsonb is craft, never facts: how a trip is paced, what
-- groups fall out over, where the money goes. Never a named restaurant,
-- hotel, bar or event — this app has shipped an invented restaurant before,
-- and a row here would put the same invention into every trip of that kind
-- rather than one. The job that writes these reads them back and refuses a
-- row that names a business.
--
-- Run in the Supabase SQL editor. Safe to re-run: every statement is
-- IF NOT EXISTS or ON CONFLICT DO NOTHING, so a second run changes nothing
-- and no already-filled row is reset to empty.
--
-- NOTE, checked against the live schema on 21 September 2026: this table
-- ALREADY EXISTS in production, with columns
--   id, archetype, playbook, playbook_version, status, error,
--   refreshed_at, expires_at, created_at, updated_at
-- and no locked_at. Somebody has run an earlier version of this migration
-- (destination_profiles is there too). So the CREATE below is a no-op there
-- and the ALTERs after it are the part that matters: the job needs
-- locked_at and production does not have it yet. The file still creates the
-- whole table for a database that has never seen it, and the two agree.

create table if not exists public.trip_playbooks (
  id uuid primary key default gen_random_uuid(),

  -- The kind of trip, in the code's own words — 'ski_trip', 'reunion'. One
  -- row each, which is what makes the seed below and the job that fills it
  -- both re-runnable.
  archetype text not null unique,

  -- Null until the job has filled it in, and that is a working state rather
  -- than a fault: generation reads what is ready and skips what is not.
  -- Never written unvalidated — the job parses and checks the shape first.
  playbook jsonb,

  -- queued    nobody has written this one yet
  -- enriching a run has claimed it (see locked_at)
  -- ready     playbook is present and was checked
  -- failed    a run got an answer it would not store, and `error` says why
  status text not null default 'queued'
    check (status in ('queued', 'enriching', 'ready', 'failed')),

  -- Why the last attempt was not stored — the tail of what came back, or the
  -- names it tried to use. Read by a person deciding whether to change the
  -- prompt or just run it again.
  error text,

  -- When a call was last spent on this row, whether it worked or not. The
  -- daily spend cap counts these, so a row that fails expensively still
  -- counts against the day.
  refreshed_at timestamptz,

  -- When what is stored stops being trusted. The job picks up ready rows
  -- past this date alongside the queued ones.
  expires_at timestamptz,

  -- When a run claimed this row. A crashed run leaves a row marked
  -- 'enriching' forever otherwise, and eleven rows is few enough that one
  -- stranded row is a kind of trip that never gets written at all. A claim
  -- older than the job's own stale window is taken back.
  locked_at timestamptz,

  -- Neither of these is read by any code here. They are in the table that
  -- production already has, and a fresh database that differs from
  -- production is a bug waiting for whoever sets the next one up.
  playbook_version integer not null default 1,
  updated_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);

-- ── The columns production is missing ───────────────────────────────────
-- The CREATE above does nothing where the table already exists, so anything
-- added since has to be stated again as an ALTER. locked_at is the one the
-- job actually needs: without it the query that picks up work fails
-- outright, and every run returns 500 having done nothing.
alter table public.trip_playbooks add column if not exists locked_at timestamptz;
alter table public.trip_playbooks add column if not exists error text;
alter table public.trip_playbooks add column if not exists refreshed_at timestamptz;
alter table public.trip_playbooks add column if not exists expires_at timestamptz;

-- One row per kind of trip. The job assumes it, and the seed below relies on
-- it to be re-runnable.
create unique index if not exists trip_playbooks_archetype_key
  on public.trip_playbooks (archetype);

-- The job's own query: what is due, oldest first.
create index if not exists trip_playbooks_due_idx
  on public.trip_playbooks (status, expires_at);
create index if not exists trip_playbooks_refreshed_idx
  on public.trip_playbooks (refreshed_at);

-- ─── The kinds of trip Reach actually gets asked for ────────────────────
-- Eleven, covering both halves of the app: the week away and the night out.
-- 'city_break' is the default when nothing else matches and 'solo_reset' is
-- what solo mode maps to, so neither may be removed without changing the
-- code that falls back to them.
--
-- ON CONFLICT DO NOTHING, not an upsert: re-running this must not wipe a row
-- the job has already filled in and set it back to empty. No conflict target
-- named, so it holds whatever the unique rule on this table turns out to be
-- called — production's was created by an earlier hand.
--
-- And only into a table nobody has seeded yet. Production's table was
-- created before this file existed and may already hold eleven rows spelled
-- differently — 'bachelor' rather than 'bachelor_party'. Adding these on top
-- of those would make twenty-two kinds of trip, half of them duplicates
-- under another name, each costing its own call. So: before running this,
--
--   select archetype, status from public.trip_playbooks order by 1;
--
-- If that returns nothing, this seeds it. If it returns eleven rows, leave
-- them as they are and change the list in lib/ that maps a trip to one of
-- them to match what is there.
insert into public.trip_playbooks (archetype, status)
select v.archetype, 'queued'
from (values
  ('bachelor_party'),
  ('bachelorette_party'),
  ('birthday_milestone'),
  ('ski_trip'),
  ('beach_trip'),
  ('city_break'),
  ('road_trip'),
  ('outdoors_adventure'),
  ('reunion'),
  ('concert_trip'),
  ('solo_reset')
) as v(archetype)
where not exists (select 1 from public.trip_playbooks)
on conflict do nothing;

comment on table public.trip_playbooks is
  'How a kind of trip works — pacing, disagreements, budget shape. Craft only: never names a business, venue or event.';

-- Expected after running:
--   select count(*) from public.trip_playbooks;                  -- 11
--   select archetype, status from public.trip_playbooks order by 1;
--
-- Two things worth checking by hand on the table production already has:
--
--   · that `status` accepts 'enriching' and 'failed'. The job writes both.
--     If an earlier hand put a CHECK on that column with a shorter list,
--     every run fails on the first write and says so in the logs.
--
--       select conname, pg_get_constraintdef(oid) from pg_constraint
--        where conrelid = 'public.trip_playbooks'::regclass;
--
--   · how to put a failed row back in the queue once the reason it failed
--     has been dealt with. The job never retries a content failure on its
--     own, deliberately — a prompt that produces rubbish should not be run
--     thirty times a day. `error` says what happened.
--
--       update public.trip_playbooks
--          set status = 'queued', error = null
--        where status = 'failed';
