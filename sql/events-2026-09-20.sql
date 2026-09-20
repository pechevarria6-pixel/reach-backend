-- ─── What actually happened, in order ───────────────────────────────────
-- Every trip that runs before this exists is evidence nobody can get back.
-- Not a number lost — the whole shape of it: how long a group took to fund,
-- whether the person who joined somebody else's trip ever made their own,
-- which invitations were opened and by whom. You can reconstruct today's
-- state from the tables, but never the sequence, and the sequence is the
-- part that tells you whether the product works.
--
-- Deliberately boring. One append-only table with a name and a bag of
-- properties, and views so a pilot metric is a SELECT rather than a
-- spreadsheet somebody rebuilds by hand every Monday.
--
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Nullable, because some of the most interesting moments happen before
  -- anybody has an account: an invitation opened is the first step of the
  -- loop and there is nobody to attribute it to yet.
  user_id uuid references public.users(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null,
  name text not null,
  -- Money and counts only. Never a name, an email, a phone number, or
  -- anything somebody typed — this table is read by people building charts,
  -- and a funnel does not need to know who anybody is.
  props jsonb not null default '{}'::jsonb
);

-- `on delete set null` throughout, never cascade: deleting a trip must not
-- delete the evidence that it happened. A funnel with the failures removed
-- is a funnel that always looks healthy.

create index if not exists events_name_time_idx on public.events (name, created_at desc);
create index if not exists events_plan_idx on public.events (plan_id) where plan_id is not null;
create index if not exists events_group_idx on public.events (group_id) where group_id is not null;
create index if not exists events_user_idx on public.events (user_id) where user_id is not null;

-- ─── The pilot metrics, as views ────────────────────────────────────────

-- One row per plan: how long each stage took, and how many people it was for.
-- Reads plans and members for the facts that are already stored, and events
-- for the moments that are not recoverable any other way.
create or replace view public.v_trip_funnel as
select
  p.id                                                   as plan_id,
  p.title,
  p.group_id,
  p.created_at,
  (select count(*) from public.group_members gm where gm.group_id = p.group_id) as members,
  (select min(e.created_at) from public.events e
     where e.plan_id = p.id and e.name = 'trip_input_submitted')  as input_at,
  (select min(e.created_at) from public.events e
     where e.plan_id = p.id and e.name = 'booking_created')       as first_quote_at,
  (select min(e.created_at) from public.events e
     where e.plan_id = p.id and e.name = 'funding_started')       as funding_at,
  (select min(e.created_at) from public.events e
     where e.plan_id = p.id and e.name = 'plan_fully_funded')     as fully_funded_at,
  (select min(e.created_at) from public.events e
     where e.plan_id = p.id and e.name = 'booking_confirmed')     as first_booked_at,
  -- GMV, summable from events alone, which is the whole reason money always
  -- travels in props.
  coalesce((select sum((e.props->>'amount_cents')::bigint) from public.events e
     where e.plan_id = p.id and e.name = 'contribution_succeeded'), 0) as collected_cents,
  coalesce((select sum((e.props->>'price_cents')::bigint) from public.events e
     where e.plan_id = p.id and e.name = 'booking_confirmed'), 0)      as booked_cents
from public.plans p;

-- The growth loop: an invitation opened, somebody signing up from it, and
-- whether they ever told us what they are into.
create or replace view public.v_invite_loop as
select
  g.id   as group_id,
  g.name as group_name,
  (select count(*) from public.events e
     where e.group_id = g.id and e.name = 'invite_link_opened')  as opens,
  (select count(*) from public.events e
     where e.group_id = g.id and e.name = 'invite_signup')       as signups,
  (select count(*) from public.events e
     where e.group_id = g.id and e.name = 'quiz_completed')      as quizzes,
  (select count(*) from public.group_members gm where gm.group_id = g.id) as members_now
from public.groups g;

-- The one that matters to somebody deciding whether this grows on its own:
-- people who arrived on somebody else's trip and later started their own.
create or replace view public.v_organizer_conversion as
with joined as (
  select e.user_id, min(e.created_at) as joined_at
    from public.events e
   where e.name = 'invite_signup' and e.user_id is not null
   group by e.user_id
),
organised as (
  select e.user_id, min(e.created_at) as first_plan_at
    from public.events e
   where e.name = 'plan_created' and e.user_id is not null
   group by e.user_id
)
select
  j.user_id,
  j.joined_at,
  o.first_plan_at,
  (o.first_plan_at is not null and o.first_plan_at > j.joined_at) as became_organiser,
  extract(epoch from (o.first_plan_at - j.joined_at)) / 86400      as days_to_first_plan
from joined j
left join organised o on o.user_id = j.user_id;

comment on table public.events is
  'Append-only record of what happened, in order. Never holds names, emails, phone numbers or anything typed by a person.';
