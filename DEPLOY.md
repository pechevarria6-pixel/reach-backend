# Reach — deploy runbook

Run the steps in order. Steps 1 and 2 are required once and must happen
before any deploy that includes the identity fixes, or the rows already in
the database will not match what the code now writes.

---

## 1. Database — run the SQL, in this order

Supabase dashboard → SQL Editor. Open each file, paste, Run. Each should
report Success.

| # | File | What it does |
|---|---|---|
| 1 | `sql/core-schema.sql` | users, groups, group_members, plans, votes, itinerary_items, payments, audit_logs. Safe on an existing database — every statement is `IF NOT EXISTS`. |
| 2 | `sql/bookings.sql` | the bookings table |
| 3 | `sql/engine-v3.sql` | connected_accounts, contributions, expenses |
| 4 | `sql/savings-v1.sql` | savings_goals, savings_checkins |
| 5 | `sql/invites-v1.sql` | group_invites — lets you add someone who has no account yet |
| 6 | `sql/migrate-clerk-ids-to-user-ids.sql` | **rewrites existing rows.** See below. |

### About the migration

The booking and funding tables used to store the Clerk id (`user_2abc…`)
where every other table stores the `users.id` UUID. The same person was
therefore two different people depending on which endpoint wrote the row.
The application now writes `users.id` everywhere; this migration rewrites
what is already on disk.

It runs in a transaction, prints how many rows it will touch, and raises an
exception if any Clerk id survives, so a partial migration rolls back rather
than leaving the two id schemes mixed. It is idempotent — running it twice is
harmless.

If your database has no rows yet, it is a no-op and you can still run it.

---

## 2. Environment variables

`.env.local` in this repo is stale placeholder data — the Supabase URL points
at a Vercel deployment and the service-role key is 41 characters, far too
short to be real. Treat Vercel's project settings as the source of truth and
re-pull local values with `npx vercel env pull .env.local` before running
`npm run dev`.

**Required.** The app cannot function without these:

```
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

**Required for money.** Funding, checkout and receipts fail without them:

```
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
```

**Required in production.** The Clerk webhook can schedule account deletion,
so it refuses to accept unsigned payloads when `NODE_ENV=production`. Without
this set to a real value the endpoint returns 500 rather than trusting the
body:

```
CLERK_WEBHOOK_SECRET
```

**Required for PII.** A 64-character hex string. `lib/encryption.ts` throws
without it, so any passport or known-traveler write fails:

```
ENCRYPTION_KEY
```

**Optional — each lane activates independently.** A missing key degrades that
one feature and breaks nothing else:

```
ANTHROPIC_API_KEY      trip generation and recommendations (falls back to a curated list)
TICKETMASTER_API_KEY   real events in Discover and the events booking lane
LITEAPI_KEY            hotel bookings
TEQUILA_API_KEY        flight bookings
VIATOR_API_KEY         activity bookings
AEROAPI_KEY            live flight status on trip day
RESEND_API_KEY         booking, receipt and deletion emails
```

---

## 3. Stripe webhook

Point a Stripe webhook at `https://<your-domain>/api/webhooks/stripe` and
subscribe to:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

The first is what marks a member's contribution collected. Without it the
collect-then-approve gate never opens and no booking can be approved.
`/api/plans/[planId]/funding/confirm` covers the case where the browser
finishes before the webhook lands, but it only fires if the app is still
open, so the webhook is the reliable path.

---

## 4. Clerk webhook

Point a Clerk webhook at `https://<your-domain>/api/webhooks/clerk` and
subscribe to `user.created`, `user.updated`, `user.deleted`. Copy the signing
secret into `CLERK_WEBHOOK_SECRET`.

This is no longer load-bearing for signup: `lib/auth.ts` creates the user row
on first API call if the webhook never fired. It still keeps names, avatars
and deletion requests in sync.

---

## 5. Verify locally, then deploy

```
npm run type-check     # must be clean; next.config.js ignores build errors
npm run test:unit      # money and date logic
npm run build
npx vercel --prod
```

`npm run test:e2e` runs the Playwright suite, which needs a deployed URL plus
a Clerk test user (`TEST_URL`, `TEST_EMAIL`, `TEST_PASSWORD`).

---

## 6. Smoke test after deploy

In order — each step depends on the one before:

1. Sign up as a brand new user. You should land in the app, not on an error.
   This exercises the just-in-time user creation.
2. Create a group. It should keep its name after a refresh; if it vanishes,
   the group POST failed and the client evicted it.
3. Add a second member, then check the group shows both avatars with
   initials. Blank circles mean the member rows are not coming back.
4. Create a plan and leave the dates empty. It must survive a refresh — this
   is the case that used to be silently dropped.
5. Open the plan. The traveler count should match the group size, not zero.
6. Open checkout. Your share should be roughly the trip total divided by the
   number of members, **not** the whole trip.
7. Invite an address with no Reach account (Edit Group → type a full email →
   Invite). It should appear under "Invited". Sign up in a private window with
   that address; you should land in the group without clicking anything.

---

## Invites

`POST /api/groups/[id]/members` with an `email` adds the person if they have
an account and creates an invite if they don't. An invite is claimed the first
time that address authenticates, so the normal path needs no link click.

`/invite/<token>` is a public page for the emailed link. It covers the case
where someone signs up with a different address than the one invited, and it
never reveals the invited address to whoever opens it.

Claiming only honours an address Clerk reports as **verified** — otherwise
signing up as someone else's email would be enough to join their group.

Invites expire after 30 days. Without `RESEND_API_KEY` the invite is still
created and valid; the API returns `acceptUrl` and the app copies it to the
clipboard so you can send it yourself.

## Known gaps

These are understood and deliberately not fixed yet:

- **`CheckoutScreen` in `components/reach-app.jsx` is unreachable.** Only
  `CheckoutScreenV2` is routed. The old component is ~300 lines of dead UI.
- **`/api/payments` is not called by the app.** The live flow is
  collect-then-approve via `/api/plans/[planId]/funding`. The endpoint is
  kept and now splits the bill the same way, so the two cannot disagree.
- **Trip generation runs on Claude Sonnet 4.6.** Valid and current; Opus 5 or
  Sonnet 5 would be a straight upgrade.
- **RLS is enabled but has no policies.** Every route uses the service-role
  key and authorizes in `lib/auth.ts`. The policies exist only to stop the
  browser's anon key reading tables directly.
