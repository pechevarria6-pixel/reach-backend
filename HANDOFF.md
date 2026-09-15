# Reach — handoff packet

Written 2026-09-15, after commit `dcd8e5e`. Intended to be read by a fresh
Claude Code session with no prior context, to decide what is required for
full completion and operational deployment.

Every claim below is labelled:

- **VERIFIED** — observed this session, with how, so you can repeat it.
- **UNVERIFIED** — believed, not observed. Check before relying on it.
- **HUMAN** — needs the owner: a dashboard, a password, a real card, or a decision.

Re-verify anything VERIFIED before acting on it if more than a day has passed.

---

## 0. Ground rules — read before touching anything

1. **Reach is the owner's primary venture** (https://www.alcanzar.io). They are
   not an engineer and will ship what you say works. Say plainly what was
   verified and how. "Type checks and unit tests pass" is not "works".
2. **Stripe is in live mode.** The site serves `pk_live_`. Never exercise a
   checkout, funding or payment flow to test anything. Real cards, real money.
3. **`npm run doctor` only reads local `.env.local`**, which holds placeholders
   (the local `SUPABASE_SERVICE_ROLE_KEY` is not real). A red doctor says
   nothing about production. Probe the deployment instead (section 6).
4. **The end-to-end suite points at production by default.**
   `tests/reach.spec.ts` uses `TEST_URL || 'https://www.alcanzar.io'`. Do not
   run `npm run test:e2e` without reading what each test creates, and never
   with checkout steps enabled.
5. **Product principles** the owner has stated:
   - Reach books everything it can. Where it cannot, it says so, along with
     "cash only", "which cards", "reservation needed".
   - Reach is a night-out-with-friends app as much as a trips app.
     Recommendations should draw on the quiz *and* on who you have been out
     with.
6. **Pushing `main` deploys production** (Vercel Git integration). Get the
   owner's go-ahead for anything user-visible.
7. **Shell is zsh.**
   - Unquoted `$var` does not word-split; use `while read`.
   - `status` is a read-only variable.
   - Foreground `sleep` is blocked in this harness.

### Repo conventions

- Next.js 14.2 App Router. Clerk auth, Supabase (service-role key server-side,
  authorisation in `lib/auth.ts`), Stripe, Anthropic SDK.
- **Almost the whole client is one file:** `components/reach-app.jsx`
  (about 6,300 lines).
