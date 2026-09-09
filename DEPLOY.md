# REACH DEPLOY — ONE BUNDLE, ONE PASS
Everything from tonight in a single zip: reach-deploy-bundle.zip

## WHAT'S IN THE BUNDLE (18 files — all placed by one unzip)
- tests/reach.spec.ts ............ fixed Playwright suite (Clerk two-step sign-in)
- middleware.ts .................. API routes return 401 instead of Clerk's 404
- lib/booking/* .................. booking engine (types + all 5 provider lanes)
- app/api/bookings/* ............. propose → approve orchestration (+ ops PATCH)
- app/api/connected-accounts/ .... pre-signed provider sessions
- app/api/travelers/ ............. autofill for every booking form
- app/api/plans/[planId]/funding . collect-then-approve (Stripe shares)
- app/api/plans/[planId]/ledger .. expenses + settle-up
- app/api/plans/[planId]/live .... AeroAPI flight status
- app/api/plans/[planId]/savings . no-custody savings goals/pace
- sql/*.sql ...................... three schema files (run in order below)
- ENGINE-README.md ............... engine docs

(Frontend reach-app.jsx and home/page.tsx were already fixed on your Mac
in the earlier session — nothing frontend in this bundle.)

## STEP 0 — DOWNLOAD ON THE MAC
Chrome on the Mac → claude.ai → this chat → download reach-deploy-bundle.zip.
Not on the phone.

## STEP 1 — UNZIP INTO THE PROJECT (one command places all 18 files)
cd ~/Desktop/reach-backend
unzip -o ~/Downloads/reach-deploy-bundle.zip -d ~/Desktop/reach-backend

If Downloads renamed it (e.g. "reach-deploy-bundle (1).zip"), check with:
ls -lt ~/Downloads | head -5
and use that exact name in quotes.

## STEP 2 — VERIFY (run each; expected result in parentheses)
grep -c identifier tests/reach.spec.ts            (1 or more)
grep -c "startsWith('/api')" middleware.ts        (1)
ls app/api/bookings                               ([id] and route.ts)
ls sql                                            (3 .sql files)

## STEP 3 — SUPABASE (dashboard → SQL Editor, run IN THIS ORDER)
1. sql/bookings.sql
2. sql/engine-v3.sql
3. sql/savings-v1.sql
Each should report Success. (Open each file in TextEdit/VS Code, copy all,
paste into SQL Editor, Run.)

## STEP 4 — CLERK TEST USER (required or all signed-in tests fail)
dashboard.clerk.com → your app → Users → Create user
email: test@reach-test.com
password: TestReach2026!

## STEP 5 — VERCEL ENV VARS (Settings → Environment Variables)
Now (free, 5 min each):
  TICKETMASTER_API_KEY   developer.ticketmaster.com
  LITEAPI_KEY            liteapi.travel (sandbox key)
Later (as approvals land — lanes activate automatically):
  TEQUILA_API_KEY, VIATOR_API_KEY, AEROAPI_KEY
Missing keys are safe: those lanes report "key not set", nothing breaks.

## STEP 6 — DEPLOY
cd ~/Desktop/reach-backend
rm -rf .next
npx vercel --prod --force

## STEP 7 — FULL TEST RUN
npx playwright test --max-failures=0
npx playwright show-report

Expected: high 30s–40s of 48 passing. For any failure: open it in the
report, screenshot the RED ERROR TEXT (not the list), send it.

## STEP 8 — PARTNER APPLICATIONS (clocks start on submission, do today)
- Duffel: push waitlist email (group travel use case, loyalty numbers needed)
- Kiwi Tequila: tequila.kiwi.com
- Viator: partnerresources.viator.com
- Seats.aero: partner API request
(Full list + statuses: REACH-PARTNERS.md v3)

## REMINDERS THAT COST US TIME BEFORE
- Type commands one per line; never paste "#" comment text into zsh.
- Quote any filename containing spaces or parentheses.
- ls -lt ~/Downloads | head BEFORE every cp/unzip.
