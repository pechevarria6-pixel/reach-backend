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
