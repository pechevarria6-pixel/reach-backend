-- ─── "Already done it" and "Not for me" ─────────────────────────────────
-- Discover kept offering places people had already been to, and there was no
-- way to say so. The only options were to ignore a card forever or to stop
-- opening the screen.
--
-- Two different sentences, deliberately stored as two different verdicts:
--
--   'done'            they went. A positive signal about what they like, and
--                     not a refusal — a restaurant can come round again, the
--                     Museum of Natural History cannot.
--   'not_interested'  a refusal. It never comes back.
--
-- Collapsing those into one "hide" would lose the difference between a place
-- somebody loved and a place they would not go to at gunpoint.

create table if not exists public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- Set when the verdict was given while planning a particular trip, so a
  -- group screen can tell "Sam has been here" from "Sam does not want to go".
  group_id uuid references public.groups(id) on delete set null,
  -- "osm:12345", "ticketmaster:G5v0Z9". Stable across sources, because the
  -- same restaurant can arrive from more than one of them.
  item_ref text not null,
  -- What kind of thing it is, which decides whether it can ever come back.
  vertical text not null default 'unknown',
  -- What they called it, for a list somebody reads back.
  title text,
  verdict text not null check (verdict in ('done', 'not_interested')),
  created_at timestamptz not null default now()
);

-- One row per person per place: the latest verdict wins, because people
-- change their minds and the older row must not.
create unique index if not exists recommendation_feedback_one_per_item
  on public.recommendation_feedback (user_id, item_ref);

-- Discover reads this on every load, filtered to one person.
create index if not exists recommendation_feedback_by_user
  on public.recommendation_feedback (user_id, created_at desc);

-- And a group screen reads everyone's at once.
create index if not exists recommendation_feedback_by_group
  on public.recommendation_feedback (group_id)
  where group_id is not null;

comment on table public.recommendation_feedback is
  'Places a person has already done or does not want. Never delete on undo — the row is replaced, so a change of mind is a change of verdict.';
