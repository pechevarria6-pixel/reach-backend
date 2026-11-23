# STATUS — ground truth, updated 2026-10-23

Verified against the code and against production. Nothing here is taken from
a prior report; where a previous package called something done and it is not,
this file says so.

Legend: ✅ done · 🟡 partial · ❌ missing · 🔒 owner-blocked

---

## Accessibility and palette — REACH-ACCESSIBILITY-PALETTE-2026-11-22.md, Task 0

Ground truth, 2026-11-22. No code changed. Measured with the WCAG formula against the real tokens, and
on production at iPhone 14 width (390 px) signed in as the QA account, both themes. Screenshots (half
size) and the raw audit: `docs/a11y/before/` (`audit.json`). Raw colours: `docs/a11y/RAW-COLOURS.md`.

### Where the colours live (corrects the directive)

- **The token file is the `PALETTE` block in `components/reach-app.jsx` (lines 99–172)**, turned into CSS
  variables (`--c-*`) and read through `C.*`. `lib/brand.ts` holds the shell, email and loading copies.
- **The landing page has its own second palette** in `app/page.tsx` line 39 (`.lp{--pg…}`), duplicating
  token values by hand. The sign-in and sign-up pages are themed separately again (`lib/clerk-appearance.ts`,
  `components/ThemedAuth.tsx`).
- **129 raw colours sit outside the token files** across 12 files: `components/reach-app.jsx` 70,
  `lib/email.ts` 30 (email HTML cannot use CSS variables, so these need a different rule), `ThemedAuth` 7,
  `clerk-appearance` 7, the rest 1–3 each. The full list with file and line is in `docs/a11y/RAW-COLOURS.md`.
- The repo already has a contrast gate, `check:contrast` (60 pairs). It only checks a `background:C.x` and a
  `color:C.y` written in the same style object, with a 3.0 floor for everything. So it misses text on the
  inherited page or card colour, which is most text, and it never applies 4.5.

**Real values vs the directive's "Now" column:**

| Token | Directive said | Real (dark) | Real (light) |
|---|---|---|---|
| Background `bg` | `#2C0E18` / `#EBEFEC` | `#2C0E18` ✓ | `#EBEFEC` ✓ |
| Card `s2` | `#3F1619` / `#E4EAE6` | `#3F1619` ✓ | `#E4EAE6` ✓ |
| Other surfaces | — | `s1 #36121B`, `s3 #4A1B20` | `s1 #F4F7F5`, `s3 #DAE2DC` |
| Control border | "faint" | `border #5A2430`, `borderLight #6B2C39` | `border #D8DED4`, `borderLight #C3CCC5` |
| Primary text `t1` | `#FEF7D9` / `#142119` | `#FEF7D9` ✓ | `#142119` ✓ |
| Secondary `t2` | `#CFC182` / `#576E61` | `#CFC182` ✓ | `#576E61` ✓ |
| Tertiary `t3` (167 uses) | not listed | `#B89A6A` | `#5E766A` |
| `t4` | not listed | `#9C815A` (unused) | `#6E8577` (unused) |
| Action fill `accent` | gold / orange | **gold `#C3A342`** | **orange `#EC6032`** |
| Accent as text `accentText` | gold / orange | gold `#C3A342` | **green `#2B583B`**, not orange or gold |
| Label on a fill `onAccent` | — | `#2A1D06` | `#2A1D06` |
| Orange | `#EC6032` in dark | **not a dark token**; the dark accent word is gold | `#EC6032` |
| Light gold | `#CD9D2E` | — | **no such token**; only the landing logo `--mark #B8912A` |
| Error `red` | unknown | `#E85D5D` | `#C0392B` |
| Success `green` | unknown | `#7FB58A` | `#2F7D43` |
| Also | — | `amber #E8A33D`, `blue #7FA8D9` | `amber #6F4B00`, `blue #1E62C4` |

### The findings, recomputed

