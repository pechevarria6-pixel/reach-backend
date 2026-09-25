-- ─── The pilot-metric views are readable with the browser's key ──────────
-- Run me. Written 2026-09-25. Safe to run twice.
--
-- Found while writing the taste-profile views. Every table here has row
-- level security on and no policy, so the anon key the browser ships reads
-- nothing from them. A view is different: it runs as its owner, the owner
-- is not held back by RLS, and Supabase grants select on everything in
-- public to anon and authenticated by default.
--
-- Probed 2026-09-25, GET with the anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY),
-- one request per table and view the API lists:
--
--   v_trip_funnel            200, rows — plan ids, titles, group ids, money collected
--   v_invite_loop            200, rows — group ids and group names
--   v_organizer_conversion   200, empty today; the same grant, so the same hole
--   place_climate            200, rows — intended (a public read policy in
--                            sql/climate-2026-09-24.sql; climate normals)
--   every other table        200, empty — RLS doing its job
--
-- So anybody holding the public key — which is anybody who opens the app —
-- can list every trip's title and every group's name. Nothing in app/, lib/
-- or components/ reads these views; they are for the owner in the SQL
-- editor and for the service role, and both keep working after this.

do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.v_trip_funnel set (security_invoker = true)';
    execute 'alter view public.v_invite_loop set (security_invoker = true)';
    execute 'alter view public.v_organizer_conversion set (security_invoker = true)';
  else
    raise notice 'Postgres older than 15: security_invoker not set; relying on the revoke below.';
  end if;
end $$;

revoke all on public.v_trip_funnel from anon, authenticated;
revoke all on public.v_invite_loop from anon, authenticated;
revoke all on public.v_organizer_conversion from anon, authenticated;

-- Re-running sql/events-2026-09-20.sql (`create or replace view`) keeps the
-- revoke — replacing a view keeps its grants — but resets its options, so
-- security_invoker is lost. Dropping and re-creating a view loses both. Run
-- this file again after either.
--
-- Check after running, from outside, with the anon key:
--   GET /rest/v1/v_trip_funnel?limit=1   → 401/403 (permission denied), never rows
