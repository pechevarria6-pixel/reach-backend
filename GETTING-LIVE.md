# Getting Reach fully working

Follow these in order. Each phase ends with a check that either passes or
tells you exactly what is wrong. Do not move to the next phase until the
current one passes — a failure early on looks like a different failure later,
and you will lose hours chasing the wrong thing.

At any point, run:

```
npm run doctor
```

It checks every credential, every database table, and whether the Stripe
webhook that gates all booking actually exists. It prints what is broken and
what to do about it.

---

## Where things actually stand

Read this before starting, so nothing surprises you.

**The live site is running old code.** https://www.alcanzar.io serves, but
seven commits of fixes are sitting unpushed on your machine. Everything
described in the sections below as "fixed" is fixed *in the repo*, not in
production. Production still loses plans, still charges each member for the
whole trip, and still lets any signed-in user approve another group's
bookings.

**Nothing has been verified against a real database.** The fixes are backed
by a clean type check, a passing build, and 25 unit tests. The unit tests
cover the money arithmetic and invite claiming as pure logic. No API route has
ever been run against real Supabase data in this work, because the local
credentials are placeholders. Phase 2 is where that finally happens, and it is
the phase most likely to surface something new.

**The booking providers have never been called.** Hotels, flights and
activities are written against the LiteAPI, Kiwi and Viator specs but have
never made a live request. Those lanes stay off until their keys are set, and
should be treated as unproven until you watch one succeed.

---

## Phase 0 — A working local environment

**`vercel env pull` cannot get these for you.** All 19 variables are stored in
Vercel as **Secret** type, which is write-only by design — the CLI returns the
literal string `[SENSITIVE]` instead of the value. They also live only in the
Production and Preview environments, not Development, so a plain pull returns
nothing at all.

You have to copy each one from where it originally came from. Do it once,
carefully, and keep the file.

**0.1** Pull anyway, to get the non-secret values and confirm the project link:

```
npx vercel env pull .env.local --environment=production --yes
```

If it fails with a linking error, run `npx vercel link` first. Any value that
comes back as `[SENSITIVE]` you must replace by hand.

**0.2** Run the doctor to see exactly which ones are wrong:

```
npm run doctor
```

**0.3** Open `.env.local` in an editor and replace each flagged value. Sources:

| It says | Where to get the value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` looks wrong | Supabase → your project → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` looks wrong | Same page → `service_role` **secret** key. It is a long JWT. Not the anon key. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` looks wrong | Same page → `anon` `public` key |
| `STRIPE_SECRET_KEY` looks wrong | Stripe → Developers → API keys → Secret key |
| `ENCRYPTION_KEY` looks wrong | **Do not generate a new one.** It decrypts passport and known-traveler numbers already in the database. Recover the production value; a new key makes existing encrypted rows unreadable. Only generate one (`openssl rand -hex 32`) if nothing has ever been encrypted. |
| `CLERK_WEBHOOK_SECRET` looks wrong | Clerk → Webhooks → your endpoint → Signing Secret |
| `STRIPE_WEBHOOK_SECRET` looks wrong | Stripe → Developers → Webhooks → your endpoint → Signing secret |
| `ANTHROPIC_API_KEY` came back `[SENSITIVE]` | console.anthropic.com → API keys. You cannot read an existing key; create a new one and update Vercel too. |

### Two things already found wrong

**`NEXT_PUBLIC_SUPABASE_URL` points at `supabase.com`.** That is the dashboard,
not your project's API host. It must be `https://<project-ref>.supabase.co` —
copy it from Supabase → Settings → API → Project URL. Check the value in
**Vercel** as well, because if production has the same mistake, every database
call on the live site is failing.

**`NEXT_PUBLIC_APP_URL` is `http://localhost:3000`.** Correct for local work.
In Vercel it must be `https://www.alcanzar.io`, or invite emails will send
people to their own machine.

After fixing, put each corrected value in **Vercel → Settings → Environment
Variables** too — and add them to the **Development** environment, not just
Production, so future pulls are less painful.

**Phase 0 passes when** `npm run doctor` reports no blocking problems in the
Environment variables section.

---

## Phase 1 — The database

The repo now contains the schema. Until this phase, the tables existed only
inside your live Supabase project and could not be recreated.

**1.1** Open Supabase → SQL Editor → New query.

**1.2** Run these files **in this exact order**. Open each, copy the whole
file, paste, Run. Each should report Success.

| # | File | Creates |
|---|---|---|
| 1 | `sql/core-schema.sql` | users, groups, group_members, plans, votes, itinerary_items, payments, audit_logs |
| 2 | `sql/bookings.sql` | bookings |
| 3 | `sql/engine-v3.sql` | connected_accounts, contributions, expenses |
| 4 | `sql/savings-v1.sql` | savings_goals, savings_checkins |
| 5 | `sql/invites-v1.sql` | group_invites |

Every statement is `IF NOT EXISTS`, so running these against your existing
project will not destroy data. Tables you already have are left alone.

**1.3** Now the migration. This one **changes existing rows**:

```
sql/migrate-clerk-ids-to-user-ids.sql
```

Your booking and funding tables store a Clerk id (`user_2abc…`) where every
other table stores a database user id. The same person is two different people
depending on which endpoint wrote the row, which is why settle-up produced
nonsense and funding could not tell who had paid. This rewrites what is on
disk to match the code.

It runs inside a transaction, prints how many rows it will touch, and raises
an exception if any Clerk id survives — so it either fully works or changes
nothing. Running it twice is harmless.

