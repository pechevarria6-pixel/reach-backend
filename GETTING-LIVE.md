# Getting Reach working — the complete steps

Do these in order. Do not skip ahead: a problem in step 1 shows up as a
confusing, unrelated-looking failure in step 8.

After every step there is a **Check**. If a check fails, stop and fix it
before continuing.

Your project details, so you never have to look them up:

```
Supabase project ref   ikdmlvdimdyjazffqlrf
Supabase API URL       https://ikdmlvdimdyjazffqlrf.supabase.co
Vercel project         reach8/reach-backend
Live domain            https://www.alcanzar.io
```

---

## Already done — nothing to do here

- **Database schema is complete.** All 17 tables exist. The catch-up migration
  ran and added the seven columns the code needed. One of them,
  `users.no_way_jose`, was making the quiz-status screen and AI trip
  generation return 400 on the live site.
- **Supabase credentials work.** They were never wrong. The URL had the
  dashboard page pasted into it instead of the API host.
- **The code is fixed and committed.** Eleven commits, not yet pushed.
- **No money has ever moved.** Payments, bookings and contributions are all
  empty, so nothing financial is at risk while we work.
- **Nothing has ever been encrypted.** Generating a fresh encryption key in
  step 4 is therefore safe. I previously warned against this; that was wrong.

---

## Step 1 — Fix how Vercel stores your variables

**This is the blocker. Everything else waits on it.**

All 19 of your variables are marked **Sensitive** in Vercel. Sensitive
variables are hidden from the build. Next.js bakes every `NEXT_PUBLIC_*`
variable into the code at build time, so a sensitive one compiles in as
`undefined`. That is why a preview deployment returned 500 on every database
route with `supabaseUrl is required`.

Go to **Vercel → reach-backend → Settings → Environment Variables**.

**1a.** Add a new variable:

| Field | Value |
|---|---|
| Name | `SUPABASE_URL` |
| Value | `https://ikdmlvdimdyjazffqlrf.supabase.co` |
| Environments | Production, Preview, Development — tick all three |
| Sensitive | **Off** |

This one is read at runtime, so a build cannot erase it.

**1b.** For these two, click Edit and turn **Sensitive off**. If Vercel will
not let you change it, delete and re-add with Sensitive off:

- `NEXT_PUBLIC_SUPABASE_URL` → `https://ikdmlvdimdyjazffqlrf.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → your `sb_publishable_…` key

Both are public by design — they are sent to every browser that loads the
app — so marking them sensitive protects nothing and breaks the build.

**Check:** `SUPABASE_URL` is in the list and not marked Sensitive.

---

## Step 2 — Stripe

Without these, checkout and funding cannot run. Everything else works.

Go to **Stripe → Developers → API keys**, in **Test mode** (toggle, top right).

**2a.** Copy both keys into Vercel, all three environments:

| Vercel variable | Stripe value |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key, starts `sk_test_` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Publishable key, starts `pk_test_` — Sensitive **off** |

**2b.** **Stripe → Developers → Webhooks → Add endpoint**:

```
Endpoint URL   https://www.alcanzar.io/api/webhooks/stripe
Events         payment_intent.succeeded
               payment_intent.payment_failed
               charge.refunded
