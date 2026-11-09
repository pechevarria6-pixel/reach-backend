-- Rail (pilot gate §A3, directive P3): "Booked it ✓" on something a member
-- paid for on the seller's own site writes an expense for settle-up. This
-- links that expense to its booking so there is exactly one per booking and
-- "Not booked after all" can take it back off.
--
-- Written by the Rail track, run by the coordinator after
-- sql/pilot-gate-2026-11-08.sql. Safe to run more than once. The code works
-- without it (lib/rail/expense.ts): the expense is written without the link,
-- once, on the press that marked the booking done.
--
-- Nothing to clean: the column is new, so no existing row carries a link and
-- the index cannot be refused by old data.

begin;

alter table public.expenses
  add column if not exists booking_id uuid;

create unique index if not exists expenses_one_per_booking
  on public.expenses (booking_id)
  where booking_id is not null;

commit;

-- Verification (each must return a row):
--   select 1 from information_schema.columns where table_name='expenses' and column_name='booking_id';
--   select 1 from pg_indexes where indexname='expenses_one_per_booking';
