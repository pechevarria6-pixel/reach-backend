-- ─── Telling somebody something, in the app and on their phone ───────────
-- Run me. Written 2026-09-23. Safe to run twice.
--
-- Until now the only way Reach could reach anybody was email. A nudge —
-- "Peter's waiting on you to say what you want from Rincón" — belongs where
-- they already are: a bell in the app, and a notification on their phone if
-- they have let Reach send one.
--
-- notifications       what each person has been told, and whether they've seen it
-- push_subscriptions  where to send a phone notification, per device

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  plan_id     uuid references public.plans(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  url         text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user_recent
  on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- The app reads and writes both through its own server with the service
-- role; no policy is granted to the anon or authenticated roles on purpose.
