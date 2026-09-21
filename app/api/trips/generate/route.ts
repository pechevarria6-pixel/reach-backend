import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import {
  TripsSchema, ItinerarySchema, TRIPS_JSON_SCHEMA, ITINERARY_JSON_SCHEMA,
  parseModelJSON, textOf, normalizeTrips, dropFillerDays,
} from '@/lib/trip-schema';
import { applyRules, correctionNote } from '@/lib/generation-rules';
import { planReadiness } from '@/lib/plan-readiness';
import { allowance, tooOften } from '@/lib/rate-limit';

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
    departureCity, departureAirport, tripPrefs = {},
    detailTripId = null, // if set, generate full itinerary for one trip
    // A night out is not a short trip. No flights, no hotel, one evening, and
    // the only thing it needs asking that the taste quiz has not already
    // stored is roughly where it should be.
    mode = 'trip', nightPrefs = {},
    // Where they already know they are going, if they do. With one, all three
    // options are that place at three budgets — somebody who has settled on
    // Breckenridge is choosing how to do it, not whether. Without one, three
    // different places that fit what they said they wanted.
    location = null,
    // What they wrote when asked what this trip is about. The most useful
    // thing on the form, because it is the only part not picked from a list.
    goalBlurb = null,
  } = body;
  // `let`, because a saved plan can correct a caller that did not say — see
  // the detail branch below.
  let isNightPlan = mode === 'night';
  const fixedPlace = typeof location === 'string' && location.trim() ? location.trim() : null;
  const goal = typeof goalBlurb === 'string' && goalBlurb.trim() ? goalBlurb.trim().slice(0, 500) : null;

  // This reads every member's dietary needs, budget and preferences, so the
  // caller has to actually be in the group.
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });
  const ctx = await requireGroupMember(groupId);
  if (isFail(ctx)) return ctx.error;
  const supabase = ctx.db;

  // Two model calls a go, and real money each time. Nothing stopped one
  // account doing this in a loop — a stuck retry, a leaning finger — and the
  // first anybody would know is the bill. Counted in the database, because a
  // counter in a module variable is per-instance and resets whenever a new
  // serverless instance starts, which is not a limit.
  const rate = await allowance(supabase, ctx.user.id, 'trip_generated');
  if (!rate.allowed) {
    console.error('[generate] rate limited', { user: ctx.user.id, used: rate.used });
    return NextResponse.json({ error: tooOften(rate) }, { status: 429 });
  }

  // Written before the work, not after: a generation that times out or
  // crashes still cost the money it cost, and a limit that only counts the
  // successes is a limit a failing loop walks straight through.
  const { error: counted } = await supabase.from('audit_logs').insert({
    user_id: ctx.user.id, action: 'trip_generated', resource: 'groups', resource_id: groupId, success: true,
    metadata: { mode, nights: null },
  });
  if (counted) console.error('[audit] could not record trip_generated — this one is not counted', { code: counted.code });

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

  const prefs = (members || []).map((m: any) => m.users).filter(Boolean);
  const groupSize = prefs.length || 2;
  // Travelling alone is a different trip, not a smaller one. The prompt used
  // to say "GROUP: 1 people" and then plan for a committee.
  const solo = groupSize <= 1;
  // `let`, and recomputed if the saved plan turns out to be an evening.
  let nights = isNightPlan ? 1 : (startDate && endDate
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    : 5);

  const budgetMap: Record<string, number> = { budget: 800, mid: 2000, premium: 4000, luxury: 8000 };
  const budgets = prefs.map((p: any) => p.budget_range).filter(Boolean);
  const effectiveBudget = budgetPerPerson ||
    (budgets.length > 0 ? Math.min(...budgets.map((b: string) => budgetMap[b] || 2000)) : 2000);

  const allVetoes = [...new Set([
    ...prefs.flatMap((p: any) => p.no_way_jose || []),
    ...(tripPrefs.noWayJose || []),
  ])];
  const dietaryNeeds = [...new Set(prefs.map((p: any) => p.dietary_needs).filter((d: any) => d && d !== 'none'))];
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

  // What each of them said in their own words, with their name on it.
  //
  // Everything above is a set of tick-boxes flattened across the group, which
  // loses who wanted what — and the one thing somebody actually cares about
  // is rarely on a list. "My sister is turning forty" cannot be inferred from
  // cuisines. Attributed, because a plan that answers a named person is one
  // they recognise as theirs.
  const suggestions = prefs
    .map((p: any) => ({ name: String(p.name || '').trim().split(/\s+/)[0], text: String(p.trip_summary || '').trim() }))
    .filter((x: { name: string; text: string }) => x.text)
    .map((x: { name: string; text: string }) => `${x.name || 'Someone'} said: "${x.text.slice(0, 300)}"`);
  const saidBlock = suggestions.length
    ? `\nWHAT THEY EACH SAID THEY WANT — in their own words:\n${suggestions.join('\n')}\n
These are standing answers about trips in general. Where one disagrees with
what they said THIS trip is, this trip wins — a note about snow does not
override "in Aspen to celebrate Kyle", and an option whose used_suggestions
only mentions a standing answer has ignored the thing actually being planned.

Answer these. For every option, used_suggestions lists which of them it acts
on and how, naming the person: "Priya wanted somewhere her sister could see
snow — this is a ski town". If an option genuinely acts on none of them, send
an empty array rather than inventing one. Do not repeat a wish back as though
quoting it were the same as planning around it.\n`
    : '';
  const tripTypes = (tripPrefs.tripType || []).join(', ') || 'any';
  const tripPace = tripPrefs.pace || 'balanced';
  const tripAccommodation = (tripPrefs.accommodation || []).join(', ') || 'hotel';
  const departure = departureCity || 'a major US city';
  const departureCode = departureAirport || 'nearest major airport';

  // ── STAGE 2: Full itinerary for one selected trip ──────────────────────────
  if (detailTripId) {
    const { destination, vibe, costs } = body.tripData || {};

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
    if (isUuid) {
      const { data: planRow } = await supabase
        .from('plans').select('group_id, solo_mode, type').eq('id', detailTripId).maybeSingle();

      // The plan already knows what it is, so a caller that forgets to say
      // cannot get a full day for an evening. That is exactly what happened:
      // the request omitted `mode`, this defaulted to a trip, and "Dinner
      // and Live Jazz" came back as a pottery studio in the morning and
      // lunch at an izakaya. The client says it now as well; this is so it
      // does not matter if one ever stops.
      if (planRow?.type === 'restaurant' && !isNightPlan) {
        console.error('[generate] plan is an evening but the request did not say — using the evening prompt', { plan: detailTripId });
        isNightPlan = true;
        // An evening is one night, whatever dates were passed alongside it.
        nights = 1;
      }
      if (planRow?.group_id) {
        try {
          const readiness = await planReadiness(
            supabase, String(detailTripId), String(planRow.group_id),
            planRow.solo_mode === true,
          );
          if (!readiness.allReady) {
            const waiting = readiness.waitingOn;
            return NextResponse.json({
              error: waiting.length === 1
                ? `${waiting[0]} hasn't said what they want from this trip yet. The plan gets written once everyone has.`
                : `${waiting.slice(0, -1).join(', ')} and ${waiting[waiting.length - 1]} haven't said what they want from this trip yet. The plan gets written once everyone has.`,
              waitingOn: waiting,
            }, { status: 409 });
          }
        } catch {
          console.error('[generate] could not check who has answered', { plan: detailTripId });
          return NextResponse.json(
            { error: 'We could not check who has answered yet — try again in a moment.' },
            { status: 503 },
          );
        }
      }
    }

    let wantedBlock = '';
    const tripVetoes: string[] = [];
    if (isUuid) {
      const { data: said, error: saidError } = await supabase
        .from('plan_preferences')
        .select('summary_text, answers, users(name)')
        .eq('plan_id', detailTripId)
        .not('submitted_at', 'is', null);
      if (saidError) {
        console.error('[generate] could not read what the group asked for', { plan: detailTripId, code: saidError.code });
      } else {
        const lines: string[] = [];
        for (const row of said ?? []) {
          const r = row as Record<string, unknown>;
          const raw = r.users as Record<string, unknown> | Record<string, unknown>[] | null;
          const u = ((Array.isArray(raw) ? raw[0] : raw) ?? {}) as Record<string, unknown>;
          const who = String(u.name || '').trim().split(/\s+/)[0] || 'Someone';
          const a = (r.answers ?? {}) as Record<string, unknown>;
          const parts: string[] = [];
          if (r.summary_text) parts.push(String(r.summary_text));
          if (a.mustDo) parts.push(`must do: ${String(a.mustDo)}`);
          if (a.noWay) {
            parts.push(`will not: ${String(a.noWay)}`);
            // A thing somebody said to avoid is a constraint, not a hint.
            tripVetoes.push(String(a.noWay));
          }
          if (parts.length) lines.push(`- ${who}: ${parts.join(' · ')}`);
        }
        if (lines.length) {
          wantedBlock = `\nWHAT EACH OF THEM ASKED FOR, FOR THIS TRIP — these are the
answers that matter most here, because they were given about this trip and not
about trips in general. Plan around them by name:\n${lines.join('\n')}\n`;
        }
      }
    }
    const allVetoesHere = [...allVetoes, ...tripVetoes];
    const nightWhen = [nightPrefs.time, nightPrefs.where].filter(Boolean).join(', ');
    const nightKind = (nightPrefs.kind || []).join(', ');
    const nightFood = (nightPrefs.food || []).join(', ');
    const prompt = isNightPlan ? `Plan one evening out: ${destination}.

${solo ? 'One person, on their own.' : `${groupSize} people going out together.`}
${nightWhen ? `When and where: ${nightWhen}` : ''}
${nightKind ? `What they want out of it: ${nightKind}` : ''}
${nightPrefs.energy ? `Energy: ${nightPrefs.energy}` : ''}
Food tonight: ${nightFood || cuisines.slice(0, 4).join(', ') || 'varied'}
Music: ${musicGenres.slice(0, 3).join(', ') || 'mixed'}
Drinks: ${drinkStyles.join(', ') || 'no preference'}
A good night out, in their words: ${nightlife.join(', ') || 'no preference'}
Dietary (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}
${allVetoesHere.length ? `Never include: ${allVetoesHere.join(', ')}` : ''}${wantedBlock}

Return exactly one day. Use its three slots as the shape of an evening:
- "morning" is where they meet first — a bar for a drink, a walk, or the thing
  before the thing. If the evening genuinely starts at dinner, say so there.
- "afternoon" is the main event: the game, the gig, the show, the booking.
- "evening" is what follows: dinner, dessert, a last drink.

Real venues with real names, all within a short ride of each other, all open
that evening. About $${effectiveBudget} a head across the whole night, and
each slot's "cost" is what one person actually spends at that stop.

No flights. No hotel. Nobody is going away — this is a night in their own city
or one nearby.

Every slot needs its practical details, because the point is that nobody turns
up and finds out the hard way:
- "booking": "reach" if it takes reservations, "ahead" if it must be booked
  direct, "walk_in" if you just turn up.
Never "reach" for a restaurant, a bar or anything with a table. Reach does
not take tables: the member books their own, on their own account and their
own card, because that is where their card's dining benefits live — Amex
opens doors on Resy, Chase on OpenTable, and a reservation made by us on our
card throws all of that away. A place that takes bookings is "ahead"; one
that does not is "walk_in". Only a flight, a hotel or a ticketed tour is
"reach".
- "payment": leave this an empty string unless you know it for this exact
  place. Not what places like it usually take — this one. We check payment
  against sources that record it, so an empty string costs nobody anything
  and a wrong guess strands somebody at a till.

Never write "placeholder", "TBD" or any other filler.

insider_tip is what a place is like, not what a business does. Weather,
crowds, terrain, light, parking, how long things take, what to bring — all
good, and being wrong about them costs an hour.

Never state a named business's opening hours, prices, cover charge, payment,
booking policy, or what it will do for you. "Milt's is cash-only and has no
ATM inside", "Woody's charges a cover after 9pm", "go right at open (5pm)" —
those read as fact, and being wrong about them costs somebody their evening.
You have not rung these places and neither have we. Write about the desert,
the queue and the light instead, or leave it empty.
The same rule covers the plan line itself. Name the place, describe the
outing, do not slip in a policy: "no cover if you sit at the bar",
"no reservations needed", "Sabaku's sister spot" — each asserts something
about a business that would have to be checked, and none of them was.` : `Generate a detailed ${nights}-day itinerary for a group trip to ${destination}.

${solo ? `Travelling: alone, ${tripPace} pace` : `Group: ${groupSize} people, ${tripPace} pace`}
Food loves: ${cuisines.slice(0, 4).join(', ') || 'varied'}
Music/nightlife: ${musicGenres.slice(0, 3).join(', ') || 'mixed'}
Activities: ${activityVibes.slice(0, 4).join(', ') || 'mixed'}
Dietary: ${dietaryNeeds.join(', ') || 'no restrictions'}
Accommodation: ${tripAccommodation}
${allVetoesHere.length ? `Never include: ${allVetoesHere.join(', ')}` : ''}${wantedBlock}

${solo ? `On their own, so every slot works for one: counter or bar seating,
neighbourhoods that are comfortable solo, some days to meet people and some to
talk to nobody. Nothing that needs a second person. Never mention sharing.
` : ''}
Every slot also needs "cost": what that one thing costs per person, in whole
dollars. A free walk is 0. A museum is its ticket price. Dinner is what one
person actually spends there, drinks included. These are the numbers somebody
budgets against, so be realistic rather than optimistic — and make each day's
three costs add up to roughly that day's cost_today.

Never write "placeholder", "TBD", "N/A", "Activity" or any other filler. Every
slot names a real place a person could walk into. If you genuinely cannot fill
${nights} days with real places, return fewer days rather than padding — a
short honest itinerary beats a long one with holes in it.

Write one entry for each of the ${nights} days.

Be specific: real venue names, real neighbourhoods. Make it feel like a local
planned it, not a guidebook.

insider_tip is what a place is like, not what a business does. Weather,
crowds, terrain, light, parking, how long things take, what to bring — all
good, and being wrong about them costs an hour.

Never state a named business's opening hours, prices, cover charge, payment,
booking policy, or what it will do for you. "Milt's is cash-only and has no
ATM inside", "Woody's charges a cover after 9pm", "go right at open (5pm)" —
those read as fact, and being wrong about them costs somebody their evening.
You have not rung these places and neither have we. Write about the desert,
the queue and the light instead, or leave it empty.
The same rule covers the plan line itself. Name the place, describe the
outing, do not slip in a policy: "no cover if you sit at the bar",
"no reservations needed", "Sabaku's sister spot" — each asserts something
about a business that would have to be checked, and none of them was.

Every slot needs its practical details, because the point of this is that
nobody arrives somewhere and finds out the hard way:
- "booking": "reach" if it is a hotel, flight or ticketed tour Reach can book
  outright; "ahead" if it needs reserving but the person does it themselves —
  a table, a tasting menu, a permit, a timed entry; "walk_in" if you just turn
  up.
Never "reach" for a restaurant, a bar or anything with a table. Reach does
not take tables: the member books their own, on their own account and their
own card, because that is where their card's dining benefits live — Amex
opens doors on Resy, Chase on OpenTable, and a reservation made by us on our
card throws all of that away. A place that takes bookings is "ahead"; one
that does not is "walk_in". Only a flight, a hotel or a ticketed tour is
"reach".
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
      if (days.length < (parsed?.itinerary?.length ?? 0)) {
        console.error('[trips itinerary] dropped filler days', {
          destination, asked: nights,
          returned: parsed?.itinerary?.length, kept: days.length,
        });
      }
      if (!days.length) {
        console.error('[trips itinerary] no itinerary in response', {
          destination, nights, stop_reason: res.stop_reason,
        });
        return NextResponse.json(
          { error: 'Could not build an itinerary for those dates — please try again.' },
          { status: 502 },
        );
      }
      return NextResponse.json({ itinerary: days });
    } catch (e: any) {
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
  const nightWhere = [nightPrefs.time, nightPrefs.where].filter(Boolean).join(', ');
  const prompt = isNightPlan ? `You are Reach. Generate exactly 3 options for ONE NIGHT OUT near ${departureCity || 'the user'}. BE FAST — overviews and honest costs, no itinerary yet.

${solo ? 'ONE PERSON, on their own.' : `GROUP: ${groupSize} people.`}
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
DIETARY (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}${saidBlock}
${allVetoes.length > 0 ? 'NEVER INCLUDE: ' + allVetoes.join(', ') : ''}

Each option is a real evening in a named neighbourhood — "Dinner and a gig in
the Mission", not a city. destination is that evening's name. Three genuinely
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
answers. food_scene and music_scene are two sentences each. tagline is at most
ten words. emoji is one emoji. accommodation.example is the neighbourhood the
night happens in.` : `You are Reach's AI travel planner. Generate exactly 3 destination options. BE FAST — no itinerary needed yet, just destination overviews and cost estimates.

${solo
  ? `TRAVELLING: alone, ${nights} nights, $${effectiveBudget} budget`
  : `GROUP: ${groupSize} people, ${nights} nights, $${effectiveBudget}/person budget`}
DEPARTING: ${departure} (${departureCode})
DATES: ${startDate || 'flexible'} to ${endDate || 'flexible'}
${goal ? `WHAT THEY SAID THIS TRIP IS, IN THEIR OWN WORDS — this leads over
everything below it:
"${goal}"

Read it properly. If it names a place, that place IS the destination and all
three options are there at three budgets — "ski trip with the boys in Aspen"
means Aspen, three ways, not Aspen and two other mountains. If it names an
occasion, every option should be somewhere that occasion makes sense, and
why_this_group should say so in a way the person who wrote it would
recognise. If it names people, plan for those people.

Every option's used_suggestions must say how it serves THIS — "Aspen, the
mountain Kyle asked for, at the cheaper end of the season" — before it
mentions any standing answer. An empty used_suggestions when they have told
you what the trip is for means you did not use it.
` : ''}WHAT THIS TRIP IS FOR (standing preferences below yield to it): ${tripTypes}
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
DIETARY (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}${saidBlock}
${allVetoes.length > 0 ? 'VETOES (never include): ' + allVetoes.join(', ') : ''}

Price diversity is required. Return exactly three options, one per tier, and
hit these totals — specific numbers, not a range, because percentages of a
budget came back clustered at 70%, 89% and 95%, which is not a choice:
- "saver":     total_per_person about $${Math.round(effectiveBudget * 0.65)}
- "on_budget": total_per_person about $${effectiveBudget}
- "stretch":   total_per_person about $${Math.round(effectiveBudget * 1.15)}

Each total must land within 10% of the figure above for its tier.

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
food_scene and music_scene to two sentences each. tagline is at most ten
words. emoji is a single emoji for the destination. accommodation.example
names a specific hotel or neighbourhood.

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
- food_scene and music_scene are two short sentences each
- why_this_group is one sentence
- tagline is at most ten words
- destination is for people to read; city and country_code are for looking the
  place up. city is the city alone, no state and no country. country_code is
  the two-letter ISO code — US, MX, PT, JP.

Return JSON only, shaped exactly like this:
{"trips":[{"id":"trip_1","destination":"City, Country","city":"City","country_code":"US","emoji":"🌍",
"tagline":"Ten words on why this group","vibe":"Vibe label",
"why_this_group":"One sentence tied to their preferences",
"food_scene":"Two sentences","music_scene":"Two sentences",
"total_per_person":1850,"tier":"saver","used_suggestions":["Priya wanted somewhere her sister could see snow — this is a ski town"],
"costs":{"flights":{"per_person":400,"details":"..."},
"accommodation":{"per_person":500,"details":"...","example":"Hotel or area"},
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



    let parsed = parseModelJSON(textOf(response), TripsSchema, 'trips generate')?.trips;
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
    const rule = { location: fixedPlace };
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
        const retried = parseModelJSON(textOf(retry), TripsSchema, 'trips generate retry')?.trips;
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

    return NextResponse.json({
      success: true,
      trips,
      meta: { groupSize, nights, budget: effectiveBudget, departure, departureAirport: departureCode },
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
