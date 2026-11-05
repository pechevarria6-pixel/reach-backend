# BETA GATE — 2026-09-22, owner rows re-checked 2026-10-23

The final checklist from REACH-FINISH-LINE. Agent checks the code rows, owner
checks his. Nothing here is marked done because a previous document said so:
every ✅ below names the file, the command or the production response that
proves it, and where something is short of the bar this file says how short.

Legend: ✅ done, with evidence · 🟡 partial, scope stated · ❌ not done · 🔒 owner

---

## CODE (agent)

| row | state | evidence |
|---|---|---|
| suite green (all e2e + unit) | ✅ | 2026-11-05, at 0078ae9: unit **2443 pass / 0 fail** under `npm run verify`; e2e **91 pass, 0 fail, 1 flaky** (Discover's card test, passed on retry) in 4.6 min against production as the two QA accounts. Earlier the same day: 89 pass, 1 fail, 2 flaky — Discover's filter pills were waited for 12 s after the redesign made them arrive with the finds. 2026-10-23: unit **1606 pass / 0 fail**. 2026-09-22: **unit 531 pass / 0 fail** under `npm run verify`, and **e2e 81 pass / 0 fail** in 4.1 min — `npx playwright test`, run against production today across chromium and iPhone 14. The e2e specs still sit outside the build gate on purpose: they need a live deployment and a session, so a build cannot be the thing that runs them |
| build gate proven | ✅ | `build: npm run verify && next build`. Proven once by planting a failing test: `exit=1` and `next build` never ran. 🔒 depends on the owner confirming Vercel's Build Command is `npm run build` |
| contract tests ≥ 4 surfaces | ✅ | `lib/contracts/itinerary-item.ts` (API · mapper · client · PUT) and `lib/contracts/booking.ts` (route · duplicate path · checkout screen), each with a round-trip test proven by reverting a field |
| money path e2e in test mode | 🟡 | 2026-11-05: `GET /api/health/modes` reports Stripe, Duffel and LiteAPI keys all **test**. The QA demo plan (b21bae42, Charleston, Dec 4–6) is generated, locked in and priced at checkout — Duffel Airways ZZ5009 $54.86, The Vendue (Charleston, SC) $914.38 plus $176.17 paid at the hotel, total $969.24 — and stops at Pay for the owner to enter the Stripe test card; nothing has been paid or booked. Viator answers 403 "Endpoint access denied" (the account's tier cannot check or book) and hands off to the tour's own page. Earlier: Stripe confirmed **test mode** — `/api/config/stripe` serves `pk_test_51U4lDQ…`, checked immediately before touching anything. Walked as far as it goes today: a QA plan was created against production and `POST /api/plans/<id>/funding` **correctly refused** it — `{"error":"We're still pricing this — check back soon.","funding":{"targetCents":0,…}}`. That is the w5 **$0-checkout guard**, live and right: nothing priced means nothing to charge. Going further needs priced bookings, which means quoting against Duffel and the other live providers on the owner's real account, so it stops here. No contribution row was created; the table is unchanged at 6 |
| grounding tests green | ✅ | `tests/unit/grounding.test.ts` — an empty town names nothing, an invented venue is removed, a verified one is left alone, and the instruction is checked for not being softened into a suggestion |
| zero console errors on all screens | ✅ | all six addressable screens swept and clean — `/home`, `/onboarding`, `/sign-in`, `/sign-up`, `/terms`, `/privacy` — for console errors, uncaught exceptions and 404s. The rest of the app is `push()` inside `/home`, so those six are every URL there is. The old single test was named "home page load" and loaded `/sign-in`, so home had never once been checked |
| copy sweep clean | ✅ | `check:vocabulary`, `check:promises`, `check:spelling` all green; `BROKEN_PROMISES` bans the five false-promise strings that shipped on 09-21 |
| nav graph complete | ✅ | `NAV-GRAPH.md` |
| Sentry live | 🔒 | `lib/report.ts` posts to the ingest endpoint and no-ops without a DSN. Deliberately not `@sentry/nextjs`: that package wraps the build, and the build broke twice on 09-21. Inert until the owner sets `SENTRY_DSN` |
| events / metrics flowing | ✅ | **proven in production today, both ways.** `plan_created` had no call site at all; a plan created against prod now writes `{city, kind, solo, nights, voting, country, budget_cents}`. `plan_deleted` was structurally impossible (FK `23503`) and now writes `{plan, cancelled_quotes}` after a real delete. All four QA event rows swept; the table is back to its 5 genuine rows and no `QA-` plan remains |
| rate limits on | ✅ | 10 new trips/hour, 30 rebuilds/hour, separate counters, human copy on 429 |
| one-active-trip on | ✅ | owner chose (a) on 09-25: one active trip and one active night out per group, solo groups exempt. Every create path asks first and handles the 409 (`tests/unit/one-active.test.ts`); `sql/one-active-plan-2026-09-25.sql` run 2026-10-23 |

## OWNER (Peter)

| row | state |
|---|---|
| migrations run | ✅ every file in `sql/` through 2026-09-25, except the two held on purpose (STATUS.md, Now) |
| RESEND key live (send a test email) | ✅ 2026-11-05 — alcanzar.io verified in Resend (DNS in Squarespace), sender `hello@alcanzar.io`, test email sent |
| APP_URL fixed | 🟡 `NEXT_PUBLIC_APP_URL` is set in Vercel; its value is not readable from here |
| Supabase service key + Clerk secret rotated | 🔒 |
| STRIPE_WEBHOOK_SECRET set | 🟡 set in Vercel (89 days old); whether it matches the live endpoint's secret is not provable from here |
| SENTRY_DSN set | 🔒 |
| BNPL methods enabled | 🔒 |
| Duffel orders confirmed test | ✅ MHW2Y3 cancelled and refunded (owner, 2026-09-24); SFYVFK was Duffel's test carrier; both indexes run |
| second test account created | ✅ 2026-11-05 — `TEST_EMAIL=pechevarria6+qa@gmail.com` and `TEST_EMAIL_2=pechevarria6+qa2@gmail.com`; e2e and the two-person walks act only on QA groups |
| flying details filled | 🔒 left empty on purpose; never stubbed |
| backups / PITR confirmed | 🔒 |

## LAUNCH TOGGLES (owner, last, in order)

1. Google OAuth consent → production
2. Privacy Policy + ToS live — *custody language is with a fintech lawyer and
   still open. Beta can run on test-mode Stripe with friends without it; live
   money cannot.*
3. Device Trust → ON, then recapture E2E auth via `@clerk/testing`
4. Stripe → live keys. **Last.** After this, payment flows are never exercised
   again — the account is unverified, so a live charge fails anyway.

---

## What is not proven, stated plainly

The hand-walked half now exists. On 2026-11-05 two QA accounts walked ten
two-person scenarios on production (group trip, go-ahead, votes, a set place
sent to a vote, the one-active rule, the itinerary, money up to paying,
nudges, leaving and rejoining, solo), then re-walked every fix: 14 of 15
passed the first re-walk, and the fifteenth and eight smaller defects were
fixed in 07dc497 and 1658bea. Still not proven:

- **Paying and booking.** Nobody has yet paid a share and pressed book on
  production. The QA demo plan is priced and stops at Pay for the owner.
- **A restaurant call.** Built, gated off (`RESERVATION_CALLS_MODE` unset);
  the test-number call needs Retell and Twilio accounts.
- **Tours.** Viator's tier refuses availability and booking (403), so a tour
  is a hand-off to its Viator page until the account has booking access.
- **Scheduled jobs.** GitHub runs the hourly pings 3–6 times a day and never
  ran the 15-minute watches schedule; the watches now ride on the pings job.
  Vercel Pro would make both reliable.

One standing caveat, which is not a gap but is easy to misread:

- The e2e suite is not inside `npm run verify` and cannot be: it needs a live
  deployment and a signed-in session, so a build is the wrong thing to run it
  from. It was run by hand today and passed 81/81. A green build still does
  not by itself mean the e2e specs passed — run `npx playwright test` before
  a release and read the number.

The walked run is a single owner action away — a `+qa` account — and it is not
a code gap.

## The thing this campaign was actually about

Seven bugs in one day had one shape: **a fact the app already held that stopped
one layer short of the person reading the screen.** The plan type, the city,
the listing venue, the ticket URL, the act's name, the venue's website, what is
on there. Each was generated correctly, stored correctly and returned
correctly, and each passed a green build, a 200 response and a correct database
row before failing at the only place that counts.

That class is now closed structurally rather than case by case: two contracts,
four layers importing them, round-trip tests proven by reverting a field, and a
build gate that will not deploy over a red suite.

Three more of the same shape surfaced *while* closing it, which is the honest
argument for the approach:

- the checkout mapper would have printed "Trip item (details coming)" over
  every line on the pay screen, because the first draft of `BookingFacts` left
  out the one field `itemTitle` reads;
- `/api/bookings` handed a duplicate back without the venue's phone number,
  because the duplicate check read eleven named columns and `response_payload`
  was not among them;
- `plan_deleted` had never once been recorded, because the row it names has to
  be deleted before the event is true and the foreign key refused it.

None of the three would have been found by a passing test. All three were found
by reading a route, reverting a field, and probing the database — which is what
`CLAUDE.md` tells the next person to do first.
