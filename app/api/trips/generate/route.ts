import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, isFail } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import {
  TripsSchema, ItinerarySchema, TRIPS_JSON_SCHEMA, ITINERARY_JSON_SCHEMA,
  parseModelJSON, textOf,
} from '@/lib/trip-schema';

// ─── Models ──────────────────────────────────────────────────────────────
// Stage 1 only names destinations and estimates costs, and the person is
// staring at a spinner while it runs, so it takes the fast model. Stage 2
// writes the itinerary somebody will actually follow, so it takes the
// capable one. Both were claude-sonnet-4-6, a previous generation.
const FAST_MODEL = 'claude-haiku-4-5';
const QUALITY_MODEL = 'claude-opus-5';

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
  } = body;

  // This reads every member's dietary needs, budget and preferences, so the
  // caller has to actually be in the group.
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });
  const ctx = await requireGroupMember(groupId);
  if (isFail(ctx)) return ctx.error;
  const supabase = ctx.db;

  const { data: members } = await supabase
    .from('group_members')
    .select(`users(id,name,budget_range,climate_preference,dietary_needs,
      cuisines,music_genres,dining_vibe,drink_style,nightlife_style,
      concert_types,activity_vibe,no_way_jose)`)
    .eq('group_id', groupId);

  const prefs = (members || []).map((m: any) => m.users).filter(Boolean);
  const groupSize = prefs.length || 2;
  const nights = startDate && endDate
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    : 5;

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
  const tripTypes = (tripPrefs.tripType || []).join(', ') || 'any';
  const tripPace = tripPrefs.pace || 'balanced';
  const tripAccommodation = (tripPrefs.accommodation || []).join(', ') || 'hotel';
  const departure = departureCity || 'a major US city';
  const departureCode = departureAirport || 'nearest major airport';

  // ── STAGE 2: Full itinerary for one selected trip ──────────────────────────
  if (detailTripId) {
    const { destination, vibe, costs } = body.tripData || {};
    const prompt = `Generate a detailed ${nights}-day itinerary for a group trip to ${destination}.

Group: ${groupSize} people, ${tripPace} pace
Food loves: ${cuisines.slice(0, 4).join(', ') || 'varied'}
Music/nightlife: ${musicGenres.slice(0, 3).join(', ') || 'mixed'}
Activities: ${activityVibes.slice(0, 4).join(', ') || 'mixed'}
Dietary: ${dietaryNeeds.join(', ') || 'no restrictions'}
Accommodation: ${tripAccommodation}

Write one entry for each of the ${nights} days.

Be specific: real venue names, real neighbourhoods. Make it feel like a local
planned it, not a guidebook. insider_tip is the thing a visitor would only
know on a second trip.`;

    const client = anthropicOrNull();
    if (!client) {
      console.error('[trips itinerary] ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        { error: 'Itinerary generation is switched off for this deployment.' },
        { status: 503 },
      );
    }

    try {
      const res = await client.messages.create({
        model: QUALITY_MODEL,
        // 8000 truncated a long itinerary mid-object, which is what most of
        // the old parse failures actually were.
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: ITINERARY_JSON_SCHEMA } },
      });

      const parsed = parseModelJSON(textOf(res), ItinerarySchema, 'trips itinerary');
      if (!parsed?.itinerary?.length) {
        console.error('[trips itinerary] no itinerary in response', {
          destination, nights, stop_reason: res.stop_reason,
        });
        return NextResponse.json(
          { error: 'Could not build an itinerary for those dates — please try again.' },
          { status: 502 },
        );
      }
      return NextResponse.json({ itinerary: parsed.itinerary });
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
  const prompt = `You are Reach's AI travel planner. Generate exactly 3 destination options. BE FAST — no itinerary needed yet, just destination overviews and cost estimates.

GROUP: ${groupSize} people, ${nights} nights, $${effectiveBudget}/person budget
DEPARTING: ${departure} (${departureCode})
DATES: ${startDate || 'flexible'} to ${endDate || 'flexible'}
TRIP TYPE: ${tripTypes}
PACE: ${tripPace}
STAY: ${tripAccommodation}
FOOD: ${cuisines.slice(0, 5).join(', ') || 'varied'}
MUSIC: ${musicGenres.slice(0, 4).join(', ') || 'mixed'}
ACTIVITIES: ${activityVibes.slice(0, 4).join(', ') || 'mixed'}
DIETARY (must accommodate ALL): ${dietaryNeeds.join(', ') || 'none'}
${allVetoes.length > 0 ? 'VETOES (never include): ' + allVetoes.join(', ') : ''}

Price diversity is required. Return exactly three options, one per tier:
- "saver": roughly 60-70% of the budget
- "on_budget": close to the budget
- "stretch": roughly 110-120% of the budget

The three must be genuinely different places, not three versions of the same
idea — vary the region and the type of destination, not just the hotel.

For each, costs must sum to total_per_person. Write why_this_group as one
sentence tied to their actual food, music and activity preferences. Keep
food_scene and music_scene to two sentences each. tagline is at most ten
words. emoji is a single emoji for the destination. accommodation.example
names a specific hotel or neighbourhood.

Be fast and be specific. Real place names, not categories.`;

  const client = anthropicOrNull();
  if (!client) {
    console.error('[trips generate] ANTHROPIC_API_KEY is not set');
    return NextResponse.json(
      { error: 'Trip suggestions are switched off for this deployment.' },
      { status: 503 },
    );
  }

  try {
    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: TRIPS_JSON_SCHEMA } },
    });

    const trips = parseModelJSON(textOf(response), TripsSchema, 'trips generate')?.trips;
    if (!trips?.length) {
      console.error('[trips generate] no trips in response', {
        groupId, nights, effectiveBudget, stop_reason: response.stop_reason,
      });
      return NextResponse.json(
        { error: 'No trips came back — try adjusting your budget or dates.' },
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
