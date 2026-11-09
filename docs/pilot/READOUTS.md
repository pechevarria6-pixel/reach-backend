# Pilot readouts — pre-registered

**Status: DRAFT — awaiting owner approval (pilot gate B4).** Once approved, this file is
locked before trip one: the four metrics, their baselines, the SQL that computes them and
the rule that decides each are fixed. A change after trip one is recorded as a dated
amendment at the bottom, with the reason, and the original rule is still reported beside
it. The point of pre-registering is that we cannot choose the yardstick after seeing the
numbers.

Sources: REACH-PILOT-GATE-2026-11-08.md (readiness item 8), REACH-BUSINESS-MODEL-2026-11-08.md
§3. Written 2026-11-08 by the Verify track.

| # | Readout | Baseline | Pre-registered rule (headline) |
|---|---|---|---|
| R1 | Proposed → funded conversion | **24%** (Talker 2026) | materially above = one-sided exact binomial p < 0.05 against 24% — at n = 10, **6 of 10** |
| R2 | Member → organiser conversion | **30%** | above target = more than 30%; materially above = binomial p < 0.05 against 30% |
| R3 | Organiser hours (and messages) per trip | **19 h** (and **83** messages) | materially below = median ≤ 8 h **and** at most 2 trips at 10 h or more; messages median ≤ 45 |
| R4 | Post-trip NPS (organiser) | **50** | met = NPS ≥ 50; materially above = NPS ≥ 70; failed = NPS < 30 |

---

## 0. The cohort, defined once

Every query below starts from the same two parameters. Fill them in when this file is
approved and never edit them afterwards.

- **The pilot window** — the dates the owner sets in B4 (suggested six weeks). A plan is in
  the pilot if it was *created* inside the window.
- **The pilot groups** — the ten recruited groups, listed by id. An explicit list, not
  "everything that isn't a test": the QA groups (`a9eba014-…`, `7cb00571-…`), the owner's
  demo plan (`b21bae42-…`) and every e2e run then stay out by construction, and so does any
  group that turns up during the window without having been recruited.
- **Solo plans are excluded** from every readout (`plans.solo_mode = true`, or
  `solo = true` on a debrief). There is no group to convert and nobody to coordinate.
- **Readout date** — window end + 14 days, so a trip that was booked in the last week can
  still be debriefed. Plans still open on that date count as *not converted*.

Paste this block in front of each query:

```sql
with params as (
  select timestamptz '2026-00-00 00:00 America/New_York' as window_start,  -- owner fills in
         timestamptz '2026-00-00 00:00 America/New_York' as window_end
),
pilot_groups(group_id) as (values
  ('00000000-0000-0000-0000-000000000000'::uuid)   -- one row per recruited group (ten)
)
```

Type notes, because they bite: `bookings.plan_id` and `contributions.plan_id` are `text`;
`plans.id` is `uuid`. Every join below casts both sides to text.

---

## R1. Proposed → funded conversion (baseline 24%)

**Question.** Of the group plans a pilot group started, what share reached the point where
the group had committed money (or, where nothing needed pooling, had something actually
held)?

**Definition.**
- *Proposed*: every non-solo plan created in the window in a pilot group — including plans
  later called off, and plans deleted (from `plan_deletions`, so deleting a stalled plan
  cannot improve the number).
