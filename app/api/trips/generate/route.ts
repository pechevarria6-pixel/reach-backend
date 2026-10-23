import { NextRequest, NextResponse } from 'next/server';
import { archetypeFor, playbookGuidance, PlaybookSchema } from '@/lib/playbooks';
import { datedDays } from '@/lib/calendar';
import { report } from '@/lib/report';
import { requireGroupMember, isFail } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import {
  ItinerarySchema, TRIPS_JSON_SCHEMA, ITINERARY_JSON_SCHEMA, parseTrips,
  parseModelJSON, textOf, normalizeTrips, dropFillerDays,
  OneSlotSchema, ONE_SLOT_JSON_SCHEMA, SlotAskSchema, type SlotAsk,
} from '@/lib/trip-schema';
import { applyRules, correctionNote } from '@/lib/generation-rules';
import { tripBreach } from '@/lib/vetoes';
import { splitVetoes, weatherLine } from '@/lib/weather-no-go';
import { planReadiness, wentAheadWith, type ReadinessReport } from '@/lib/plan-readiness';
import { howIsIt, climatePromptBlock, climateVetoes, COLD_HIGH_C, HOT_HIGH_C } from '@/lib/climate';
import { readClimate, climateFor, ideasWithClimateNow } from '@/lib/climate-store';
import { generationHints } from '@/lib/traveler-profile';
import { readProfiles } from '@/lib/quiz-store';
import {
  readGroupAnswers, answersBlock, standingWishesBlock, groupFraming, attributes, nightPrefsFrom,
  optionsGate, notYetAnswered, isUndecided, type GroupAnswers,
  mayGoAhead, goAheadDecision, whoShapesIt, PLANNED_WITH_ANSWERED,
} from '@/lib/group-answers';
import { allowance, tooOften, rebuiltTooOften, PER_HOUR, REBUILDS_PER_HOUR } from '@/lib/rate-limit';
import { placeFromGoal, nightCityFor, partyFromGoal } from '@/lib/goal';
import { actWords, eventFromCache, eventFromProvider, eventFacts } from '@/lib/discovery/find-event';
import { within } from '@/lib/deadline';
import { cachedDestinationPhoto } from '@/lib/discovery/destination-photo';
import { locate } from '@/lib/discovery/geocode';
import { normalise } from '@/lib/discovery/verify';
import { randomUUID } from 'node:crypto';
import { ideasFrom, findDecision, isOrganiser, daysDecision, ideasReadyCopy, type SavedIdeas, type TripIdea } from '@/lib/trip-vote';
import { readSavedIdeas, saveIdeas, attachDays, clearVotes, membersOf, organiserOf, organisersOf, firstName } from '@/lib/trip-ideas-store';
import { notifyUsers } from '@/lib/notify-user';
import { pushSender } from '@/lib/push';
import { placesFor, placeMenu, scenesFrom, cleanRef, placeOf, type RealPlace } from '@/lib/discovery/real-places';
import { placeRef } from '@/lib/itinerary-alternatives';
import { track, isEventName } from '@/lib/track';
import { away, farEnough } from '@/lib/away';
import { isNear, awayPromptBlock, awayGaps, awayCorrection, awayEstimate, awayLines, rowOf, type AwayEstimate } from '@/lib/away-lines';
import { arrivalFor } from '@/lib/booking/arrival';
import { awayMissing, afterAwayRebuild } from '@/lib/itinerary-rebuild';
import { readSkips } from '@/lib/participation';
import { readBackDays, clearPhotos, attachTicket, vouchedGeography, asGenSlot, oneSlotReadBack, type ReadBackEnv, type GenDay, type GenSlot } from '@/lib/itinerary-readback';

/** Logged when a stop is dropped for being nowhere near the rest of its day. */
const DROPPED_LOCATION: string = 'itinerary_item_dropped_location';

// ─── Models ──────────────────────────────────────────────────────────────
// Stage 1 only names destinations and estimates costs, and the person is
// staring at a spinner while it runs, so it takes the fast model. Stage 2
// writes the itinerary somebody will actually follow, so it takes the
// capable one. Both were claude-sonnet-4-6, a previous generation.
const FAST_MODEL = 'claude-haiku-4-5';
// Opus 5 with adaptive thinking took 114 seconds for a 7-day itinerary, past
// the platform's function ceiling, so the request was killed and the itinerary
// never arrived at all. Measured alternatives for the same prompt:
//   opus-5 + adaptive thinking  114s   6654 tokens
//   opus-5, effort low           49s   2668 tokens
//   sonnet-5, effort medium      24s   1760 tokens
//   sonnet-5, effort low         14s   1134 tokens
// Medium keeps the detail that makes an itinerary worth following — real venue
// names, tips you would only know on a second visit — at a fifth of the wait.
const QUALITY_MODEL = 'claude-sonnet-5';
const QUALITY_EFFORT = 'medium' as const;

// Explicit rather than inherited, so the ceiling is visible next to the call
// that has to fit inside it.
export const maxDuration = 120;


