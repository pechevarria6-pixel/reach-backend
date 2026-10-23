# STATUS — ground truth, updated 2026-10-23

Verified against the code and against production. Nothing here is taken from
a prior report; where a previous package called something done and it is not,
this file says so.

Legend: ✅ done · 🟡 partial · ❌ missing · 🔒 owner-blocked

---

## Now — 2026-10-23

Probed today (PostgREST GETs, `vercel env ls`, the GitHub Actions API).

- **Code:** main `8eb4f7a`; `npm run verify` green, 1606 unit tests. No other
  commits between 2026-09-25 and today. Vercel's live build was from 09-25.
- **Every migration in `sql/` written before today has been run**, except two
  held on purpose:
  - ~~`sql/one-active-plan-2026-09-25.sql`~~ — run by the owner 2026-10-23
    once every path handled the refusal and solo plans were exempt: 12
    past-dated plans closed as completed, 17 plans marked solo, one active
    plan left (Puerto Vallarta, solo).
  - `sql/nudge-index-2026-09-25.sql` — optional; speeds nudges up as
    `audit_logs` grows.
- **The 8 checkout migrations of 2026-09-25** (section 0 below) were run by the
  owner that day; each column and table answers 200, and the anon key gets
  42501 on `v_trip_funnel`, `v_invite_loop` and `v_taste_signals` — the leak is
  closed.
- **Map data:** 586,844 live venues. The daily OSM ingest ran every day; 103 of
  105 regions ok. `europe/italy/centro` and `russia/central-fed-district`
  failed every run with "Unterminated string in JSON" — readline split a
  record at a bare `\r`. Fixed in `8eb4f7a` (lib/discovery/feature-lines.ts);
  confirm on the next daily run.
- **Email is still dead:** `RESEND_API_KEY` in Vercel last changed 89 days ago.
- **In progress:** checkout spec Stage 2 UI (the 5-dot rail replacing the
  sign-off tabs, getNextAction on every chip, the one-active start screen) —
  built and reviewed in `.claude/worktrees/wf_b319ed23-9c9-1`, fix pass
  running. Stages 3–6 not started (plan: wf_0331f72d-1d7).

## 0. Checkout migrations, 2026-09-25 — ✅ all eight run by the owner on 09-25

Run, and verified the same day. Each file is safe to run twice. Run them in the Supabase
SQL editor in this order; each line says what waits on it. Until a file runs,
the code that needs it must fail soft on 42703 / PGRST205 and name the file.

Probed 2026-09-25 with read-only PostgREST GETs: every column and table
below is absent live (42703 or PGRST205). Each file was also run twice
against a throwaway Postgres 18 (PGlite) whose base tables were built from
the live schema's column list, and every constraint and index was exercised
there — duplicate claim, double tap, Null Island, blank confirmation number,
a handle stored with its `@`/`$`, anon-key reads.

| # | file | what it adds | waits on it |
|---|---|---|---|
| 1 | `sql/view-privacy-2026-09-25.sql` | revokes anon/authenticated on `v_trip_funnel`, `v_invite_loop`, `v_organizer_conversion`, and sets `security_invoker` | **a live leak, today**: with the public anon key, `v_trip_funnel` and `v_invite_loop` answer 200 with rows — every trip's title and group id, money collected, every group's name. Nothing in the app reads these views, so nothing breaks |
| 2 | `sql/booking-confirmation-2026-09-25.sql` | `bookings.confirmation_number` (typed by the member on "I've got it"; shown as entered, never as verified) | `POST /api/bookings/[id]/confirmation` keeping the number |
| 3 | `sql/trip-map-2026-09-25.sql` | `plans.destination_lat`, `destination_lng`, `destination_label`; both-or-neither, in range, never 0,0 | the geocode step, `GET /api/me/trips-map`, then `scripts/backfill-plan-coords.mjs` (run after this) |
| 4 | `sql/settle-up-2026-09-25.sql` | `users.venmo_handle`, `cashtag`, `zelle_contact` (stored bare, no `@`/`$`); `settlements` with unique `idempotency_key` and one pending line per pair per trip | "Mark as paid" and the settle-up handles |
| 5 | `sql/pings-2026-09-25.sql` | `ping_log`, unique on (plan, user, kind, local_day); `plan_notification_mutes` | the pings job (a second run sends nothing) and the per-trip opt-out |
| 6 | `sql/user-taste-profile-2026-09-25.sql` | `user_taste_profile`, `taste_profile_ids` (the `profile_id` map), view `v_taste_signals` over the rows we already hold, view `v_taste_profile_ops` by `profile_id`; both views revoked from anon | the distill in `/api/cron/knowledge` and the ops read |
| 7 | `sql/itinerary-suggestions-2026-09-25.sql` | `itinerary_item_suggestions` (one open per line per place), `itinerary_item_suggestion_votes` (one 👍 per person) | "Sam suggests …" on group trips before lock |
| 8 | `sql/post-trip-close-2026-09-25.sql` | `trip_reviews`, one 3-point answer per person per trip | the "How was it?" card |

