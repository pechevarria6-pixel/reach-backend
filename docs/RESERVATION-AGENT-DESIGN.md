# Reservation agent — design (for owner approval)

Directive: `~/REACH-RESERVATION-AGENT-2026-11-08.md`. Status: **design only. Nothing below is
built until you approve.** Implementation then goes on `feat/reservation-agent`.

## 0. What already exists, and what this design does with it

The repo already has a phone-call path (built 2026-11-04, `lib/reservations/*`,
`app/api/bookings/[id]/call`, `app/api/webhooks/reservation-call`, table `reservation_calls`):

| Existing piece | Kept as-is | Changed by this design |
|---|---|---|
| **Gate** `RESERVATION_CALLS_MODE` off / test / live, live only with `RESERVATION_CALLS_LAWYER_APPROVED=yes`; test rings only `RESERVATION_TEST_NUMBER` | ✓ the master switch for the agent too | — |
| **Policy**: +1 numbers only, landline-only via Twilio Lookup, open-hours-only, do-not-call list forever, 50/day cap in the database, one call per request | ✓ | landline rule stays (TCPA) |
| **Outcome proof**: "confirmed" only when a *staff* turn says yes to the asked time/party | ✓ — the agent's own words are never evidence | extended to the window (§3) |
| **Opening line** "…automated AI assistant from Reach… This call is recorded." | — | replaced by the directive's line (§4) |
| **Provider**: Retell / Vapi hosted voice agents | — | **decision D1** below |
| **Rule "never accept a different time"** | — | becomes "accept only inside the member-approved window" |
| **Voicemail: hang up, leave nothing** | — | **decision D3** below |

## 1. Decisions I need from you (everything else follows the directive)

**D1 — Where the live call loop runs.** Twilio ConversationRelay streams each turn to a
WebSocket that *we* run, and Vercel functions cannot hold a WebSocket open. Options:
- **(a) Recommended:** a small relay service (~300 lines, Node) on Fly.io or Render that
  holds the socket, runs the state machine and calls Claude; it reports results to
  `/api/webhooks/reservation-call` with an HMAC signature. Owner action: a Fly/Render account.
- (b) Keep Retell's hosted loop and express the state machine as a Retell "conversation flow".
  No new host, but the dialogue is not Claude-driven, contrary to §3 of the directive.

**D2 — Model.** The directive says `claude-sonnet-4-6`, "same model as the app". The app
actually runs `claude-sonnet-5` (itinerary) and `claude-haiku-4-5` (options). A phone turn
needs a reply in well under a second, so I recommend **`claude-haiku-4-5` per turn**, with
`max_tokens` 120 and the state machine (not the model) deciding every transition. Say which.

**D3 — Voicemail.** The directive's `LEAVE_CALLBACK` leaves a message with a callback number.
Two concerns: an artificial-voice message is the one thing FCC 24-17 treats most strictly, and
the callback number is the member's personal phone. Recommended until counsel answers: on
voicemail/IVR **hang up, status `no_answer`**, and the member gets "They didn't pick up — try
again or call yourself." If you want `callback_left`, it uses a Reach number (Twilio), never
the member's, and needs counsel's yes.

**D4 — "Transcript only" and two-party-consent states.** Real-time transcription of a call
can itself count as recording in all-party states (CA Penal Code §632 / CIPA). Recommended:
the disclosure keeps the words "this call is transcribed" in every state until counsel says
otherwise (it costs four words and removes the question). The disclosure line in §4 shows it
as an optional clause, **[bracketed]**: approve it with or without.

**D5 — Booking status vs call status.** Adding seven new values to `bookings.status` touches
every money filter (`NOT_CHARGED`, `chargedRows`, funding, approval, ledger). Recommended:
`bookings.status` keeps today's values (`pending` while calling → `confirmed` | `failed`), and
the directive's fine-grained states live on `reservation_calls.agent_status` and
`bookings.response_payload.agent_status`. Every chip reads `agent_status`. The directive's
flow is fully represented; the funding code is provably untouched (§5 acceptance).

## 2. When the call option appears (platform first)

```
restaurant item
 ├─ platform detected (/api/discovery/platforms: OpenTable, Resy, Tock, Yelp…)
 │    ├─ show prefilled link "Finish on <platform> →" + "Booked it ✓"      ← always first
 │    └─ "We'll call them for you" appears ONLY if (b) the platform shows no
 │       availability for the window, or (c) party > platform's online limit
 └─ no platform → "We'll call them for you" is the primary action
```
Never offered: no venue phone we can read, not a landline, outside open hours, on the
do-not-call list, gate off. Each refusal hands over the restaurant's own number instead.