// Constrained generation is the right tool, but a schema the API will not
// accept is a 400 on every single request — which is exactly how this feature
// went down: `minItems: 3` is rejected outright, and nothing worked until it
// was removed. A malformed schema should degrade to the unconstrained prompt,
// not take trip planning with it.
async function withSchemaFallback(
  client: Anthropic,
  model: string,
  maxTokens: number,
  prompt: string,
  schema: Record<string, unknown>,
  label: string,
  effort?: 'low' | 'medium' | 'high',
) {
  const call = (tokens: number, extra: string, constrained: boolean) =>
    client.messages.create({
      model,
      max_tokens: tokens,
      messages: [{ role: 'user' as const, content: prompt + extra }],
      ...(constrained
        ? { output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema' as const, schema } } }
        : effort ? { output_config: { effort } } : {}),
    });

  let res;
  try {
    res = await call(maxTokens, '', true);
  } catch (e: any) {
    // Only a rejected request falls back. A 429 or a 5xx is transient and
    // belongs to the caller's handler, which knows how to word it.
    if (e?.status !== 400) throw e;
    console.error(`[${label}] schema rejected, retrying unconstrained:`, e?.message);
    res = await call(maxTokens, '', false);
  }

  // A truncated response is valid right up to where the tokens ran out, so it
  // parses as nothing. Rather than surface that as a failure, ask again with
  // more room and an explicit instruction to be brief. Once only — if it
  // overruns twice the prompt is wrong, and the caller reports it.
  if (res.stop_reason === 'max_tokens') {
    console.error(`[${label}] truncated at ${maxTokens} tokens, retrying briefer`);
    const briefer = '\n\nBe significantly briefer than you would normally be. ' +
      'Every prose field must be one short sentence or less. The complete ' +
      'response must fit well within the limit.';
    try {
      const retry = await call(Math.round(maxTokens * 1.5), briefer, true);
      if (retry.stop_reason !== 'max_tokens') return retry;
      console.error(`[${label}] truncated again at ${Math.round(maxTokens * 1.5)} tokens`);
      return retry;
    } catch (e: any) {
      console.error(`[${label}] briefer retry failed:`, e?.message);
      return res;
    }
  }

  return res;
}

// ─── Two rules every slot prompt carries, word for word ─────────────────
// Shared by the evening, the trip and the single-slot prompts so that a
// slot rewritten on its own is told exactly what the full generator is.
const TABLES_ARE_THEIRS = `Never "reach" for a restaurant, a bar or anything with a table. Reach does
not take tables: the member books their own, on their own account and their
own card, because that is where their card's dining benefits live — Amex
opens doors on Resy, Chase on OpenTable, and a reservation made by us on our
card throws all of that away. A place that takes bookings is "ahead"; one
that does not is "walk_in". Only a flight, a hotel or a ticketed tour is
"reach".`;

const NO_VENUE_FACTS = `Each slot's "tip" is about that slot and nothing else — never another stop,
never the day as a whole. Weather, crowds, terrain, light, parking, how long
getting there takes, what to bring — all good, and being wrong about them
costs an hour. A tip on a slot that names a place is about getting there or
the time of day, not about what is inside. Nothing true to say is an empty
string.

Never state a named business's opening hours, prices, cover charge, payment,
booking policy, or what it will do for you. "Milt's is cash-only and has no
ATM inside", "Woody's charges a cover after 9pm", "go right at open (5pm)" —
those read as fact, and being wrong about them costs somebody their evening.
You have not rung these places and neither have we. Write about the desert,
the queue and the light instead, or leave it empty.
The same rule covers the plan line itself. Name the place, describe the
outing, do not slip in a policy: "no cover if you sit at the bar",
"no reservations needed", "Sabaku's sister spot" — each asserts something
about a business that would have to be checked, and none of them was.`;

// A missing key disables this lane with a clean message rather than a crash.
function anthropicOrNull() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    groupId, startDate, endDate, budgetPerPerson,
    departureCity, departureAirport,
    // The place the night-out screen shows ("Out around …") — a picked place
    // or this device, which for an evening is where they are, not where
    // they live.
    nightPlace = null,
    detailTripId = null, // if set, generate full itinerary for one trip
    // A night out is not a short trip. No flights, no hotel, one evening, and
    // the only thing it needs asking that the taste quiz has not already
    // stored is roughly where it should be.
    mode = 'trip',
    // Where they already know they are going, if they do. With one, all three
    // options are that place at three budgets — somebody who has settled on
    // Breckenridge is choosing how to do it, not whether. Without one, three
    // different places that fit what they said they wanted.
    location = null,
    // What they wrote when asked what this trip is about. The most useful
    // thing on the form, because it is the only part not picked from a list.
    goalBlurb = null,
    // The group trip these options are for. A group trip exists before it
    // has a destination, so that everybody can answer the same questions
    // against it first; with this set, the options wait for all of them and
    // are built from all of them.
    planId: groupPlanId = null,
    // "Get three different ideas": the organiser throwing away a saved set
    // and everybody's votes on it. Without this a Find on a plan that
    // already has ideas shows those ideas and builds nothing.
    regenerate = false,
    // "Plan with who's answered": the organiser going ahead without waiting
    // for the last answers. Organiser only, and only once somebody besides
    // them has answered or the trip is 48 hours old (lib/group-answers.ts).
    withAnswered = false,
  } = body;
  // `let`: a group trip's own answers fill these when the caller did not
  // send them — which is every time somebody other than the organiser
  // presses "Find our trips", because the organiser's answers are theirs.
  let tripPrefs: Record<string, any> = body.tripPrefs && typeof body.tripPrefs === 'object' ? body.tripPrefs : {};
  let nightPrefs: Record<string, any> = body.nightPrefs && typeof body.nightPrefs === 'object' ? body.nightPrefs : {};
  // `let`, because a saved plan can correct a caller that did not say — see
  // the detail branch below.
  let isNightPlan = mode === 'night';

  // This reads every member's dietary needs, budget and preferences, so the
  // caller has to actually be in the group.
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });
  const ctx = await requireGroupMember(groupId);
  if (isFail(ctx)) return ctx.error;
  const supabase = ctx.db;

  // "Something else…" on one stop: which day, which part, and what instead.
  // Only on a plan or an option that already has days — there is no stop to
  // change on one that has none.
  const slotParsed = body.slot != null ? SlotAskSchema.safeParse(body.slot) : null;
  if (slotParsed && !slotParsed.success) {
    return NextResponse.json({ error: 'Say which stop to change — the day, and which part of it.' }, { status: 400 });
  }
  const slotAsk: SlotAsk | null = slotParsed?.success ? slotParsed.data : null;
  if (slotAsk && !detailTripId) {
    return NextResponse.json({ error: 'A stop can only be changed on a plan that has its days.' }, { status: 400 });
  }

  // ── A group trip waits for everybody ───────────────────────────────
  // The owner's rule: group trip quizzes wait on each other, so every option
  // is built from everybody's input. Checked before the rate limit, because
  // being told who the trip is waiting for should not cost anybody one of
  // their generations for the hour.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (groupPlanId != null && !UUID.test(String(groupPlanId))) {
    return NextResponse.json({ error: 'planId must be the id of a saved plan' }, { status: 400 });
  }

  // How many people are in this group, counted from the table — never from
  // the plan's solo_mode, which the client sets, and never from anything in
  // the request. A group of one is somebody travelling alone; anything more
  // is a group, and a group's trip is found from everybody's answers.
  const { count: memberCount, error: countError } = await supabase
    .from('group_members').select('user_id', { count: 'exact', head: true })
    .eq('group_id', groupId);
  if (countError || memberCount == null) {
    console.error('[generate] could not count the group', { groupId, code: countError?.code });
    return NextResponse.json(
      { error: 'We could not check who is in this group — try again in a moment.' },
      { status: 503 },
    );
  }
  const isGroup = memberCount > 1;

  // New places from answers — the three options, or the days of one of them
  // (a local id, not a saved plan) — as against rebuilding the days of a
  // trip that already exists.
  const detailIsPlan = detailTripId != null && UUID.test(String(detailTripId));
  const fromAnswers = !detailIsPlan;

  // The server end of the owner's rule. The client only asks with a planId
  // for a group, but a browser still running an older bundle does not, and
  // "is this a group" on the client is a guess from whatever it has loaded.
  // Without a group trip to wait on, there is nobody's answers to wait for —
  // so a group gets nothing here built from one person's say-so. That
  // includes the days of an option, which would otherwise be a way to have
  // any destination written up from standing profiles alone.
  if (isGroup && fromAnswers && !groupPlanId) {
    console.error('[generate] refused: a group asked without a group trip', {
      groupId, stage: detailTripId ? 'itinerary' : 'options', members: memberCount,
    });
    return NextResponse.json({
      error: "A trip for a group is found from everyone's answers. Start it with "
        + '"Plan a Trip Together" and Reach finds the options once everyone has answered.',
      needsGroupTrip: true,
    }, { status: 409 });
  }

  let groupPlan: { id: string; created_by: string | null; created_at: string | null; type: string | null; solo_mode: boolean | null; title: string | null } | null = null;
  // Set when the organiser went ahead with who had answered: whose wishes
  // the prompt may carry. Null means everybody's, as it always was.
  let answeredOnly: Set<string> | null = null;
  // The organiser's go-ahead, recorded only once the ideas are built.
  let goAhead: { answered: number; members: number } | null = null;
  // Whether plans.trip_options exists yet (sql/trip-options-2026-09-23.sql),
  // and which saved set a regenerate is replacing.
  let ideasAvailable = false;
  let replacing: string | null = null;
  let groupAnswers: GroupAnswers | null = null;
  if (groupPlanId) {
    const { data: row } = await supabase
      .from('plans').select('id, group_id, created_by, created_at, type, solo_mode, destination_style, title, status')
      .eq('id', String(groupPlanId)).maybeSingle();
    // Membership was checked against groupId; the plan has to be in that same
    // group, or a member of one group could read another group's answers
    // into a prompt by naming its plan.
    if (!row || String(row.group_id) !== String(groupId)) {
      return NextResponse.json({ error: 'That trip is not in this group' }, { status: 404 });
    }
    groupPlan = {
      id: String(row.id), created_by: row.created_by ? String(row.created_by) : null,
      created_at: row.created_at ? String(row.created_at) : null,
      type: row.type ? String(row.type) : null, solo_mode: row.solo_mode === true,
      title: row.title ? String(row.title) : null,
    };
    if (groupPlan.type === 'restaurant') isNightPlan = true;

    // Nothing is built for a trip that was called off or is over — before
    // any paid model call, and said as what it is.
    if (row.status === 'cancelled' || row.status === 'completed') {
      return NextResponse.json(
        { error: row.status === 'cancelled' ? 'This trip was called off.' : 'This trip is over.', calledOff: row.status === 'cancelled' },
        { status: 409 },
      );
    }

    // Options are for a trip still deciding where it goes. Once somebody has
    // picked, a fresh three would be three nobody can choose — picking only
    // lands on an undecided trip — so they are not built, and not paid for.
    if (!detailTripId && !isUndecided(row)) {
      return NextResponse.json(
        { error: 'Somebody has already picked where this trip goes.', alreadyDecided: true },
        { status: 409 },
      );
    }

    // ── One set of ideas per trip ─────────────────────────────────────
    // The ideas are saved on the plan and the whole group votes on them, so
    // a second Find shows the saved three rather than building three more
    // over a vote in progress — and costs nothing. Only the organiser can
    // ask for different ones, because that throws everybody's votes away.
    if (!detailTripId && isGroup) {
      const read = await readSavedIdeas(supabase, groupPlan.id);
      if ('error' in read) {
        // Building anyway could put a second set over a vote in progress.
        console.error('[generate] refused: could not check for saved ideas', { plan: groupPlan.id, code: read.error });
        return NextResponse.json(
          { error: "We couldn't check for this trip's ideas just now — try again in a moment." },
          { status: 503 },
        );
      }
      ideasAvailable = read.available;
      const decision = findDecision({
        saved: read.ideas,
        regenerate: regenerate === true,
        organiser: isOrganiser({ role: ctx.role, createdBy: groupPlan.created_by, userId: ctx.user.id }),
      });
      if (decision.action === 'refuse') {
        return NextResponse.json({ error: decision.error }, { status: decision.status });
      }
      if (decision.action === 'show' && read.ideas) {
        // The saved ideas' weather for the dates asked about now, which may
        // not be the dates they were made for (lib/climate-store.ts).
        const shownTrips = await ideasWithClimateNow(supabase, read.ideas.options, { start: startDate, end: endDate });
        return NextResponse.json({ success: true, trips: shownTrips, ideas: publicIdeas(read.ideas), saved: true, shared: true });
      }
      if (decision.action === 'generate') replacing = decision.replacing;
    }

    // The options, and the days of each option, wait for everybody — gated
    // on how many people are in the group, not on the plan's solo_mode flag,
    // which is the client's to set. Rebuilding a saved plan's days is gated
    // below, by the rule that was already there for it.
    if (isGroup && fromAnswers) {
      let readiness: ReadinessReport;
      try {
        readiness = await planReadiness(supabase, groupPlan.id, String(groupId), false);
      } catch {
        console.error('[generate] could not check who has answered', { plan: groupPlan.id });
        return NextResponse.json(
          { error: 'We could not check who has answered yet — try again in a moment.' },
          { status: 503 },
        );
      }
      // Never solo here: isGroup was already decided from the member count, and
      // somebody leaving between the two reads must not open the gate.
      const gate = readiness.wentAhead ? { open: true, waitingOn: [] } : optionsGate(readiness.members, false);
      const organiser = isOrganiser({ role: ctx.role, createdBy: groupPlan.created_by, userId: ctx.user.id });
      if (withAnswered === true && !detailTripId) {
        // Server-enforced: only the organiser can go ahead, whatever the
        // screen offered. Only for the ideas: the days of an idea follow
        // from the go-ahead that built it, and are never where one starts.
        const go = goAheadDecision({
          organiser,
          allowed: gate.open || mayGoAhead({ members: readiness.members, createdBy: groupPlan.created_by, createdAt: groupPlan.created_at }),
        });
        if (go.action === 'refuse') return NextResponse.json({ error: go.error }, { status: go.status });
        if (!gate.open) {
          // Not recorded yet. The row says the ideas were built with who
          // had answered — the days, the vote, a rebuild and "Everyone's
          // in" all read it — so it is written once they have been, just
          // before they are saved. A go-ahead that is rate limited or whose
          // model call fails leaves no row, and the trip waits as before.
          goAhead = {
            answered: readiness.members.filter(m => m.answered).length,
            members: readiness.members.length,
          };
          gate.open = true;
          readiness = { ...readiness, wentAhead: true };
        }
      }
      if (!gate.open) {
        return NextResponse.json({
          error: notYetAnswered(gate.waitingOn, 'Reach finds your trips once everyone has.'),
          waitingOn: gate.waitingOn,
        }, { status: 409 });
      }
      if (readiness.wentAhead) answeredOnly = new Set(readiness.members.filter(m => m.answered).map(m => m.userId));
    }

    const read = await readGroupAnswers(supabase, groupPlan.id);
    if (read.error && !detailTripId) {
      // Everybody has answered and we cannot read what they said. Building
      // anyway would be building from nobody's answers after making them all
      // wait, so this says so instead.
      console.error('[generate] refused the options: could not read the answers', { plan: groupPlan.id, code: read.error });
      return NextResponse.json(
        { error: "We couldn't read everyone's answers just now — try again in a moment." },
        { status: 503 },
      );
    }
    groupAnswers = read;
    console.log('[generate] built from the group\'s answers', {
      plan: groupPlan.id, stage: detailTripId ? 'itinerary' : 'options', answered_by: read.userIds,
    });

    // Whoever set the trip up framed it — their first sentence is what the
    // trip is. When somebody else presses the button their device does not
    // have that sentence, and it is not theirs to be sent, so it comes from
    // the table instead.
    const framing = groupPlan.created_by ? read.byUser[groupPlan.created_by] : undefined;
    if (framing) {
      if (!Object.keys(tripPrefs).length) tripPrefs = framing.answers;
      if (isNightPlan && !Object.keys(nightPrefs).length) {
        const a = framing.answers;
        nightPrefs = {
          time: a.nightTime || '', where: a.nightWhere || '',
          kind: Array.isArray(a.nightKind) ? a.nightKind : [],
          food: Array.isArray(a.nightFood) ? a.nightFood : [],
          energy: a.nightEnergy || null,
        };
      }
    }
  }

  const framingGoal = groupPlan?.created_by ? groupAnswers?.byUser[groupPlan.created_by]?.summary ?? null : null;
  const goalText = typeof goalBlurb === 'string' && goalBlurb.trim() ? goalBlurb : framingGoal;
  const goal = typeof goalText === 'string' && goalText.trim() ? goalText.trim().slice(0, 500) : null;

  // Where they said it is.
  //
  // "dinner and drinks in Charlotte this Friday" names the city, and the
  // city was ignored — the plan was built around wherever the device thought
  // the person was. Somebody who tells us where they are going should not
  // then watch the app plan somewhere else.
  //
  // An explicit location still wins: a field somebody filled in is a
  // decision, and a phrase read out of a sentence is a reading of one.
  const said = typeof location === 'string' && location.trim() ? location.trim() : null;
  const fromGoal = said ? null : placeFromGoal(goal);
  if (fromGoal) console.log('[generate] took the place from what they wrote', { place: fromGoal });
  const fixedPlace = said ?? fromGoal;

  // Where an evening happens: the place they named, then the place on their
  // screen, then home. Home was all it ever used — "Birthday dinner in
  // Charlotte to celebrate my buddy who loves greek food" was planned at
  // Raleigh venues, because the night prompt read only departureCity. A trip
  // still departs from home; an evening happens where it happens.
  const nightCity = nightCityFor(fixedPlace, typeof nightPlace === 'string' ? nightPlace : null, departureCity ?? null);

  // Two model calls a go, and real money each time. Nothing stopped one
  // account doing this in a loop — a stuck retry, a leaning finger — and the
  // first anybody would know is the bill. Counted in the database, because a
  // counter in a module variable is per-instance and resets whenever a new
  // serverless instance starts, which is not a limit.
  //
  // Rebuilding the days of a plan that already exists is counted apart from
  // creating new ones. They are not the same act: creating asks for three
  // destinations nobody has chosen, while rebuilding is somebody fixing a
  // trip they already own — usually because the first answer was wrong,
  // which is precisely when the app should not be telling them to come back
  // in an hour. Separate budgets, so neither can starve the other.
  const rebuilding = !!detailTripId;
  const action = rebuilding ? 'itinerary_rebuilt' : 'trip_generated';
  const rate = await allowance(
    supabase, ctx.user.id, action,
    rebuilding ? REBUILDS_PER_HOUR : PER_HOUR,
  );
  if (!rate.allowed) {
    console.error('[generate] rate limited', { user: ctx.user.id, action, used: rate.used });
    return NextResponse.json(
      { error: rebuilding ? rebuiltTooOften(rate) : tooOften(rate) },
      { status: 429 },
    );
  }

  // Written before the work, not after: a generation that times out or
  // crashes still cost the money it cost, and a limit that only counts the
  // successes is a limit a failing loop walks straight through.
  const { error: counted } = await supabase.from('audit_logs').insert({
    user_id: ctx.user.id, action, resource: 'groups', resource_id: groupId, success: true,
    metadata: { mode, nights: null, plan: detailTripId ?? groupPlan?.id ?? null, ...(slotAsk ? { slot: `${slotAsk.day}:${slotAsk.part}` } : {}) },
  });
  if (counted) console.error(`[audit] could not record ${action} — this one is not counted`, { code: counted.code });

  // trip_summary arrives in sql/plan-preferences-2026-09-18.sql. Naming a
  // column that does not exist fails the entire select, and this select is
  // what trip generation is built on — so a migration that had not been run
  // yet would take the whole feature down rather than one line of a prompt.
  const WITH_SUMMARY = `users(id,name,budget_range,climate_preference,dietary_needs,
      cuisines,music_genres,dining_vibe,drink_style,nightlife_style,
      concert_types,activity_vibe,no_way_jose,trip_summary)`;
  const WITHOUT_SUMMARY = `users(id,name,budget_range,climate_preference,dietary_needs,
      cuisines,music_genres,dining_vibe,drink_style,nightlife_style,
      concert_types,activity_vibe,no_way_jose)`;

  const full = await supabase.from('group_members').select(WITH_SUMMARY).eq('group_id', groupId);
  const fallback = full.error && /trip_summary/.test(full.error.message || '')
    ? await supabase.from('group_members').select(WITHOUT_SUMMARY).eq('group_id', groupId)
    : null;
  const members = (fallback ?? full).data;
  if ((fallback ?? full).error) {
    console.error('[generate] could not read the group', { groupId, code: (fallback ?? full).error?.code });
  }

  // Everybody going — the party size, and the constraints that protect each
  // of them (dietary needs, hard nos, somebody not drinking) — and, apart
  // from that, whose wishes shape it. The two are the same list unless the
  // organiser went ahead with who had answered: then somebody who has not
  // said what they want from this trip adds nothing to what it is.
  const everyone = (members || []).map((m: any) => m.users).filter(Boolean);
  if (!answeredOnly && isGroup && detailIsPlan && await wentAheadWith(supabase, String(detailTripId))) {
    const { data: said, error: saidErr } = await supabase
      .from('plan_preferences').select('user_id, submitted_at').eq('plan_id', String(detailTripId));
    if (saidErr) console.error('[generate] could not read who answered for a trip that went ahead', { plan: detailTripId, code: saidErr.code });
    else answeredOnly = new Set((said ?? []).filter((r: any) => r.submitted_at).map((r: any) => String(r.user_id)));
  }
  const prefs = whoShapesIt(everyone, answeredOnly);
  // Who is going: the Reach members, or the party the sentence names, if
  // that is more. "Night out with my buddy … for his birthday" came from a
  // one-member group and was planned — and worded — as an evening alone:
  // "a menu built for eating slowly on your own". The buddy is not on Reach;
  // he is still going.
  const saidParty = partyFromGoal(goal);
  const groupSize = Math.max(everyone.length || 2, saidParty ?? 0);
  const notOnReach = Math.max(0, groupSize - (everyone.length || groupSize));
  // Travelling alone is a different trip, not a smaller one. The prompt used
  // to say "GROUP: 1 people" and then plan for a committee.
  const solo = groupSize <= 1;
  const partyLine = notOnReach > 0
    ? `${groupSize} people — one of them is planning this; the other${notOnReach === 1 ? ' is' : 's are'} not on Reach. Plan for all ${groupSize} and never write as if anybody is alone.`
    : null;
  // `let`, and recomputed if the saved plan turns out to be an evening.
  let nights = isNightPlan ? 1 : (startDate && endDate
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    : 5);

  // A night out is not a small trip, and the same answer means very
  // different money for each. Somebody who said "mid" means about $2,000 for
  // a week away and about $110 for an evening — and the evening was being
  // given the trip figure, so the prompt read "about $2000 a head across the
  // whole night". The model did as it was told: $900 for dinner, $500 for
  // the gig, $300 for a last pint. Seventeen hundred dollars for a Monday.
  const TRIP_BUDGET: Record<string, number> = { budget: 800, mid: 2000, premium: 4000, luxury: 8000 };
  const NIGHT_BUDGET: Record<string, number> = { budget: 45, mid: 110, premium: 220, luxury: 400 };
  const budgets = prefs.map((p: any) => p.budget_range).filter(Boolean);
  // Recomputed below if a listing turns what was asked for into an evening.
  const budgetFor = (night: boolean) => {
    const map = night ? NIGHT_BUDGET : TRIP_BUDGET;
    const fallback = night ? 110 : 2000;
    return budgetPerPerson
      || (budgets.length > 0 ? Math.min(...budgets.map((b: string) => map[b] || fallback)) : fallback);
  };
  // A group trip is priced for the person with the least to spend. The
  // standing answers were always read this way — the lowest bucket wins — and
  // the per-trip ones are a better version of the same question: an option
  // one of them cannot afford is not an option for the group.
  const lowestAsked = groupAnswers?.lowestBudget ?? null;
  const groupBudget = (night: boolean) => {
    const own = budgetFor(night);
    return lowestAsked && lowestAsked < own ? lowestAsked : own;
  };
  let effectiveBudget = groupBudget(isNightPlan);
  if (lowestAsked && lowestAsked < budgetFor(isNightPlan)) {
    console.log('[generate] priced for the lowest budget anybody gave', { plan: groupPlan?.id, budget: lowestAsked });
  }

  const everyVeto = [...new Set([
    ...everyone.flatMap((p: any) => p.no_way_jose || []),
    ...(tripPrefs.noWayJose || []),
    // What anybody going said, for this trip, that they will not do.
    ...(groupAnswers?.vetoes ?? []),
  // "custom:" is how the quiz stores a typed answer, not part of the answer.
  ].map((v: unknown) => String(v).replace(/^custom:/, '').trim()).filter(Boolean))];
  // A weather no-go is not a veto while nothing can check it: it leaves the
  // "never include" lists and is said once, as a wish we cannot verify
  // (lib/weather-no-go.ts). The model is never told it is enforced.
  const { hard: allVetoes, weather: weatherNos } = splitVetoes(everyVeto);
  // Everyone's own answers for this trip, for the options prompt. The
  // itinerary stage builds its own from the same reader below. For a group
  // they go in unnamed, under the rule that nobody's are ever said back:
  // everything the model writes here is shown to all of them.
  const groupWanted = !detailTripId && groupAnswers ? answersBlock(groupAnswers, { group: isGroup }) : '';
  const dietaryNeeds = [...new Set(everyone.map((p: any) => p.dietary_needs).filter((d: any) => d && d !== 'none'))];
  const cuisines = [...new Set(prefs.flatMap((p: any) => p.cuisines || []))];
  const musicGenres = [...new Set(prefs.flatMap((p: any) => p.music_genres || []))];
  const activityVibes = [...new Set(prefs.flatMap((p: any) => p.activity_vibe || []))];
  // Queried since the first version and never put in the prompt, so answering
  // these questions changed nothing about what came back.
  const climates = [...new Set(prefs.map((p: any) => p.climate_preference).filter(Boolean))];
  const diningVibes = [...new Set(prefs.map((p: any) => p.dining_vibe).filter(Boolean))];
  const drinkStyles = [...new Set(prefs.map((p: any) => p.drink_style).filter(Boolean))];
  const nightlife = [...new Set(prefs.map((p: any) => p.nightlife_style).filter(Boolean))];
  const concertTypes = [...new Set(prefs.flatMap((p: any) => p.concert_types || []))];

  // What each of them said about trips in general, in their own words.
  //
  // Everything above is a set of tick-boxes flattened across the group, and
  // the one thing somebody actually cares about is rarely on a list. "My
  // sister is turning forty" cannot be inferred from cuisines. For somebody
  // travelling alone it is theirs to have said back to them; for a group it
  // goes in unnamed and is never repeated, because the options are read by
  // everyone and nobody was told their words would be shown to the others.
  const standing = prefs.map((p: any) => ({
    name: String(p.name || '').trim().split(/\s+/)[0], text: String(p.trip_summary || '').trim(),
  }));
  const saidBlock = standingWishesBlock(standing, { group: isGroup });

  // How they like to travel, from the onboarding quiz: the dials, and how
  // far apart the group sits on them. Unnamed — the model's words are read
  // by everyone — and never a restriction, which have their own lines above.
  // Empty until sql/quiz-v3-2026-09-24.sql has run.
  // Two versions, because isNightPlan can still change below (a restaurant
  // plan, a named gig): a night out is one evening, and the trip wording —
  // "each day from morning to night", "the last night" — would tell the
  // model to plan a day it was never asked for.
  const travelProfiles = await readProfiles(supabase, prefs.map((p: any) => p.id));
  const someoneSober = !solo && everyone.some((p: any) => String(p.drink_style || '').trim().toLowerCase() === 'not drinking');
  const hintsBlock = (evening: boolean) => {
    const hints = generationHints(travelProfiles, { evening });
    // Somebody in a group not drinking is never said out loud, on any screen.
    // It is said here, once, so every evening has somewhere that is not a bar.
    if (someoneSober) {
      hints.push(`At least one of them is not drinking: ${evening ? 'the evening needs' : 'every evening needs'} a stop that is not built around alcohol. Never mention this in anything you write.`);
    }
    return hints.length ? `\nHOW THEY LIKE TO TRAVEL:\n- ${hints.join('\n- ')}` : '';
  };
  const travelBlock = hintsBlock(false);
  const eveningTravelBlock = hintsBlock(true);

  // The trip the options lead with. For a group trip that is everybody's
  // answers together — every kind of trip anybody asked for, every kind of
  // stay, and the group's pace — not the organiser's, which used to fill
  // these three lines while everybody else sat in a block further down.
  const together = isGroup && groupAnswers ? groupFraming(groupAnswers) : null;
  const tripTypes = (together?.tripTypes.length ? together.tripTypes : (tripPrefs.tripType || [])).join(', ') || 'any';
  const tripPace = together?.pace || tripPrefs.pace || 'balanced';
  // No default. This read `|| 'hotel'`, so a group who never said where they
  // wanted to stay was described to the model as staying in a hotel — and the
  // model, correctly following its brief, wrote the days around one. A real
  // Moab plan in the table opens with "check into the hotel", has "an
  // afternoon doing nothing in particular back at the hotel pool", and ends
  // with "check out of the hotel". That trip has no hotel item and no hotel
  // booking. The pool was invented on top of the hotel, which was invented by
  // this line.
  //
  // Empty is the honest value, and the prompt says what to do with it.
  const tripAccommodation = (together?.accommodation.length ? together.accommodation : (tripPrefs.accommodation || [])).join(', ');
  const departure = departureCity || 'a major US city';
  const departureCode = departureAirport || 'nearest major airport';
  // How far a place is from home, great-circle km, or null when either end
  // cannot be placed. Home is placed once, and only if something asks. It
  // decides whether an away plan's getting-there is a flight or a drive
  // (lib/away-lines.ts isNear), and whether a day trip is away at all.
  let homePlaced: ReturnType<typeof locate> | null = null;
  const kmFromHome = async (place: string, countryCode?: string | null): Promise<number | null> => {
    if (!departureCity || !place.trim()) return null;
    homePlaced ??= within(locate(String(departureCity)), 5000, 'placing home').catch(() => null);
    const [home, there] = await Promise.all([
      homePlaced, within(locate(place, countryCode ?? null), 5000, 'placing the trip').catch(() => null),
    ]);
    return away({ mode: 'trip', home, destination: there }).km;
  };

  // ── STAGE 2: Full itinerary for one selected trip ──────────────────────────
  if (detailTripId) {
    // city and country_code are carried through stage 1 precisely so the
    // place can be looked up rather than parsed back out of a display name.
    // The days of one of a group trip's saved ideas are written from the
    // idea as saved — the place, the vibe, the costs everybody is looking at
    // — not from whatever the caller sent, and are saved back onto it so
    // every member sees them.
    let ideaForDays: TripIdea | null = null;
    const organiser = !!groupPlan && isOrganiser({ role: ctx.role, createdBy: groupPlan.created_by, userId: ctx.user.id });
    if (groupPlan && isGroup && !detailIsPlan) {
      const read = await readSavedIdeas(supabase, groupPlan.id);
      ideaForDays = read.ideas?.options.find(o => o.id === String(detailTripId)) ?? null;
      // An idea whose days are written is everybody's copy. Anyone but the
      // organiser asking again is handed those days — no model call, and
      // nothing the group is voting on changes under them.
      // A single stop is a suggestion, not the group's copy of the days,
      // so anybody may ask for one; it is never saved here.
      if (!slotAsk && ideaForDays && daysDecision({ idea: ideaForDays, organiser }) === 'keep') {
        const kept = typeof ideaForDays.venueTitle === 'string' ? ideaForDays.venueTitle : null;
        // The idea's own away lines, from the estimate saved on it — the
        // same lines whoever wrote the days was given.
        const est = ideaForDays.away && typeof ideaForDays.away === 'object' && !isNightPlan ? ideaForDays.away as AwayEstimate : null;
        const fixed = est ? awayLines(est, {
          town: String(ideaForDays.city || ideaForDays.destination || 'the town'),
          start: startDate ? String(startDate) : null, end: endDate ? String(endDate) : null, party: groupSize, solo,
        }).map(rowOf) : undefined;
        return NextResponse.json({
          itinerary: ideaForDays.itinerary, savedToIdeas: true, kept: true, ...(kept ? { title: kept } : {}),
          ...(est ? { away: est, fixed } : {}),
        });
      }
    }
    const tripSource = (ideaForDays ?? body.tripData ?? {}) as Record<string, any>;
    const { destination, vibe, costs, city: tripCity, country_code: tripCountry } = tripSource;

    // ── An away plan's lines: getting there, and a bed every night ─────
    // Task 6a. Built here from the option's own estimates and the tier's
    // class of stay and flight timing (lib/away-lines.ts), so the days and
    // the lines arrive together and neither can be dropped for having no
    // price. A rebuild of a saved plan is told which of the two it has
    // lost (`restore`), so putting them back never doubles one. Somebody
    // driving, or already holding a flight, is off the flight — never the
    // flight off the plan (lib/participation.ts, decision 8).
    const awayForDays = async (): Promise<Record<string, unknown>> => {
      if (isNightPlan) return {};
      const town = String(tripCity || fixedPlace || destination || '').trim();
      const known = tripSource.away && typeof tripSource.away === 'object' ? tripSource.away as Partial<AwayEstimate> : null;
      // The distance the card was built with, else measured now: it
      // decides a flight or a drive, and for a day trip whether it is away.
      const km = typeof known?.km === 'number' ? known.km : await kmFromHome(town, tripCountry ?? null);
      let isAway: boolean | null = nights >= 1 ? true : known?.away === true ? true : null;
      if (isAway === null && km !== null && farEnough(km)) isAway = true;
      if (isAway !== true) return { away: null };
      const gateway = known?.transport?.airport
        ?? (town ? (await within(arrivalFor({ city: town, countryCode: tripCountry ?? null }), 6000, 'the arrival airport').catch(() => null))?.gateway ?? null : null);
      const est = awayEstimate({ ...tripSource, costs: costs ?? {} }, { nights: Math.max(0, nights), gateway, km });
      const driving = detailIsPlan ? await drivingCount(supabase, String(detailTripId)) : 0;
      const lines = awayLines(est, {
        town: town || 'the town', start: startDate ? String(startDate) : null, end: endDate ? String(endDate) : null,
        party: groupSize, driving, solo,
      });
      const fixed = lines.map(rowOf);
      if (!detailIsPlan) return { away: est, fixed };
      // What the saved plan already holds before its days, so a rebuild
      // puts back only what it lost.
      const { data: held, error: heldErr } = await supabase
        .from('itinerary_items').select('scheduled_time, type').eq('plan_id', String(detailTripId));
      if (heldErr) {
        // Not knowing what is there, nothing is offered to put back: a
        // second flight line is its own kind of wrong.
        console.error('[trips itinerary] could not read the plan\'s own lines', { plan: detailTripId, code: heldErr.code });
        return { away: est, fixed, restore: null };
      }
      // No flight among the lines (a drive away, or nobody flying): getting
      // there is the transport line, and a plan that holds one has it.
      const byRoad = !lines.some(l => l.type === 'flight');
      const missing = awayMissing((held ?? []).map(r => ({ time: r.scheduled_time, type: r.type })), { nights: est.nights, byRoad });
      if (missing.length) console.error('[trips itinerary] an away plan had lost getting there or its bed — offering them back', { plan: detailTripId, missing });
      const restore = afterAwayRebuild((held ?? []).map(r => ({ time: r.scheduled_time, type: r.type })), [], fixed, { nights: est.nights, byRoad })
        .filter(r => (fixed as unknown[]).includes(r));
      return { away: est, fixed, restore, missing };
    };

    // What this group asked for, for THIS trip.
    //
    // Until now the itinerary was written from standing taste answers —
    // cuisines, music, activity vibes — which describe a person in general
    // and not a week in particular. The trip collects its own answers from
    // every member; this is where they are finally used, which is the point
    // of having asked.
    //
    // Only for a saved plan: detailTripId is the plan's id, and a local one
    // has no rows to find.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(detailTripId));

    // Nobody's itinerary gets written before everybody has had their say.
    //
    // This is a stronger rule than the one on voting, and it is the one that
    // matters: an itinerary is the plan. Building it from half the group's
    // answers and topping it up later would mean the people who answered
    // first shape the week, and whoever was slow gets an afterthought bolted
    // onto a trip already decided. Waiting costs a day; the alternative
    // costs somebody their holiday.
    //
    // It also means an itinerary does not need rebuilding when a late answer
    // arrives, because a late answer cannot arrive.
    //
    // The plan whose answers this is written from: the plan itself, or — for
    // the days of one of a group trip's three options, which is not a plan
    // of its own yet — the group trip it is an option for. Without the
    // second, the days everybody compares the options on were written from
    // standing profiles, after the whole group had been made to answer.
    const answersPlanId = isUuid ? String(detailTripId) : groupPlan?.id ?? null;
    if (answersPlanId) {
      const { data: planRow } = await supabase
        .from('plans').select('group_id, solo_mode, type, destination_style').eq('id', answersPlanId).maybeSingle();

      // A trip id is a claim about which trip this is for, and the ids travel
      // in email and share links. Any id that is not a plan in THIS group is
      // refused: a random one skipped the readiness gate (no row, no group to
      // wait on) and another group's got that group's answers — by name —
      // written into somebody else's days.
      if (!planRow || String(planRow.group_id) !== String(groupId)) {
        return NextResponse.json({ error: 'That trip is not in this group.' }, { status: 404 });
      }

      // A group trip nobody has picked a destination for has no place to
      // write days about — its title is "Where next?" or somebody's sentence.
      // Writing an itinerary for it would be writing one for nowhere.
      if (isUuid && isUndecided(planRow)) {
        return NextResponse.json(
          { error: "This trip doesn't have a destination yet. Find your trips first — the days get written for the one you pick." },
          { status: 409 },
        );
      }

      // The plan already knows what it is, so a caller that forgets to say
      // cannot get a full day for an evening. That is exactly what happened:
      // the request omitted `mode`, this defaulted to a trip, and "Dinner
      // and Live Jazz" came back as a pottery studio in the morning and
      // lunch at an izakaya. The client says it now as well; this is so it
      // does not matter if one ever stops.
      if (planRow?.type === 'restaurant' && !isNightPlan) {
        console.error('[generate] plan is an evening but the request did not say — using the evening prompt', { plan: answersPlanId });
        isNightPlan = true;
        // An evening is one night, whatever dates were passed alongside it.
        nights = 1;
      }
      if (planRow?.group_id) {
        try {
          const readiness = await planReadiness(
            supabase, answersPlanId, String(planRow.group_id),
            // The flag is set by whoever created the plan; the member count
            // is the fact. A group of three saved as solo does not skip the wait.
            planRow.solo_mode === true && !isGroup,
          );
          if (!readiness.allReady) {
            return NextResponse.json({
              error: notYetAnswered(readiness.waitingOn, 'The plan gets written once everyone has.'),
              waitingOn: readiness.waitingOn,
            }, { status: 409 });
          }
        } catch {
          console.error('[generate] could not check who has answered', { plan: answersPlanId });
          return NextResponse.json(
            { error: 'We could not check who has answered yet — try again in a moment.' },
            { status: 503 },
          );
        }
      }
    }

    // Read through the same function the options stage uses, so an answer
    // cannot reach one stage and miss the other. A failed read is logged
    // there and writes the days without the block, as it always has here.
    let wantedBlock = '';
    const tripVetoes: string[] = [];
    if (answersPlanId) {
      const read = groupAnswers && groupPlan?.id === answersPlanId
        ? groupAnswers
        : await readGroupAnswers(supabase, answersPlanId);
      // The days are read by the whole group too, so the same rule holds.
      wantedBlock = answersBlock(read, { group: isGroup });
      // A thing somebody said to avoid is a constraint, not a hint.
      tripVetoes.push(...read.vetoes);
      // What the plan's own answers say that the request did not: tonight's
      // food, kind and energy, and the lowest budget anybody named. A
      // rebuild sends none of them, so a Thai birthday at $250 was rebuilt
      // eight times as a brewery and ramen for $105.
      const stored = nightPrefsFrom(read, groupPlan?.created_by ?? null);
      if (!(nightPrefs.food || []).length && stored.food) nightPrefs.food = stored.food;
      if (!(nightPrefs.kind || []).length && stored.kind) nightPrefs.kind = stored.kind;
      if (!nightPrefs.energy && stored.energy) nightPrefs.energy = stored.energy;
      if (read.lowestBudget && !body.budgetPerPerson) effectiveBudget = read.lowestBudget;
    }
    const here = splitVetoes([...new Set([...allVetoes, ...weatherNos, ...tripVetoes.map(v => String(v).replace(/^custom:/, '').trim())])]);
    const allVetoesHere = here.hard;
    const weatherHere = weatherLine(here.weather);
    // The part of town is no longer asked for. It comes from where they
    // are, or the city they named in the first sentence, and from what they
    // want the room to be like — which is what energy and kind already say.
    // Still used when somebody volunteered it: "drinks by the water" is a
    // real preference, it just was not worth a question.
    const nightWhen = [nightPrefs.time, nightPrefs.where].filter(Boolean).join(', ');
    // ── The event they actually named ──────────────────────────────────
    // "milk carton kids concert in dc" came back as a multi-day trip at a
    // venue nobody plays at, because nothing looked the concert up. A gig is
    // the most checkable thing in this product — it has a date, a venue and
    // a page that sells tickets — so it is looked up, and the evening is
    // built around the real one or around no specific one at all.
    const act = actWords(goal);
    let realEvent = act.length >= 2 ? await eventFromCache(supabase, act) : null;
    if (!realEvent && act.length >= 2) {
      realEvent = await eventFromProvider(act, fixedPlace, fetch);
    }
    if (realEvent) {
      console.log('[generate] planning around a real event', { title: realEvent.title, venue: realEvent.venue });
      // A gig on a named night is an evening, whatever the request said.
      // "the milk carton kids in Washington DC" names no kind of outing, so
      // the mode fell through to a trip and somebody asking about one
      // concert was handed several days. The listing settles it: this event
      // happens on one evening, so the plan is one evening.
      if (!isNightPlan) {
        console.log('[generate] a one-night event was named — planning an evening, not a trip');
        isNightPlan = true;
        nights = 1;
        // An evening's money, now that we know it is an evening.
        effectiveBudget = groupBudget(true);
      }
    } else if (act.length >= 2) {
      console.log('[generate] an act was named and not found — the evening will not claim a show', { act });
    }

    // ── The places that actually exist there ──────────────────────────
    // Read before anything is written, which is the whole change. The model
    // used to be asked for "real venue names" and answered from memory, and
    // a verifier went looking afterwards — by which point an invented
    // restaurant was already a sentence in Reach's voice, and the best
    // anyone could do was take it away again.
    //
    // So the map and our own venue table are read first, and the list they
    // give is the only list a plan may name from. A thin list is not a
    // licence to fall back on memory: it is the honest shape of what we know
    // about a small town, and the prompt says so.
    // What they said they are hungry for, as words: the quiz stores a typed
    // answer as "custom:Thai".
    const wantFood = isNightPlan
      ? [...new Set((nightPrefs.food || []).map((f: unknown) => String(f).replace(/^custom:/i, '').trim()).filter(Boolean))] as string[]
      : [];
    const realPlaces: RealPlace[] = await placesFor(
      supabase,
      // For an evening, never the option's title: it is a name, not a place.
      { city: tripCity || fixedPlace || (isNightPlan ? nightCity : destination), country: tripCountry ?? null, interests: [...cuisines, ...activityVibes, ...musicGenres] },
      // A night out is judged on the evening; a day trip on one date is not
      // a night out, and needs somewhere open for lunch.
      { days: startDate ? { from: String(startDate), to: String(endDate || startDate) } : null, wantFood, eveningOut: isNightPlan },
    ).catch((err) => {
      console.error('[generate] could not read the real places', err instanceof Error ? err.message : 'failed');
      return [];
    });
    console.log('[generate] verified places for this plan', { city: tripCity || destination, count: realPlaces.length });
    const menu = placeMenu(realPlaces);

    // ── What the weather is usually like then ─────────────────────────
    // NASA POWER's forty-year averages for the place on these dates, held in
    // place_climate (lib/climate.ts). Given as data, so a cold month gets no
    // beach day and the wettest months get somewhere indoors each day. None
    // held — or no dates — and the prompt says nothing about the weather,
    // which is the honest amount.
    const climateCity = tripCity || fixedPlace || (isNightPlan ? nightCity : destination);
    const heldClimate = startDate && climateCity
      ? (await readClimate(supabase, { name: String(climateCity), country: tripCountry ?? null })).normals
      : null;
    const daysClimate = heldClimate ? howIsIt(heldClimate, String(startDate), endDate ? String(endDate) : String(startDate)) : null;
    const climateBlock = daysClimate ? `\n${climatePromptBlock(daysClimate)}\n` : '';
    if (startDate && !daysClimate) console.log('[generate] no climate held for this place', { place: climateCity });

    const nightKind = (nightPrefs.kind || []).join(', ');
    const nightFood = wantFood.join(', ');
    // Said plainly either way. A menu with no Thai place next to "Food
    // tonight: Thai" is how a birthday dinner for somebody who loves Thai
    // ended at a ramen bar with nobody told.
    const foodFound = wantFood.filter(w => realPlaces.some(p => p.forFood === w.toLowerCase()));
    const foodGap = wantFood.filter(w => !foodFound.includes(w));
    const foodLine = [
      ...foodFound.map(w => `${w.toUpperCase()}: dinner is at the menu place marked for it (${realPlaces.filter(p => p.forFood === w.toLowerCase()).map(p => p.name).join(' or ')}).`),
      ...foodGap.map(w => `We hold no verified ${w} place here. Do not describe any stop as ${w} food or promise ${w} anywhere.`),
    ].join('\n');
    if (foodGap.length) console.error('[trips itinerary] no verified place for the food asked for', { destination, city: tripCity || nightCity, wanted: foodGap });

    // ── Nothing goes out that we cannot stand behind ────────────────
    // The prompt asks the model to name only verified places, and whatever
    // comes back is read back against the same list (readBackDays). The
    // town's own name, and a real ticketed venue from a listing, are real
    // without being on a map-built menu, so they are allowed through by
    // name.
    // For an evening, the option's title is the model's own earlier words —
    // "Greek Dinner & Jazz at The Pit" — and letting it vouch for itself is
    // how a place nobody verified reached a plan's name. The city does the
    // vouching instead. For a trip the destination IS the town, and stays.
    const baseVouchers = (): string[] => [
      isNightPlan ? nightCity : destination, tripCity, fixedPlace, realEvent?.venue, realEvent?.city, realEvent?.title,
      // What is on at a verified venue, read off its own page, is as
      // verified as the venue: "R&B Rewind Millennial Edition" was being
      // softened into "a local spot" though it came from the menu itself.
      ...realPlaces.flatMap(p => (p.whatsOn ?? []).map(w => w.split(' — ')[0])),
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    const readBackEnv = (vouchers: string[], quiet = false): ReadBackEnv => ({
      realPlaces, vouchers, destination, isNightPlan, realEvent, nightPrefs,
      vetoes: allVetoesHere, planForLog: detailTripId ? String(detailTripId) : groupPlan?.id ?? null, quiet,
      onDroppedLocation: (note) => {
        // Added to EVENT_NAMES in lib/track.ts by its own change; until
        // that lands this writes nothing rather than a name the table
        // would refuse. The log line is the record either way.
        if (isEventName(DROPPED_LOCATION)) {
          void track(supabase, DROPPED_LOCATION, {
            userId: ctx.user.id, groupId: String(groupId), planId: groupPlan?.id ?? null,
            props: { day: note.day, slot: note.slot, km: note.km, reason: note.reason, night: isNightPlan },
          });
        }
      },
    });
    // The calendar, not just a count: weekly nights have a weekday, and the
    // model was being asked to honour one it had never been told.
    // The shape of this kind of plan, from the playbooks that were written
    // and never read. Decided in code; skipped if the row is not ready or does
    // not parse — a missing playbook leaves the prompt as it was.
    let shapeBlock = '';
    const kind = archetypeFor({ night: isNightPlan, solo, goal, tripTypes });
    if (kind) {
      const { data: pbRow, error: pbErr } = await supabase.from('trip_playbooks')
        .select('playbook, status').eq('archetype', kind).maybeSingle();
      if (pbErr) console.error('[generate] could not read the playbook', { kind, code: pbErr.code });
      const pb = pbRow?.status === 'ready' ? PlaybookSchema.safeParse(pbRow.playbook) : null;
      if (pb?.success) {
        const shape = playbookGuidance(pb.data, kind);
        shapeBlock = ['', shape, ''].join('\n');
      }
    }
    const calendarDays = datedDays(startDate ? String(startDate) : null, isNightPlan ? 1 : Math.max(1, nights));
    const whenLine = calendarDays.length
      ? (isNightPlan ? `THE EVENING: ${calendarDays[0].replace(/^Day 1 — /, '')}.` : `THE DAYS:\n${calendarDays.join('\n')}\nPut anything that only happens on certain weekdays on the right day.`)
      : 'The dates are not fixed yet. Do not tie anything to a weekday or a season.';
    // ── "Something else…": one stop, rewritten ─────────────────────────
    // Task 7a. Somebody wants something else in one slot — "somewhere with
    // live music" — and rebuilding the itinerary to answer that would move
    // every other line under them. So the model is asked for one slot, from
    // the same verified menu the full generator was given, and the answer
    // goes through the same read-back (readBackDays). The rest of the day is
    // context and never output: nothing here can write to another slot.
    //
    // Nothing is saved. The new slot goes back to the screen, which applies
    // it to that one line (or offers it as a suggestion, after Lock it in,
    // where swaps are the organiser's — owner decision 14).
    if (slotAsk) {
      const client = anthropicOrNull();
      if (!client) {
        console.error('[trips slot] ANTHROPIC_API_KEY is not set');
        return NextResponse.json({ error: 'Changing a stop is switched off for this deployment.' }, { status: 503 });
      }
      // The day as it stands: the saved idea's own copy where there is one,
      // otherwise what the screen sent.
      const savedDays = Array.isArray(ideaForDays?.itinerary) ? ideaForDays!.itinerary as unknown[] : [];
      const savedDay = savedDays.find(d => Number((d as { day?: unknown })?.day) === slotAsk.day) as Record<string, unknown> | undefined;
      const source = (savedDay ?? slotAsk.current ?? {}) as Record<string, unknown>;
      const contextDay: GenDay = {
        day: slotAsk.day, title: typeof source.title === 'string' ? source.title : '',
        morning: asGenSlot(source.morning), afternoon: asGenSlot(source.afternoon), evening: asGenSlot(source.evening),
        cost_today: 0,
        daytime: Array.isArray(source.daytime) ? (source.daytime as unknown[]).map(asGenSlot) : [],
      };
      const part = slotAsk.part;
      const index = part === 'daytime' ? (slotAsk.index ?? 0) : null;
      if (part === 'daytime' && (index === null || !contextDay.daytime[index])) {
        return NextResponse.json({ error: 'That stop is not on this day.' }, { status: 400 });
      }
      const current: GenSlot = part === 'daytime' ? contextDay.daytime[index!] : contextDay[part];
      const LABEL: Record<string, string> = isNightPlan
        ? { morning: 'To start', afternoon: 'The main event', evening: 'After', daytime: 'Earlier that day' }
        : { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', daytime: 'Earlier that day' };
      const others: Array<[string, GenSlot]> = [
        ...(['morning', 'afternoon', 'evening'] as const).filter(k => k !== part).map(k => [LABEL[k], contextDay[k]] as [string, GenSlot]),
        ...contextDay.daytime.filter((_, i) => !(part === 'daytime' && i === index)).map(s => [LABEL.daytime, s] as [string, GenSlot]),
      ].filter(([, s]) => !!s?.plan);
      const ask = typeof slotAsk.ask === 'string' && slotAsk.ask.trim() ? slotAsk.ask.trim().replace(/\s+/g, ' ').slice(0, 200) : null;
      const dayDate = calendarDays[slotAsk.day - 1]?.replace(/^Day \d+ — /, '') ?? null;

      const slotPrompt = `Change ONE stop of ${isNightPlan ? 'an evening out' : 'a trip'} in ${tripCity || (isNightPlan ? nightCity : destination) || destination}.
${dayDate ? `${isNightPlan ? 'The evening' : `Day ${slotAsk.day}`}: ${dayDate}.` : 'The dates are not fixed yet. Do not tie anything to a weekday or a season.'}${climateBlock}
${solo ? 'One person, on their own.' : partyLine ?? `${groupSize} people together.`}

THE STOP TO CHANGE: ${LABEL[part]}${isNightPlan ? '' : ` of day ${slotAsk.day}`}. It is now: "${current?.plan || 'nothing yet'}".
${ask
  ? `What they want there instead, in their own words: "${ask}". That is a wish, not a fact about any place — only the menu says what a place is or what is on there.`
  : 'They want something different there.'}

THE REST OF THAT DAY STAYS EXACTLY AS IT IS. Do not repeat any of it, and keep the new stop close to it:
${others.length ? others.map(([l, s]) => `- ${l}: ${s.plan}`).join('\n') : '- (nothing else that day)'}

${menu}

${isNightPlan ? `This is part of an evening: nothing before late afternoon, and exactly one sit-down meal across the evening — if another stop above is a meal, this one is not.
Food tonight: ${nightFood || cuisines.slice(0, 4).join(', ') || 'varied'}
${foodLine}` : `Food loves: ${cuisines.slice(0, 4).join(', ') || 'varied'}`}
Dietary (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}
${allVetoesHere.length ? `Never include: ${allVetoesHere.join(', ')}` : ''}${weatherHere}
No slot may reference the stay: no checking in, no "back at the hotel", no room, no pool.

Name only a place on the menu above, and put its [ref] in place_ref. If nothing on the menu fits what they asked for, return an empty "plan" — they are told nothing we have verified fits, which is a true answer; a place that does not fit is not. Never say a place has live music, a DJ, a quiz or anything else on unless its menu line says so.

"cost" is what one person spends at this stop, in whole dollars. 0 means free.
- "booking": "ahead" if it must be booked direct, "walk_in" if you just turn up.
${TABLES_ARE_THEIRS}
- "payment": an empty string unless you know it for this exact place.

${NO_VENUE_FACTS}

"because": an empty string.

Return one slot.`;

      try {
        const res = await withSchemaFallback(client, QUALITY_MODEL, 4000, slotPrompt, ONE_SLOT_JSON_SCHEMA, 'trips slot', QUALITY_EFFORT);
        const parsed = parseModelJSON(textOf(res), OneSlotSchema, 'trips slot');
        if (!parsed) {
          console.error('[trips slot] no slot in the response', { plan: detailTripId, stop_reason: res.stop_reason });
          return NextResponse.json({ error: 'Could not find something else for that stop — please try again.' }, { status: 502 });
        }
        const fresh = parsed.slot;
        // Geography for the new stop only: the rest was read when it was written.
        const vouchers = baseVouchers();
        const lone: GenDay = { ...contextDay, morning: fresh, afternoon: asGenSlot(null), evening: asGenSlot(null), daytime: [] };
        vouchers.push(...await vouchedGeography([lone], realPlaces, vouchers, { place: tripCity || destination, country: tripCountry ?? null }));

        const out = oneSlotReadBack({ day: contextDay, part, index, fresh, env: readBackEnv(vouchers) });
        if ('refused' in out) {
          console.error('[trips slot] not offered', {
            plan: detailTripId, day: slotAsk.day, part, why: out.refused, ask, verified_places: realPlaces.length,
            offered: String(fresh.plan).slice(0, 80),
          });
          return NextResponse.json({
            error: out.refused === 'moved_another' || out.refused === 'clashes'
              // A second dinner that would cost the real one its place, a
              // stop that would pull the day across town: the rest of the
              // day is not this request's to change.
              ? 'That one would not sit with the rest of the day, so the stop stays as it is. Try asking for something else.'
              : ask
                ? `Nothing we have verified there fits "${ask}", so that stop stays as it is.`
                : 'Nothing else we have verified there fits, so that stop stays as it is.',
            unchanged: true, why: out.refused, ...(out.refused === 'nothing_fits' || out.refused === 'same_place' ? { nothingFits: true } : {}),
          }, { status: 422 });
        }
        // `to`: the menu place the new stop names, by the stable ref the
        // per-item PATCH and a suggestion take (lib/itinerary-alternatives
        // placeRef) — so it lands on that one line, not by rewriting the plan.
        const named = placeOf(out.slot, realPlaces);
        return NextResponse.json({
          slot: out.slot, day: slotAsk.day, part, ...(index !== null ? { index } : {}), label: LABEL[part],
          to: named ? placeRef(named) : null,
        });
      } catch (e: any) {
        report(e, { where: 'trips/generate slot', extra: { destination, status: e?.status } });
        console.error('[trips slot] failed', { destination, status: e?.status, message: e?.message });
        const status = e?.status === 429 ? 429 : 502;
        return NextResponse.json(
          { error: status === 429 ? 'Reach is busy right now — try again in a moment.' : 'Could not find something else for that stop — please try again.' },
          { status },
        );
      }
    }

    const prompt = isNightPlan ? `Plan one evening out in ${tripCity || nightCity || destination}.
${whenLine}${climateBlock}${shapeBlock} Its working title was "${destination}" — a name from an earlier step, not a fact: do not treat any venue, performer or dish it mentions as real unless it is on the menu below.

${solo ? 'One person, on their own.' : partyLine ?? `${groupSize} people going out together.`}
${realEvent ? eventFacts(realEvent) : ''}${act.length >= 2 && !realEvent ? `
They mentioned something they want to see, and we could not find it in any
listing. Do NOT invent a venue, a date or a show for it. Plan the evening
without naming that event at all, and let them add it themselves.` : ''}
${nightWhen ? `When and where: ${nightWhen}` : ''}

${menu}

Keep it to one part of town — everything within a short walk or a single
short ride of the first stop, because an evening that crosses a city is
three journeys and a lot of standing about. Which part is yours to choose
from where they are and what they are after; do not ask them to pick one.
${nightKind ? `What they want out of it: ${nightKind}` : ''}
${nightPrefs.energy ? `Energy: ${nightPrefs.energy}` : ''}
Food tonight: ${nightFood || cuisines.slice(0, 4).join(', ') || 'varied'}
${foodLine}
Music: ${musicGenres.slice(0, 3).join(', ') || 'mixed'}
Drinks: ${drinkStyles.join(', ') || 'no preference'}
A good night out, in their words: ${nightlife.join(', ') || 'no preference'}
Dietary (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}
${allVetoesHere.length ? `Never include: ${allVetoesHere.join(', ')}` : ''}${weatherHere}${wantedBlock}

Return exactly one day. Use its three slots as the shape of an EVENING — not
a day. Nothing here happens before late afternoon:
- "morning" is where they meet first — a bar for a drink, a walk, or the thing
  before the thing. If the evening genuinely starts at dinner, say so there.
- EXACTLY ONE slot is a sit-down meal. If dinner is the first stop or the main
  event, the last slot is a drink, dessert or a walk — never another restaurant.
- "afternoon" is the main event: the game, the gig, the show, the booking.
  Name it. Never write about the slot — "this is the slot for the thing you
  already have in mind", "leave this window open" — that is the form talking
  about itself on somebody's evening. If you do not know what the main event
  is, make it a real thing they could do: the dinner, the venue, the bar with
  the band on. An evening of two real things beats three with a note in the
  middle.
- "evening" is what follows: dessert, a last drink, or dinner if nothing before
  it was a meal.

Then "daytime": two things they could do earlier that same day if they decide
to make a day of it. Nearby, and they must work as an afternoon on their own —
somebody who only wanted a drink with a friend is never shown these. If the
evening is the whole of it, return an empty list rather than padding.

Real venues with real names, all within a short ride of each other, all open
that evening. About $${effectiveBudget} a head across the whole night, and
each slot's "cost" is what one person actually spends at that stop.

No flights. No hotel. Nobody is going away — this is a night in their own city
or one nearby.

Every slot needs its practical details, because the point is that nobody turns
up and finds out the hard way:
- "booking": "reach" if it takes reservations, "ahead" if it must be booked
  direct, "walk_in" if you just turn up.
${TABLES_ARE_THEIRS}
- "payment": leave this an empty string unless you know it for this exact
  place. Not what places like it usually take — this one. We check payment
  against sources that record it, so an empty string costs nobody anything
  and a wrong guess strands somebody at a till.

Never write "placeholder", "TBD" or any other filler.

${NO_VENUE_FACTS}` : `Generate a detailed ${nights}-day itinerary for a group trip to ${destination}.
${whenLine}${climateBlock}${shapeBlock}

${solo ? `Travelling: alone, ${tripPace} pace` : `Group: ${groupSize} people, ${tripPace} pace`}
Food loves: ${cuisines.slice(0, 4).join(', ') || 'varied'}
Music/nightlife: ${musicGenres.slice(0, 3).join(', ') || 'mixed'}
Activities: ${activityVibes.slice(0, 4).join(', ') || 'mixed'}
Dietary: ${dietaryNeeds.join(', ') || 'no restrictions'}${travelBlock}
${tripAccommodation
  ? `Accommodation they asked for: ${tripAccommodation}. This is the kind of
place they want, not somewhere that has been booked. Do not write them into
it.`
  : `Where they are sleeping: NOT DECIDED. Nobody has booked anywhere, and
Reach has not placed them.`}
Either way, no slot may reference the stay. No checking in, no checking out,
no "back at the hotel", no room, no pool, no lobby, no breakfast included.
Those read as facts about a booking that does not exist, and the first thing
somebody does with the first line of a plan is act on it. Write the day
outside: arrive, drop the bags, and go and look at the town.
${allVetoesHere.length ? `Never include: ${allVetoesHere.join(', ')}` : ''}${weatherHere}${wantedBlock}

${solo ? `On their own, so every slot works for one: neighbourhoods that are
comfortable solo, some days to meet people and some to talk to nobody. Nothing
that needs a second person. Never mention sharing. Being on their own is not a
reason to describe a place's seating or what it is like inside — the menu
below does not say, so neither do you.
` : ''}
${menu}

Every slot also needs "cost": what that one thing costs per person, in whole
dollars. A free walk is 0. A museum is its ticket price. Dinner is what one
person actually spends there, drinks included. These are the numbers somebody
budgets against, so be realistic rather than optimistic — and make each day's
three costs add up to roughly that day's cost_today.

Never write "placeholder", "TBD", "N/A", "Activity" or any other filler.

Write one entry for each of the ${nights} days. All of them. The days come
from the dates they are going; the venues come from the verified list, and
those are separate things. A short list is not a reason to give somebody a
shorter trip — they are still there on the Thursday.

Where the list runs out, write the day without naming a place: "a slow
morning on the beach", "wander the old town and find lunch where it looks
busy", "an afternoon doing nothing in particular". That is a true sentence
about a real day and it is genuinely useful. A named restaurant that does
not exist is not.

Use the verified list above for every venue you name. Neighbourhoods,
distances and the shape of the day are yours; the names are not.

${NO_VENUE_FACTS}

Every slot needs its practical details, because the point of this is that
nobody arrives somewhere and finds out the hard way:
- "booking": "reach" if it is a hotel, flight or ticketed tour Reach can book
  outright; "ahead" if it needs reserving but the person does it themselves —
  a table, a tasting menu, a permit, a timed entry; "walk_in" if you just turn
  up.
${TABLES_ARE_THEIRS}
- "payment": leave this as an empty string unless you know it for this exact
  place, from that place — not from what restaurants of its kind usually do.
  An empty string is the right answer almost every time, and it costs the
  traveller nothing: we check payment against sources that record it and fill
  it in ourselves.
  A wrong "Cash only" strands somebody at a till, and a wrong "Cards" strands
  them harder. Neither is worth a guess, so do not make one.

"because" is the one thing on a slot that is about a person rather than a
place: whose request this answers, in their own terms — "Peter asked for one
big night out", "the sunset Sarah wanted, from the sand". Use their name. If a
slot answers nobody in particular, send an empty string rather than a reason
you have made up; a day that is simply a good day is allowed to be one.`;

    const client = anthropicOrNull();
    if (!client) {
      console.error('[trips itinerary] ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        { error: 'Itinerary generation is switched off for this deployment.' },
        { status: 503 },
      );
    }

    try {
      const res = await withSchemaFallback(
        // 16000 because 8000 truncated a long itinerary mid-object, which is
        // what most of the old parse failures actually were.
        client, QUALITY_MODEL, 16000, prompt, ITINERARY_JSON_SCHEMA, 'trips itinerary',
        QUALITY_EFFORT,
      );

      const parsed = parseModelJSON(textOf(res), ItinerarySchema, 'trips itinerary');
      // A day whose slots say "placeholder" is worse than a missing day: it
      // looks planned. Drop it rather than write a hole into somebody's trip.
      const days = dropFillerDays(parsed?.itinerary ?? []);
      // Far fewer days than were asked for.
      //
      // A seven-night Puerto Vallarta came back as one day — three rows and
      // $34 for a week — because the prompt said to return fewer days rather
      // than pad, and that town holds nine verified venues. The instruction
      // was meant to stop invented restaurants and it stopped Tuesday
      // through Sunday instead. Loud, because it reaches a screen looking
      // like a plan rather than like a failure.
      if (nights > 1 && days.length < Math.ceil(nights / 2)) {
        console.error('[trips itinerary] came back far shorter than asked', {
          destination, asked: nights, got: days.length, verified_places: realPlaces.length,
        });
      }
      if (days.length < (parsed?.itinerary?.length ?? 0)) {
        console.error('[trips itinerary] dropped filler days', {
          destination, asked: nights,
          returned: parsed?.itinerary?.length, kept: days.length,
        });
      }
      const vouchers = baseVouchers();
      // ── The ticket, carried through to something you can press ───────
      // See attachTicket. A picture is attached from a row or a listing,
      // never taken from the model: whatever it wrote into these is
      // cleared first.
      clearPhotos(days);
      if (realEvent?.url && !attachTicket(days, realEvent)) {
        console.error('[trips itinerary] a real event was found but no slot names it', {
          title: realEvent.title, venue: realEvent.venue,
        });
      }
      vouchers.push(...await vouchedGeography(days, realPlaces, vouchers, { place: tripCity || destination, country: tripCountry ?? null }));

      // ── Nothing goes out that we cannot stand behind ────────────────
      // readBackDays — the same read-back "Something else…" puts a single
      // slot through.
      days.splice(0, days.length, ...readBackDays(days, readBackEnv(vouchers)));
      if (!days.length) {
        console.error('[trips itinerary] no itinerary in response', {
          destination, nights, stop_reason: res.stop_reason,
        });
        return NextResponse.json(
          { error: 'Could not build an itinerary for those dates — please try again.' },
          { status: 502 },
        );
      }
      // An evening's name, from what it actually holds. Plan 4fbd6ac9 was
      // called "Greek Dinner & Jazz at The Pit" over a brewery and a ramen
      // bar — no Greek food, no jazz, no Pit. The venues the itinerary cites
      // are the only names checked against the map, so they are the name.
      let title: string | null = null;
      if (isNightPlan) {
        const venues = [...new Set(days.flatMap(d => [d.morning, d.afternoon, d.evening])
          // A slot the read-back emptied names nowhere, whatever venue it kept.
          .map(sl => (sl && typeof sl === 'object' && sl.plan ? (sl as { venue?: string | null }).venue : null))
          .filter((v): v is string => !!v && !!v.trim()))];
        if (venues.length) title = venues.length === 1 ? `An evening at ${venues[0]}` : `${venues[0]} & ${venues[venues.length - 1]}`;
      }
      // Onto the saved idea, so everybody voting sees the same days. Never
      // fails the request: whoever asked still gets the days.
      const savedToIdeas = ideaForDays && groupPlan
        ? await attachDays(supabase, groupPlan.id, ideaForDays.id, days, { organiser, venueTitle: title })
        : false;
      // Getting there and a bed, as lines the screen saves with the days —
      // never left to be rebuilt from costs on the client, where an
      // unpriced one used to vanish.
      const awayPart = await awayForDays();
      return NextResponse.json({
        itinerary: days, savedToIdeas, ...(title ? { title } : {}), ...(isNightPlan && foodGap.length ? { foodGap } : {}),
        ...awayPart,
      });
    } catch (e: any) {
      report(e, { where: 'trips/generate', extra: { destination, nights, status: e?.status } });
      console.error('[trips itinerary] generation failed', {
        destination, nights, status: e?.status, message: e?.message,
      });
      const status = e?.status === 429 ? 429 : 502;
      return NextResponse.json(
        { error: status === 429
            ? 'Reach is busy right now — try again in a moment.'
            : 'Could not build an itinerary — please try again.' },
        { status },
      );
    }
  }

  // ── STAGE 1: Fast — just destinations + cost estimates, NO itinerary ───────
  // The weather, for a trip. Where the place is settled and we hold its
  // climate, the averages for these dates go in as data. Where it is not,
  // a weather no-go is said as the rule it now is: every idea is checked
  // against the averages afterwards and dropped if it breaks it, so asking
  // for somewhere that passes costs nobody an idea.
  const weatherNoGo = climateVetoes(allVetoes);
  const settledClimate = !isNightPlan && fixedPlace && startDate
    ? (await readClimate(supabase, { name: fixedPlace })).normals : null;
  const settledDays = settledClimate ? howIsIt(settledClimate, String(startDate), endDate ? String(endDate) : null) : null;
  const noGoRule = [
    weatherNoGo.cold ? `usually cold (daytime highs under ${COLD_HIGH_C}°C / ${Math.round(COLD_HIGH_C * 9 / 5 + 32)}°F)` : '',
    weatherNoGo.heat ? `usually extremely hot (daytime highs of ${HOT_HIGH_C}°C / ${Math.round(HOT_HIGH_C * 9 / 5 + 32)}°F or more)` : '',
  ].filter(Boolean).join(' or ');
  const ideasClimateBlock = settledDays
    ? `\n${climatePromptBlock(settledDays)}\n`
    : (noGoRule && startDate
      ? `\nWEATHER NO-GO: choose places that are not ${noGoRule} on these dates. Every idea is checked against NASA POWER 1981–2020 averages for its dates, and one that breaks this is dropped.\n`
      : '');
  const nightWhere = [nightPrefs.time, nightPrefs.where].filter(Boolean).join(', ');
  const prompt = isNightPlan ? `You are Reach. Generate exactly 3 options for ONE NIGHT OUT in ${nightCity || 'the user\'s city'}. BE FAST — overviews and honest costs, no itinerary yet.
${nightCity ? `ALL THREE MUST BE IN ${nightCity.toUpperCase()}. Every "destination" and "city" is there — not anywhere they live or anywhere nearby.` : ''}
${goal ? `WHAT THE NIGHT IS FOR, IN THEIR WORDS: ${goal}` : ''}

${solo ? 'ONE PERSON, on their own.' : partyLine ? `GROUP: ${partyLine}` : `GROUP: ${groupSize} people.`}
WHEN: ${startDate || 'soon'}${nightPrefs.time ? ` around ${nightPrefs.time}` : ''}
WHERE IT SHOULD FEEL LIKE: ${nightPrefs.where || 'anywhere good'}
${(nightPrefs.kind || []).length ? 'WHAT THEY WANT OUT OF IT: ' + (nightPrefs.kind || []).join(', ') : ''}
${nightPrefs.energy ? 'ENERGY: ' + nightPrefs.energy : ''}
${(nightPrefs.food || []).length ? 'HUNGRY FOR TONIGHT: ' + (nightPrefs.food || []).join(', ') : ''}
BUDGET: about $${effectiveBudget} each for the whole night
FOOD: ${cuisines.slice(0, 5).join(', ') || 'varied'}
MUSIC: ${musicGenres.slice(0, 4).join(', ') || 'mixed'}
DRINKS: ${drinkStyles.join(', ') || 'no preference'}
A GOOD NIGHT OUT: ${nightlife.join(', ') || 'no preference'}
DINING STYLE: ${diningVibes.join(', ') || 'no preference'}
DIETARY (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}${saidBlock}${eveningTravelBlock}${groupWanted}
${allVetoes.length > 0 ? 'NEVER INCLUDE: ' + allVetoes.join(', ') : ''}${weatherLine(weatherNos)}

Each option is a real evening in a named neighbourhood — "Dinner and a gig in
the Mission", not a city. destination is that evening's name: the KIND of
evening and the neighbourhood only. Never name a venue, a bar, a restaurant, a
band or a DJ in it or in the tagline — the venues are chosen next, from places
we have verified, and a name here is a promise nothing has checked. Three genuinely
different nights: vary what the evening is built around, not just the
restaurant.

There are no flights and no hotel. Set costs.flights.per_person to 0 and
costs.accommodation.per_person to 0, and put the real money in activities and
food. costs must sum to total_per_person.

Price diversity, one per tier, within 10% of these figures:
- "saver":     total_per_person about $${Math.round(effectiveBudget * 0.65)}
- "on_budget": total_per_person about $${effectiveBudget}
- "stretch":   total_per_person about $${Math.round(effectiveBudget * 1.15)}

why_this_group is one sentence tied to their actual food, music and drink
answers. food_scene and music_scene are one short line each and are REPLACED
by counts from our verified venue table before anybody sees them, so do not
spend words or claims on them. tagline is at most
ten words. emoji is one emoji. accommodation.example is the neighbourhood the
night happens in.` : `You are Reach's AI travel planner. Generate exactly 3 destination options. BE FAST — no itinerary needed yet, just destination overviews and cost estimates.

${solo
  ? `TRAVELLING: alone, ${nights} nights, $${effectiveBudget} budget`
  : `GROUP: ${groupSize} people, ${nights} nights, $${effectiveBudget}/person budget`}
DEPARTING: ${departure} (${departureCode})
DATES: ${startDate || 'flexible'} to ${endDate || 'flexible'}${ideasClimateBlock}
${goal ? `WHAT THEY SAID THIS TRIP IS, IN THEIR OWN WORDS — this leads over
everything below it:
"${goal}"

Read it properly. If it names a place, that place IS the destination and all
three options are there at three budgets — "ski trip with the boys in Aspen"
means Aspen, three ways, not Aspen and two other mountains. If it names an
occasion, every option should be somewhere that occasion makes sense, and
why_this_group should say so in a way ${isGroup ? 'the whole group' : 'the person who wrote it'} would
recognise. If it names people, plan for those people.

Every option's used_suggestions must say how it serves THIS — ${isGroup
  ? '"Aspen at the cheaper end of the season — the ski week this trip is for"'
  : '"Aspen, the mountain you asked for, at the cheaper end of the season"'} — before it
mentions any standing answer. An empty used_suggestions when they have told
you what the trip is for means you did not use it.
` : ''}WHAT THIS TRIP IS FOR${together ? " — everything anybody going asked for" : ''} (standing preferences below yield to it): ${tripTypes}
PACE: ${tripPace}
STAY: ${tripAccommodation}
FOOD: ${cuisines.slice(0, 5).join(', ') || 'varied'}
MUSIC: ${musicGenres.slice(0, 4).join(', ') || 'mixed'}
ACTIVITIES: ${activityVibes.slice(0, 4).join(', ') || 'mixed'}
CLIMATE THEY WANT: ${climates.join(', ') || 'any'}
DINING STYLE: ${diningVibes.join(', ') || 'no preference'}
DRINKS: ${drinkStyles.join(', ') || 'no preference'}
NIGHTLIFE: ${nightlife.join(', ') || 'no preference'}
LIVE MUSIC THEY GO TO: ${concertTypes.slice(0, 4).join(', ') || 'no preference'}
DIETARY (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}${saidBlock}${travelBlock}${groupWanted}
${allVetoes.length > 0 ? 'VETOES (never include): ' + allVetoes.join(', ') : ''}${weatherLine(weatherNos)}

Price diversity is required. Return exactly three options, one per tier, and
hit these totals — specific numbers, not a range, because percentages of a
budget came back clustered at 70%, 89% and 95%, which is not a choice:
- "saver":     total_per_person about $${Math.round(effectiveBudget * 0.65)}
- "on_budget": total_per_person about $${effectiveBudget}
- "stretch":   total_per_person about $${Math.round(effectiveBudget * 1.15)}

Each total must land within 10% of the figure above for its tier.
${nights >= 1 ? awayPromptBlock({ nights, from: `${departure} (${departureCode})` }) : ''}

${fixedPlace ? `ALL THREE OPTIONS MUST BE AT ${fixedPlace.toUpperCase()}. This is not a
suggestion and not one of three ideas — they have chosen where they are going.
Vary the plan, the standard of the stay and the budget. Never the destination.
Every "destination" and "city" must be ${fixedPlace} or somewhere inside it.` : `UNLESS the goal above names a place — in which case all three are THAT place
and nothing else — the three must be genuinely different places, not three
versions of the same idea: vary the region and the type of destination, not
just the hotel.

Vary the place, never the purpose. All three have to deliver WHAT THIS TRIP IS
FOR: if that is skiing, all three are places you can ski, at three different
budgets. Offering one that fits and two that do not is not a choice between
three trips, it is one trip and two changes of subject.`}

Every veto is absolute: a vetoed thing must not appear in any option.

Climate is a standing preference, not a rule, and what this trip is FOR beats
it whenever the two disagree. A group that asked for skiing gets skiing even
though their profile says warm — they know where snow is. Honour the stored
climate only where the trip type leaves it open. Standing preferences that
cannot be met by this trip are simply not mentioned; never bend the trip to
them, and never apologise for them.

For each, costs must sum to total_per_person. Write why_this_group as one
sentence tied to their actual food, music and activity preferences. Keep
food_scene and music_scene to one short line each — they are REPLACED by
counts from our verified venue table, so claim nothing in them. tagline is at most ten
words. emoji is a single emoji for the destination. accommodation.example
names the neighbourhood or area to stay in — never a named hotel, which
nobody has checked.

${solo ? `
Travelling alone, so plan for one — not for a smaller group. Somewhere safe to
arrive at after dark. A single room, guesthouse or good hostel, never a flat
priced to be split; note a single supplement if there is one. Places where
eating alone is normal — counters, bars, markets. Never "great for sharing",
never splitting, voting or what the group wants. Keep all of this inside the
word limits below.
` : ''}
Be fast and be specific. Real place names, not categories.

Keep it tight — this has to fit in one response:
- every "details" is at most 12 words
- food_scene and music_scene are one short line each, and are replaced by
  counts from our verified venue table before anybody reads them. Never name
  a restaurant, bar or venue in them.
- why_this_group is one sentence
- tagline is at most ten words
- destination is for people to read; city and country_code are for looking the
  place up. city is the city alone, no state and no country. country_code is
  the two-letter ISO code — US, MX, PT, JP.

Return JSON only, shaped exactly like this:
{"trips":[{"id":"trip_1","destination":"City, Country","city":"City","country_code":"US","emoji":"🌍",
"tagline":"Ten words on why this group","vibe":"Vibe label",
"why_this_group":"One sentence tied to their preferences",
"food_scene":"One line, replaced","music_scene":"One line, replaced",
"total_per_person":1850,"tier":"saver","used_suggestions":[${isGroup
  ? '"Somewhere with snow for a birthday — this is a ski town"'
  : '"Somewhere your sister can see snow — this is a ski town"'}],
"costs":{"flights":{"per_person":400,"details":"..."},
"accommodation":{"per_person":500,"details":"...","example":"Neighbourhood or area"},
"ground_transport":{"per_person":100,"details":"..."},
"food_drink":{"per_person":350,"details":"..."},
"activities":{"per_person":200,"details":"..."},
"misc":{"per_person":100,"details":"..."}}}]}`;

  const client = anthropicOrNull();
  if (!client) {
    console.error('[trips generate] ANTHROPIC_API_KEY is not set');
    return NextResponse.json(
      { error: 'Trip suggestions are switched off for this deployment.' },
      { status: 503 },
    );
  }

  try {
    const response = await withSchemaFallback(
      // Three destinations, each with two scene paragraphs and six costed
      // lines, ran past 8000 and came back truncated mid-object — the schema
      // was satisfied right up to the point the tokens ran out.
      client, FAST_MODEL, 16000, prompt, TRIPS_JSON_SCHEMA, 'trips generate',
    );



    let parsed = parseTrips(textOf(response), 'trips generate');
    // A live run came back with four trips, one destination twice, and every
    // trip's cost lines summing below its own headline total.
    // Repeated destinations are dropped as a model repeating itself — except
    // when they are the point. A place can arrive two ways: the explicit
    // field, or inside what they wrote ("ski trip with the boys in aspen").
    // Only the first was allowed for, so three options at Aspen came back
    // deduped to one and somebody was shown a single "choice" again.
    //
    // With a goal present, a repeat is far likelier to be intentional than a
    // slip, and applyRules still reports the count either way.
    const samePlaceIsFine = !!fixedPlace || !!goal;
    let trips = parsed ? normalizeTrips(parsed, samePlaceIsFine) : undefined;
    if (parsed && trips && parsed.length !== trips.length) {
      console.error('[trips generate] trimmed duplicates', { returned: parsed.length, kept: trips.length });
    }

    // What came back, checked rather than trusted. Ordering and tier labels
    // are put right here; being at the wrong place earns one more attempt,
    // because three holidays somewhere else is not a choice, it is being
    // ignored.
    // For an evening, the place it must be is the one worked out above, so an
    // evening at home when they asked for Charlotte earns the same retry.
    const rule = { location: isNightPlan ? nightCity : fixedPlace };
    if (trips?.length) {
      let report = applyRules(trips, rule);
      trips = report.trips;
      if (report.fixed.length) {
        console.error('[trips generate] corrected the answer', { groupId, fixed: report.fixed });
      }
      if (report.fatal.length) {
        console.error('[trips generate] asking again', { groupId, fatal: report.fatal });
        const retry = await withSchemaFallback(
          client, FAST_MODEL, 16000,
          `${prompt}\n\n${correctionNote(report, rule)}`,
          TRIPS_JSON_SCHEMA, 'trips generate retry',
        );
        const retried = parseTrips(textOf(retry), 'trips generate retry');
        const secondTrips = retried ? normalizeTrips(retried, samePlaceIsFine) : undefined;
        if (secondTrips?.length) {
          report = applyRules(secondTrips, rule);
          trips = report.trips;
        }
        // Once, then an honest answer. Asking a third time spends somebody's
        // afternoon to be told the same thing.
        if (report.fatal.length) {
          console.error('[trips generate] still wrong after a second attempt', { groupId, fatal: report.fatal });
          return NextResponse.json(
            { error: fixedPlace
                ? `We couldn't put together three options at ${fixedPlace} just now — try again, or plan without a fixed place.`
                : "We hit a snag building your options — try again?" },
            { status: 502 },
          );
        }
      }
    }
    // ── Getting there and a bed, on every away option ─────────────────
    // A trip with a night in it is away (lib/away.ts), and an away option
    // that prices no flight or no stay is a plan with a hole in it that
    // reads as a cheap one. Asked again once, naming exactly what was left
    // out. Whatever is still missing after that is not dropped: the card
    // says it is not estimated yet (lib/away-lines.ts awayEstimate).
    if (trips?.length && !isNightPlan && nights >= 1) {
      // A flight left at 0 may be right: somewhere a drive away is priced
      // by road in ground_transport. Measured only for those, and only to
      // decide which line counts as getting there.
      const nearOnes = async (list: typeof trips) => {
        const near = new Set<unknown>();
        await Promise.all(list.map(async t => {
          if (Number(t.costs?.flights?.per_person) > 0) return;
          if (isNear(await kmFromHome(String(t.city || t.destination || ''), t.country_code ?? null))) near.add(t);
        }));
        return (t: unknown) => near.has(t);
      };
      const gaps = awayGaps(trips, nights, await nearOnes(trips));
      if (gaps.length) {
        console.error('[trips generate] an away option left out getting there or a bed — asking again', { groupId, gaps });
        const again = await withSchemaFallback(
          client, FAST_MODEL, 16000,
          `${prompt}\n\n${awayCorrection(gaps, nights)}`,
          TRIPS_JSON_SCHEMA, 'trips generate away retry',
        ).catch((e: any) => { console.error('[trips generate] the away retry failed', { message: e?.message }); return null; });
        const reparsed = again ? parseTrips(textOf(again), 'trips generate away retry') : null;
        const second = reparsed ? applyRules(normalizeTrips(reparsed, samePlaceIsFine), rule) : null;
        // Taken only if it is better and still right about the place.
        if (second && !second.fatal.length && second.trips.length >= trips.length
          && awayGaps(second.trips, nights, await nearOnes(second.trips)).length < gaps.length) {
          trips = second.trips;
        } else {
          console.error('[trips generate] still missing after asking again — shown as not estimated', { groupId, gaps });
        }
      }
    }
    // A veto is absolute on the ideas too, not only in the prompt: an idea
    // whose own card is built on something somebody going will not do is
    // not one of their choices (lib/vetoes.ts). Mentions that say no —
    // "no hiking needed" — keep the veto and stay.
    if (trips?.length && allVetoes.length) {
      const kept = trips.filter(t => {
        const hit = tripBreach(t, allVetoes);
        if (hit) console.error('[trips generate] dropped an idea that broke a veto', { groupId, destination: t.destination, veto: hit });
        return !hit;
      });
      if (!kept.length) {
        return NextResponse.json(
          { error: "Every idea we came up with ran into something one of you said no to — try again, or loosen one of the no-ways." },
          { status: 502 },
        );
      }
      trips = kept;
    }
    // ── The weather, checked rather than asked for ────────────────────
    // Each idea gets what the weather is usually like on its dates, from the
    // climate we hold (lib/climate.ts), and "Cold weather" — or heat — is
    // now a rule about the place, not a line in the prompt: an idea that
    // averages cold on the dates is dropped like any veto. An idea whose
    // place we hold no climate for is kept, and its card says it was not
    // checked rather than letting silence read as a pass.
    if (trips?.length && !isNightPlan) {
      const judged = await Promise.all(trips.map(async (t) => {
        const got = await climateFor(supabase, { name: t.city || t.destination, country: t.country_code ?? null }, { start: startDate, end: endDate }, allVetoes);
        return { t, climate: got.climate, breach: got.breach };
      }));
      const kept = judged.filter(j => {
        if (j.breach) console.error('[trips generate] dropped an idea the weather rules out', { groupId, destination: j.t.destination, veto: j.breach, when: j.climate?.trip?.when, highC: j.climate?.trip?.highC });
        return !j.breach;
      });
      for (const j of kept) (j.t as typeof j.t & { climate?: unknown }).climate = j.climate;
      if (judged.length && !kept.length) {
        return NextResponse.json(
          { error: `Every idea we came up with is usually too ${judged.some(j => j.breach === 'coldWeather') ? 'cold' : 'hot'} on those dates, and that is a no-go for this trip — try other dates, or try again.` },
          { status: 502 },
        );
      }
      trips = kept.map(j => j.t);
    }
    // The schema cannot pin the array length, so the count is checked here.
    // Fewer than three is still worth showing — an empty list is not.
    if (!trips?.length) {
      console.error('[trips generate] no trips in response', {
        groupId, nights, effectiveBudget, stop_reason: response.stop_reason,
        chars: textOf(response).length,
      });
      // Truncation and a genuinely empty answer need different words: one is
      // worth retrying as-is, the other is not.
      const truncated = response.stop_reason === 'max_tokens';
      return NextResponse.json(
        { error: truncated
            ? 'The answer came back too long to finish. Try a shorter trip or fewer nights.'
            : 'No trips came back. Try adjusting your budget or dates.' },
        { status: 502 },
      );
    }

    // ── Nobody's answers, said back to the group ─────────────────────
    // The prompt says never to name who asked for what or quote anybody;
    // this checks it listened. A line that names somebody in the group, or
    // repeats a run of what somebody wrote, is taken out — the option still
    // stands, it just does not say whose wish it answers.
    if (isGroup) {
      const said: string[] = [
        ...standing.map((x: { text: string }) => x.text),
        ...Object.values(groupAnswers?.byUser ?? {}).flatMap(u => [
          u.summary ?? '', String(u.answers.mustDo ?? ''),
          // What somebody typed as a hard no is stored in noWayJose as
          // "custom:…" (noWayText was only ever the quiz's input box), and it
          // is the most private thing anybody says here.
          ...([] as unknown[]).concat(u.answers.noWayJose ?? [], u.answers.noWay ?? [])
            .map(String).map(v => v.startsWith('custom:') ? v.slice(7) : v),
        ]),
      ].filter(Boolean);
      const who = {
        names: everyone.map((p: any) => String(p.name || '').trim().split(/\s+/)[0]).filter(Boolean),
        said, title: groupPlan?.title ?? null,
      };
      let removed = 0;
      for (const trip of trips) {
        const lines = trip.used_suggestions ?? [];
        const kept = lines.filter(l => !attributes(l, who));
        removed += lines.length - kept.length;
        trip.used_suggestions = kept;
        if (attributes(trip.why_this_group, who)) { trip.why_this_group = ''; removed++; }
        if (attributes(trip.tagline, who)) { trip.tagline = ''; removed++; }
      }
      if (removed) {
        console.error('[trips generate] took out lines that said who asked for what', { plan: groupPlan?.id, removed });
      }
    }

    // ── The scene, counted rather than remembered ────────────────────
    // Each card carried two paragraphs about a city's food and music,
    // written from the model's memory — "legendary taco trucks on Cesar
    // Chavez, plus James Beard-winning Suerte". They read beautifully and
    // asserted a dozen things nobody had checked: that the trucks are
    // there, that the award is real, that either still exists.
    //
    // We do hold something true about a town, and it is duller and better:
    // the venues we have verified in it. Counted, it cannot be wrong. Where
    // we hold nothing the line says so, which is a fair thing to tell
    // somebody choosing between three places.
    await Promise.all(trips.map(async (trip) => {
      // ── Getting there and a bed, said on the card ──────────────────
      // Where it lands: the town's own airport, or the nearest that has
      // one and a rental car from there (lib/booking/arrival.ts). Finding
      // the airport is not a price — no flight is searched for — and a
      // lookup that cannot answer in time leaves the card at "flights",
      // never at nothing.
      if (!isNightPlan) {
        const place = String(trip.city || trip.destination || '');
        const landing = within(arrivalFor({ city: place, countryCode: trip.country_code ?? null }), 6000, 'the arrival airport').catch(() => null);
        // How far from home: a day trip is away only by distance, and a
        // place a drive away is reached by road, not by a flight.
        const km = await kmFromHome(place, trip.country_code ?? null);
        const isAway = nights >= 1 || (km !== null && farEnough(km));
        const landed = await landing;
        (trip as Record<string, unknown>).away = isAway === true
          ? awayEstimate(trip, { nights: Math.max(0, nights), gateway: landed?.gateway ?? null, km })
          : null;
      }
      // A picture of the place the idea goes to, kept per destination so
      // the same town is asked about once (lib/discovery/destination-photo).
      // Alongside the count, never in front of it, and on a short leash: an
      // idea without a photograph is the card as it always looked. A night
      // out gets none — its card is about an evening at named venues, and a
      // skyline over it would read as a picture of them.
      const photoing = isNightPlan ? Promise.resolve(null) : within(
        cachedDestinationPhoto(supabase, String(trip.destination || trip.city || '')),
        4000, 'the destination photo',
      ).catch(() => null);
      const counted = { floor: false };
      const places = await placesFor(
        supabase,
        { city: trip.city || trip.destination, country: trip.country_code ?? null, interests: [...cuisines, ...musicGenres, ...activityVibes] },
        // Uncapped: this is counted, not read, and a count taken off a
        // shortened list is a number about the list rather than the town.
        // Where even the page limit is reached, the count says "+".
        { perKind: Infinity, max: Infinity, counted },
      ).catch(() => [] as RealPlace[]);

      const photo = await photoing;
      // Never the picture without its credit.
      if (photo?.credit) (trip as Record<string, unknown>).photo = { url: photo.url, credit: photo.credit, source: photo.source };
      const scenes = scenesFrom(places, { floor: counted.floor });
      if (scenes) {
        trip.food_scene = scenes.food;
        trip.music_scene = scenes.music;
        return;
      }
      // Nothing held for this town yet. Saying so is honest, and the sweep
      // has just been told about it, so the next person sees the real thing.
      trip.food_scene = 'We have not verified any places here yet — the plan will keep to what we can stand behind.';
      trip.music_scene = trip.food_scene;
    }));

    const meta = { groupSize, nights, budget: effectiveBudget, departure, departureAirport: departureCode };

    // ── Saved on the trip, for the whole group ───────────────────────
    // A group's ideas go on the plan and the vote opens: every member sees
    // these three, votes on their own phone, and the organiser picks. Until
    // the migration has run they are shown to whoever found them only, and
    // the response says so rather than letting the screen imply otherwise.
    // The ideas are built: now the go-ahead is a fact about this trip.
    // Without the row the days of each idea and the vote would still be
    // waiting, so a failed write refuses rather than hand over ideas that
    // cannot go any further.
    let goAheadRow: string | null = null;
    if (goAhead && groupPlan) {
      const { data: noted, error: notedErr } = await supabase.from('audit_logs').insert({
        user_id: ctx.user.id, action: PLANNED_WITH_ANSWERED, resource: 'plans', resource_id: groupPlan.id, success: true,
        metadata: goAhead,
      }).select('id').single();
      if (notedErr) {
        console.error('[generate] could not record going ahead with who has answered', { plan: groupPlan.id, code: notedErr.code });
        return NextResponse.json(
          { error: "We couldn't start this with who's answered just now — try again in a moment." },
          { status: 503 },
        );
      }
      goAheadRow = noted?.id ? String(noted.id) : null;
      console.log('[generate] organiser went ahead with who has answered', { plan: groupPlan.id, ...goAhead });
    }

    if (groupPlan && isGroup && ideasAvailable) {
      const ideas = ideasFrom(trips as unknown as Array<Record<string, unknown>>, {
        set: randomUUID(), foundBy: ctx.user.id, foundAt: new Date().toISOString(),
        mode: isNightPlan ? 'night' : 'trip',
      });
      const saved = await saveIdeas(supabase, groupPlan.id, ideas, replacing);
      if (saved.outcome === 'saved') {
        if (replacing) await clearVotes(supabase, groupPlan.id);
        await tellTheGroup(supabase, groupPlan.id, String(groupId), groupPlan.created_by, ctx.user.id, isNightPlan, !!replacing, ideas.options.length);
        return NextResponse.json({ success: true, trips: await ideasWithClimateNow(supabase, ideas.options, { start: startDate, end: endDate }), ideas: publicIdeas(ideas), saved: false, shared: true, meta });
      }
      if (saved.outcome === 'taken') {
        // Somebody else's Find landed first. Theirs are the group's ideas;
        // these three are dropped rather than shown beside them — so this
        // go-ahead built nothing the group will see, and its row goes.
        if (goAheadRow && groupPlan) {
          const { error: undo } = await supabase.from('audit_logs').delete().eq('id', goAheadRow);
          if (undo) console.error('[generate] could not remove a go-ahead whose ideas were not kept', { plan: groupPlan.id, code: undo.code });
        }
        if (!saved.ideas) {
          return NextResponse.json(
            { error: 'Somebody has already picked where this trip goes.', alreadyDecided: true },
            { status: 409 },
          );
        }
        return NextResponse.json({ success: true, trips: await ideasWithClimateNow(supabase, saved.ideas.options, { start: startDate, end: endDate }), ideas: publicIdeas(saved.ideas), saved: true, shared: true, meta });
      }
      // 'unavailable' or 'error': fall through, unshared.
    }

    return NextResponse.json({
      success: true,
      trips,
      // A group's ideas that could not be saved are on this phone only.
      shared: !(groupPlan && isGroup) ? null : false,
      meta,
    });
  } catch (e: any) {
    console.error('[trips generate] generation failed', {
      groupId, nights, effectiveBudget, status: e?.status, message: e?.message,
    });
    const status = e?.status === 429 ? 429 : 502;
    return NextResponse.json(
      { error: status === 429
          ? 'Reach is busy right now — try again in a moment.'
          : 'Trip generation failed — please try again.' },
      { status },
    );
  }
}

