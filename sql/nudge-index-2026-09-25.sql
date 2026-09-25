-- ─── Nudge claims: an index for the lookups they make ────────────────────
-- lib/nudge.ts records every nudge claim in audit_logs and reads them back
-- by action and resource_id inside a time window: once a minute per plan
-- (prefs_nudged) and once per person per plan per twelve hours
-- (person_nudged, resource_id = '<plan id>:<user id>'). Each nudge reads
-- twice, and audit_logs only has an index on (user_id, created_at), so
-- each read is a scan of the whole table.
--
-- Optional: the code is correct without it, only slower as audit_logs grows.
-- Idempotent — safe to run more than once.
CREATE INDEX IF NOT EXISTS audit_action_resource_idx
  ON public.audit_logs (action, resource_id, created_at);
