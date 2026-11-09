## Payments kill switch

One environment variable stops Reach starting any new movement of money.
Code: `lib/rail/kill-switch.ts`.

| `PAYMENTS_ENABLED` | Effect |
|---|---|
| unset, `true`, anything else | Payments run as normal. |
| `false` (any case, spaces ignored) | Paused. |

**While paused:**
- `POST /api/plans/[planId]/funding` (checkout's pay step) answers
  `503 { code: 'payments_paused' }` before Stripe is asked. No PaymentIntent is created.
- `POST /api/bookings/[id]/approve` answers the same for anything Reach pays a
  provider for (flights, hotels, activities). Nothing is bought.
- Members read: "Payments are paused for a moment. Nothing has been charged and
  nothing was booked — try again a little later."

**Not paused, on purpose:** the Stripe webhook and `/funding/confirm` (they record
money that has already moved, and stopping them loses that record), refunds, and
approving something a member books on the seller's own site (a ticket, a table, a
flight handed to the airline). No money goes through Reach for those, so "payments
are paused" would not be true there.

### Flip it off (pause)
1. `npx vercel env rm PAYMENTS_ENABLED production` (only if it is already set), then
   `npx vercel env add PAYMENTS_ENABLED production` and enter `false`.
   Or: Vercel → Project → Settings → Environment Variables → `PAYMENTS_ENABLED` = `false` (Production).
2. Redeploy: `npx vercel --prod` (or Deployments → latest → Redeploy). **An env change
   reaches only a deployment built after it.** Until the redeploy finishes, payments run.
3. Check it is live: with a signed-in session, `POST /api/plans/<a test plan id>/funding`
   must answer `503` with `"code":"payments_paused"`. A status code alone is not proof;
   read the body.
4. Payments already in flight still land: a bank debit that was clearing will clear,
   and the webhook records it. Pausing stops new money, not money already moving.
   To stop that too, cancel the PaymentIntent in the Stripe Dashboard.

### Flip it back on (resume)
1. Set `PAYMENTS_ENABLED` to `true` in Production (or remove it — unset means on).
2. Redeploy, as above.
3. Check: the same `POST /funding` on a plan with something to pay answers `200` with a
   `clientSecret`, or one of its ordinary refusals — never `payments_paused`. Then
   cancel that test PaymentIntent in the Stripe Dashboard (test mode) so it is not left open.