/** The saved set as a screen sees it. */
function publicIdeas(ideas: SavedIdeas) {
  return { set: ideas.set, mode: ideas.mode, foundAt: ideas.foundAt };
}

/**
 * "Your trip ideas are ready — vote", to everybody but whoever found them,
 * who is looking at them already. Opens the trip's Vote tab.
 *
 * Two messages, because the organiser is one of "everybody" whenever
 * somebody else pressed Find, and "Sam makes the pick once you've voted"
 * sent to Sam is a sentence about himself in the third person. The
 * wording is ideasReadyCopy's, so it can be tested.
 */
async function tellTheGroup(
  db: import('@supabase/supabase-js').SupabaseClient,
  planId: string, groupId: string, createdBy: string | null, finderId: string,
  night: boolean, fresh: boolean, count: number,
): Promise<void> {
  const members = await membersOf(db, groupId);
  if (!members) return;
  const others = members.map(m => m.userId).filter(id => id !== finderId);
  if (!others.length) return;
  const organiser = organiserOf(members, createdBy);
  const url = `/home?vote=${encodeURIComponent(planId)}&group=${encodeURIComponent(groupId)}`;
  const organisers = new Set(organisersOf(members, createdBy));
  const toOrganisers = others.filter(id => organisers.has(id));
  const toMembers = others.filter(id => !organisers.has(id));
  const sends: Array<Promise<{ stored: boolean }>> = [];
  for (const [ids, forOrganiser] of [[toOrganisers, true], [toMembers, false]] as const) {
    if (!ids.length) continue;
    const copy = ideasReadyCopy({
      night, fresh, count, forOrganiser,
      organiserName: organiser ? firstName(organiser.name) : null,
    });
    sends.push(notifyUsers(db, [...ids], { kind: 'ideas_ready', ...copy, url, planId }, pushSender()));
  }
  const results = await Promise.all(sends);
  if (results.some(r => !r.stored)) console.error('[generate] the group was not told about the ideas in the app', { planId });
}

