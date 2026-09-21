# QA LEDGER

Append-only. One entry per pass. Every bug found, every fix with its commit,
every blocker that belongs to the owner rather than to the code.

The rule this ledger exists to enforce: **evidence, not belief.** A pass is
not green because a build compiled. It is green because a screen was opened
and read.

---

## Pass 0 — hour-zero gates — 2026-09-21 12:0x UTC

Walked: deployment state, Stripe mode, e2e session. | Found: P0 0 / P1 1 / P2 0

**Deploy state — VERIFIED.** All six recent commits are `READY` on Vercel,
including `e80f2b7`. Checked against the deployments API from a signed-in
vercel.com origin rather than inferred from a chunk hash, because a
server-only change does not move the client chunk and the hash would have
said "not deployed" while being wrong.

Worth recording: earlier today two commits silently never deployed. The cause
was a `vercel.json` cron schedule of `0 */3 * * *`. **This account is on the
Hobby plan, which runs a cron once per day**, and a sub-daily schedule is not
a slower cron — it is a rejected deployment, with no failure shown in the
deployments list at all. Reverted in `0bbb497`; the deploy went through
immediately, which is what proved the cause.

**P1 — four cron entries on a plan that allows two.** `vercel.json` now
carries four. The deployment is accepted and `READY`, so this does not block
shipping, but Hobby's documented limit is two cron jobs and there is no
reason to believe all four fire. The venue sweep is the one that matters:
if it stops running, every destination silently stops gaining verified
venues, and the failure looks exactly like "this town has nothing in it".
→ OWNER: confirm in the Vercel dashboard which crons actually run, or move
to Pro. Logged, not worked around.

**Stripe mode — BLOCKED, payment lane OFF.** `GET /api/health/providers`
answers `{"error":"Not authorised"}` to a signed-in browser session: it
authenticates with `CRON_SECRET`, which this session does not hold and must
not be given. The hard rule says payment flows run **only if Stripe is
confirmed in test mode**. It cannot be confirmed here, and independent prior
knowledge says the account is in **live mode with an unverified account**, so
a real charge would be attempted and would fail.

Therefore: no payment, checkout, funding or refund flow will be exercised in
this run. Flow A9 and A10's paid branches are tested up to the payment sheet
and no further. This is the rule working, not a gap.
→ OWNER: to unblock, either confirm test mode yourself or expose provider
mode on an endpoint a signed-in owner can read.

**Account creation — constrained, and already solved properly.** This agent
cannot create accounts or type passwords into forms; that is a standing
safety rule and it is not negotiable for a UI sign-up. The durable fix the
directive itself recommends is already wired: `tests/auth.setup.ts` uses
`@clerk/testing` with a `clerk_test` account, which mints a session
programmatically — no password typed, no real account created. The
new-user path is therefore tested through the harness rather than by hand.

Suite: baseline running.

---

## Pass 1 — suite baseline + copy audit — 2026-09-21 12:2x UTC

Walked: full Playwright suite against production; every user-visible string
in `components/` and `app/`. | Found: **P0 1** / P1 1 / P2 0

**Suite baseline: 67/69 e2e, 475/475 unit.** Both e2e failures were the same
test on two viewports — *"No console errors on home page load"*. The suite
had been reporting it as console noise. It was not noise.

**P0 — the browser called the map directly, and it never worked.**

```
Access to fetch at 'https://nominatim.openstreetmap.org/reverse?...'
from origin 'https://www.alcanzar.io' has been blocked by CORS policy
```

Four client-side calls to Nominatim, all failing in production:

| call | what the user got |
|---|---|
| reverse lookup of device coordinates | city renders as **"Your location"** |
| home-city fallback | fails silently → **no location at all** |
| "where are you going" search | **returns nothing, every time** |
| Discover's place search | **returns nothing, every time** |

The comment beside the fallback warns about precisely this — *"what never
happens is a silent default — that is how a trip planned from Aberdeen came
back with things to do in San Francisco."* It was happening, and Flow B of
this directive names it as a thing to prove.

It also should never have been a browser call: Nominatim's usage policy asks
for a User-Agent identifying the application, which a page cannot set, so all
four were anonymous traffic against donated hardware.

Fix: `67028f0` — new `app/api/geo/route.ts` (signed-in, identified, cached a
day, bounded), all four call sites repointed.

Regression guard: `scripts/check-client-fetch.mjs` — no file that runs in the
browser may name a third-party API host. **Proven to fire**: planted the old
call back, guard exited 1 and named the line; restored, guard passed.

**Copy audit — clean.** Built `scripts/check-spelling.mjs`: every JSX text
node, aria-label, placeholder and title checked word by word against the
system dictionary, with morphology for inflected forms and an allowlist for
what a 1934 dictionary lacks. **Zero misspellings.** Also checked and clear:
no unicode escape literals, no raw enums rendered, no `undefined`/`null`/
`NaN` in text, no unresolved `{placeholder}` braces.

Both guards are now in `npm run verify`. Spelling reports and never fails a
build — a dictionary that old does not get a veto over the product's voice.

**P1 carried from Pass 0**: four cron entries on a two-cron plan.

Suite after fix: 475/475 unit, build clean. e2e re-run pending deploy.

---

## Pass 1b — fix verified — 2026-09-21 12:3x UTC

`67028f0` deployed. Re-ran the failing test against production: **3 passed**
(setup + both viewports). Suite is now **69/69 e2e, 475/475 unit**, no flaky
reruns.

**Safety finding — the e2e suite signs in as the OWNER.** `auth.setup.ts`
logged `Signed in pechevarria6@gmail.com`, not the `test+clerk_test@...`
default: `TEST_EMAIL` in `.env.local` points at the real account.

This matters for the directive's data-hygiene rule. Every signed-in e2e test,
and anything I drive through that session, acts on **Peter's own groups and
plans** — not a sandbox. So for the rest of this run:

- nothing is deleted or cancelled through that session
- anything created is prefixed `QA-` and swept at the end
- destructive branches are walked up to the confirm step and no further

→ OWNER: worth pointing `TEST_EMAIL` at a dedicated `+qa` account so the
suite cannot touch real data. Logged, not changed — env is owner-only.

---