```

**2c.** Open the endpoint you just made, copy its **Signing secret** (starts
`whsec_`) into Vercel as `STRIPE_WEBHOOK_SECRET`.

This webhook is what marks a member's payment as collected. Without it,
contributions stay pending forever and **no booking can ever be approved** —
the flow stalls silently, with no error anywhere.

**Check:** the endpoint appears in Stripe's list as Enabled.

---

## Step 3 — Clerk webhook

**Clerk → your app → Webhooks → Add Endpoint**:

```
Endpoint URL   https://www.alcanzar.io/api/webhooks/clerk
Events         user.created, user.updated, user.deleted
```

Copy the **Signing Secret** into Vercel as `CLERK_WEBHOOK_SECRET`.

This endpoint can schedule account deletion, so it now refuses unsigned
requests in production. With the current placeholder value it returns 500.

**Check:** the endpoint shows as active in Clerk.

---

## Step 4 — Encryption key

Add to Vercel, all three environments:

```
Name   ENCRYPTION_KEY
Value  f1dace0fb793be32efe13f7b45c29d64ce396e7395699b1a0a86a44a0e6f496b
```

Freshly generated for you, and safe because no encrypted data exists yet. To
make your own instead: `openssl rand -hex 32`.

**Check:** exactly 64 characters, hex only.

---

## Step 5 — Optional keys

Skip any of these. Each one only disables its own feature.

| Variable | Where | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Trip generation uses a canned list instead of the model |
| `RESEND_API_KEY` | resend.com → API keys | Invite and receipt emails don't send. Invites still work — the app copies the link to your clipboard |
| `TICKETMASTER_API_KEY` | developer.ticketmaster.com, free | Discover shows generic events |

Hotel, flight and activity booking need partner approvals you don't have yet.
Leave those off.

---

## Step 6 — Pull it all back down and verify

On the Mac, in the project folder:

```
npx vercel env pull .env.local --environment=production --yes
npm run doctor
```

Anything that comes back as `[SENSITIVE]` must be pasted into `.env.local` by
hand. Vercel will not reveal those over the CLI.

**Check:** `npm run doctor` prints **no blocking problems**.

---

## Step 7 — Test locally

```
npm run dev
```

Open **http://localhost:3000** in a browser **on the Mac itself**. On a phone,
`localhost` means the phone, and nothing will load.

Go in order. Stop at the first failure and note the number.

1. **Sign in.** You land in the app, not an error.
2. **Your groups appear.** You have 10. Avatars show initials, not blank circles.
3. **Create a group.** Refresh. It is still there.
4. **Create a plan and leave the dates empty.** Refresh. It survives.
   *This is the bug that explains 10 groups but only 2 plans.*
5. **Open the plan.** Traveler count matches group size, not zero.
6. **Open checkout.** Your share is the trip total divided by the number of
   members, not the whole trip.
7. **Invite an email with no Reach account.** It appears under "Invited".

Keep the terminal visible. Server errors print there with a full stack trace.

**Check:** all seven work.

---

## Step 8 — Deploy a preview and test that

```
npx vercel --yes
```

This prints a preview URL and does **not** touch alcanzar.io. Open it in a
browser signed into your Vercel account and repeat all seven checks.

**Check:** all seven work on the preview URL.

---

## Step 9 — Go live

Only after step 8 passes.

```
git push origin main
npx vercel --prod
```

Run the seven checks once more on https://www.alcanzar.io.

If anything is wrong: **Vercel → Deployments → the previous one → Promote to
Production** restores the old version in about a minute.

**Check:** all seven work on the live site.

---

## Step 10 — Real money

Everything above is Stripe test mode. Before charging anyone:

1. Switch Stripe to **Live mode**, copy the `sk_live_` / `pk_live_` keys into
   Vercel.
2. Create a **second webhook** in live mode — same URL, same events. Live and
   test webhooks are separate objects with different signing secrets; a test
   secret rejects live events.
3. Put the live signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Make one real contribution with your own card**, small amount, and
   confirm the row flips to `succeeded` in Supabase.
5. Refund it in Stripe and confirm the row updates.

Do not skip 4. The funding gate is the one place where a silent failure stops
every booking in the product, and watching one succeed is the only proof.

---

## What still will not work after all this

Honest list. None of it is a bug; none of it is written yet.

**People are never told anything.** No emails or notifications when a plan
needs a vote, a payment is due, or a booking is confirmed. The app assumes
everyone opens it at the right moment. This is the biggest gap between "works"
and "a group can actually use it".

**Restaurant bookings need you, by hand.** They land as `pending` and someone
confirms them with a manual API call. There is no admin screen.

**Refunds are manual.** Nothing reconciles what Stripe collected against what
the app believes it collected.

**Flights, hotels and activities cannot be booked.** Those lanes need partner
approvals and have never made a live request.

**Errors are mostly invisible.** A failed request usually logs to the console
and shows the person nothing.

---

## When something breaks

Send me three things:

1. Which numbered step.
2. The full output of `npm run doctor`.
3. The complete stack trace — from the terminal, or
   `npx vercel logs <deployment-url>`.

The step number is the most useful part. It narrows the problem to one layer
immediately.
