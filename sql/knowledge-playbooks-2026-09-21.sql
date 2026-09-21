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
  -- stranded row is a feature that never finishes. A claim older than the
  -- job's own stale window is taken back.
  locked_at timestamptz,

  created_at timestamptz not null default now()
);

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
-- the job has already filled in and set it back to empty.
insert into public.trip_playbooks (archetype, status) values
  ('bachelor_party',      'queued'),
  ('bachelorette_party',  'queued'),
  ('birthday_milestone',  'queued'),
  ('ski_trip',            'queued'),
  ('beach_trip',          'queued'),
  ('city_break',          'queued'),
  ('road_trip',           'queued'),
  ('outdoors_adventure',  'queued'),
  ('reunion',             'queued'),
  ('concert_trip',        'queued'),
  ('solo_reset',          'queued')
on conflict (archetype) do nothing;

comment on table public.trip_playbooks is
  'How a kind of trip works — pacing, disagreements, budget shape. Craft only: never names a business, venue or event.';

-- Expected after running:
--   select count(*) from public.trip_playbooks;                  -- 11
--   select archetype, status from public.trip_playbooks order by 1;
