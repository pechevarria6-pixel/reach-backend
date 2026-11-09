# Pilot tasks — REACH-BUSINESS-MODEL-2026-11-08.md

The working list for the business-model directive (`~/REACH-BUSINESS-MODEL-2026-11-08.md`).
An item is ticked only when its acceptance criteria were checked, and the note says how.
Each task ships on its own branch, merged only on a green `npm run build` (verify inside).

## Pre-pilot

- [x] **P1 Bank debit first for contributions** (cbbf98a) — PaymentIntent offers `us_bank_account`
  then `card`; the Payment Element shows the bank first and the card one tap away;
  `contributions.payment_method` records what paid; a "bank not switched on" refusal
  falls back to the account's methods rather than failing. A clearing bank payment
  is "on its way", never "not recorded". Migration: `sql/pilot-1-contribution-method-2026-11-08.sql`.
  *Verified 2026-11-08 on production (test mode, /api/health/modes all `test`): a throwaway
  QA plan's contribution PaymentIntent read back `payment_method_types ["us_bank_account","card"]`;
  the Payment Element mounted as the app mounts it shows "US bank account" first and selected,
  Card beside it. Bank debit is already enabled on the test account. Unit tests:
  tests/unit/contribution-method.test.ts. `payment_method` is written once the migration runs.*
- [ ] **P2 Funding gate tolerates bank settlement** — `processing` state; approval needs
  every share succeeded; 402 separates "not yet paid" from "still clearing".
- [ ] **P3 Only Reach-booked items are funded** — redirect-only plan: $0 target, no pay
  step; mixed plan funds the native subtotal; share before the vote shows funded vs
  self-paid; "Booked it ✓" on a redirect item writes an `expenses` row.
- [ ] **P4 Skip funding when no pooled money is needed** — single payer / book-your-own.
- [ ] **P5 Refunds and bank returns** — refund and ACH return/dispute recompute funding.
- [ ] **P6 Fee capture** — Stripe fee from the balance transaction stored per contribution.
- [ ] **L1 Expedia affiliate ID (code side)** — `EXPEDIA_AFFILIATE_ID` on every Vrbo/Expedia link.
- [ ] **L3 Price-parity spot-check** — `public_price_cents` beside `price_cents`; "Cheaper if
  you book this one directly →" when public is cheaper beyond tolerance.
- [ ] **L4 Commission logging** — `lane`, `provider`, `commission_cents` per booking.
- [ ] **M1 Events + `pilot_metrics`** — every §3 metric emitted and in the view.
- [ ] **M2 Organiser debrief** — hours, messages, NPS, "would you run the next one?".
- [ ] **M3 Reconnection question** — "When did you last see this group in person?".
- [ ] **M4 Contribution margin per trip** — take − fees − AI cost − concierge minutes.
- [ ] **C1 Knowledge caching** — playbooks/profiles read before the model.
- [ ] **C2 Model tiering** — small for options, large for itinerary, hard `max_tokens`.
- [ ] **C3 AI cost per generation** — model, tokens, cost logged.

## Beta
- [ ] **T1 Holiday and reconnection nudges** — deep-link to Discover with the group preselected.
- [ ] **T2 Trips per active group** — in `pilot_metrics`.
- [ ] **C4 Redirect-first everywhere else** — concierge only as an ops exception queue.

## Post-pilot (data model and stub routes only, no UI)
- [ ] **R1 Partner placements** · **R2 Points/loyalty referrals** · **R3 Employer tier** · **R4 Paid organiser tier**

## Standing rules (§4F) — enforced in `verify` where testable
No booking fee, markup or paid tier gating savings; per-person share before the vote;
per-item opt-in and "I'll skip this one"; native price at or below public or the member is told.

## Owner actions
1. Stripe Dashboard → Payment methods → enable **ACH Direct Debit (us_bank_account)**, test and live.
2. Join the Expedia Group Affiliate Program; set `EXPEDIA_AFFILIATE_ID` in Vercel.
3. Confirm any negotiated Stripe rates (the brief assumes 2.9% + 30¢ card, 0.8% capped $5 ACH).
4. Run the migrations below, in order, in the Supabase SQL editor.

## Migrations, in order
1. `sql/pilot-1-contribution-method-2026-11-08.sql` (P1)
