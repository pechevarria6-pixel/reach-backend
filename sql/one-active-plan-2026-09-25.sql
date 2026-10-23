-- ─── One trip and one night out being planned per group ─────────────────
-- Ready to run as of 2026-10-23. Safe to run twice.
--
-- The two holds it was written with are both met:
--   1. Every path in components/reach-app.jsx that makes a plan sends
--      `accepts_one_active: true` and handles a 409 `one_active` by dropping
--      its own copy and opening `planId` (tests/unit/one-active.test.ts
--      fails if a new path does not).
--   2. A group of one is left out. POST /api/plans now sets solo_mode from
--      the member count itself, lib/joining.ts clears it when somebody
--      joins, the backfill below marks existing plans in one-person groups,
--      and the index skips solo_mode plans.
--
-- The owner's rule (a), 2026-09-25: a group may have one TRIP and one NIGHT
-- OUT in planning or voting at a time. Starting a second of the same kind is
-- refused, with the first offered instead. A night out is never blocked by a
-- trip, nor the other way round.
--
-- POST /api/plans checks first and answers 409
--   { code: 'one_active', planId, kind }        (kind: 'trip' | 'night')
-- — or the older { code: 'already_waiting', planId } when both are group
-- trips still deciding where to go. This index is what makes the rule hold
-- when two requests arrive in the same instant; until it exists, the check
-- in the route is all there is.
--
-- The kind is the same expression as kindOf() in lib/one-active.ts:
-- 'restaurant' and 'concert' are a night out, 'trip' and 'weekend' a trip.
-- Change one, change both.
--
-- plans_one_waiting (sql/trip-options-2026-09-23.sql) stays. It is narrower
-- than this one — undecided plans of one type — and harmless beside it.
--
-- An index cannot read today's date, so a plan still marked planning/voting
-- whose dates have passed would hold its slot for ever. POST /api/plans
-- closes such a plan before making the next; this does the same once, for
-- the ones already there, so the index can be built:
--   · still undecided (nobody ever picked where) → 'cancelled', as 09-23 did
--   · decided → 'completed'. A night out with nothing to book stays in
--     'planning' for ever and the dinner happened; 'cancelled' would say it
--     was called off.
-- "Passed" is against the earliest calendar day anywhere (UTC-12), so a plan
-- still on somewhere in the world is never closed. Undated plans are left
-- alone: they are still coming, as everywhere else in the app.
--
-- If a group still has two live plans of one kind after that, the index is
-- not built and a notice says so; the query at the bottom lists them. The
-- organiser calls one off, and this is run again.

update public.plans
   set status = case when destination_style = 'undecided' then 'cancelled' else 'completed' end,
       updated_at = now()
 where status in ('planning', 'voting')
   and coalesce(end_date, start_date) < (now() at time zone 'Etc/GMT+12')::date;

-- Plans already in a one-person group are marked solo, as POST /api/plans
-- now marks every new one, so the index below leaves them out.
update public.plans p
   set solo_mode = true, updated_at = now()
 where coalesce(p.solo_mode, false) = false
   and (select count(*) from public.group_members m where m.group_id = p.group_id) = 1;

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'plans_one_active') then
    if exists (
      select 1 from public.plans
       where status in ('planning', 'voting') and not coalesce(solo_mode, false)
       group by group_id, (case when type in ('restaurant', 'concert') then 'night' else 'trip' end)
      having count(*) > 1
    ) then
      raise notice 'a group has two live plans of one kind (trip / night out) — not adding plans_one_active. Run the query at the end of sql/one-active-plan-2026-09-25.sql, call one of each pair off, and run this again.';
    else
      create unique index plans_one_active on public.plans
        (group_id, (case when type in ('restaurant', 'concert') then 'night' else 'trip' end))
        where status in ('planning', 'voting') and not coalesce(solo_mode, false);
    end if;
  end if;
end $$;

-- Check after running (no rows = the index is there; rows = what is in its way):
--   select indexname from pg_indexes where indexname = 'plans_one_active';
--   select group_id,
--          case when type in ('restaurant', 'concert') then 'night' else 'trip' end as kind,
--          array_agg(id order by created_at) as plans,
--          array_agg(title order by created_at) as titles
--     from public.plans
--    where status in ('planning', 'voting') and not coalesce(solo_mode, false)
--    group by 1, 2 having count(*) > 1;
