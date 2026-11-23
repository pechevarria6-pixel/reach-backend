-- ─── Reach's own call relay as a reservation_calls provider (2026-11-23) ──
-- The calling agent's relay (lib/reservations/providers.ts relay(),
-- relay/server.ts) writes provider = 'relay'. The column only allowed
-- Retell and Vapi, so the first relay call's claim would be refused.
-- Schema only; nothing is read or rewritten. Reversible: put the old list back
-- once no row says 'relay'.

begin;

alter table public.reservation_calls drop constraint if exists reservation_calls_provider_check;
alter table public.reservation_calls add constraint reservation_calls_provider_check
  check (provider in ('relay', 'retell', 'vapi'));

commit;

-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'reservation_calls_provider_check';
--   -- CHECK ((provider = ANY (ARRAY['relay'::text, 'retell'::text, 'vapi'::text])))