**1.4** Verify:

```
npm run doctor
```

**Phase 1 passes when** the Database section shows every table present and
"user ids are consistent".

---

## Phase 2 — Prove it works locally

This is the first time the app runs against real data. Expect to find things.

**2.1** Start it:

```
npm run dev
```

**2.2** Open http://localhost:3000 and work through this in order. Each step
depends on the one before, so **stop at the first failure** and note which
number — that tells us which layer broke.

1. **Sign up as a brand new user.** You should land in the app.
   *Tests:* Clerk, and the just-in-time user creation that covers a webhook
   that never fired.

2. **Create a group.** Refresh the page. It must still be there.
   *Tests:* the group write path. If it vanishes, the POST failed and the
   client correctly evicted it rather than showing a ghost.

3. **Check the group shows your avatar with initials**, not a blank circle.
   *Tests:* members coming back from the list endpoint.

4. **Create a plan and leave the dates empty.** Refresh. It must survive.
   *Tests:* the bug that silently destroyed any plan without a clean date
   range. This one is worth doing carefully.

5. **Open the plan.** The traveler count should equal the group size, not zero.

6. **Open checkout.** Your share should be the trip total divided by the number
   of members. If it shows the whole trip, something regressed.

7. **Invite an email with no Reach account.** It should appear under "Invited".
   Then sign up in a private window using that address — you should land in
   the group without clicking anything.

**2.3** While doing this, keep the terminal visible. Any 500 prints there with
a stack trace. Copy the whole trace, not the summary line.

**Phase 2 passes when** all seven steps work.

---

## Phase 3 — Ship it

**3.1** Final checks:

```
npm run type-check
npm run test:unit
npm run build
```

All three must be clean.

**3.2** Push:

```
git push origin main
```

**3.3** Deploy:

```
rm -rf .next
npx vercel --prod
```

**3.4** Confirm the Stripe webhook exists. Without it, contributions never
mark as collected and **no booking can ever be approved** — the whole
collect-then-approve flow silently stalls.

Stripe → Developers → Webhooks → Add endpoint:

```
URL     https://www.alcanzar.io/api/webhooks/stripe
Events  payment_intent.succeeded
        payment_intent.payment_failed
        charge.refunded
```

Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in Vercel.

**3.5** Confirm the Clerk webhook:

Clerk → Webhooks → Add endpoint → `https://www.alcanzar.io/api/webhooks/clerk`,
events `user.created`, `user.updated`, `user.deleted`. Copy the signing secret
into `CLERK_WEBHOOK_SECRET` in Vercel.

This one matters more than it used to: the endpoint can schedule account
deletion, so it now refuses unsigned payloads in production. Without a real
secret it returns 500 rather than trusting the request.

**3.6** Verify the deployment:

```
npm run doctor -- --prod
```

**Phase 3 passes when** the doctor is clean and the seven steps from Phase 2
work on the live site.

---

## Phase 4 — Money, for real

Everything above uses Stripe test mode. Before taking a real payment:

1. **Switch to live keys** in Vercel (`sk_live_…`, `pk_live_…`), and create a
   **separate live-mode webhook** with its own signing secret. Test-mode and
   live-mode webhooks are different objects; a test secret will reject live
   events.
2. **Run one real contribution end to end** with your own card, for a small
   amount, and confirm the contribution row flips to `succeeded`.
3. **Refund it** and confirm the row updates.

Do not skip step 2. The funding gate is the single point where a silent
failure stops every booking in the product, and the only way to know it works
is to watch one succeed.

---

## What is still missing

Honest list of what stands between here and a product you can put in front of
strangers. None of this is written yet.

**Blocking for real use**

- **Nobody is told anything.** There are no push notifications or emails when
  a plan needs a vote, a payment is due, or a booking is confirmed. The app
  assumes everyone opens it at the right moment.
- **No error recovery in the client.** A failed request mostly logs to the
  console. The person sees nothing, or a toast that disappears.
- **The concierge queue has no interface.** Restaurant bookings land in the
  database as `pending` and someone has to confirm them by hand with a PATCH
  request. That someone is you, via curl.
- **No admin view.** No way to see all bookings, all groups, or a single
  user's state without opening Supabase directly.

**Blocking for money at scale**

- **Refunds are not implemented.** If a trip falls through, there is no path
  to return contributions other than doing it by hand in Stripe.
- **No reconciliation.** Nothing checks that what Stripe collected matches
  what the contributions table believes.
- **The booking providers are unproven.** Four lanes have never made a live
  call.

**Known rough edges**

- ~1,100 inline style blocks still bypass the design system; four different
  header paddings survive.
- `CheckoutScreen` in `components/reach-app.jsx` is ~300 lines of unreachable
  dead UI. Only `CheckoutScreenV2` is routed.
- `/api/payments` is not called by the app at all. The live flow is
  collect-then-approve via `/api/plans/[planId]/funding`.
- Trip generation runs on Claude Sonnet 4.6. Current and valid; Opus 5 or
  Sonnet 5 would be a straight upgrade.
- RLS is enabled with no policies. Every route uses the service-role key and
  authorizes in `lib/auth.ts`. The policies exist only to stop the browser's
  anon key reading tables directly.

---

## If you get stuck

Copy the whole thing, not a summary:

- the full output of `npm run doctor`
- the complete stack trace from the terminal, not the last line
- which numbered step you were on

The step number is the most useful part. It narrows the problem to one layer
immediately.
