-- ─── Migration: Clerk ids → users.id in the engine tables ────────────────
-- Run AFTER core-schema.sql, bookings.sql, engine-v3.sql and savings-v1.sql.
--
-- WHY. The engine tables (bookings, contributions, expenses,
-- connected_accounts, savings_goals) stored `auth().userId` — a Clerk id like
-- `user_2abc…` — while every core table stored `users.id`, a UUID. The same
-- person was therefore two different people depending on which endpoint wrote
-- the row: the ledger could not match a payer to the people splitting a bill,
-- funding could not tell who had paid, and the savings affordability check
-- queried a uuid column with a Clerk string and matched nothing.
--
-- The application code now writes `users.id` everywhere. This rewrites the
-- rows already on disk to match. Columns stay TEXT so the migration is
-- reversible and so a row whose user was deleted is not silently destroyed.
--
-- Idempotent: rows already holding a UUID are left alone.

BEGIN;

-- Report what will change before it changes, so the run is auditable.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM public.bookings b
    JOIN public.users u ON u.clerk_id = b.booked_by;
  RAISE NOTICE 'bookings.booked_by to remap: %', n;

  SELECT count(*) INTO n FROM public.contributions c
    JOIN public.users u ON u.clerk_id = c.user_id;
  RAISE NOTICE 'contributions.user_id to remap: %', n;

  SELECT count(*) INTO n FROM public.expenses e
    JOIN public.users u ON u.clerk_id = e.paid_by;
  RAISE NOTICE 'expenses.paid_by to remap: %', n;
END $$;

-- ── bookings ─────────────────────────────────────────────────────────────
UPDATE public.bookings b
   SET booked_by = u.id::text
  FROM public.users u
 WHERE u.clerk_id = b.booked_by;

UPDATE public.bookings b
   SET approved_by = u.id::text
  FROM public.users u
 WHERE u.clerk_id = b.approved_by;

UPDATE public.bookings b
   SET fulfilled_by = u.id::text
  FROM public.users u
 WHERE u.clerk_id = b.fulfilled_by;

-- ── contributions ────────────────────────────────────────────────────────
UPDATE public.contributions c
   SET user_id = u.id::text
  FROM public.users u
 WHERE u.clerk_id = c.user_id;

-- ── expenses ─────────────────────────────────────────────────────────────
UPDATE public.expenses e
   SET paid_by = u.id::text
  FROM public.users u
 WHERE u.clerk_id = e.paid_by;

-- split_between is a TEXT[] of ids; remap each element that is a Clerk id.
UPDATE public.expenses e
   SET split_between = remapped.arr
  FROM (
    SELECT x.id,
           array_agg(COALESCE(u.id::text, elem) ORDER BY ord) AS arr
      FROM public.expenses x
      CROSS JOIN LATERAL unnest(x.split_between) WITH ORDINALITY AS t(elem, ord)
      LEFT JOIN public.users u ON u.clerk_id = t.elem
     GROUP BY x.id
  ) AS remapped
 WHERE remapped.id = e.id
   AND remapped.arr IS DISTINCT FROM e.split_between;

-- ── connected_accounts ───────────────────────────────────────────────────
-- Remap only where it will not collide with an existing (user_id, provider).
UPDATE public.connected_accounts ca
   SET user_id = u.id::text
  FROM public.users u
 WHERE u.clerk_id = ca.user_id
   AND NOT EXISTS (
     SELECT 1 FROM public.connected_accounts other
      WHERE other.user_id = u.id::text
        AND other.provider = ca.provider
   );

-- Anything still keyed by a Clerk id is now a duplicate of the row that was
-- already keyed by the UUID. Drop the stale Clerk-keyed copy.
DELETE FROM public.connected_accounts ca
 USING public.users u
 WHERE u.clerk_id = ca.user_id;

-- ── savings_goals ────────────────────────────────────────────────────────
UPDATE public.savings_goals g
   SET user_id = u.id::text
  FROM public.users u
 WHERE u.clerk_id = g.user_id
   AND NOT EXISTS (
     SELECT 1 FROM public.savings_goals other
      WHERE other.user_id = u.id::text
        AND other.plan_id = g.plan_id
   );

DELETE FROM public.savings_goals g
 USING public.users u
 WHERE u.clerk_id = g.user_id;

-- ── verification ─────────────────────────────────────────────────────────
-- Anything still matching a clerk_id means the remap missed a row.
DO $$
DECLARE
  leftovers INTEGER;
BEGIN
  SELECT
    (SELECT count(*) FROM public.bookings b JOIN public.users u ON u.clerk_id = b.booked_by) +
    (SELECT count(*) FROM public.contributions c JOIN public.users u ON u.clerk_id = c.user_id) +
    (SELECT count(*) FROM public.expenses e JOIN public.users u ON u.clerk_id = e.paid_by) +
    (SELECT count(*) FROM public.savings_goals g JOIN public.users u ON u.clerk_id = g.user_id)
  INTO leftovers;

  IF leftovers > 0 THEN
    RAISE EXCEPTION 'Migration incomplete: % rows still hold Clerk ids', leftovers;
  END IF;
  RAISE NOTICE 'Migration complete — no Clerk ids remain in engine tables.';
END $$;

COMMIT;
