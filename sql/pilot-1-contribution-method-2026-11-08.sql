-- Pilot P1 (REACH-BUSINESS-MODEL-2026-11-08.md §4A): how each share was paid.
-- 'us_bank_account' | 'card' | 'other'; null for shares paid before this ran.
-- Written by the funding confirm route and the Stripe webhook
-- (lib/contribution-method.ts). Safe to run more than once.
alter table public.contributions
  add column if not exists payment_method text
  check (payment_method is null or payment_method in ('us_bank_account', 'card', 'other'));
