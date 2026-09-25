-- ─── Settling up, in the members' own apps ───────────────────────────────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- Reach never moves money between members. The ledger works out who owes
-- whom (GET /api/plans/[planId]/ledger → settleUp in lib/money.ts), and each
-- line opens the payer's own Venmo or Cash App, or shows a Zelle contact to
-- copy. Two things are needed for that and neither exists yet (probed
-- 2026-09-25: users.venmo_handle answers 42703, settlements PGRST205):
--
-- 1. Somewhere to say a line was paid.
--
--    The settle-up lines are recomputed on every read, so they have no
--    stable identity: one new expense can reshape every line. A "paid" flag
--    on a computed line would come back unpaid, or land on the wrong pair.
--    So a payment is stored as what it is — a payment from one member to
--    another, for an amount — and the ledger counts it in the net balances
--    like any other money that changed hands. Once the balances say square,
--    the line is gone because it is true, not because it was hidden.
--
--      pending    the payer tapped "Pay on Venmo" and has not said it went
--                 ("Sent on Venmo?"). Shown to both sides; does NOT move the
--                 balances — nobody has said the money arrived.
--      paid       either side said it went ("Mark as paid" / "Mark
--                 received"). Counts in the balances from here on.
--      cancelled  withdrawn. Counts for nothing, kept for the record.
--
-- 2. The handles.
--
--    users.venmo_handle, users.cashtag and users.zelle_contact, optional,
--    typed by the person for exactly this. Zelle has no deep link, so the
--    screen shows the contact with a copy button — and it is the contact
--    they typed for Zelle, never users.phone by default (owner decision 21).
--    A member is only ever given the handle of the person they owe, never
--    the whole set (the /api/groups/[id]/mix precedent: being in a group is
--    not consent to be read).

alter table public.users
  add column if not exists venmo_handle text,
  add column if not exists cashtag text,
  add column if not exists zelle_contact text;

do $$
begin
  -- Stored bare: "sam-lee", not "@sam-lee"; "samlee", not "$samlee". The
  -- link builders (lib/settle-links.ts) add what each app wants, and a
  -- stored prefix would be doubled.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.users'::regclass and conname = 'users_venmo_handle_shape') then
    alter table public.users add constraint users_venmo_handle_shape
      check (venmo_handle is null
             or (char_length(venmo_handle) between 1 and 64 and venmo_handle !~ '^[@\s]' and venmo_handle !~ '\s'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.users'::regclass and conname = 'users_cashtag_shape') then
    alter table public.users add constraint users_cashtag_shape
      check (cashtag is null
             or (char_length(cashtag) between 1 and 64 and cashtag !~ '^[$\s]' and cashtag !~ '\s'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.users'::regclass and conname = 'users_zelle_contact_shape') then
    alter table public.users add constraint users_zelle_contact_shape
      check (zelle_contact is null or char_length(btrim(zelle_contact)) between 3 and 254);
  end if;
end $$;

comment on column public.users.venmo_handle is
  'Venmo username without the @, typed by the person so group members they are owed by can pay them. Returned only to someone who owes them.';
comment on column public.users.cashtag is
  'Cash App $Cashtag without the $. Same scope as venmo_handle.';
comment on column public.users.zelle_contact is
  'The email or phone the person typed for Zelle. Never filled from users.phone. Same scope as venmo_handle.';

create table if not exists public.settlements (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.plans(id) on delete cascade,
  from_user_id     uuid not null references public.users(id) on delete cascade,
  to_user_id       uuid not null references public.users(id) on delete cascade,
  amount_cents     integer not null check (amount_cents > 0),
  currency         text not null default 'usd',
  -- Which app they said they used. 'other' is cash, a bank app, anything.
  method           text not null check (method in ('venmo', 'cashapp', 'zelle', 'other')),
  status           text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  -- Sent by the client with "Mark as paid" / the pay button. A double tap is
  -- two concurrent requests with the same key; the unique index below turns
  -- the second into a conflict instead of a second payment in the ledger.
  idempotency_key  text not null,
  created_by       uuid references public.users(id) on delete set null,
  paid_at          timestamptz,
  -- Who closed it: the payer ("Mark as paid") or the payee ("Mark received").
  closed_by        uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  check ((status = 'paid') = (paid_at is not null))
);

create unique index if not exists settlements_one_per_key
  on public.settlements (idempotency_key);

-- One open "Sent on Venmo?" per pair per trip. Tapping the Venmo button
-- twice, or Venmo then Cash App, should leave one pending line to answer,
-- not two that each look like money owed on top of the other.
create unique index if not exists settlements_one_pending_per_pair
  on public.settlements (plan_id, from_user_id, to_user_id)
  where status = 'pending';

-- The ledger reads every settlement of one plan on each GET.
create index if not exists settlements_by_plan
  on public.settlements (plan_id, created_at);

alter table public.settlements enable row level security;

comment on table public.settlements is
  'Money one member says they paid another, outside Reach (Venmo, Cash App, Zelle, cash). Only status = paid counts in the ledger''s net balances. Reach never holds or moves this money.';

-- Read and written only through the app's own server with the service role;
-- no policy for anon or authenticated, on purpose.
--
-- Check after running:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'users'
--      and column_name in ('venmo_handle', 'cashtag', 'zelle_contact');
--   select indexname from pg_indexes where tablename = 'settlements';
