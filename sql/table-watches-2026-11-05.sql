-- ─── Watches: a table Reach keeps checking for, until one opens ─────────
-- Run me. Written 2026-11-05. Safe to run twice.
--
-- "Watch for a table" (lib/watch/tables.ts): somebody picks a restaurant on
-- their plan (or a Discover card), the nights and times they would sit down
-- and the party, and a scheduled check (.github/workflows/watches.yml →
-- /api/cron/watches) asks the platform Reach has a deal with for openings.
-- When one fits, Reach takes the platform's five-minute hold on the booking
-- row through the one booking path and tells them; their tap books it.
--
-- One table for every kind of watch, so a flight price or a hotel rate can
-- use the same scheduler later: `kind` says which, `spec` holds its facts.
-- Only 'table' is allowed until the code for another kind exists.
--
-- Until this runs, every watch route answers "not switched on yet" and the
-- screens offer the platforms' own alerts instead. Nothing breaks.

create table if not exists public.watches (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('table')),
  user_id         uuid not null references public.users(id) on delete cascade,
  -- The plan, booking row and line a table watch is on. Null for a watch
  -- from a Discover card, which can only tell, never hold.
  plan_id         uuid references public.plans(id) on delete cascade,
  booking_id      uuid references public.bookings(id) on delete cascade,
  item_id         uuid,
  -- What is watched: for a table, the discovery_venues row the line cites.
  -- Never a name.
  target_ref      text not null check (length(target_ref) between 1 and 200),
  -- 'platform': Reach asks the platform. The only way: a restaurant that
  -- books by phone has nothing for Reach to check, so it is never watched.
  method          text not null check (method in ('platform')),
  platform        text,
  -- table: { restaurant, nights: [YYYY-MM-DD], from: 'HH:MM', to: 'HH:MM', party, lng, lapses, notBookedElsewhere? }
  spec            jsonb not null default '{}'::jsonb,
  status          text not null default 'active'
                  check (status in ('active', 'held', 'booked', 'stopped', 'expired', 'ended')),
  expires_at      timestamptz not null,
  next_check_at   timestamptz not null default now(),
  last_checked_at timestamptz,
  -- Counts and codes only: never a person's details.
  last_result     jsonb,
  -- Slots already held or told ('2026-11-07T20:30'), never held or told twice.
  seen            jsonb not null default '[]'::jsonb,
  -- What is held right now, while status = 'held'.
  hold            jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One live watch per person per restaurant (it covers up to seven nights),
-- and one per booking row whoever set it: two watches on one table would
-- hold it twice. A double-tap is two concurrent inserts; these are what make
-- the second one fail.
create unique index if not exists watches_one_per_target
  on public.watches (user_id, kind, target_ref) where status in ('active', 'held');
create unique index if not exists watches_one_per_booking
  on public.watches (booking_id) where status in ('active', 'held') and booking_id is not null;

-- The scheduled check reads what is due, soonest first.
create index if not exists watches_due
  on public.watches (next_check_at) where status in ('active', 'held');
-- A person's own list.
create index if not exists watches_mine
  on public.watches (user_id, created_at desc);

alter table public.watches enable row level security;

-- Each scheduled run, counts only. The screens offer "Reach watches" only
-- when a run has happened in the last two hours: a watch nothing checks is
-- a promise nobody keeps.
create table if not exists public.watch_runs (
  id      uuid primary key default gen_random_uuid(),
  ran_at  timestamptz not null default now(),
  report  jsonb not null default '{}'::jsonb
);
create index if not exists watch_runs_recent on public.watch_runs (ran_at desc);
alter table public.watch_runs enable row level security;

comment on table public.watches is
  'Things Reach checks on a schedule for somebody (lib/watch). kind=table: a restaurant, nights, times and party; a matching slot is held through the one booking path and the person taps to book it.';
comment on table public.watch_runs is
  'One row per scheduled watch run (/api/cron/watches), counts only. Read to tell whether the schedule is running before a screen says Reach is watching.';

-- Both tables are read and written only by the app's own server with the
-- service role; no policy is granted to the anon or authenticated roles on
-- purpose (the same as notifications-2026-09-23.sql).
