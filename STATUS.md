# STATUS — ground truth, 2026-09-21

Verified against the code and against production. Nothing here is taken from
a prior report; where a previous package called something done and it is not,
this file says so.

Legend: ✅ done · 🟡 partial · ❌ missing · 🔒 owner-blocked

---

## 1. Migration state — definitive

Probed by selecting the one column each migration creates. This is the real
answer, not the ledger's.

| migration | state | evidence |
|---|---|---|
| preferences-v1 (availability_windows) | ✅ | `availability_windows.id` selectable |
| preferences-v1 (item_optouts) | ✅ | `item_optouts.id` selectable |
| knowledge-layer (destination_profiles) | ✅ | 20 rows, all `queued` |
| knowledge-layer (trip_playbooks) | ✅ | 11 rows, all `ready`, `locked_at` present |
| discovery sources | ✅ | `discovery_venues.harvest_status` |
| venue images | ✅ | `discovery_venues.image_url` |
| **reservation-platform** | ❌ | `itinerary_items.reservation_platform` does not exist |
| **plan photo** | ❌ | `plans.image_url` does not exist — destination photos cannot save |
| booking idempotency | 🟡 | **column exists, unique index does not** — the route writes the key and nothing enforces it |
| contribution idempotency | 🟡 | column exists (pre-existing); index not yet created |

The two 🟡 rows are the dangerous state: the code behaves as though it is
protected and it is not.

## 2. Contract lockdown (T1–T4)

| | state | evidence |
|---|---|---|
| T3 build gate | ✅ | `build: npm run verify && next build`; proven by planting a failing test → `exit=1`, `next build` never ran |
| T1 itinerary contract | ✅ | `lib/contracts/itinerary-item.ts`; all four layers import it; `venue_website:item.venue_website` appears nowhere |
| T1 booking contract | ❌ | not written |
| T2 rendered-content tests | ❌ | `tests/contract/` does not exist |
| T4 empty-town honesty test | ❌ | not written |
| T4 vocabulary additions | 🟡 | internal terms added; the reintroduced false-promise strings are not banned |

## 3. Infrastructure

| | state | evidence |
|---|---|---|
| Stripe webhook | ✅ | `payment_intent.succeeded` **and** `charge.refunded`, signature-verified, refunds mark contributions `refunded`/`partially_refunded` |
| events / metrics table | 🟡 | exists, **3 rows** — `funding_started` ×2, `trip_input_submitted` ×1. Instrumented but barely firing; trip created/booked/invite/veto not seen |
| `@clerk/testing` | ✅ | `tests/auth.setup.ts`, races a 30s deadline, falls back to the jar |
| rate limits | ✅ | 10 new trips/hour, 30 rebuilds/hour, separate counters, human copy on 429 |
| **Sentry** | ❌ | no config, not a dependency — nothing catches a thrown error in production |
| crons | 🟡 | four entries on a plan documenting two; all daily |
| itinerary replace | ✅ | insert-then-delete, in `lib/itinerary-replace.ts`, with a test that fails if reversed |
| DELETE plan audit log | ✅ | `audit_logs` written on plan delete |

## 4. Product surfaces

| | state | note |
|---|---|---|
| grounded generation | ✅ | verified venue menu; output read back; softening on unmatched names |
| ticket handoff | ✅ | 🎟️ Get tickets → real seller · "I've got them" → ✓ Tickets sorted, counted toward completion |
| venue booking links | ✅ | every cited place carries its site; 386/386 venues have one |
| what's-on | ✅ | harvested from venue pages, in the menu, on the row |
| `redirect_url` "Finish on …" | ✅ | rendered, 4 call sites |
| one-active-trip rule | ❌ | no enforcement found |
| B11 dismiss → Discover suppression | 🟡 | `recommendation_dismissed` tracked; `item_optouts` written by participation; the suppression path is not joined up |
| `←` literals | ✅ | none |
| `g_local_*` purge on boot | 🟡 | `isTempId` exists and is used; no purge-on-load |

## 5. Owner-blocked

| | why |
|---|---|
| 🔒 reservation-platform + plan-photo migrations | SQL written, owner runs |
| 🔒 booking + contribution unique indexes | blocked on choosing between two **real Duffel orders**, `MHW2Y3` / `SFYVFK` |
| 🔒 `SENTRY_DSN` | needed before Sentry can be wired |
| 🔒 `RESEND_API_KEY` | 401; all outbound email dead |
| 🔒 `TEST_EMAIL` | points at the owner's real account, so e2e acts on real data |

## 6. What Phase 0 contradicts

- **Booking idempotency was reported done.** The column landed; the index did
  not. The app writes a key nothing enforces.
- **The events table is not "receiving pilot instrumentation".** Three rows.
- **Sentry is absent entirely**, not partially wired.
- The brief's `EventContract` describes a standalone events table this
  codebase does not have. Six of the seven dropped facts were **itinerary
  items**, so T1 was built against the real columns. Same principle, actual
  shapes.

## 7. Ordered gap list

1. **Sentry** — nothing reports a production error today. (Phase 1)
2. **Booking + contribution indexes** — 🔒, but the SQL is ready.
3. **T2 rendered-content tests** — the layer that missed six bugs.
4. **T4 empty-town test + vocabulary bans** — freeze today's fixes.
5. **T1 booking contract** — same disease, money-side.
6. **events table barely firing** — it is the valuation.
7. **one-active-trip**, **dismiss suppression**, **localStorage purge**.
8. **reservation-platform + plan-photo migrations** — 🔒.

---

## OWNER RUNBOOK

Struck through is already done.

1. **Run `sql/finish-idempotency-2026-09-21.sql`.** Decide first between
   `MHW2Y3` and `SFYVFK` in Duffel — the same flight booked twice. Cancelling
   a row here no longer means cancelling only a row: `POST
   /api/bookings/[id]/cancel` now does it at the airline, two-step, showing
   the refund before it acts.
2. **Run `sql/plan-photo-2026-09-21.sql`** — destination photos cannot save
   without it.
3. **Run the reservation-platform migration** — the restaurant redirect flow
   is built and inert.
4. **Set `SENTRY_DSN`** so errors are caught.
5. **Fix `RESEND_API_KEY`** (401) and send a test email.
6. **Point `TEST_EMAIL` at a `+qa` account**, so the suite stops acting on
   real groups and plans.
7. **Confirm Vercel → Settings → Build Command is `npm run build`.** If it is
   `next build`, the gate proven in T3 is bypassed.
8. **Confirm the cron count.** Four entries on a plan documenting two; if the
   venue sweep silently stops, destinations quietly stop gaining venues.
9. ~~Switch Stripe to test mode~~ — done, confirmed `pk_test_`.
10. ~~Run the knowledge-layer migration~~ — done; 11 playbooks `ready`.