- *Funded*: the Reach-booked (native) target is covered by succeeded contributions net of
  refunds; or, for a plan with no native target (everything booked by the members on the
  partner's own site, P3/P4), at least one booking is confirmed or one itinerary line is
  marked held. Funded counts even if the trip was later called off; a called-off-after-funding
  trip is reported beside the number.

```sql
-- (params + pilot_groups block here)
, proposed as (
  select p.id, p.status
    from public.plans p
    join pilot_groups g on g.group_id = p.group_id, params
   where p.created_at >= params.window_start and p.created_at < params.window_end
     and coalesce(p.solo_mode, false) = false
),
deleted as (   -- needs sql/pilot-gate-2026-11-08.sql (plan_deletions)
  select d.plan_id
    from public.plan_deletions d
    join pilot_groups g on g.group_id = d.group_id, params
   where d.created_at >= params.window_start and d.created_at < params.window_end + interval '14 days'
     and not exists (select 1 from public.plans p where p.id = d.plan_id)
),
target as (
  select b.plan_id::text as plan_id, sum(coalesce(b.price_cents, 0)) as cents
    from public.bookings b
   where b.mode = 'native' and b.status not in ('cancelled', 'failed')
   group by 1
),
paid as (
  select c.plan_id::text as plan_id, sum(c.amount_cents - coalesce(c.refunded_cents, 0)) as cents
    from public.contributions c
   where c.status in ('succeeded', 'partially_refunded')
   group by 1
),
held as (
  select b.plan_id::text as plan_id from public.bookings b where b.status = 'confirmed'
  union
  select i.plan_id::text from public.itinerary_items i where i.is_confirmed
),
per_plan as (
  select pr.id, pr.status,
         case when coalesce(t.cents, 0) > 0 then coalesce(pd.cents, 0) >= t.cents
              else h.plan_id is not null end as funded
    from proposed pr
    left join target t on t.plan_id = pr.id::text
    left join paid   pd on pd.plan_id = pr.id::text
    left join held   h on h.plan_id = pr.id::text
)
select
  (select count(*) from per_plan) + (select count(*) from deleted)              as proposed,
  (select count(*) from per_plan where funded)                                  as funded,
  round(100.0 * (select count(*) from per_plan where funded)
        / nullif((select count(*) from per_plan) + (select count(*) from deleted), 0), 1) as pct,
  (select count(*) from per_plan where funded and status = 'cancelled')         as funded_then_called_off;
```

**Decision rule.** Exact one-sided binomial test of `funded` out of `proposed` against
p = 0.24. *Materially above* when p < 0.05. The smallest qualifying count, so nobody has
to compute it on the day:

| proposed (n) | 6 | 8 | 10 | 12 | 14 | 16 | 20 |
|---|---|---|---|---|---|---|---|
| funded needed | 4 | 5 | **6** | 6 | 7 | 8 | 9 |

Below that but above 24%: *directionally above, not established*. At or below 24%: *no
better than the chat*. Cross-check: the count of `plan_fully_funded` events for the same
plans should match the native-target branch; a mismatch is investigated before reporting.

---

## R2. Member → organiser conversion (baseline 30%)

**Question.** Of the people who arrived in a pilot group as somebody else's guest, what
share went on to organise a group plan of their own?

**Definition.**
- *Members*: people who joined a pilot group during the window and did not create it, and
  had not created any non-solo plan anywhere before they joined. One row per person (their
  first such join).
- *Became organiser*: created a non-solo plan, in any group, after that join and before the
  readout date.

```sql
-- (params + pilot_groups block here)
, joins as (
  select distinct on (gm.user_id) gm.user_id, gm.joined_at
    from public.group_members gm
    join pilot_groups g on g.group_id = gm.group_id
    join public.groups gr on gr.id = gm.group_id, params
   where gm.joined_at >= params.window_start and gm.joined_at < params.window_end
     and gm.user_id is distinct from gr.created_by
   order by gm.user_id, gm.joined_at
),
members as (
  select j.* from joins j
   where not exists (select 1 from public.plans p
                      where p.created_by = j.user_id and p.created_at < j.joined_at
                        and coalesce(p.solo_mode, false) = false)
),
converted as (
  select m.user_id,
         exists (select 1 from public.plans p, params
                  where p.created_by = m.user_id and p.created_at > m.joined_at
                    and p.created_at < params.window_end + interval '14 days'
                    and coalesce(p.solo_mode, false) = false) as organised
    from members m
)
select count(*) as members,
       count(*) filter (where organised) as became_organisers,
       round(100.0 * avg(organised::int), 1) as pct
  from converted;
```

How they joined, for the write-up (not the rule): accepted invitations are
`group_invites.status = 'accepted'` with `accepted_by = user_id`; link opens and sign-ups
are the `invite_link_opened` / `invite_signup` events.

**Decision rule.** *Above target* when pct > 30%. *Materially above* when the exact
one-sided binomial test against p = 0.30 gives p < 0.05:

| members (n) | 10 | 15 | 20 | 25 | 30 | 40 | 50 |
|---|---|---|---|---|---|---|---|
| organisers needed | 6 | 9 | 10 | 12 | 14 | 18 | 21 |

Caveat stated in advance: six weeks is short for somebody to go from guest to organiser,
so a low number here is weak evidence against the loop; a high one is strong evidence for it.

---

## R3. Organiser hours and messages per trip (baseline 19 h, 83 messages)

**Question.** How much of the organiser's time and attention did a trip take?

**Source.** The post-trip debrief (`POST /api/plans/[planId]/debrief`,
`components/pilot/DebriefForm.jsx`), asked of the organiser only, once per trip, after a
trip that happened. Answers are ranges, stored as one representative value each
(`components/pilot/rules.ts`; the migration's check constraint holds the same values):

| hours tapped | stored | | messages tapped | stored |
|---|---|---|---|---|
| Under an hour | 0.5 | | Under 10 | 5 |
| 1–3 hours | 2 | | 10–30 | 20 |
| 3–6 | 4.5 | | 30–60 | 45 |
| 6–10 | 8 | | 60–100 | 80 |
| 10–20 | 15 | | More than 100 | 130 |
| More than 20 | 25 | | | |

The message count is optional and travels in the event as **`messages`** (a number —
`lib/track.ts` keeps it as a counting key; `pilot_metrics` reads the same name). One debrief
per trip: the first one submitted.

```sql
-- (params + pilot_groups block here)
, debriefs as (
  select distinct on (e.plan_id) e.plan_id, p.type,
         (e.props->>'hours')::numeric           as hours,
         (e.props->>'messages')::numeric        as msgs,
         (e.props->>'nps')::int                 as nps,
         (e.props->>'would_run_again')::boolean as would_run_again
    from public.events e
    join public.plans p on p.id = e.plan_id
    join pilot_groups g on g.group_id = p.group_id, params
   where e.name = 'debrief_submitted'
     and p.created_at >= params.window_start and p.created_at < params.window_end
     and coalesce((e.props->>'solo')::boolean, false) = false
   order by e.plan_id, e.created_at
)
select count(*)                                               as trips,
       percentile_cont(0.5) within group (order by hours)    as median_hours,
       round(avg(hours), 1)                                   as mean_hours,
       count(*) filter (where hours >= 15)                    as trips_10h_or_more,
       count(msgs)                                            as trips_with_msgs,
       percentile_cont(0.5) within group (order by msgs)     as median_msgs,
       count(*) filter (where would_run_again)                as would_run_again
  from debriefs;
-- Split by night out vs trip: add `group by type`.
```

Once `sql/pilot-debrief-2026-11-08.sql` has run, the same numbers are in
`public.pilot_debriefs` (columns `hours`, `messages`, `nps`, `would_run_again`, `solo`, and
the free-text `almost_quit`), one row per organiser per plan; use it to read the notes and
as a cross-check — the two sources must agree before reporting.

**Decision rule.** The baseline is a mean of self-reports for multi-day trips; ours are
ranges, so the rule is on the median and the tail.
- *Materially below 19 h*: median ≤ 8 h (the 6–10 range or lower) **and** at most 2 trips
  answered 10–20 or more than 20.
- *Messages materially below 83*: median ≤ 45 (the 30–60 range or lower), over the trips
  that answered it, and only reported if at least 6 trips answered.
- Otherwise: *not established*. Report nights out and weekend trips separately as well as
  together; the 19 h baseline describes trips, and a night out beating it says little.

---

## R4. Post-trip NPS (target 50)

**Question.** "How likely are you to recommend Reach to a friend?" (0–10), asked in the
same debrief.

**Definition.** NPS = % promoters (9–10) − % detractors (0–6), over the debriefs in R3.
These are organisers' scores — the people who did the work. Members answer a different,
three-point "How was it?" (`trip_reviews`) that is not converted into an NPS.

```sql
-- (params + pilot_groups block + the `debriefs` CTE from R3 here)
select count(*) as answers,
       count(*) filter (where nps >= 9) as promoters,
       count(*) filter (where nps <= 6) as detractors,
       round(100.0 * (count(*) filter (where nps >= 9) - count(*) filter (where nps <= 6))
             / nullif(count(*), 0)) as nps
  from debriefs;
```

**Decision rule.** *Met* at NPS ≥ 50; *materially above* at NPS ≥ 70; *failed* below 30;
between 30 and 49 *inconclusive*. With ten answers each person moves the score by ten
points, so the counts are always reported next to the score.

---

## Sample size, said before the numbers exist

Ten trips is a pilot, not a study.
- A 95% interval on 5 of 10 runs from 24% to 76% (Wilson). Only a large effect can be
  distinguished from the 24% baseline, which is why R1's bar is 6 of 10.
- R3 and R4 rest on one answer per trip, from the person most invested in it going well,
  often a friend of the owner. They are biased upward; the write-up says so.
- R2 needs time the window does not give. Treat a miss as "not yet", a hit as real.
- No readout is re-cut after the fact (by city, by group size, by excluding a bad trip)
  to reach a threshold. Splits may be reported as description, never as the result.

## Pilot stop rule

**Two consecutive pilot trips failing at the same step → pause, fix, and only then start
the third.** Consecutive means in the order the trips were created. A trip *fails at a
step* when it stops there for good (called off, deleted, or still there at the readout
date) or when an incident at that step is logged in `docs/pilot/INCIDENTS.md` that the
group could not get past without the owner stepping in.

The steps, and the furthest one each trip reached — run weekly, and after every trip:

```sql
-- (params + pilot_groups block here)
select p.id, p.created_at, p.status,
       case
         when exists (select 1 from public.bookings b where b.plan_id::text = p.id::text and b.status = 'confirmed')
           or exists (select 1 from public.itinerary_items i where i.plan_id::text = p.id::text and i.is_confirmed) then '5 booked'
         when exists (select 1 from public.events e where e.plan_id = p.id and e.name = 'plan_fully_funded')  then '4 funded'
         when exists (select 1 from public.events e where e.plan_id = p.id and e.name = 'funding_started')    then '3b paying'
         when exists (select 1 from public.events e where e.plan_id = p.id and e.name = 'vote_cast')          then '3a voting'
         when exists (select 1 from public.events e where e.plan_id = p.id and e.name = 'trip_input_submitted') then '2 answers in'
         else '1 started'
       end as furthest_step
  from public.plans p
  join pilot_groups g on g.group_id = p.group_id, params
 where p.created_at >= params.window_start and p.created_at < params.window_end
   and coalesce(p.solo_mode, false) = false
 order by p.created_at;
```

Two adjacent rows that ended at the same step (and are no longer moving) trigger the
pause. The pause and its fix are logged in `docs/pilot/INCIDENTS.md`.

## Mapping to `pilot_metrics` (once the Observe track's view exists)

The SQL above reads base tables only, so it runs today and does not depend on the view.
When `pilot_metrics` lands (Observe track, A5), each readout should be re-derived from it
and the two must agree on the same cohort before the view is trusted:

| Readout | Base-table SQL here | Expected in `pilot_metrics` |
|---|---|---|
| R1 | `per_plan.funded` over `proposed` + `deleted` | plans created vs plans with funding complete, per plan, filterable to the pilot groups |
| R2 | `converted.organised` over `members` | joined-via-invite users and their first later plan (today's `v_organizer_conversion` is the event-based version; it only sees people with an `invite_signup` event) |
| R3 | `debriefs` from `debrief_submitted` (`hours`, `messages`) | organiser hours and message count per plan |
| R4 | `debriefs.nps` | NPS per plan, promoters/detractors |

If the view and this file disagree, this file is the pre-registered definition; the view
is fixed to match it, not the other way round.

## Amendments

None. (Format: date — what changed — why — the original rule's result, still reported.)
