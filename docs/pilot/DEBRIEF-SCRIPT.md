# Pilot debrief call — script (15 minutes, one per trip)

**Status: DRAFT — awaiting owner approval (pilot gate B4, readiness item 7).**

Who: the owner and the trip's organiser. Invite one other member when you can — the
organiser's view is the one being measured, but a member hears the trip differently.
When: within 7 days of the trip ending, after the organiser has submitted the in-app
debrief ("You organised this one", on the plan's overview). The form gives the numbers;
this call gives the story behind them. Never read the numbers back as a score.

Before the call (5 minutes, not counted in the 15):
- Open the trip's furthest-step row (docs/pilot/READOUTS.md, stop-rule query) and its
  lines in `docs/pilot/INCIDENTS.md`. Know where it stalled before they tell you.
- Read their debrief row in `pilot_debriefs` — including "What almost made you quit?".
- Have a blank copy of the notes template (bottom of this file) open.

Rules for the person asking:
- Ask, then stop talking. Silence is where the useful sentence comes from.
- Ask about what happened, not what they would like. "Walk me through" beats "would you use".
- Never defend the product, explain a screen, or promise a fix on the call. Write it down.
- Use their words in the notes, in quotes. Don't paraphrase into ours.
- Don't ask for anything you won't use. Fifteen minutes means fifteen.

---

## 0:00 — Open (1 min)

> "Thanks for doing this. Fifteen minutes, I'll keep to it. There are no right answers —
> the most useful thing you can tell me is where it was annoying. I'm taking notes; nothing
> you say goes to anyone in the group."

## 0:01 — The trip in their words (3 min)

1. "Start from the moment somebody first said 'we should do something'. What happened
   next — before Reach came into it?"
2. "Where did Reach come in, and what did you do first?"

Listen for: where the idea started (chat, call, in person), how long between the idea and
the first plan in Reach, who else was already involved.

## 0:04 — The hard part (4 min)

3. "You wrote that [their 'almost quit' answer, or: 'nothing almost made you quit'].
   Tell me about that moment." — if they left it blank: "Was there a moment you thought
   about giving up on it, or doing it the old way?"
4. "Was there anything you had to chase people for? Who, and how did you chase them —
   in Reach or outside it?"
5. "Did money come up as awkward at any point — who pays, how much, when?"

Listen for: the step (invite, answers, options, vote, paying, booking, the trip, settling
up), and whether they left the app to solve it. Every "I just texted them" is a message
count Reach did not save.

## 0:08 — The time it took (2 min)

6. "You put roughly [hours range] and [messages range, or 'no count']. What took most of
   that time?"
7. "Compared with the last trip you organised without Reach — more, less, about the same?"

Do not correct their estimate. Note any big gap between the form and the story ("I said
3–6 but honestly it was more") — the form answer is still the one that counts in R3.

## 0:10 — What the group thought (2 min)

8. "What did the others say about it — during, or after?"
9. "Did anyone not come, or drop out? Do you know why?"

## 0:12 — Next time (2 min)

10. "You said you [would / wouldn't] run the next one. What would have to be different?"
11. "Is there a next one already being talked about? With this group, or another one?"

Listen for: a member saying they would organise the next one (R2), and a real date or
place (a trip, not a compliment).

## 0:14 — Close (1 min)

> "That's everything. Thank you — this genuinely decides what we fix next. If anything
> else comes to you, [support channel from B4] reaches me."

Do not ask for a review, a referral or a testimonial on this call.

---

## Notes template (one per trip, file under `docs/pilot/debriefs/<date>-<trip>.md`)

```
Trip: <plan id>  ·  Group: <group id>  ·  Call date: <YYYY-MM-DD>  ·  With: organiser [+ member]
Furthest step (query): <step>       Incidents logged: <n>
Form: hours <range> · messages <range|—> · NPS <0–10> · run the next one <yes/no>

Where it started (before Reach):
Moment they nearly quit (their words, quoted):
Chased people for: <what> via <Reach | text | call>
Money awkwardness:
What took the time:
Group's reaction:
Drop-outs and why:
What would make them run the next one:
Next trip already mentioned? <no | yes: who, where, when>  ·  Member wants to organise? <no | yes: who>

Step it failed at, if any (for the stop rule): <none | step>
Fixes this suggests (owner's words, not promises made on the call):
```

## After the call (5 minutes, not counted)

- If the trip failed at a step, compare with the previous trip's notes. Two in a row at the
  same step → the stop rule in READOUTS.md applies: pause before the next trip starts.
- Any defect heard goes into `docs/pilot/INCIDENTS.md` with the trip and the step.
- Nothing said on the call changes a readout. The readouts come from the form and the
  tables only; the call explains them.