## 3. State machine — every exit

States live on `reservation_calls.agent_status`; each terminal state maps to member copy (§6).

```
requested ── member approves (one tap) ──▶ DIAL
DIAL
 ├─ no answer / busy / failed to connect ────────────────▶ no_answer        [retry once +20 min]
 ├─ voicemail / IVR with no route to a person ───────────▶ no_answer        (D3: or callback_left)
 └─ answered ─▶ GREET_DISCLOSE  (disclosure line, verbatim, first words spoken)
GREET_DISCLOSE
 ├─ "we don't talk to bots / to recordings" ─────────────▶ THANK_END ▶ declined_bot   [no retry]
 ├─ "don't call us again" ───────────────────────────────▶ THANK_END ▶ declined_bot + do-not-call
 └─ continues ─▶ REQUEST (party, date, window, name, notes from stored restrictions only)
REQUEST
 ├─ "we're full / no tables that night" ─────────────────▶ THANK_END ▶ declined
 ├─ offers time INSIDE the approved window ──────────────▶ CONFIRM_BACK
 ├─ offers time OUTSIDE the window ──▶ NEGOTIATE ("I'll check with them and call back")
 │                                     ▶ THANK_END ▶ declined (offered time recorded)
 ├─ needs card / deposit to hold ────▶ CARD_REQUIRED ("could you hold it under <name>; they'll
 │                                     call to give a card") ▶ THANK_END ▶ needs_card
 ├─ asks for something we can't give (payment, member's phone without consent, a guarantee)
 │                                   ─▶ THANK_END ▶ needs_card or declined (by what was asked)
 └─ wants to speak to the guest ─────▶ THANK_END ▶ needs_card ("they'll call you")
CONFIRM_BACK  (repeat party, date, time, name; capture confirmation name/number if given)
 ├─ staff says yes ─────────────────────────────────────▶ CLOSE ▶ confirmed   (proved from a staff turn)
 └─ staff corrects something ───────────────────────────▶ back to REQUEST (once), else declined
ANY STATE
 ├─ hang-up mid-call ────────────────────────────────────▶ failed  (unless a staff yes was proved → confirmed)
 ├─ max duration (4 min) or max turns (24) reached ──────▶ THANK_END ▶ failed
 └─ model error / relay drops ───────────────────────────▶ failed  (never retried automatically)
```
`calling` is the in-flight state between DIAL and any terminal one. Retry policy: one retry
after 20 minutes on `no_answer` only; none on `declined_bot`, `declined`, `needs_card`,
`failed`.

## 4. The agent's system prompt (disclosure line verbatim)

First words spoken, passed as a fixed string (not generated), checked in every transcript:

> **"Hi, this is an automated assistant calling on behalf of {first name}, a Reach member[, and this call is transcribed]."**

