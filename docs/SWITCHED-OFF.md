# What is switched off, and what turns it on

Kept up to date by whoever changes one of these. Checked against production on
2026-11-22: `/api/health/modes` read as the QA account, the production
environment variable *names* in Vercel (never values), and the public sign-in
page.

**Kind of change:**
- **Switch:** set one value in Vercel, then redeploy. Nothing else is needed.
- **Switch + outside step:** the switch is ready, but somebody outside the code has to say yes first.
- **Work:** code or data is still missing, and a switch alone would not be enough.

## Off today

| # | What a member can't do yet | State now | Kind | What turns it on | Who |
|---|---|---|---|---|---|
| 1 | **Pay real money** | Stripe is in **test** mode (`pk_test`, `sk_test`); the webhook is configured | Switch + outside step | Stripe live business verification; then live keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`), a live webhook and its `STRIPE_WEBHOOK_SECRET`, and `STRIPE_EXPECTED_MODE=live` | Owner, after counsel answers the custody question |
| 2 | **Book a real flight** | Duffel in **test** mode | Switch + outside step | A live Duffel key in `DUFFEL_API_KEY` (Duffel account approval) | Owner |
| 3 | **Book a real hotel** | LiteAPI in **test** mode | Switch + outside step | A live LiteAPI key in `LITEAPI_KEY` | Owner |
| 4 | **Book tours and activities** | Viator is search-only (booking answers 403) and points at Viator's **sandbox** (`VIATOR_BASE` unset) | Switch + outside step | Viator booking access, then the live key and `VIATOR_BASE` | Owner (Viator partner approval) |
| 5 | **Reach books a restaurant table** | No Yelp Reservations or OpenTable keys, so Reach hands the booking off to the restaurant's own page | Switch + outside step | `YELP_RESERVATIONS_API_KEY` or the `OPENTABLE_*` keys, after a partner deal | Owner |
| 6 | **Reach phones a restaurant to book** | `RESERVATION_CALLS_MODE` is unset, so no call is ever placed | Switch + outside step | A phone-law lawyer's sign-off, then `RESERVATION_CALLS_MODE=live` **and** `RESERVATION_CALLS_LAWYER_APPROVED=yes`. Out of scope until after the pilot | Owner + counsel |
| 7 | **New destination picker** (wider variety of places, "Why this" line) | `DESTINATION_SELECT` unset; the code is on PR #1, not yet merged | Work, then switch | Merge PR #1. Grow the catalogue from **17** places to about **36 or more** (below that the same places keep coming back), geocode the 16 places with no coordinates, dedupe the cities stored three times. Then `DESTINATION_SELECT=on` | Owner approves the merge and the data; I can do the work |
| 8 | **Error alerts to you** (Sentry) | `SENTRY_DSN` not set, so errors are only in Vercel logs | Switch | `! npx vercel env add SENTRY_DSN production`, then redeploy. The value is at alcanzar-group.sentry.io → reach → Client Keys | Owner (it is a key) |
| 9 | **Staff exception page** (`/api/ops/exceptions`) | Always refuses: the code reads `REACH_OPS_SECRET`, but production holds `OPS_SECRET` | Switch | Add `REACH_OPS_SECRET` with the same value, or I rename it in the code | Owner or me |
| 10 | **Darker map tiles** | `NEXT_PUBLIC_CARTO_KEY` unset, so the map uses OpenStreetMap tiles (works, credited) | Switch | A free Carto key in `NEXT_PUBLIC_CARTO_KEY` | Optional |
| 11 | **"Anything you're weirdly into?" question** | `MOMENTS_ENABLED = false` in `lib/drip.ts`, because the answer has no screen yet | Work | Build Moments; out of scope for the pilot | — |

## On, but worth knowing

- **Sign-in** runs on Clerk **production** (`pk_live`), so real people can sign up now.
- **Payments kill switch.** `PAYMENTS_ENABLED` is unset, which means payments run. Setting it to `false` and redeploying stops all new charges without a code change. See `docs/pilot/PAYMENTS-KILL-SWITCH.md`.
- **Test-only keys in production.** `E2E_CLERK_PUBLISHABLE_KEY` and `E2E_CLERK_SECRET_KEY` are in the production environment, but no app code reads them. Remove them before going live so a test key can never become a way in.

## Not a switch: the pilot gate (`STATUS.md`, 3 of 8 true)

Counsel on custody (#2), ten groups recruited (#6), and pre-registered readouts approved (#8) are decisions and people, not settings.
