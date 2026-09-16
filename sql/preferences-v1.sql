-- ─── Preferences v1 ───────────────────────────────────────────────────────
-- Two things a group decides together without anybody having to chase it:
-- when they can go, and which of the optional things each of them is in for.
--
-- Run in the Supabase SQL editor. Every statement is safe to run twice.
-- Until it runs the app carries on exactly as before: the dates card and the
-- "What you're in for" list stay hidden, and shares split evenly.

-- ── When people can go ──────────────────────────────────────────────────
-- A row is one stretch of dates one member can make, for one plan.
create table if not exists public.availability_windows (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  constraint availability_windows_in_order check (end_date >= start_date)
);
create index if not exists availability_windows_plan_idx
  on public.availability_windows (plan_id);

-- ── Who is sitting something out ────────────────────────────────────────
-- A row means this member is not going to this booking, so its cost is shared
-- among the people who are. Only activities, events and restaurants can be
-- sat out, and nothing can change once anybody on the plan has paid; the API
-- enforces both.
create table if not exists public.item_optouts (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans (id) on delete cascade,
  item_ref    text not null,        -- bookings.id
  user_id     uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (plan_id, item_ref, user_id)
);
create index if not exists item_optouts_plan_idx
  on public.item_optouts (plan_id);

-- ── Row Level Security ───────────────────────────────────────────────────
-- Every API route uses the service-role key, which bypasses RLS, and all
-- authorization happens in lib/auth.ts. RLS is on so that the anon key, which
-- ships to every browser, cannot read people's dates or change who is going.
alter table public.availability_windows enable row level security;
alter table public.item_optouts         enable row level security;

-- ── Did it work? ────────────────────────────────────────────────────────
-- Run this on its own afterwards. Two rows means yes.
-- select table_name from information_schema.tables
--  where table_name in ('availability_windows','item_optouts');
