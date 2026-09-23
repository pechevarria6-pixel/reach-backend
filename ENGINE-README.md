# Reach Booking Engine (v4)

v4 adds: SAVINGS (no custody) — goals, schedules, pace tracking,
group readiness, affordability guardrail. Run sql/savings-v1.sql.
FLOAT IS PINNED: no pooled funds, no yield, by explicit decision.
  POST/PATCH/GET /api/plans/[planId]/savings

v3 adds: connected accounts, traveler autofill, collect-then-approve
funding gate, quote-drift protection at approval, live flight status,
trip ledger + settle-up. Run sql/engine-v3.sql after sql/bookings.sql.

New endpoints:
  GET/POST/DELETE /api/connected-accounts        pre-signed provider sessions
  GET  /api/travelers?groupId=                   autofill for every booking form
  GET/POST /api/plans/[planId]/funding           member shares via Stripe PI
  GET/POST /api/plans/[planId]/ledger            expenses + minimal settle-up
  GET  /api/plans/[planId]/live                  AeroAPI flight status (AEROAPI_KEY)
Approve endpoint enforces, with no override: (1) everybody on the booking
has their travel details (400 travellers_missing) and it was priced for as
many people as are going (409 party_changed); (2) a price re-quote — a rise
over 5% or $25 is held and answered 409 price_changed, and acceptNewPrice:true
accepts only that held price; (3) the plan is funded, net of refunds, with
this booking at the price just checked (402 not_funded) — and the provider
may not charge more than that; (4) one claim per booking, so two presses
cannot both book. The full contract is at the top of
app/api/bookings/[id]/approve/route.ts.
Stripe webhook addition needed: on payment_intent.succeeded with
metadata.kind === "reach_contribution", mark the contribution succeeded.

One pipeline, five verticals, three fulfillment modes.

## Install
1. Unzip into ~/Desktop/reach-backend (adds lib/booking/* and app/api/bookings/*):
   unzip -o ~/Downloads/reach-booking-engine.zip -d ~/Desktop/reach-backend
2. Run sql/bookings.sql in the Supabase SQL Editor.
3. Add env vars in Vercel (each vertical activates independently; missing
   keys fail gracefully with a clear error, nothing else breaks):
   - LITEAPI_KEY            (hotels — sandbox key free at liteapi.travel)
   - TEQUILA_API_KEY        (flights — apply at tequila.kiwi.com)
   - VIATOR_API_KEY         (activities — partnerresources.viator.com)
   - TICKETMASTER_API_KEY   (events — developer.ticketmaster.com, free)
   (restaurants need no key — concierge queue)
4. Deploy: npx vercel --prod --force

## API — approval-gated flow
POST /api/bookings                { planId, items[], dryRun? }
                                  Default: quotes every item and stores it as
                                  awaiting_approval. Nothing books yet.
POST /api/bookings/[id]/approve   Human trigger. Executes the item:
                                  native → books via provider now
                                  redirect → returns prefilled URL for the
                                    in-app browser (user's own signed-in
                                    session completes in 1-2 taps)
                                  concierge → moves to 'pending' for ops
GET  /api/bookings?planId=        list bookings for a plan
PATCH /api/bookings/[id]          ops confirms concierge tickets / updates status

## Pre-signed sessions (the legal version of account delegation)
Users sign in to Ticketmaster/OpenTable/etc. ONCE in Reach's in-app
webview. Those sessions persist on-device. Reach never sees or stores
third-party credentials — the concierge preps everything, and approval
opens the provider page pre-filled inside the user's own session.
Do NOT store third-party passwords server-side or automate provider
logins: security liability, guaranteed bot-detection bans, and (for
tickets) BOTS Act exposure.

## Rollout order (fastest first)
1. Ticketmaster (free key, minutes) — real events, redirect checkout
2. LiteAPI sandbox (free key, ~1 day) — real hotel bookings end to end
3. Viator (application, ~days-weeks) — activities
4. Kiwi Tequila (application, ~days-weeks) — flights
5. Restaurants run through the concierge queue from day one; you confirm
   them via PATCH (or later, an admin screen). Swap in a real API when one
   becomes available — no frontend change needed.
