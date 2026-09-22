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
| T1 booking contract | ✅ | `lib/contracts/booking.ts`; route + checkout screen read it; a live drop found and fixed (`response_payload` on the duplicate path) |
| T2 rendered-content tests | ✅ | four structural assertions on the rendered DOM in `tests/reach.spec.ts` (not a separate `tests/contract/` dir — that never existed), serial, because two workers shared one session and Clerk rotates the cookie |
| T4 empty-town honesty test | ✅ | `tests/unit/grounding.test.ts` — a town we hold nothing for names no venues, and the instruction is checked for not being softened into a suggestion |
| T4 vocabulary additions | ✅ | `BROKEN_PROMISES` bans the five false-promise strings that shipped on 09-21 |

## 3. Infrastructure

| | state | evidence |
|---|---|---|
| Stripe webhook | ✅ | `payment_intent.succeeded` **and** `charge.refunded`, signature-verified, refunds mark contributions `refunded`/`partially_refunded` |
| events / metrics table | ✅ | **corrected twice.** Was 5 rows, not 3. `plan_created` had no call site at all — `track` was imported into `app/api/plans/route.ts` and never called — so the top of the funnel was never recorded and the views in `sql/events-2026-09-20.sql` that select on it were reading an empty set. Now proven in production: a plan created against prod produced `plan_created {city, kind, solo, nights, voting, country, budget_cents}`. `plan_deleted` was **structurally impossible**: `events.plan_id` is `on delete set null`, the track call runs after the plan row is deleted, and the insert is refused `23503`. Reproduced against the database, fixed by moving the id into props, pinned by a test. `booking_created` is unexercised, not broken — both bookings written since the table went live predate its first row |
| `@clerk/testing` | ✅ | `tests/auth.setup.ts`, races a 30s deadline, falls back to the jar |
| rate limits | ✅ | 10 new trips/hour, 30 rebuilds/hour, separate counters, human copy on 429 |
| Sentry | 🟡 | `lib/report.ts` posts to the ingest endpoint; inert until `SENTRY_DSN` is set (🔒) |
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
| one-active-trip rule | 🔒 | no enforcement found, and **the spec is gone** — see below |
| B11 dismiss → Discover suppression | ✅ | **corrected**: the path is joined up. Discover GETs `/api/recommendations/feedback` on mount (`reach-app.jsx:1166`) and seeds `hidden`/`visited` from it; the table exists and holds a row. A refusal survives a reload |
| `←` literals | ✅ | none |
| `g_local_*` purge on boot | ✅ | **corrected**: `purgeStaleDraft` runs on group load and after every delete (`reach-app.jsx:8845/8943/8958`). It had its own second spelling of the temp-id test and missed the `p1758…` form; it uses `isTempId` now |

## 5. Owner-blocked

| | why |
|---|---|
| 🔒 reservation-platform + plan-photo migrations | SQL written, owner runs |
| 🔒 booking + contribution unique indexes | blocked on choosing between two **real Duffel orders**, `MHW2Y3` / `SFYVFK` |
| 🔒 `SENTRY_DSN` | needed before Sentry can be wired |
| 🔒 `RESEND_API_KEY` | 401; all outbound email dead |
| 🔒 `TEST_EMAIL` | points at the owner's real account, so e2e acts on real data |
| 🔒 the one-active-trip rule | the packages that specify it (REACH-HARDENING-BETA rev 2, reach-feedback-w5) are not in the repo or in Downloads, and the rule **stops somebody creating a trip**. Guessing which reading is meant would be inventing product behaviour at the one place it is most expensive to be wrong. The question is in the runbook |

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

1. ~~Sentry~~ — `lib/report.ts`; no-ops until the owner sets `SENTRY_DSN`.
2. **Booking + contribution indexes** — 🔒, but the SQL is ready.
3. ~~T2 rendered-content tests~~ — done; the layer that missed six bugs.
4. ~~T4 empty-town test + vocabulary bans~~ — done; today's fixes are frozen.
5. ~~T1 booking contract~~ — done; the duplicate path was dropping the venue's phone.
6. **events table barely firing** — it is the valuation. ← next
7. ~~dismiss suppression~~, ~~localStorage purge~~ — both were already done; STATUS.md had them wrong and is corrected above. **one-active-trip** is 🔒 on the spec.
8. **reservation-platform + plan-photo migrations** — 🔒, re-probed today and still absent.

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
8. **Decide the one-active-trip rule.** It is the last product gap and the
   package that specifies it is gone. Which did you mean?
   (a) a group may hold one plan in `planning`/`voting` at a time, and
       starting a second is refused with an offer to open the first; or
   (b) one plan is *featured* on Home at a time, and the rest stay in the
       list — a display rule, nothing refused.
   (a) blocks somebody mid-flow, so it is not a guess worth making: say
   which and it goes in with a test.
9. **Confirm the cron count.** Four entries on a plan documenting two; if the
   venue sweep silently stops, destinations quietly stop gaining venues.
10. ~~Switch Stripe to test mode~~ — done, confirmed `pk_test_`.
11. ~~Run the knowledge-layer migration~~ — done; 11 playbooks `ready`.
