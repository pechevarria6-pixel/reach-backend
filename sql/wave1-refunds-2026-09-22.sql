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
--      cannot both refund: the second insert is refused by the unique index
--      and the route answers 409. Reading "no refund yet" first cannot do
--      this, for the same reason it could not for payments — both requests
--      read before either writes.
--
-- Until this runs:
--   · a refund of a WHOLE payment still works — Stripe's idempotency key and
--     the contribution's own 'refunded' status carry it, as they did before;
--   · a refund of PART of a payment is refused with a 503, because there is
--     nowhere to record it and the plan would go on counting money it no
--     longer holds;
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
  -- pending: claimed, Stripe asked or about to be. succeeded / failed / canceled
  -- are Stripe's own words for the refund object. requires_action is Stripe's
  -- too (some payment methods need the customer to do something).
  status text not null default 'pending'
    check (status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The point of the table. One refund per payment, ever: the Stripe
-- idempotency key is per contribution too, so a second refund of the same
-- payment is refused here and at Stripe.
create unique index if not exists refunds_one_per_contribution
  on public.refunds (contribution_id);

create index if not exists refunds_plan_idx on public.refunds (plan_id);

-- The same stance as every other money table: the server reads and writes
-- with the service role, and nobody reads these through the anon key.
alter table public.refunds enable row level security;
