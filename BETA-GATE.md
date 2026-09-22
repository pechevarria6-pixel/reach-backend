# BETA GATE — 2026-09-22

The final checklist from REACH-FINISH-LINE. Agent checks the code rows, owner
checks his. Nothing here is marked done because a previous document said so:
every ✅ below names the file, the command or the production response that
proves it, and where something is short of the bar this file says how short.

Legend: ✅ done, with evidence · 🟡 partial, scope stated · ❌ not done · 🔒 owner

---

## CODE (agent)

| row | state | evidence |
|---|---|---|
| suite green (all e2e + unit) | 🟡 | **unit: 531 pass, 0 fail** under `npm run verify`. The 38 e2e specs in `tests/reach.spec.ts` are not part of that gate and were last run by hand — see *What is not proven* |
| build gate proven | ✅ | `build: npm run verify && next build`. Proven once by planting a failing test: `exit=1` and `next build` never ran. 🔒 depends on the owner confirming Vercel's Build Command is `npm run build` |
| contract tests ≥ 4 surfaces | ✅ | `lib/contracts/itinerary-item.ts` (API · mapper · client · PUT) and `lib/contracts/booking.ts` (route · duplicate path · checkout screen), each with a round-trip test proven by reverting a field |
| money path e2e in test mode | 🟡 | Stripe confirmed **test mode** by the `pk_test_` prefix on `/api/config/stripe`. The path is built and read end to end in code; it has not been walked with a test card this session |
| grounding tests green | ✅ | `tests/unit/grounding.test.ts` — an empty town names nothing, an invented venue is removed, a verified one is left alone, and the instruction is checked for not being softened into a suggestion |
| zero console errors on all screens | ❌ | not swept this session |
| copy sweep clean | ✅ | `check:vocabulary`, `check:promises`, `check:spelling` all green; `BROKEN_PROMISES` bans the five false-promise strings that shipped on 09-21 |
| nav graph complete | ✅ | `NAV-GRAPH.md` |
| Sentry live | 🔒 | `lib/report.ts` posts to the ingest endpoint and no-ops without a DSN. Deliberately not `@sentry/nextjs`: that package wraps the build, and the build broke twice on 09-21. Inert until the owner sets `SENTRY_DSN` |
| events / metrics flowing | ✅ | **proven in production today, both ways.** `plan_created` had no call site at all; a plan created against prod now writes `{city, kind, solo, nights, voting, country, budget_cents}`. `plan_deleted` was structurally impossible (FK `23503`) and now writes `{plan, cancelled_quotes}` after a real delete. All four QA event rows swept; the table is back to its 5 genuine rows and no `QA-` plan remains |
| rate limits on | ✅ | 10 new trips/hour, 30 rebuilds/hour, separate counters, human copy on 429 |
| one-active-trip on | 🔒 | the package specifying it is in neither the repo nor Downloads, and the rule **refuses somebody a trip**. Question is in the STATUS.md runbook, item 8 |

## OWNER (Peter)

| row | state |
|---|---|
| 5 migrations run | 🟡 3 of 5. `reservation-platform` and `plans.image_url` re-probed today and still absent |
| RESEND key live (send a test email) | 🔒 401; all outbound email dead |
| APP_URL fixed | 🔒 |
| Supabase service key + Clerk secret rotated | 🔒 |
| STRIPE_WEBHOOK_SECRET set | 🔒 the webhook route is written and signature-verifies; until the secret exists the honest-bridge verify path carries it |
| SENTRY_DSN set | 🔒 |
| BNPL methods enabled | 🔒 |
| Duffel orders confirmed test | 🔒 **blocks the idempotency migration.** `MHW2Y3` and `SFYVFK` are the same flight booked twice and both are real |
| second test account created | 🔒 `TEST_EMAIL` points at the owner's real account, so e2e acts on real groups and plans |
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

The finish-line directive asks for a Phase 5 mini-marathon: Flow A twice on a
fresh account, B–E once, resilience. That has not been run this session, and
the two reasons are worth recording because both are 🔒:

- `TEST_EMAIL` is the owner's real account, so an end-to-end run acts on real
  groups and real plans rather than a fixture. Every QA artefact made today
  carried a `QA-` prefix and was deleted through the API afterwards.
- The e2e suite is not inside `npm run verify`, so "suite green" above means
  the 531 unit tests and eleven guard scripts. A green build does not today
  mean the 38 e2e specs passed.

Both are one owner action away — a `+qa` account — and neither is a code gap.

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