| # | Verdict | Real measurement |
|---|---|---|
| F1 cards don't separate | **Confirmed, worse** | Card on background: dark 1.13:1, light 1.05:1. Control borders on background are **1.46:1 dark, 1.18:1 light**, under the 3:1 target. Light cards rely on a shadow at 7% opacity. |
| F2 one hue does every job | **Confirmed in dark; corrected in light** | Dark: cream headings, tan `t2` body, tan `t3`, gold links and buttons: one warm family. Light: text and links are green (`accentText #2B583B` 7.06:1) and fills are orange, so links and body text are both green-grey. Links in sentences are not underlined in either theme. |
| F3 orange fails as text in light | **Confirmed, narrow** | 2.88:1 on background. Used as text in one place: the Home greeting's accent word ("better"), 34 px, which needs 3:1 and fails. The orange `Pay` / `Get started` fills carry dark labels. |
| F4 white on orange fails | **Ratio confirmed, not used** | White on orange 3.34:1; nothing in the app puts white on it. Dark ink on orange is **4.92:1** (the directive's 5.31 was orange on the maroon background). A related failure: **white on the dark red is 3.41:1** (the "Delete" button on Groups). |
| F5 gold washes out in light | **Corrected** | The light app uses no gold. The landing page's gold hands logo (`#B8912A`) is 2.31:1 on its page colour. It is decorative (`alt=""`), so it fails only as brand legibility, not as text. |
| F6 light secondary text has no margin | **Confirmed, and the tertiary is worse** | `t2` 4.75:1 on background, 4.52:1 on a card, 4.17:1 on `s3`. **`t3` (167 uses) is 4.23:1 on background and 4.03:1 on a card: a fail.** This was the most common low-contrast text in the audit (28 instances, e.g. "From Southern Pines", "Traveller"). On the landing page's own background, `t2` is 4.31:1 and the "How it works" label 3.35:1: both fail. |
| F7 landing chips look tappable | **Confirmed** | `app/page.tsx:105–107`: three `<span>` pills with a border and fill, no link or role. |
| F8 long body text centred and tinted | **Confirmed** | Landing intro: four centred lines in `t2`. The same pattern appears in-app: the trip-question intro is four centred lines. |
| F9 emoji as interface icons | **Confirmed** | For example 🧪 group badges, 🍽️🏖️✈️ chips, 💬 Help, 📄 Privacy Policy, the quiz's 💭 and 👋. **An icon set exists:** `Ic` in `components/reach-app.jsx` (line 460), 14 hand-drawn SVG icons, so emoji can be replaced rather than only hidden. |
| F10 error and success unknown | **Measured; mixed** | Dark red: 5.20:1 on background, 4.59:1 on a card, 4.19:1 on `s3` (fail). Light red: 4.68:1 on background, **4.46:1 on a card** (fail). Light success green `#2F7D43`: **4.37:1 on background** (fail) and 4.16:1 on a card. Dark success is fine (7.50:1). |

### Per screen (audit on production, both themes)

Captured: landing, sign-in, sign-up, onboarding quiz, Home, Discover, Groups, a group, trip creation, plan
overview, budget, checkout, Profile, Privacy, empty Groups, the group's empty plan list, the Groups error,
the Discover error, 404 and offline. Each has a dark and a light capture, and the dark captures also have
200% text versions.

**Not captured, with the reason:**
- **Options and voting:** no group holds ideas right now. Making some means generating a trip, and the audit
  refuses every write.
- **Trip input:** a trip-answers step past the first was not reached without writing.
- **Itinerary:** the plan screen's tabs are Overview / Budget / Book; the day-by-day sits inside Overview.

Capturing options and voting needs a QA trip generated and then called off. I'll do that in Task 5 if you agree.

| Check | Result |
|---|---|
| Text under target | **Dark: almost none.** 3 lines on Groups and Profile: the white "Delete" label, and the map credit "Leaflet" at 3.64:1. A fourth hit, the 👋 emoji on the quiz, is a false alarm. **Light: 47 unique lines** across 11 screens, nearly all `t3` and `t2` on cards, the light success green, and the orange accent word. |
| Tap targets under 44×44 | Every signed-in screen has some. The worst: group badges (46×14), "Plan the weekend / night / this trip →" links on idea cards (216×29), "Not for me" ✕ on ideas (20×44), "Edit" / "Edit plan" pills (50×29, 78×29), the venue phone link (138×37), the bell (31×44), and Clerk's sign-in fields (30 px tall). |
| Looks tappable, isn't (or the reverse) | Home's idea cards and "See all →" have a pointer cursor but cannot be reached by keyboard. The checkout back arrow "←" is the same. Landing chips: the reverse of a control (F7). **Privacy toggles** report as buttons with no on/off state, and the off track is invisible (edge 1.24:1 dark, 1.14:1 light). |
| Accessible names | No unnamed controls found on any captured screen. |
| Heading order | **The app screens have no headings at all.** Home, Groups, group, trip creation, plan, budget, checkout, Profile and Privacy each report zero `h1`–`h6`. Titles are styled `div`s. Discover, 404, offline, onboarding and the auth pages have an `h1`. The landing page skips from `h1` to `h3`, and "How it works" is a `<p>`. |
| Focus ring | **Present on keyboard focus** on every app screen. Dark: 2 px gold, 7.30:1 on background. Light: 2 px green, 7.06:1. Sign-in and sign-up use Clerk's ring (orange in light). The offline page uses the browser default. |
| 200% text | No sideways scrolling on any screen. Text is clipped (ellipsis or fixed boxes) on Groups (12 places), plan overview (4), trip creation (4) and Home (1–2). Much of the app's type is fixed `px` in inline styles, so the reader's text size changes less than it should. |
| Reduced motion | **Respected.** A global `@media (prefers-reduced-motion: reduce)` turns every animation and transition to 0.01 ms, and the shimmer, pin-drop and Discover press have their own rules. There is no confetti: the booking celebration is a pin drop. |
| Status by colour alone | Privacy toggles (above). The checkout progress dots carry words ("Plan · Lock in · Pay · Booked"). Home's "Waiting on you" card has an orange dot plus words. Status pills ("Paying", "Ready to book") are words. |
| Automated checker | **None present** (no axe in `package.json`). **Asking:** may I add `@axe-core/playwright` as a dev-only dependency for Task 6? It never ships to the app. |

### What this changes in the plan

- The token work is in `PALETTE`, `lib/brand.ts`, the landing page's `.lp` block and the Clerk theme. The
  landing and Clerk palettes should read from the same values rather than copies.
- **Email** colours need a token map of their own (`lib/brand.ts`), because email HTML cannot read CSS variables.
- **Light theme accent rules, as proposed, would change the brand.** Light text and links are green, not
  orange or gold. The proposal (Task 1) keeps green as the light link colour and moves only orange-as-text.
- **Headings** are the largest structural gap: every app screen needs real headings (Task 4).

---

## Pilot gate — REACH-PILOT-GATE-2026-11-08.md

Maintained by the coordinator. Updated 2026-11-08.

### Definition of ready (all eight must be true) — readiness report 2026-11-08

| # | Item | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Owner blockers cleared | **false** | 2026-11-22: Stripe access to Reach's key account resolved (it is "Alcanzar Group sandbox", `acct_1U4lDQ5GB2FVY7o6`). Left: set `SENTRY_DSN` (project `reach` created in Sentry org `alcanzar-group`); Stripe live business verification |
| 2 | Custody question answered by counsel | **false** | B2 counsel session pending (also gates P4 single-payer) |
| 3 | Payment rail fixed (ACH default, native-only funding) | **true** (pending the first delivered event) | 2026-11-22 on Reach's Stripe account: webhook `we_1U71Zj…` now subscribes to all 13 events the handler reads (was 3); ACH Direct Debit enabled (was **disabled**, so bank-first could not have worked); Klarna and Affirm disabled (were **enabled**); every pay-later method off. No delivery seen yet: the endpoint shows none in the last week, so the first test contribution proves it |
| 4 | Zero S1 UX items | **true** (pending a production check of F19-02) | All 3 S1 fixed in Wave 1: F19-03 f6be78d, F08-01 b11809a, F19-02 6a438e6. 39 S2 · 55 S3 remain (`UX-LEDGER.md`) |
| 5 | Monitoring and payments kill switch live | **false** | Kill switch live (`PAYMENTS_ENABLED`); health alert live (manual dry run passed 2026-11-22, scheduled runs green); Sentry project `reach` created 2026-11-22 — `SENTRY_DSN` not yet set in Vercel (owner) |
| 6 | Ten groups recruited | **false** | Owner (B4) |
| 7 | Debrief script written | **true** | `docs/pilot/DEBRIEF-SCRIPT.md` (owner approval pending); debrief form live |
| 8 | Four readouts pre-registered | **false** | `docs/pilot/READOUTS.md` drafted; owner approval + pilot group ids needed |

### Environment
- Stripe: **test** (`/api/health/modes`, 2026-11-08: stripe/stripePublishable/duffel/liteapi all `test`,
  webhook secret set). `/api/health/stripe` is CRON_SECRET-gated; the coordinator does not hold it.
- **Stripe account mismatch:** Reach's test keys belong to account `acct_1U4lDQ5GB2FVY7o…` (pk prefix),
  which is NOT in the dashboard the owner is signed into. That dashboard holds "Alcanzar Group, Inc."
  (sandbox `acct_1UYUj14MaTB8EmsW`: ACH Direct Debit enabled 2026-11-08, no webhook endpoint, live mode
  needs business verification) and "New business" (`acct_1UYUbt5lpbXMYs3C`). Going live means keys and the
  webhook endpoint from the Alcanzar Group account.
- **Owner decision 2026-11-08: no buy-now-pay-later.** Klarna and Affirm disabled in the Alcanzar Group
  sandbox (Afterpay/Clearpay, Scalapay already off). In code, the Rail track makes every contribution
  name its methods (bank, card) — no `automatic_payment_methods`, so the account default can never
  surface BNPL; on Reach's current key account (`acct_1U4lDQ5GB2FVY7o…`, not in the owner's dashboard)
  only the code guard applies.
