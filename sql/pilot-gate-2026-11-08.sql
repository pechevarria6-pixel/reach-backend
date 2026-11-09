-- Pilot gate (REACH-PILOT-GATE-2026-11-08.md §A2, new): the schema the payment
-- rail, booking integrity and pilot metrics write to. Executed only by the
-- coordinator, after a dry run, in the A2 order. Safe to run more than once.
--
-- Dry run, 2026-11-08 (PostgREST read, service role): bookings 48, live 17,
-- duplicate live (plan, item, vertical) sets 0. The gate's "(plan_id,
-- item_hash) unique" already exists as bookings_one_live_per_thing on
-- (plan_id, idempotency_key) — sql/finish-idempotency-2026-09-21.sql — where
-- idempotency_key is the item hash. Nothing to clean, nothing new to add.
--
-- The pilot_metrics view is Observe's (sql/pilot-metrics-*.sql), run after this.

begin;

-- ── contributions: how it was paid, what Stripe kept, bank settlement ──
alter table public.contributions
  add column if not exists payment_method text,
  add column if not exists stripe_fee_cents integer check (stripe_fee_cents is null or stripe_fee_cents >= 0);
alter table public.contributions drop constraint if exists contributions_payment_method_check;
alter table public.contributions add constraint contributions_payment_method_check
  check (payment_method is null or payment_method in ('us_bank_account', 'card', 'other'));
-- A bank debit is on its way for days: 'processing' (Stripe's word; the gate
-- calls it pending_settlement). Both names are allowed so neither track has
-- to rename the other's.
alter table public.contributions drop constraint if exists contributions_status_check;
alter table public.contributions add constraint contributions_status_check
  check (status in ('pending', 'processing', 'pending_settlement', 'succeeded', 'failed',
                    'refunded', 'partially_refunded'));

-- ── bookings: which lane, what Reach earns, the public price beside ours ──
alter table public.bookings
  add column if not exists lane text,
  add column if not exists commission_cents integer check (commission_cents is null or commission_cents >= 0),
  add column if not exists public_price_cents integer check (public_price_cents is null or public_price_cents >= 0),
  add column if not exists public_price_checked_at timestamptz;
alter table public.bookings drop constraint if exists bookings_lane_check;
alter table public.bookings add constraint bookings_lane_check
  check (lane is null or lane in ('native', 'redirect', 'concierge', 'capture', 'agent'));

-- ── who deleted which plan, and what it held ──
create table if not exists public.plan_deletions (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null,
  group_id      uuid,
  deleted_by    uuid not null,
  title         text,
  status        text,
  bookings      integer not null default 0,
  contributions integer not null default 0,
  snapshot      jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists plan_deletions_plan on public.plan_deletions (plan_id);
alter table public.plan_deletions enable row level security;
-- No policies: the server (service role) writes it; nobody reads it from a browser.

commit;

-- Verification (run after; each must return a row):
--   select 1 from information_schema.columns where table_name='contributions' and column_name='stripe_fee_cents';
--   select 1 from information_schema.columns where table_name='bookings' and column_name='public_price_cents';
--   select 1 from information_schema.tables  where table_name='plan_deletions';
--   select 1 from pg_indexes where indexname='bookings_one_live_per_thing';