/**
 * How many on a saved plan are off every flight on it — driving, or
 * holding a flight of their own (item_optouts on the flight bookings; the
 * opt-out itself is lib/participation.ts's and the participation route's).
 * Flights are one booking per departure airport, so somebody is driving
 * only when they sit out every one of them. Zero when there are no flight
 * bookings yet, or the opt-outs cannot be read: the flight line then says
 * nothing about who is driving rather than guessing.
 */
async function drivingCount(db: import('@supabase/supabase-js').SupabaseClient, planId: string): Promise<number> {
  const { data: flights, error } = await db.from('bookings')
    .select('id').eq('plan_id', planId).eq('vertical', 'flight').not('status', 'in', '("failed","cancelled")');
  if (error) {
    console.error('[trips itinerary] could not read the plan\'s flights', { plan: planId, code: error.code });
    return 0;
  }
  const ids = new Set((flights ?? []).map(f => String(f.id)));
  if (!ids.size) return 0;
  const skips = await readSkips(db, planId).then(r => r.skips).catch(() => []);
  const out = new Map<string, Set<string>>();
  for (const s of skips) {
    if (!ids.has(s.ref)) continue;
    if (!out.has(s.userId)) out.set(s.userId, new Set());
    out.get(s.userId)!.add(s.ref);
  }
  return [...out.values()].filter(refs => refs.size === ids.size).length;
}
