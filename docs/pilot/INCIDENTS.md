# Pilot incidents

One entry for each time a pilot trip went wrong at a step, whether a member
saw it, it cost somebody time or money, or the stop rule could be triggered.
The stop rule: **two trips in a row failing at the same step means pause and
fix before the third.** Read the last two entries before every new trip.

The rule from CLAUDE.md applies here too. Write down what you saw on the
screen or in the row, not what you think happened. Attach the screenshot.
A bug that was never written down gets found a second time, at the same cost.

Newest first. Copy the template.

---

## Template

```
### YYYY-MM-DD — <step> — <one line: what the member saw>

- **Trip:** plan id `…` · group id `…` · trip N of 10 · night out / weekend trip
- **Step:** quiz · options · vote · checkout/pay · booking · on the trip · settle up · debrief
- **Who saw it:** organiser / member / only the logs / the health alert
- **What they saw:** the words on the screen, quoted exactly
- **Screenshot:** docs/pilot/incidents/YYYY-MM-DD-<slug>.png
- **What was actually true:** the row, the log line, the provider's answer
- **Cost:** minutes of the member's time · money moved or at risk · trust (did they say anything?)
- **Fix:** commit sha, or "not fixed: <why>", or "workaround: <what>"
- **Guard:** the test or check that now fails if it comes back, or "none: <why>"
- **Same step as the previous incident?** yes/no. If yes, the stop rule applies.
```

---

<!-- Entries go below this line. -->