System prompt (per turn, with the state machine's current state and allowed moves):
```
You are an automated assistant phoning {restaurant} to ask for a table for {first name}, a Reach member.
You have already said who you are. If asked whether you are a person, say you are an automated assistant.
Current step: {STATE}. You may only: {ALLOWED_MOVES}.
The request: {party} people on {spoken date}, any time from {window start} to {window end}, under the name {first name}.
Notes you may share if asked: {stored restrictions, e.g. "one guest has a severe nut allergy"} — nothing else.
Never give, read or ask for a card number, deposit, or any payment detail. If they need one, ask them to
hold the table under {first name} and say {first name} will call with a card.
Never give anyone's phone number.
Never accept a time outside {window}. If offered one, say you'll check with {first name} and call back.
Never say the table is booked. If they confirm, repeat back party, date, time and name, thank them, end.
If they would rather not speak to an automated assistant, apologise, thank them and end the call at once.
Reply in one or two short spoken sentences. No lists, no markdown.
Return JSON: {"say": "...", "move": "<one of ALLOWED_MOVES>", "heard": {"time": "...", "card_required": bool, ...}}
```
The relay, not the model, decides the transition from `move` + `heard`; an invalid `move` ends
the call politely as `failed`. Payment details: the prompt contains none, and a redaction pass
masks any 12–19 digit run in transcripts before storage (acceptance: no payment detail in a
transcript or prompt).

## 5. Data — `sql/reservation-agent-2026-11-08.sql`

```sql
-- the AGENT lane on bookings (mode) and the phone provider
alter table public.bookings drop constraint if exists bookings_mode_check;
alter table public.bookings add constraint bookings_mode_check
  check (mode is null or mode in ('native','redirect','concierge','capture','agent'));

-- the call attempt carries the directive's states and consent
alter table public.reservation_calls
  add column if not exists agent_status text
    check (agent_status in ('requested','calling','confirmed','needs_card','declined',
                            'declined_bot','no_answer','callback_left','failed')),
  add column if not exists attempt integer not null default 1 check (attempt between 1 and 2),
  add column if not exists window_start time,
  add column if not exists window_end time,
  add column if not exists consent_mode text not null default 'transcript_only'
    check (consent_mode in ('record','transcript_only')),
  add column if not exists recording_url text,          -- only when consent_mode = 'record'
  add column if not exists confirmed_time time,
  add column if not exists confirmation_ref text,
  add column if not exists stated_deposit_cents integer,
  add column if not exists cost jsonb;                  -- {twilio_cents, stt_cents, tts_cents, model_cents, minutes}
alter table public.reservation_calls drop constraint if exists reservation_calls_provider_check;
alter table public.reservation_calls add constraint reservation_calls_provider_check
  check (provider in ('retell','vapi','twilio_relay'));
-- recording only under a policy that allows it
alter table public.reservation_calls add constraint reservation_calls_recording_consent
  check (recording_url is null or consent_mode = 'record');
```
(If you reject D5, the migration instead extends `bookings_status_check` with the seven states.)

## 6. Member copy (vocabulary-guarded)

| State | Chip / message |
|---|---|
| eligible | button **"We'll call them for you"** |
| requested / calling | chip **"Table requested"** |
| confirmed | chip **"Table confirmed ✓"** on the itinerary; stated deposit → settle-up ledger |
| needs_card | **"They need a card — finish here"** + restaurant number + the details agreed |
| no_answer / callback_left | **"They didn't pick up — try again or call yourself."** |
| declined / declined_bot | **"They'd rather hear from you — here's the number."** |

`check:vocabulary` gains: agent, bot, lane, fulfillment, concierge queue (already partly
covered) for every new string.

## 7. Consent handling

- `RECORDING_POLICY` env: JSON map `{ "NC": "record", … }`; any state missing → `transcript_only`.
  **Default: every state `transcript_only`** until counsel confirms (directive §2).
- The restaurant's state comes from the venue's harvested address; unknown → `transcript_only`.
- In `transcript_only`, Twilio recording is not enabled at all (not "recorded then deleted").
- Notes come only from the group's stored restrictions the member has seen; free text the
  member typed is shown back to them for one-tap approval before the call.
- The member approves each call (one tap) with the request shown; nothing dials without it.

## 8. Mocked-restaurant harness (no real calls, ever, in CI)

`tests/unit/reservation-agent-harness.test.ts` drives the state machine + prompt builder with
scripted restaurant turns and a stubbed model that answers from a fixture. Scenarios and the
expected landing:

| Scenario | Ends in | Member copy |
|---|---|---|
| accepts the asked time | confirmed | Table confirmed ✓ |
| counter-offer inside window | confirmed (new time) | Table confirmed ✓ |
| counter-offer outside window | declined | They'd rather hear from you… |
| card required to hold | needs_card | They need a card — finish here |
| voicemail | no_answer (or callback_left per D3) | They didn't pick up… |
| IVR menu, no person | no_answer | They didn't pick up… |
| "we don't talk to bots" | declined_bot | They'd rather hear from you… |
| hangs up mid-call | failed | They didn't pick up… |

Each also asserts: the transcript's first assistant turn is the disclosure line; no 12–19
digit run anywhere in prompt or transcript; no funding-path module is imported by the lane.
The relay itself is tested against Twilio's test credentials only.

## 9. Ops and cost
- Exception count + SLA for `needs_card`, `failed`, `declined_bot` on an ops-only route
  (never member UI); the member always has "Call myself".
- `reservation_calls.cost` → feeds C3/M4 (AI and call cost per trip).
- `/api/health/providers` adds Twilio Voice and the STT/TTS vendor.

## 10. Owner actions (directive §7)
1. Buy a Twilio number; enable Programmable Voice and ConversationRelay.
2. Choose the STT/TTS vendor and provide keys (Twilio's ConversationRelay bundles Deepgram /
   ElevenLabs / Google options — pick one).
3. Counsel: recording-consent policy (D4) and voicemail (D3). Until then `transcript_only`
   everywhere, and the existing lawyer switch keeps calls on your test number only.
4. Pilot city list for phone-eligible restaurants.
5. Decide D1–D5 above.