Deliberately **not** written:
- **Per-traveller booking rows** — owner decision 7 is still open. No SQL
  until it is decided.
- A best-photo bucket (decision 19 defers it), a `completed` flip
  (decision 18: derived from dates), a day-note column (decision 11: the tip
  lives on the slot), a `signals` table (decision 20: views over what we
  hold), a Tier-2 cohort view (it needs the profile's facet shape first).

**Is `bookings_one_per_itinerary_item` live?** Not provable by GET —
PostgREST does not expose `pg_indexes`. What the rows say: 42 bookings, 22
linked to an itinerary line, and no two rows of any status share a line,
which is consistent with the index (the bookable route's release of
superseded attempts was written because of it, commit 1c3218d) but does not
prove it. It is in no file under `sql/`. Settle it in the SQL editor before
anything splits a line into per-traveller rows:

    select indexname, indexdef from pg_indexes
     where schemaname = 'public' and tablename = 'bookings';


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
| reservation-platform | ✅ | the file adds `discovery_venues.reservation_platform` / `reservation_url` / `phone` — present. (This row used to probe `itinerary_items`, which the migration never touches) |
| plan photo | ✅ | `plans.image_url` present |
| booking idempotency | ✅ | `sql/finish-idempotency-2026-09-21.sql` run by the owner 2026-09-24 |
| contribution idempotency | ✅ | same file, same day |

Both idempotency indexes were run on 2026-09-24 once MHW2Y3 was confirmed
cancelled and refunded in Duffel.

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
| crons | ✅ | five `vercel.json` entries, all daily (Hobby allows daily only); the map load, pings and the like run in GitHub Actions instead |
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

1. ~~Run `sql/finish-idempotency-2026-09-21.sql`~~ — done 2026-09-24; MHW2Y3
   was cancelled and refunded in Duffel.
2. ~~Run `sql/plan-photo-2026-09-21.sql`~~ — done.
3. ~~Run the reservation-platform migration~~ — done.
4. **Set `SENTRY_DSN`** so errors are caught.
5. **Fix `RESEND_API_KEY`** (401) and send a test email.
6. **Point `TEST_EMAIL` at a `+qa` account**, so the suite stops acting on
   real groups and plans.
7. ~~Confirm Vercel's Build Command~~ — not overridden, so Vercel runs
   `npm run build`, which is `npm run verify && next build`.
8. ~~Decide the one-active-trip rule~~ — the owner chose (a) on 2026-09-25:
   one active trip and one active night out per group. The server rule is in
   (`lib/one-active.ts`), off until the client says it can show it; then run
   `sql/one-active-plan-2026-09-25.sql`.
9. ~~Confirm the cron count~~ — five, all daily, all allowed on Hobby.
10. ~~Switch Stripe to test mode~~ — done, confirmed `pk_test_`.
11. ~~Run the knowledge-layer migration~~ — done; 11 playbooks `ready`.
