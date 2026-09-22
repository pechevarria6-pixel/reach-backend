# Consolidated fix list — status, 2026-09-22

Against `reach-fixes.md`. Every ✅ names what was actually wrong, because in
most cases it was not what the item said it was. Nothing here is marked done
on the strength of a diff: where it says verified, it was opened, probed or
read back.

| # | Item | State |
|---|---|---|
| 1 | "Book it" must produce real links before confirming | ✅ |
| 2 | Booking flow needs the full itinerary | ✅ **this was the root cause** |
| 3 | Real reservation URLs from restaurant sites | 🔒 needs the migration |
| 4 | Never invent a reservation option | ✅ |
| 5 | Walk-in-only flagged correctly | ✅ |
| 6 | Fabricated "main event" | ✅ |
| 7 | "Check into the hotel" with no hotel | ✅ |
| 8 | Budget broken down per day | ✅ |
| 9 | Event roll-up into a calendar | ✅ |
| 10 | Home: duplicated notifications and content | ✅ |
| 11 | Remove "Jump back in" | ✅ |
| 12 | Pay + Book It tabs on one screen | ❓ **cannot find it** |
| 13 | "Make a day of it" triggering incorrectly | 🟡 partly — see below |
| 14 | "Everyone's in" on a solo trip | ✅ |
| 15 | "We're on it" dead end | ✅ |
| 16 | Book It screen: placeholders, failures, confirm gate | ✅ |
| 17 | Multiple ticket sources | ✅ box office 🔒 |

---

## The one that mattered — item 2

"Book everything books nothing" was not a booking bug. Two paths built the
itinerary and one was missing half:

```
generate:  [...fixedCostRows(trip), ...itineraryRows(days)]
rebuild:   itineraryRows(days)
```

Saving an itinerary replaces it wholesale, so pressing **"Plan my days for
me"** deleted the flight, the stay and the transfers — the only lines
carrying `booking_mode: "reach"`, which is all `/bookable` looks at. One
press and the trip was permanently unbookable, silently.

Moab: 39 lines, **zero** bookable, $893 of its own budget missing from its
own budget screen. Across all plans: 61 `walk_in`, 27 `ahead`, 12 `reach`.

Fixed in `lib/itinerary-rebuild.ts`, with a test that rebuilds a trip and
counts what is still bookable. Both stripped trips had a stay restored, and
the bridge was then run against production:

```
Moab (started Sep 17)      → "No rates available"
Puerto Vallarta (Nov 2–9)  → "We need the name of whoever the room is
                              under before this can be booked."
```

Which is the point: it reached LiteAPI and asked a real question. LiteAPI
works — there are confirmed hotel bookings in the table at $334.01.

## Where each item actually landed

**1, 15, 16** — Checkout lists everything Reach cannot book, on both the
review and success screens, each with a link or a phone number and a way to
mark it done. Failures show the provider's own reason plus "Try these again"
and "Carry on without them" — blocking outright would strand Moab, whose
flight cannot succeed at any price. `"Trip item (details coming)"` is gone:
eleven rows had no detail, and they now fall back to the itinerary line, then
to an honest description. `BOOKING_STATE.pending` said "We're on it"; it says
"Yours to book", because nobody at Reach is on it.

**4, 5** — Pasta Jay's is walk-in only and Vic's takes no reservations, and
both said "Reserve ahead". That is a claim about a venue's policy and nothing
had checked it. The pill says "Yours to book" until the migration that would
settle it has run.

**6** — Two plans had the model describing the slot instead of filling it:
*"This is the slot for the thing Peter already has in mind."* `lib/filler.ts`
catches it, the generator drops the slot, both rows deleted. In the Italian
one the real birthday dinner was sitting in the "After" slot all along.

**7** — The prompt built accommodation as `(prefs.accommodation || []).join(', ') || 'hotel'`,
so a group who said nothing was *told* they were in a hotel. Five lines
scrubbed; `lib/stay-claims.ts` catches it regardless of the prompt.

**9** — 236 events had no date and many said one plainly: "Fri, Sep 25".
`lib/discovery/when.ts` reads them, and the weekday is the check on the year
— Sep 25 is a Friday in 2026 and a Thursday in 2025. Only the 19 a weekday
confirmed were written; 20 unconfirmed were left alone. Discover opens with
seven days of what is on, weekly nights marked "every week".

**17** — Every URL was requested before being written down:
`stubhub.com/search?q=` 200, `vividseats.com/search?searchTerm=` 200,
`stubhub.com/find/s/?q=` **404** (the shape that looks right), `seatgeek.com`
**403** — unverifiable, so not shipped.

## Still open

**#3 and the box office half of #17** need migrations the owner runs:
`sql/venue-box-office-2026-09-22.sql`, `sql/day-offer-2026-09-22.sql`, and the
older reservation-platform one. Until that last lands, nothing in the database
knows whether any venue takes bookings — which is why #4 and #5 are a copy fix
rather than a data fix.

**#12** — there are no "Pay" and "Book it" tabs in the code. The plan screen's
tabs are overview / itinerary / budget and checkout is one screen. Either it is
already consolidated or it is a screen not reachable without a funded plan.
Which screen the screenshot was of would settle it in minutes.

**#13** — generation is correct: both paths send `mode: "night"`, and night-out
plans in the table have three evening slots, not a day. What was wrong is that
the rebuild path threw the *offer* away, so "let's make a day of it"
disappeared. Fixed. The offer still lives only in browser memory, so it does
not survive a reload until `day-offer` is run.

## Two guards were lying

`check:vocabulary`'s matcher excluded apostrophes from its content class, so
**every sentence with an apostrophe was invisible to it**. `"We're on it"` — on
its own banned list — sat on screen, green on every run since the ban was
written. `check:spelling` had the identical hole. Both fixed and proven by
planting the phrase back.
