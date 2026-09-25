-- ─── One trip and one night out being planned per group ─────────────────
-- Run me. Written 2026-09-25. Safe to run twice.
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

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'plans_one_active') then
    if exists (
      select 1 from public.plans
       where status in ('planning', 'voting')
       group by group_id, (case when type in ('restaurant', 'concert') then 'night' else 'trip' end)
      having count(*) > 1
    ) then
      raise notice 'a group has two live plans of one kind (trip / night out) — not adding plans_one_active. Run the query at the end of sql/one-active-plan-2026-09-25.sql, call one of each pair off, and run this again.';
    else
      create unique index plans_one_active on public.plans
        (group_id, (case when type in ('restaurant', 'concert') then 'night' else 'trip' end))
        where status in ('planning', 'voting');
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
--    where status in ('planning', 'voting')
--    group by 1, 2 having count(*) > 1;
