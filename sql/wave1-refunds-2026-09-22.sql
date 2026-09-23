-- ─── Giving money back when nothing was booked with it ──────────────────
-- Run me. Written 2026-09-22. Safe to run twice.
--
-- Moab took $1,474 from one person, every booking on it failed, and there
-- was no way in the app to hand the money back: nothing created a Stripe
-- refund, and a contribution could only say "refunded" of the whole amount,
-- so a refund of part of a share could not be written down at all. The
-- funding total went on counting money that had already left.
--
-- Two things:
--
--   1. contributions.refunded_cents — how much of a payment Stripe has given
--      back. The funding total, the approval gate and the ledger count
--      amount_cents minus this. Written by POST /api/plans/[planId]/funding/refund
--      when Stripe accepts the refund, and by the Stripe webhook
--      (charge.refunded) from the charge's own amount_refunded, which is the
--      authority — it also sees refunds made by hand in the Stripe dashboard.
--
--   2. refunds — one row per contribution the app has refunded. The row is
--      written BEFORE Stripe is asked, so two presses at the same instant
--      cannot both refund: the second insert is refused by the unique index.
--      Reading "no refund yet" first cannot do this, for the same reason it
--      could not for payments — both requests read before either writes.
--
--   3. refund_locks — one refund at a time per plan, because the amount is
--      capped by the plan's spare money and two payers could both take it.
--
-- Until this runs:
--   · POST /api/plans/[planId]/funding/refund answers 503 and refunds
--     nothing, which is where the app was before it existed — refunds go
--     through the Stripe dashboard;
--   · a whole refund made in the dashboard is still recorded, by status;
--   · a part refund made in the dashboard is answered 500 by the webhook so
--     Stripe retries it until this has run (see the end of this file);
--   · every read of refunded_cents treats a missing column as nothing refunded.

alter table public.contributions
  add column if not exists refunded_cents integer not null default 0;

do $$ begin
  alter table public.contributions
    add constraint contributions_refund_within_amount
    check (refunded_cents >= 0 and refunded_cents <= amount_cents);
exception when duplicate_object then null; end $$;

-- Payments already marked refunded were refunded in full — that was the only
-- kind of refund the status could say. Written down as an amount too, so the
-- two never disagree. Touches only rows still at the default.
update public.contributions
   set refunded_cents = amount_cents
 where status = 'refunded' and refunded_cents = 0;

comment on column public.contributions.refunded_cents is
  'Cents Stripe has refunded against this payment. Money collected = amount_cents - refunded_cents for a succeeded row. status becomes refunded only when the whole amount is back.';

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.contributions(id) on delete restrict,
  plan_id text not null,
  user_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  stripe_refund_id text,
  status text not null default 'claimed',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Added after the first draft of this file; `if not exists` so a database
-- that ran that draft catches up.
--   refunded_before_cents — refunded_cents on the payment when the claim was
--     taken. Before/after a claim, what has gone back is the larger of the
--     payment's refunded_cents and this plus amount_cents, so a second request
--     in the gap before the payment row is written cannot refund it again.
--   attempt — which try at refunding this payment this is. The Stripe
--     idempotency key carries it: a refused refund, or a further refund after
--     one settled, is a new attempt with a new key.
alter table public.refunds add column if not exists refunded_before_cents integer not null default 0;
alter table public.refunds add column if not exists attempt integer not null default 1;
alter table public.refunds alter column status set default 'claimed';

-- claimed: ours — written before Stripe is asked, until Stripe's answer is
-- recorded. The rest are Stripe's own words for a refund object.
alter table public.refunds drop constraint if exists refunds_status_check;
do $$ begin
  alter table public.refunds
    add constraint refunds_status_check
    check (status in ('claimed', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled'));
exception when duplicate_object then null; end $$;

-- One row per payment: a claim is taken by inserting it, or, once its last
-- refund has settled or been refused, by moving it back to 'claimed' where
-- it still reads that. Either way exactly one request holds a payment.
create unique index if not exists refunds_one_per_contribution
  on public.refunds (contribution_id);

create index if not exists refunds_plan_idx on public.refunds (plan_id);
create index if not exists refunds_stripe_idx on public.refunds (stripe_refund_id);

-- ─── One refund at a time per plan ─────────────────────────────────────
-- The refund is capped by what the plan holds beyond what Reach is booking.
-- Two payers asking at the same instant would both see the same spare money
-- and both take it. The route inserts this row before it reads anything and
-- deletes it when it is done; a second request is refused (409) until then.
-- A row older than two minutes belongs to a request that died, and the next
-- request takes it over.
create table if not exists public.refund_locks (
  plan_id text primary key,
  token uuid not null,
  user_id text not null,
  taken_at timestamptz not null default now()
);

-- The same stance as every other money table: the server reads and writes
-- with the service role, and nobody reads these through the anon key.
alter table public.refunds enable row level security;
alter table public.refund_locks enable row level security;

-- ─── Before this ran ───────────────────────────────────────────────────
-- Between deploying the code and running this file, a PART refund made in
-- the Stripe dashboard has nowhere to be written. The webhook answers 500 for
-- it, so Stripe keeps retrying (for up to three days) and it lands once this
-- has run. If this runs later than that, reconcile by hand: for each
-- charge.refunded event in Stripe's log from that window, set
-- contributions.refunded_cents to the charge's amount_refunded.
