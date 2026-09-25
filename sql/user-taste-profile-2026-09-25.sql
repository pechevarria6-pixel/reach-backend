-- ─── One taste profile per person, from what they have already told us ────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- Every recommendation surface (Discover, trip generation, Change
-- alternatives, packing lists) should read one distilled profile per person
-- instead of each re-reading the quiz. This is the storage for it.
--
-- No new signals table. Owner decision 20: nearly every signal the spec
-- lists is already a row somewhere — recommendation_feedback, trip_vetoes,
-- votes, item_optouts, plan_preferences, availability_windows, bookings,
-- events, and the declared answers on users. An append-only copy of those
-- would be a second record of each fact, written on every tap and able to
-- disagree with the first. So the signals are a VIEW over the rows we hold,
-- and the distill (lib/taste-profile.ts, folded into /api/cron/knowledge —
-- no new vercel.json entry) reads the view and writes the profile.
--
-- v_taste_signals     every signal, one row each: whose, what kind, when
-- user_taste_profile  the distilled profile, one row per person
-- taste_profile_ids   the opaque profile_id for each person, the only place
--                     it meets a users.id
-- v_taste_profile_ops the profile by profile_id, for the ops read — no
--                     user id, name, email or phone in it
--
-- Probed 2026-09-25: user_taste_profile and signals both answer PGRST205.
--
-- Hard limits, enforced by what the view selects rather than by a promise:
--   * Travel and leisure only. Nothing the quiz marks PRIVATE is in the
--     view (lib/traveler-profile.ts, QuizAnswers): not users.dietary_needs,
--     and not the copies of it and its neighbours that live inside the
--     quiz answers — quiz_answers.dietary, eat_everything, dislikes,
--     no_way_text and free_interests are removed from users.quiz_answers
--     and from plan_preferences.answers by key. users.no_way_jose is left
--     out too, because the typed hard no is appended to it verbatim. They
--     stay where the person put them, read at the moment they are needed.
--   * No free text at all: users.trip_summary and plan_preferences
--     .summary_text are left out. A sentence somebody typed can say
--     anything ("I'm coeliac"), and this view's limits are enforced by what
--     it selects, which cannot be done on a sentence. Discover and trip
--     generation read those columns live, as they do today.
--   * Nobody who has asked to be deleted. deletion_scheduled_at is checked
--     once, around the whole view, so a new branch cannot forget it and the
--     distill cannot rebuild a profile during the grace period.
--   * No name, email, phone, date of birth, gender, passport, KTN or
--     payment detail. No coordinates: places are city names.
--   * Never shown to the person or to other members. Nothing under
--     NEXT_PUBLIC reads any of this.
--
-- Account deletion: every table here cascades from public.users, so the
-- purge that deletes the user row removes the profile and the id map with
-- it, and the view has nothing left to show. Today deletion is only
-- scheduled (deletion_requests); the taste-profile builder adds the explicit
-- delete to the deletion path rather than waiting on a worker that does not
-- exist yet.
-- Between the request and the purge the user row still exists, which is why
-- the view filters on deletion_scheduled_at: otherwise the next distill
-- would read their votes and bookings and write the profile back.

-- ── The profile ─────────────────────────────────────────────────────────

create table if not exists public.user_taste_profile (
  user_id         uuid primary key references public.users(id) on delete cascade,
  -- Explainable facets, not a score: interests{tag:score}, avoid{tag:score},
  -- pace, budget_posture, food, nightlife, outdoors, culture, travel_style,
  -- time_prefs, places, social, confidence{facet:0..1}. Shape owned by
  -- lib/taste-profile.ts, versioned by model_version.
  profile         jsonb not null default '{}'::jsonb,
  model_version   integer not null default 1,
  -- How many signal rows the last distill read, and the newest of them.
  -- last_signal_at is what the 24-months-inactive retention rule reads.
  signal_count    integer not null default 0,
  last_signal_at  timestamptz,
  distilled_at    timestamptz not null default now()
);

create index if not exists user_taste_profile_last_signal
  on public.user_taste_profile (last_signal_at);

alter table public.user_taste_profile enable row level security;

comment on table public.user_taste_profile is
  'Inferred travel/leisure profile per person, distilled from v_taste_signals. Internal only: never rendered to the person or to other members. Purged with the user row.';

-- ── The pseudonym ───────────────────────────────────────────────────────

