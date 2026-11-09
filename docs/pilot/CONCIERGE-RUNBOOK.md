# Concierge runbook (pilot)

During the pilot, anything Reach cannot book through an API or hand off with
a link goes to a person, and that person is the owner. The business model
(§4E C4) keeps this as an exception queue with a count and an SLA, shown in
ops and never in member UI. This file is that SLA and the words to use.

**The SLA: a human reply within 2 hours** of the request, between 8am and
10pm in the member's time zone. A request made after 10pm gets its reply by
10am. The reply doesn't have to be the answer. It has to be true, and it has
to say when the answer will come.

This is an ops document. The member never sees the words "concierge",
"queue", "lane", "agent" or "bot". The messages below are written to be
sent as they are.

---

## Every two hours (while the pilot is running)

1. **Look at what is open.** Read-only, in the Supabase SQL editor:

   ```sql
   select b.id, b.plan_id, b.vertical, b.status, b.created_at,
          now() - b.created_at as waiting, b.detail
     from bookings b
    where b.mode = 'concierge'
      and b.status in ('pending', 'awaiting_approval')
    order by b.created_at;
   ```

   The count of rows is the queue size. Anything with `waiting` over
   1h30m comes first.

2. **For each request, check it against the trip before doing anything.**
   - The date, time and party size match the plan (`plans.start_date`, the
     itinerary day, `group_members` count minus anyone sitting it out in
     `item_optouts`).
   - The venue is a real, verified place: it is on the trip's itinerary from
     the menu, with a website or phone in `discovery_venues`. If it isn't,
     stop and write an incident, because the generator named something
     nothing vouches for.
   - What the venue says about bookings comes from the venue's own page or
     phone line, never from memory. Walk-in only means walk-in only.

3. **Send the first reply** (template 1) inside 2 hours, even if you have
   nothing yet.

4. **Do the work.** Use the venue's own booking page or phone. Never use a
   member's card or account without them asking in writing. A restaurant
   table is the member's to book on their own card, so give them the link
   (template 4) rather than booking it for them.

5. **Record the outcome where the member will see it.** The member marks
   "I've got it" on the item, or tells you and you note it in the plan.
   Don't write to production rows by hand without logging it as an incident.

6. **Log the minutes** in the table at the bottom: the "concierge minutes"
   term of contribution margin has no other source yet
   (docs/pilot/METRICS.md).

7. **Anything that went wrong** → `docs/pilot/INCIDENTS.md`, with a
   screenshot. Check whether it is the same step as the previous incident
   (the stop rule).

## Before the pilot starts

- [ ] Support channel chosen (SMS, WhatsApp or Slack) and every pilot member
      told what it is and that replies come within 2 hours, 8am–10pm.
- [ ] Health alert switched on: `CRON_SECRET` and `APP_URL` repository
      secrets set, one manual "Run workflow" of **Health alert** with
      *dry* ticked shows `failing: 0`.
- [ ] `ALERT_EMAIL` set in Vercel if alerts should go somewhere other than
      hello@alcanzar.io.
- [ ] A phone alarm every two hours, 8am–10pm, for the length of the pilot
      window.

---

## Messages

Fill the `{…}` parts. Every fact in a message must be one you checked today:
a time on the venue's own page, a confirmation number you were given, a
link that opens. Leave out anything you haven't checked.

Write to one person. If several people asked, send each their own message.

**1. Seen it (inside 2 hours, always)**

> Hi {first name}, it's {your name} from Reach. I've got your request for
> {what} on {day} for {number} people. I'll message you by {time} with
> whether it can be done. If you'd rather sort it yourself, this is where
> to book: {link}

**2. Booked (only with a confirmation in hand)**

> {What} is booked: {day} at {time}, for {number}, under {name on the
> booking}. Confirmation number {number}. It's on your trip page as well.

**3. Not available, with two other options ready**

> {Venue} has nothing for {number} on {day}. Two places that do have space:
> {option A}: {link}
> {option B}: {link}
> Tell me which one you'd like and I'll check it straight away.

**4. Yours to book (a table on your own card, or a site only you can use)**

> {Venue} books through {platform}, and it's worth doing on your own
> account so your card's dining perks count. Here's the page for {day},
> {number} people: {link}. Tap "I've got it" on the trip once you're in.

**5. Walk-in only (only if the venue's own page or phone says so)**

> {Venue} doesn't take bookings. Their own site says it's walk-in only
> ({link}). If you'd rather have something booked, {option A} takes
> reservations: {link}

**6. Something needed from you**

> To book {what} I need {the one thing}. You can add it here: {link}.
> Nothing has been charged.

**7. Running late on an answer (before the time you promised passes)**

> I said I'd have an answer on {what} by {time}, and I don't yet. Sorry.
> {Venue} hasn't replied. I'll try once more and message you by {new time}.
> If it's still nothing, I'll send you two other places that have space.

**8. On the day, something changed**

> Heads up about {what} today: {what changed, exactly as the venue said
> it}. {What you've done, or the two options with links}. Reply here if
> you want me to look at anything else.

---

## Minutes log

The concierge-minutes term of contribution margin, until there is a source
in the app. One row for each request handled.

| Date | Plan id | Booking id | What | Minutes | Outcome |
|---|---|---|---|---|---|
| | | | | | |