- **Checks:**
  - `npx tsc --noEmit`
  - `npm run test:unit` (Node's own runner, *not* vitest; vitest reports "no test suite")
  - `npx next build`
- **Comments explain why, in plain prose.** Commit messages are narrative:
  what was wrong, what was measured, what changed. Match both.
- **SQL migrations** are run by hand in the Supabase SQL editor. Every file is
  written to be safe to run twice.

---

## 1. Project facts

| | |
|---|---|
| Live domain | https://www.alcanzar.io |
| Vercel | team `reach8`, project `reach-backend` |
| GitHub | `pechevarria6-pixel/reach-backend`, branch `main` |
| Supabase | project ref `ikdmlvdimdyjazffqlrf` |
| Crons (`vercel.json`) | `/api/discovery/sweep` at 04:00 UTC, `/api/discovery/harvest` at 04:30 UTC |
| AI models in code | `claude-haiku-4-5` (recommendations, harvest), `claude-sonnet-4-6` / `claude-sonnet-5` / `claude-haiku-4-5` (trip generation) |

---

## 2. State at handoff

### Code and deploy — VERIFIED

- **Production runs `dcd8e5e`.** Checked with
  `npx vercel ls --meta githubCommitSha=$(git rev-parse HEAD)`: Ready,
  Production.
- **Local checks pass at `dcd8e5e`:**
  - `tsc` exits 0;
  - unit tests 100/100;
  - `next build` succeeds.
- **Working tree clean** apart from this file.

### Database — VERIFIED

Checked by querying Supabase's REST API with the anon key: HTTP 404 `PGRST205`
means a missing table, 400 means a missing column.

- **All 20 tables** referenced by `.from('…')` in `app/` and `lib/` exist.
- **All 29 columns** added by `ALTER TABLE … ADD COLUMN` across `sql/*.sql` and
  `supabase/*.sql` exist.
- **No migration is outstanding.**

### Production configuration

- **VERIFIED:** every expected variable exists in Production (names only;
  values unreadable):
  - AEROAPI_KEY, ANTHROPIC_API_KEY, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET, CRON_SECRET
  - DUFFEL_API_KEY, EMAIL_FROM, ENCRYPTION_KEY, EVENTBRITE_TOKEN, LITEAPI_KEY
  - NEXT_PUBLIC_APP_URL and the NEXT_PUBLIC_CLERK_* values
  - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
  - POSTMARK_SERVER_TOKEN, RESEND_API_KEY
  - STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  - SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
  - TICKETMASTER_API_KEY, VIATOR_API_KEY, YELP_API_KEY
- **VERIFIED:** `POST /api/webhooks/clerk` unsigned → 400 "Missing signature
  headers". The signing secret is real, not a placeholder.
- **VERIFIED:** `POST /api/webhooks/stripe` unsigned → 400 "No signature".
  Its *mode* (live or test) is **UNVERIFIED**; see P0-2.
- **VERIFIED:** `GET /api/config/stripe` serves `pk_live_…`.

### Discovery engine (Discover screen) — built and fixed this session

**How it works:**
- The nightly sweep searches OpenStreetMap (Overpass) for kinds of place near
  areas people have opened Discover from, and writes `discovery_venues`.
- The harvest reads those venues' own websites with Claude Haiku for
  classes and events, and writes `discovery_events`.
- `/api/nearby` reads both, plus Ticketmaster and Yelp, and ranks them.

**Shipped this session:**

- **`c96cb0a`** — the sweep discarded every venue it found (ID pattern
  mismatch), and Yelp refused every search (radius over its 40,000 m maximum).
- **`e46dd7b`** — Overpass was given a 15 s server timeout and answered 504 on
  denser areas. It now uses the caller's budget (25 s for the sweep).
- **`dcd8e5e`:**
  - Discover reads the *whole* quiz: cuisines, drinks, night-out style and
    music, not just activities.
  - A new user with no answers gets an everyday mix. It is never labelled
    "Because you like", and the UI shows a gentle invitation to take the quiz.
  - Six new quiz chips.
  - Hard nos remove whole kinds ("Not drinking" removes bars; "Clubs" removes
    nightclubs).
  - Each kind has its own cap in the Overpass query.
  - The sweep searches 4 kinds per request and has a 240 s deadline.
  - Restaurants, pubs and bars get `harvest_status='skip'`, so the harvest
    never reads menus.
  - The single source of truth is `lib/discovery/taste.ts`.

**VERIFIED against the live map (Aberdeen, NJ):**
- The new-user mix found 26 places with websites across 5 kinds.
- A Japanese + Italian + cocktails + pub profile found 10 pubs, 2 bars,
  7 Japanese and 8 Italian restaurants.

**VERIFIED in production logs:**
- After `c96cb0a`, a manual sweep stored 4 venues for the owner's area
  ("Aberdeen").
- The harvest read all 4 and got 0 events: 2 `needs_render` (sites that build
  their text in the browser), 2 `nothing_found`.
- An empty `discovery_events` is therefore an honest result for that area,
  not a bug.

**VERIFIED:** the harvest's new PostgREST filter
`or(and(last_harvested_at.is.null,harvest_status.is.null),and(last_harvested_at.lt.<ts>,harvest_status.neq.skip))`
and the venue and event lookups are accepted by the real Supabase (HTTP 200),
while a deliberately malformed filter returns 400.

**UNVERIFIED:** `dcd8e5e` has not been seen working in a browser, and no
sweep has run since it deployed. See P0-3.

---

## 3. P0 — blockers to operational deployment, in order

### P0-1. Payments cannot be taken: `STRIPE_SECRET_KEY` is a key ID, not a key

- **VERIFIED evidence:** production log, 2026-09-15 12:11:33, on
  `POST /api/plans/1c067a4a-…/funding`:
  `[funding] STRIPE_SECRET_KEY is missing or is not a secret key { present: true, prefix: 'mk_' }`
- **VERIFIED:** `npx vercel env ls` shows `STRIPE_SECRET_KEY` created
  51 days ago and never replaced.
- **Already known:** the guard in `app/api/plans/[planId]/funding/route.ts`
  (around line 71) records it as `mk_1U4lD…`, "the identifier of a key rather
  than the key". A previous session added the guard; the value was never fixed.
- **Effect:** every contribution attempt is refused, so no plan can be funded
  and nothing downstream of funding can be booked.

**HUMAN fix:**
1. Stripe dashboard in **Live** mode → Developers → API keys.
2. Reveal the **Secret key** (`sk_live_…`), not its ID. A restricted `rk_live_…`
   also passes the guard.
3. Vercel → reach-backend → Settings → Environment Variables →
   `STRIPE_SECRET_KEY` → edit Production (and Preview) → paste → Save.
4. Deployments → ⋯ on the current Production deploy → Redeploy.

**Safe verification, without moving money:**
- There is currently no non-money probe for the secret key. Recommended code
  task (needs owner approval to ship): extend `GET /api/config/stripe` to also
  report the *shape* of the secret key: `"live" | "test" | "restricted" |
  "invalid"`, derived from the prefix only. **Never return the key.**
- After redeploying, the probe should say `live`.
- Until that exists, the only evidence is the absence of the `[funding]` error
  on the owner's own next checkout attempt, which is a money path. Leave that
  to the owner.

### P0-2. Stripe webhook may be a test-mode secret paired with live keys

- **UNVERIFIED, high risk:** `STRIPE_WEBHOOK_SECRET` is also 51 days old,
  older than the switch to live keys.
- **Failure if wrong:** Stripe rejects the live event's signature, the card is
  still charged, and the contribution row never flips to `succeeded`, so the
  booking silently stalls.
- **HUMAN check:** Stripe dashboard in **Live** mode → Developers → Webhooks.
  1. Confirm an endpoint exists for `https://www.alcanzar.io/api/webhooks/stripe`.
  2. Confirm its signing secret is the value in Vercel's
     `STRIPE_WEBHOOK_SECRET`.
  3. If there is no live-mode endpoint, create one with the same events as
     the test one, put its secret in Vercel, and redeploy.
- **HUMAN only, after P0-1 and P0-2:** follow `GETTING-LIVE.md` "Step 10 —
  Real money", items 4–5.
  1. The owner makes one small contribution with their own card.
  2. Confirm the row reaches `succeeded` in Supabase.
  3. Refund it and confirm the row updates.
- An agent must not do this.

### P0-3. Confirm the new Discover in production

1. **HUMAN, Supabase SQL editor:**
   `update discovery_areas set last_swept_at = null, sweep_status = null, sweep_detail = null;`
   (Existing areas were stamped fresh before the new kinds existed.)
2. **HUMAN:** Vercel → Settings → Cron Jobs → **Run** `/api/discovery/sweep`,
   then **Run** `/api/discovery/harvest`.
3. **Agent check:**
   `npx vercel logs --environment production --since 30m --query "/api/discovery" --expand`
   - The sweep report should list `kinds` and `found` per area, with status
     `ok` or `partial`.
   - The harvest report should tally statuses. `skip` venues must not appear
     in `read`.
4. **HUMAN:** open Discover signed in, then signed in as a user with no quiz
   answers.
   - The new user should see a mix (markets, live music, museums, galleries,
     comedy, cooking), none labelled "Because you like", plus the invitation
     line.
   - **Agent:** check the same visit's `/api/nearby` logs for errors.

---

## 4. P1 — operational hardening

### Yelp events is blocked

**VERIFIED** in production logs:
`[discover/yelp-events] returned 403 NOT_IN_DEVELOPER_BETA`. This fires on
every Discover load since the radius fix; Yelp place search logs no errors.

- **HUMAN:** Yelp Fusion → Manage App → join the developer beta.
- **Or, as code:** treat a 403 `NOT_IN_DEVELOPER_BETA` as unavailable, logged
  once, not an error per request.

### Overpass mirrors are dead

**VERIFIED** today: `overpass.kumi.systems` and `overpass.private.coffee`
timed out on every attempt, and their `/api/status` returned nothing.
`overpass-api.de` works: rate limit 2 slots, and it returns 429 after heavy
use from one IP.

- **Cost:** each failed sweep batch can spend about 50 s on dead mirrors.
- **Options:** replace the mirrors with current public instances (verify each
  first), or give mirrors 2–3 an 8–10 s budget.
- Code: `OVERPASS_MIRRORS` in `lib/discovery/osm.ts`.

### Harvest yield is low (decision for the owner)

- Half of the first venues were `needs_render`: sites that build their text in
  the browser, such as Wix.
- **Option:** headless rendering in the harvest. It's slower and costs more
  per venue.
- Measure the `needs_render` share over a few nights of real sweeps before
  deciding.

### Errors are invisible

- Failures log to Vercel only.
- No alerting, no error tracking, no log drain.
- The owner learns of breakage from users.

### Stale and contradictory documentation

**`GETTING-LIVE.md`** (last edited 09-12) says:
- "Eleven commits, not yet pushed";
- "No money has ever moved";
- Stripe test mode throughout;
- "People are never told anything".

All four are out of date. Email notification routes exist; see section 5.

**`DEPLOY.md` §1 (SQL order)** omits:
- `sql/catch-up-2026-09-11.sql`
- `sql/home-airport-2026-09-12.sql`
- `sql/itinerary-practicals-2026-09-14.sql`
- `sql/discovery-engine-2026-09-15.sql`
- `supabase/add_preferences.sql` and `supabase/add_preferences_v2.sql`

**`SETUP.md`**'s security checklist is unticked and partly obsolete.

**Recommended:** merge them into one current runbook, driven by the probes in
section 6.

### Other

- **Eventbrite:** `EVENTBRITE_TOKEN` is set, but its event search endpoint was
  withdrawn (returns 404; see commit `22bf398`). Remove the variable, or leave
  it documented as unused.
- **Local verification gap:** `.env.local` has placeholder secrets, so no API
  route has been run against the real database from the laptop. Only pure
  logic is unit tested.

---

## 5. P2 — product completeness

From `GETTING-LIVE.md` "What still will not work", updated with this session's
findings.

### Notifications exist but are unproven

- `POST /api/plans/[planId]/notify` (vote and funding reminders) and
  `POST /api/plans/[planId]/itinerary/email` send via `lib/email.ts`.
  `RESEND_API_KEY` and `POSTMARK_SERVER_TOKEN` are set, and the app calls both
  routes.
- **UNVERIFIED:** that an email is actually delivered.
- **Missing:** notifications that fire without someone pressing a button, such
  as a booking confirmed or a vote closing.

### Calendar invites

- The owner describes Reach as sending calendar updates and invites.
- **VERIFIED absent:** no `.ics`, `text/calendar` or calendar code in `app/`,
  `lib/` or `components/`.

### Recommendations from people you've been out with

- The owner's stated requirement: recommend from the quiz *plus* who you have
  travelled or gone out with. **Not built.** Discover reads only the viewer's
  own quiz.
- **Building blocks:**
  - `group_members` and `plans` (`status` includes `booked` / `completed`)
    give who someone has done things with;
  - `GET /api/groups/[id]/quiz-status` already reads members' preferences;
  - `tasteFrom()` in `lib/discovery/taste.ts` turns any profile into kinds of
    place, so a group's shared kinds can be derived by combining members'
    `tasteFrom` results.

### Bookings

- **Restaurant bookings** land as `pending` and are confirmed by a manual API
  call. There is no admin screen.
- **Flights, hotels and activities** (Duffel, LiteAPI, Viator keys set) have
  never made a live booking request; partner approvals are needed.
- **Refunds and reconciliation** against Stripe are manual.

### Known dead or duplicate code

From `DEPLOY.md` "Known gaps":
- `CheckoutScreen` is unreachable (only `CheckoutScreenV2` is routed).
- `/api/payments` is unused by the app.
- RLS is enabled with no policies, which is intentional: the server uses the
  service-role key.

---

## 6. How to verify production without touching money

All read-only. Run from the repo root.

```sh
# Which commit is live
npx vercel ls --meta githubCommitSha=$(git rev-parse HEAD)

# Variables that exist (values are never shown)
npx vercel env ls production

# Webhook secrets are real (expect 400, not 500)
curl -s -X POST https://www.alcanzar.io/api/webhooks/clerk
curl -s -X POST -H 'Content-Type: application/json' --data '{}' https://www.alcanzar.io/api/webhooks/stripe

# Publishable key mode
curl -s https://www.alcanzar.io/api/config/stripe

# Production errors, last few hours
npx vercel logs --environment production --since 6h --level error -n 60

# One route's logs, with messages
npx vercel logs --environment production --since 1h --query "/api/nearby" --expand
```

**Tables and columns.** Anon-key REST calls; RLS returns `[]`, never data:

```sh
set -a; source .env.local; set +a
curl -s -o /dev/null -w "%{http_code}\n" \
  "$SUPABASE_URL/rest/v1/<table>?select=<column>&limit=0" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
# 200 = exists, 404 = table missing, 400 = column missing
```

**Do not:**
- run checkout or funding;
- run `npm run test:e2e` against production without review;
- pull production env to disk (the permission layer blocks it, and it
  materialises secrets);
- query Overpass in tight loops (you will be rate-limited, 429).

---

## 7. Suggested order for the next session

1. **P0-1 and P0-2** with the owner: Stripe secret key and live webhook.
   Nothing that costs money works until both are done.
2. **With owner approval:** ship the non-money key-shape probe, then confirm
   it reads `live`.
3. **P0-3:** reset areas, run the jobs, and confirm Discover in the browser
   and the logs.
4. **Owner-led:** the one real contribution and refund
   (GETTING-LIVE step 10.4–10.5).
5. **P1:**
   - Yelp events 403 handling, or the beta;
   - Overpass mirrors;
   - error alerting;
   - one merged, current runbook.
6. **P2, ranked by the owner's priorities:**
   - recommendations from co-travellers;
   - calendar invites;
   - confirm email delivery;
   - automatic notifications;
   - booking admin.
