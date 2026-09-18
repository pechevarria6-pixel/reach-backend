-- ─── Travel essentials — the one column an airline needs and we lack ────
-- Before a seat can be sold, three things must be true of every traveller:
-- a legal name, a date of birth and a gender marker, each matching the
-- document they will present. Two of the three are already here —
-- users.first_name / users.last_name and users.date_of_birth — and nothing
-- writes the third.
--
-- Run in the Supabase SQL editor. Safe to re-run. Nothing existing changes:
-- every row simply gains a null gender, which reads as "not answered yet".

-- IATA carries four markers on a ticket. 'unspecified' is stored for someone
-- who would rather not say: it is a real answer to us and not a bookable one,
-- so lib/essentials.ts counts it as still missing rather than pretending a
-- ticket could be issued on it.
alter table public.users add column if not exists gender text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_gender_known') then
    alter table public.users add constraint users_gender_known check (
      gender is null or gender in ('female', 'male', 'x', 'unspecified')
    );
  end if;
end $$;

-- ── What this does NOT do ───────────────────────────────────────────────
-- It adds no passport storage. The columns passport_number_enc,
-- tsa_precheck_enc and global_entry_enc already exist and are already written
-- encrypted by /api/profile; travel essentials does not extend them, and the
-- v1 flight lane sends a Known Traveler Number and nothing else.
--
-- It creates no second copy of anyone's name. The legal name on a ticket is
-- users.first_name and users.last_name — the same name the app already greets
-- them by — so the two cannot drift apart into a booking that gets refused.