create table if not exists public.taste_profile_ids (
  profile_id  uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references public.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.taste_profile_ids enable row level security;

comment on table public.taste_profile_ids is
  'Opaque profile_id per person. The one place a profile_id meets a users.id; the ops read and any cohort analysis use profile_id only.';

-- ── The signals, as a view over the rows we already hold ────────────────
-- Columns: user_id, source ('declared' | 'behavioural'), kind, ref,
-- plan_id, group_id, detail (jsonb), at.
--
-- Weights and decay are not here. They are the distill's to decide and to
-- change without a migration.

create or replace view public.v_taste_signals as
select s.*
  from (
  -- What they said about themselves (the quiz and Profile), one row each.
  -- The quiz answers go in minus every key the quiz marks PRIVATE.
  select u.id as user_id, 'declared'::text as source, 'profile'::text as kind,
         null::text as ref, null::uuid as plan_id, null::uuid as group_id,
         jsonb_strip_nulls(jsonb_build_object(
           'quiz_version', u.quiz_version,
           'quiz_answers', u.quiz_answers
                             - array['dietary', 'eat_everything', 'dislikes', 'no_way_text', 'free_interests'],
           'traveler_profile', u.traveler_profile,
           'favorite_activities', to_jsonb(u.favorite_activities),
           'activity_vibe', to_jsonb(u.activity_vibe),
           'cuisines', to_jsonb(u.cuisines),
           'music_genres', to_jsonb(u.music_genres),
           'concert_types', to_jsonb(u.concert_types),
           'dining_vibe', u.dining_vibe,
           'drink_style', u.drink_style,
           'nightlife_style', u.nightlife_style,
           'budget_range', u.budget_range,
           'travel_style', u.travel_style,
           'trip_frequency', u.trip_frequency,
           'climate_preference', u.climate_preference,
           'seat_preference', u.seat_preference,
           'home_city', u.home_city,
           'home_airport', u.home_airport
         )) as detail,
         coalesce(u.updated_at, u.created_at) as at
    from public.users u
union all
  -- "Already done it" / "Not for me" on Discover.
  select f.user_id, 'behavioural', 'feedback_' || f.verdict,
         f.item_ref, null::uuid, f.group_id,
         jsonb_build_object('vertical', f.vertical),
         f.created_at
    from public.recommendation_feedback f
union all
  -- "I won't do this one" on a trip idea.
  select v.user_id, 'behavioural', 'veto', v.option, v.plan_id, p.group_id,
         '{}'::jsonb, v.created_at
    from public.trip_vetoes v
    join public.plans p on p.id = v.plan_id
union all
  -- The idea they voted for.
  select v.user_id, 'behavioural', 'vote', v.option, v.plan_id, p.group_id,
         '{}'::jsonb, coalesce(v.voted_at, p.created_at)
    from public.votes v
    join public.plans p on p.id = v.plan_id
union all
  -- "Skip this one".
  select o.user_id, 'behavioural', 'skip', o.item_ref, o.plan_id, p.group_id,
         '{}'::jsonb, o.created_at
    from public.item_optouts o
    join public.plans p on p.id = o.plan_id
union all
  -- What they asked of a particular trip: the per-trip quiz answers, minus
  -- the same PRIVATE keys. summary_text is free text and is not here.
  select pp.user_id, 'declared', 'trip_input', null, pp.plan_id, p.group_id,
         jsonb_strip_nulls(jsonb_build_object(
           'answers', pp.answers
                        - array['dietary', 'eat_everything', 'dislikes', 'no_way_text', 'free_interests'])),
         coalesce(pp.submitted_at, pp.updated_at)
    from public.plan_preferences pp
    join public.plans p on p.id = pp.plan_id
   where pp.submitted_at is not null
union all
  -- The dates they offered.
  select a.user_id, 'behavioural', 'dates_offered', null, a.plan_id, p.group_id,
         jsonb_build_object('start', a.start_date, 'end', a.end_date,
                            'weekday_start', extract(isodow from a.start_date)::int),
         a.created_at
    from public.availability_windows a
    join public.plans p on p.id = a.plan_id
union all
  -- What was actually booked, for everybody who was on that trip. bookings.plan_id
  -- is text; only a well-formed uuid is joined, inside the CASE so a stray
  -- value can never fail the cast. City and country only — never a point.
  -- Not everybody in the group today was on it:
  --   * somebody who pressed "Skip this one" on this booking did not go, so
  --     it is their skip row, not a booked row (item_optouts.item_ref is
  --     bookings.id as text);
  --   * somebody who joined the group after the trip ended was not there.
  --     The day after the end date is allowed, because joined_at is UTC and
  --     the trip's dates are local. A trip with no dates is measured against
  --     the day it was booked. An unknown joined_at proves nothing and is
  --     left out (the comparison is null).
  select gm.user_id, 'behavioural', 'booked', b.vertical, p.id, p.group_id,
         jsonb_strip_nulls(jsonb_build_object(
           'vertical', b.vertical, 'plan_type', p.type,
           'city', p.destination_city, 'country', p.destination_country,
           'price_cents', b.price_cents, 'start_date', p.start_date, 'end_date', p.end_date)),
         coalesce(b.updated_at, b.created_at)
    from public.bookings b
    join public.plans p
      on p.id = (case when b.plan_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then b.plan_id::uuid end)
    join public.group_members gm on gm.group_id = p.group_id
   where b.status = 'confirmed'
     and gm.joined_at::date <= coalesce(p.end_date, p.start_date, b.created_at::date) + 1
     and not exists (
           select 1 from public.item_optouts o
            where o.plan_id = p.id
              and o.item_ref = b.id::text
              and o.user_id = gm.user_id)
union all
  -- Moments recorded as events: a swap (what replaced what), a Discover
  -- dismissal, a quiz dial moved by hand, a trip created (its budget), a
  -- next trip started from the close card. events.props holds no names by
  -- contract (sql/events-2026-09-20.sql).
  select e.user_id, 'behavioural', e.name, null, e.plan_id, e.group_id,
         e.props, e.created_at
    from public.events e
   where e.user_id is not null
     and e.name in ('itinerary_item_swapped', 'recommendation_dismissed', 'quiz_dial_adjusted',
                    'plan_created', 'next_trip_started_from_close')
  ) s
  -- One filter for every branch: nobody who has asked to be deleted.
  join public.users du on du.id = s.user_id and du.deletion_scheduled_at is null;

comment on view public.v_taste_signals is
  'Every taste signal Reach already holds, one row each, for the distill in lib/taste-profile.ts. Service role only. Excludes dietary_needs and every PRIVATE quiz key, all free text, all contact, identity and payment fields, and anybody scheduled for deletion, on purpose.';

-- ── The ops read ────────────────────────────────────────────────────────

create or replace view public.v_taste_profile_ops as
  select t.profile_id, p.profile, p.model_version, p.signal_count,
         p.last_signal_at, p.distilled_at
    from public.user_taste_profile p
    join public.taste_profile_ids t on t.user_id = p.user_id;

comment on view public.v_taste_profile_ops is
  'Taste profiles by opaque profile_id, for GET /api/ops/taste-profile and cohort analysis. No user id or contact detail.';

-- ── Nobody but the server reads a view ──────────────────────────────────
-- A view is not protected by the row level security of the tables under it:
-- by default it runs as its owner, and Supabase grants select on everything
-- in public to the anon key the browser ships. Probed 2026-09-25 with that
-- key: v_trip_funnel and v_invite_loop (sql/events-2026-09-20.sql) both
-- answer 200 with rows. These two must not, so:
--   * security_invoker, so a view reads with the caller's rights and the
--     tables' RLS applies (Postgres 15+; skipped with a notice on older), and
--   * select revoked from anon and authenticated outright.
-- The service role the app uses bypasses both and keeps reading.
-- The same fix for the two views already leaking is its own file,
-- sql/view-privacy-2026-09-25.sql. Re-running this file re-applies both
-- (create or replace keeps grants but resets security_invoker).
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.v_taste_signals set (security_invoker = true)';
    execute 'alter view public.v_taste_profile_ops set (security_invoker = true)';
  else
    raise notice 'Postgres older than 15: security_invoker not set; relying on the revoke below.';
  end if;
end $$;

revoke all on public.v_taste_signals from anon, authenticated;
revoke all on public.v_taste_profile_ops from anon, authenticated;
revoke all on public.user_taste_profile from anon, authenticated;
revoke all on public.taste_profile_ids from anon, authenticated;

-- Tier 2 (cohort patterns with k-anonymity, cells under 10 people dropped)
-- is not here: it aggregates facets whose shape lib/taste-profile.ts has not
-- fixed yet, and a view written ahead of that shape would be a guess.
--
-- Check after running (with the anon key, from outside): a GET of
-- /rest/v1/v_taste_signals?limit=1 must answer 401/403 or an empty set,
-- never rows.
