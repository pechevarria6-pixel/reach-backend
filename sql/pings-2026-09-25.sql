-- ─── Countdown pings: sent once, and never to somebody who said stop ─────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- The pings job (T-7 packing list, T-1 "check in for your flight", the
-- day-of flight, "Tonight: dinner at X") runs from a schedule, and a
-- schedule runs twice sooner or later: a retried GitHub Actions job, a
-- manual re-run, two runs overlapping when one is slow. Each run reads "has
-- this gone out?" before the other has written that it has, which is the
-- read-then-write race CLAUDE.md describes. So the job claims a ping by
-- inserting its row first and sends only if the insert succeeded; the
-- unique index below is what makes the second run's insert fail.
--
-- ping_log                  one row per ping claimed: which plan, which
--                           person, which kind, for which local day
-- plan_notification_mutes   "stop pinging me about this trip", per person
--
-- Probed 2026-09-25: neither table exists (PGRST205).

create table if not exists public.ping_log (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  -- 'packing', 'flight_checkin', 'flight_day', 'tonight', 'settle_up', …
  -- Named by lib/pings.ts; kept to a plain slug here rather than a fixed
  -- list, so a new kind of ping is a code change and not a migration.
  kind        text not null check (kind ~ '^[a-z][a-z0-9_]{1,47}$'),
  -- The day the ping is FOR, in the trip's local time — never the UTC date.
  -- At 8pm in New York the UTC day has already rolled over, and a T-1 ping
  -- keyed on it would fire a day early (lib/calendar.ts today()/dayWhere()).
  local_day   date not null,
  -- Filled in after the send: who it actually reached. A claimed row with
  -- sent_at null is a ping that was claimed and then failed to go — the log
  -- says why, and it is not retried the same day, which is the safe way
  -- round (a missed ping beats a doubled one).
  channels    text[],
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- One ping of each kind, per person, per plan, per local day. The claim.
create unique index if not exists ping_log_once
  on public.ping_log (plan_id, user_id, kind, local_day);

-- The settle-up reminder is at most once every three days; the job reads
-- the last one of that kind for a person.
create index if not exists ping_log_recent
  on public.ping_log (user_id, kind, created_at desc);

alter table public.ping_log enable row level security;

create table if not exists public.plan_notification_mutes (
  plan_id     uuid not null references public.plans(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- One per person per plan: muting twice is still muted, and a double-tap
  -- is two concurrent inserts.
  primary key (plan_id, user_id)
);

alter table public.plan_notification_mutes enable row level security;

comment on table public.ping_log is
  'Countdown and reminder pings claimed per (plan, user, kind, local_day). Insert first, send second: the unique index is what stops a second cron run sending again.';
comment on table public.plan_notification_mutes is
  'A person who turned off pings for one plan. Checked by lib/notify-user.ts before anything is sent about that plan. Deleting the row turns them back on.';

-- Both tables are read and written only by the app's own server with the
-- service role; no policy is granted to the anon or authenticated roles on
-- purpose (the same as notifications-2026-09-23.sql).
