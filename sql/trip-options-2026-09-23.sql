-- ─── A group trip's three ideas, shared and voted on ────────────────────
-- Run me. Written 2026-09-23. Safe to run twice.
--
-- The three trip ideas "Find our trips" builds used to live on the phone of
-- whoever pressed it. Vote and Veto counted on that phone only, and whoever
-- tapped "Pick this" first decided for everybody. Now the ideas are saved on
-- the plan, every member sees and votes on the same three, and only the
-- organiser picks.
--
-- plans.trip_options  the saved set: { set, rev, mode, foundBy, foundAt, options[] }
-- trip_vetoes         "I won't do this one" — shown to the group as a count only
-- plans_one_waiting   one undecided group trip per group at a time
--
-- Until this runs the app keeps working: ideas are shown to whoever found
-- them and saved nowhere, vetoes are not offered, and the log names this file.

alter table public.plans add column if not exists trip_options jsonb;

create table if not exists public.trip_vetoes (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  option      text not null,
  created_at  timestamptz not null default now(),
  -- One veto per person per idea: a double-tap is two concurrent requests,
  -- and a check in the route would let both through.
  unique (plan_id, user_id, option)
);
create index if not exists trip_vetoes_plan on public.trip_vetoes (plan_id);
-- Read and written only through the app's own server, with the service key.
alter table public.trip_vetoes enable row level security;

-- One vote per member per plan. core-schema.sql declares this; it is asserted
-- again here because changing a vote relies on it (the route updates the
-- member's row, and inserts only when there is none).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.votes'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (plan_id, user_id)'
  ) and not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'votes'
      and indexdef ilike '%unique%(plan_id, user_id)%'
  ) then
    if exists (select 1 from public.votes group by plan_id, user_id having count(*) > 1) then
      raise notice 'votes has duplicate (plan_id, user_id) rows — not adding the unique index. Remove the duplicates and run this again.';
    else
      create unique index votes_one_per_member on public.votes (plan_id, user_id);
    end if;
  end if;
end $$;

-- One group trip waiting on its destination per group. POST /api/plans
-- checks first and answers 409 { code: 'already_waiting', planId }; this is
-- what makes it true when two requests arrive together. Skipped, with a
-- notice, if the table already holds two — building it would fail.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'plans_one_waiting') then
    if exists (
      select 1 from public.plans
      where destination_style = 'undecided' and status in ('planning', 'voting')
      group by group_id having count(*) > 1
    ) then
      raise notice 'a group has two undecided trips — not adding plans_one_waiting. Cancel one and run this again.';
    else
      create unique index plans_one_waiting on public.plans (group_id)
        where destination_style = 'undecided' and status in ('planning', 'voting');
    end if;
  end if;
end $$;
