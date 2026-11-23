# Reservation calling agent: switching it on

Status, 2026-11-23: **built, tested, and off.** It has never placed a call. Branch `feat/reservation-agent`.

How it works:
- Twilio dials and handles the speech in both directions.
- Reach's small relay server (`relay/`) holds each call open and runs the conversation. Claude words each
  reply; Reach's rules decide what happens next.
- When the call ends, Reach's webhook proves whether anything was booked, from the restaurant's own words.

The agent never says "booked" on its own, never takes a time the member didn't approve, and never records
the call. Its first words are always: "Hi, this is an automated AI assistant from Reach, calling for
<first name>. This call is recorded." That wording is a known open question; see **What still needs
deciding**.

## What is done

| Piece | Where | Tested by |
|---|---|---|
| Conversation rules: every way a call can end | `lib/reservations/agent/machine.ts` | 15 mocked-restaurant scenarios (`tests/unit/reservation-agent-harness.test.ts`) |
| Per-turn prompt: no phone numbers, no payment details, never claims a booking | `lib/reservations/agent/prompt.ts` | same |
| Turn-by-turn driver | `lib/reservations/agent/session.ts` | same |
| Proof against the member's time window | `lib/reservations/agent/settle-window.ts`, `lib/reservations/call.ts` | `tests/unit/reservation-call.test.ts` |
| Twilio provider: places the call, verifies Twilio's signature, reads its status callback | `lib/reservations/providers.ts` `relay()` | `tests/unit/reservation-relay.test.ts` (matches Twilio's own documented signature example) |
| The relay server | `relay/server.ts` | `relay/server.test.ts`: a real WebSocket, a fake Twilio and a scripted model, end to end |
| "If they can't do 7:30 PM: only that time / 30 min / an hour either side" | the table card in the plan | `tests/unit/reservation-call.test.ts` |
| Database: allow provider 'relay' | `sql/reservation-relay-2026-11-23.sql` | run in Supabase 2026-11-23 |

## What you do, in order (about an hour, plus waiting on Twilio)

You create the accounts and set every key yourself. I never handle keys.

1. **Twilio:** create an account, then buy one US local number with Voice. In Voice settings, turn on
   ConversationRelay. Keep the account in trial or upgrade it; a trial can only ring numbers you've verified,
   which suits test mode.
2. **Fly.io:** create an account. Then, from the repository root:
   ```
   fly apps create reach-call-relay
   fly secrets set RELAY_SECRET=<a long random string> ANTHROPIC_API_KEY=<the Anthropic key> --app reach-call-relay
   fly deploy --config relay/fly.toml --dockerfile relay/Dockerfile
   ```
   Check `https://reach-call-relay.fly.dev/health` shows `ok`.
3. **Vercel:** add these to production. Each is `! npx vercel env add NAME production` in this prompt.
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (the number from step 1, as +1…)
   - `RELAY_WSS_URL` = `wss://reach-call-relay.fly.dev/ws`
   - `RELAY_SECRET`: the same string as step 2
   - `RESERVATION_CALLS_MODE` = `test`
   - `RESERVATION_TEST_NUMBER`: your own mobile, as +1…
4. **Merge and redeploy.** I'll merge `feat/reservation-agent` when you say so.
5. **Test calls.** In test mode every call rings your phone, never a restaurant, whatever the venue's
   number is. You play the restaurant. Try:
   - a plain yes;
   - "we're full at 7:30 but I can do 8";
   - "we need a card to hold it";
   - "press 2 for reservations";
   - "we don't talk to robots";
   - hanging up halfway.

   Each should end with the right message in the app.

## What stays off until the lawyer says yes

`RESERVATION_CALLS_MODE=live` does nothing on its own: real restaurants are only rung when
`RESERVATION_CALLS_LAWYER_APPROVED=yes` is also set. The phone-law questions for counsel:
- AI-voice calls to businesses (FCC 24-17);
- the disclosure wording;
- recording and transcription in all-party-consent states (design D4);
- voicemail (design D3).

## What still needs deciding

- **The opening says "This call is recorded."** Recording is never switched on, but the call is
  transcribed. The approved design (D4) suggested "transcribed". Changing the words means changing the
  opening, the disclosure check and their tests together, so it waits for counsel's wording.
- **Online-first:** OpenTable and Yelp partner programmes. Google books online before it ever calls. Reach's
  code for both is written and waits only on partner keys.
