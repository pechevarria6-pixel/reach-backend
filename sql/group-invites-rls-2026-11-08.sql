-- Security fix (Supabase Security Advisor, 2026-11-08: "RLS Disabled in Public"
-- and "Sensitive Columns Exposed" on public.group_invites). With RLS off, the
-- public anon key — in every page — read every invite: the invited email
-- address and the token that joins a group (verified: anon GET answered 200).
--
-- Every reader and writer of group_invites is server code using the service
-- role (app/api/invites/[token], app/api/groups/[id]/members, …/invites,
-- lib/invites.ts), which bypasses RLS, so enabling it with no policies
-- changes nothing for the app and closes the table to the anon key.
-- Safe to run more than once.
alter table public.group_invites enable row level security;
revoke all on public.group_invites from anon, authenticated;
