-- ─── One contribution per payment intent ────────────────────────────────
-- POST /api/plans/[id]/funding now sends Stripe an Idempotency-Key, so a
-- double-tapped "Looks good" gets back the SAME payment intent instead of
-- creating two. That stops the double charge. It does not stop the insert
-- underneath it running twice.
--
-- Walked on production, two simultaneous requests:
--
--   0bb01d61  pending  $918.81  pi_3UIDYI5GB2FVY7o60RXdYQmY
--   c90c5e97  pending  $918.81  pi_3UIDYI5GB2FVY7o60RXdYQmY
--
-- One intent, two rows. The webhook finds contributions by intent id, so a
-- single payment would have been recorded twice: the group's collected
-- total would have read $1,837.62 against a target of $918.81, and the plan
-- would have called itself funded on half the money actually taken.
--
-- Reading before writing cannot fix it — both requests read before either
-- writes, which is the same reason the intent needed Stripe's key. Only the
-- database settles it.

create unique index if not exists contributions_one_per_intent
  on public.contributions (stripe_payment_intent, user_id)
  where stripe_payment_intent is not null;

-- Nulls never collide in Postgres, so a contribution recorded without an
-- intent — a cash share, an adjustment — is unaffected.
--
-- Existing duplicates will stop this building. Find them first:
--
--   select stripe_payment_intent, user_id, count(*), array_agg(id), array_agg(status)
--     from public.contributions
--    where stripe_payment_intent is not null
--    group by 1, 2 having count(*) > 1;
--
-- Nothing here deletes anything. Where a duplicate is genuinely two rows for
-- one payment, keep the one the webhook has touched — the succeeded one if
-- there is one, otherwise the oldest — and delete the rest by id. Money is
-- involved; a migration should not pick.
