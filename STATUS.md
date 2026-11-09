# Pilot gate status — REACH-PILOT-GATE-2026-11-08.md

Maintained by the coordinator. Updated 2026-11-08.

## Definition of ready (all eight must be true)

| # | Item | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Owner blockers cleared | **false** | B1 keys not yet pasted; `SUPABASE_DB_URL` absent; Sentry DSN absent |
| 2 | Custody question answered by counsel | **false** | B2 counsel session pending |
| 3 | Payment rail fixed (ACH default, native-only funding) | **false** | P1 done (cbbf98a, verified live in test mode); P2–P6 in Rail track |
| 4 | Zero S1 UX items | **false** | Wave 0 audit in progress (UX track) |
| 5 | Monitoring and payments kill switch live | **false** | Sentry blocked on DSN; `PAYMENTS_ENABLED` in Rail track |
| 6 | Ten groups recruited | **false** | Owner (B4) |
| 7 | Debrief script written | **false** | Verify track (A7) |
| 8 | Four readouts pre-registered | **false** | Verify track (`docs/pilot/READOUTS.md`), then owner approval |

## Environment
- Stripe: **test** (`/api/health/modes`, 2026-11-08: stripe/stripePublishable/duffel/liteapi all `test`,
  webhook configured). `/api/health/stripe` is CRON_SECRET-gated; the coordinator does not hold it.

## Migrations (A2), in order
| File | Live state (2026-11-08) |
|---|---|
| `sql/discovery-sources-2026-09-17.sql` | **not applied** (`discovery_sources` missing) |
| `sql/2026-09-18-feedback.sql` | **file not in repo**; `plans.solo_mode` present, `plan_preferences.suggestion_text` missing and unused by code |
| `sql/preferences-v1.sql` | applied (`availability_windows`, `item_optouts` present) |
| `sql/reservation-platform-2026-09-20.sql` | applied (`discovery_venues.reservation_platform` present) |
| `sql/knowledge-layer-2026-09-20.sql` | **file not in repo**; equivalent `sql/knowledge-playbooks-2026-09-21.sql` applied |
| `sql/pilot-1-contribution-method-2026-11-08.sql` | not applied (folded into pilot-gate; harmless either way) |
| `sql/pilot-gate-2026-11-08.sql` | **not applied** — waits on `SUPABASE_DB_URL` (or the owner's SQL editor) |

## Out of scope until the pilot has run
Reservation agent (design doc stays parked at `docs/RESERVATION-AGENT-DESIGN.md`), savings
bank partnership, Spotify, App Store wrapper, Europe, revenue layers R1–R4.