- Backups: daily physical backups on (latest 2026-11-08 09:13 UTC, 7 retained). **PITR off** (paid add-on).
- Supabase Security Advisor 2026-11-08: was 2 errors, both `public.group_invites` (RLS disabled; sensitive
  columns exposed — the anon key read every invite's email and join token). Fixed by
  `sql/group-invites-rls-2026-11-08.sql`; re-run shows **0 errors, 0 warnings**, 50 info suggestions.

### Migrations (A2), in order
| File | Live state (2026-11-08) |
|---|---|
| `sql/discovery-sources-2026-09-17.sql` | already applied (its column, constraint, both indexes present; the gate's `discovery_sources` table check names a table this file never creates). Not re-run: it also deletes duplicate venues |
| `sql/2026-09-18-feedback.sql` | **file not in repo**; `plans.solo_mode` present, `plan_preferences.suggestion_text` missing and unused by code |
| `sql/preferences-v1.sql` | applied (`availability_windows`, `item_optouts` present) |
| `sql/reservation-platform-2026-09-20.sql` | applied (`discovery_venues.reservation_platform` present) |
| `sql/knowledge-layer-2026-09-20.sql` | **file not in repo**; equivalent `sql/knowledge-playbooks-2026-09-21.sql` applied |
| `sql/pilot-1-contribution-method-2026-11-08.sql` | superseded by pilot-gate (column now exists) |
| `sql/pilot-gate-2026-11-08.sql` | **applied 2026-11-08** by the coordinator via the SQL Editor after a rollback dry run; verified through PostgREST (new columns readable, `plan_deletions` present) |
| `sql/group-invites-rls-2026-11-08.sql` | **applied 2026-11-08** (owner-authorized): anon read now 401/42501, service read 200, `/api/invites/<token>` 200; Security Advisor 0 errors |
| `sql/rail-expense-booking-2026-11-08.sql` | **applied 2026-11-08** (dry run clean); `expenses.booking_id` readable |
| `sql/pilot-metrics-2026-11-08.sql` | **applied 2026-11-08** after the dry run caught a text=uuid join (fixed in 04e8665); `pilot_metrics` returns 19 rows |
| `sql/pilot-debrief-2026-11-08.sql` | **applied 2026-11-08** (dry run clean); `pilot_debriefs` RLS on, no policies |

### Out of scope until the pilot has run
Reservation agent (design doc stays parked at `docs/RESERVATION-AGENT-DESIGN.md`), savings
bank partnership, Spotify, App Store wrapper, Europe, revenue layers R1–R4.

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
  confirmed — both load every run since 2026-10-24 (≈10.8k and 11.4k kept),
  all 105 regions ok.
- **Email works again (2026-11-05):** Resend's DKIM + send/rsend records added in Squarespace DNS for alcanzar.io, EMAIL_FROM changed from a reach.app address (unverified) to `Reach <hello@alcanzar.io>`, and a test itinerary email was accepted (`sent: 1`).
- **Checkout spec (REACH-CHECKOUT-NEXT-STEP-2026-09-25): Stages 1–6 merged and
  live by 2026-10-28** (main `552beae`, 1920 unit tests) — the 5-dot rail and
  getNextAction everywhere, one active trip, the booked "Your trip" view, the
  once-only celebration, Your map, the wallet, pings, the taste profile
  (never shown), away trips with flight + stay or the road, Change on every
  line, faces, "How was it?", settle-up, per-trip mutes, and the polish pass.
  Every builder was reviewed adversarially and its findings fixed before merge.
- **Not yet seen on a signed-in screen.** Task 12's end-to-end walk needs a
  `+qa` test account (`TEST_EMAIL`); until then the new screens are covered by
  unit and source-text tests only.
- **Owner, to switch things on:** GitHub secrets `CRON_SECRET` and `APP_URL`
  (pings); Vercel `REACH_OPS_SECRET` (ops taste read); optional
  `NEXT_PUBLIC_CARTO_KEY` (dark map tiles) and `AEROAPI_KEY` (gate/delay).
- **Known open:** server routes ignore the Undo `Idempotency-Key` (the changes
  are repeat-safe anyway); no way back once the last flyer drops a flight;
  the nearby-dates button on the plan is not built.

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
