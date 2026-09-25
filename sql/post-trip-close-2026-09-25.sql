-- ─── "How was it?" ───────────────────────────────────────────────────────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- The day after a trip ends (the trip's local date, from tripTiming() in
-- lib/calendar.ts — not a job flipping plans.status to 'completed'; owner
-- decision 18), each person who went is asked one question with three
-- answers: 😞 😐 🤩. This keeps the answer.
--
-- Deliberately not here:
--   * A best-photo column or storage bucket. Owner decision 19 defers it: a
--     photo is personal data that account deletion must purge, and nothing
--     in the app uploads to storage yet.
--   * A 'completed' flip. The date is the fact we hold; a stored status next
--     to it is a second source that can disagree with it.
--   * Any change to v_organizer_conversion. It counts the first
--     'plan_created' event after 'invite_signup' per person, so a trip
--     started from the close card is counted once — as the plan_created it
--     also is. next_trip_started_from_close marks where it came from and
--     is not added to that count.
--
-- Probed 2026-09-25: trip_reviews does not exist (PGRST205).

create table if not exists public.trip_reviews (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  -- 1 = 😞, 2 = 😐, 3 = 🤩. A three-point answer, stored as one, rather
  -- than dressed up as a ten-point NPS it was never asked as.
  score       smallint not null check (score between 1 and 3),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One answer per person per trip; tapping again changes it. A double tap
  -- is two concurrent requests, so this is an index, not a check in a route.
  unique (plan_id, user_id)
);

create index if not exists trip_reviews_by_user on public.trip_reviews (user_id);

alter table public.trip_reviews enable row level security;

comment on table public.trip_reviews is
  'One 3-point answer per person per trip to "How was it?" (1 😞, 2 😐, 3 🤩). Asked only after the trip''s local end date, and only on a trip that had a confirmed booking row.';

-- Read and written only through the app's own server with the service role;
-- no policy for anon or authenticated, on purpose.
