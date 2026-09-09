import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    groupId, startDate, endDate, budgetPerPerson,
    departureCity, departureAirport, tripPrefs = {},
    detailTripId = null, // if set, generate full itinerary for one trip
  } = body;

  const supabase = createServerClient();

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

Return ONLY valid JSON array for all ${nights} days:
[{"day":1,"title":"Day Title","morning":"Specific activity with venue name","afternoon":"Specific activity","evening":"Specific restaurant + bar/venue","cost_today":85,"insider_tip":"Local tip"}]

Be specific — real venue names, real neighborhoods. Make it feel like a local planned it.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return NextResponse.json({ error: 'Failed to generate itinerary' }, { status: 503 });
    const data = await res.json();
    const text = (data.content[0]?.text || '[]').replace(/```json|```/g, '').trim();
    let itinerary;
  try {
    itinerary = JSON.parse(text);
  } catch (e) {
    console.error('[trips itinerary] JSON parse failed, len', text.length, 'tail:', text.slice(-300));
    return NextResponse.json({ error: 'AI response parsing failed - please try again' }, { status: 500 });
  }
    return NextResponse.json({ itinerary });
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

Return ONLY valid JSON, no other text:
{"trips":[{
  "id":"trip_1",
  "destination":"City, Country",
  "tagline":"Why perfect for this specific group in 10 words",
  "emoji":"🌍",
  "total_per_person":1850,
  "vibe":"Trip vibe label",
  "highlight":"The one unmissable thing",
  "why_this_group":"1 sentence personalized to their food/music/activity prefs",
  "weather":"Weather for travel dates",
  "visa":"Visa info for US citizens",
  "food_scene":"2 sentences on food scene for their tastes",
  "music_scene":"2 sentences on music/nightlife scene",
  "costs":{
    "flights":{"per_person":400,"details":"Round trip ${departureCode}→DEST economy","airlines":"Likely carriers"},
    "accommodation":{"per_person":500,"details":"${nights} nights, ${tripAccommodation}","example":"Specific hotel/area"},
    "ground_transport":{"per_person":100,"details":"Airport + local transport"},
    "food_drink":{"per_person":350,"details":"All meals avg per day","must_eat":["Restaurant 1","Restaurant 2"]},
    "activities":{"per_person":200,"details":"Top experiences","examples":["Activity 1 $X","Activity 2 $X"]},
    "misc":{"per_person":100,"details":"Insurance, tips, buffer"}
  }
}]}

3 very different destinations. Costs must sum to total_per_person. Make it fast.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000, // Much smaller — no itinerary yet
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return NextResponse.json({ error: 'AI unavailable' }, { status: 503 });

    const aiData = await response.json();
    const rawText = (aiData.content[0]?.text || '');
    
    // Robust JSON extraction — handle markdown fences and extra text
    let text = rawText.replace(/```json|```/g, '').trim();
    
    // Find the JSON object if there's surrounding text
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      text = text.slice(jsonStart, jsonEnd + 1);
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('Parse failed, raw response:', rawText.slice(0, 500));
      // Try to extract trips array directly
      const tripsMatch = rawText.match(/"trips"\s*:\s*\[[\s\S]*\]/);
      if (tripsMatch) {
        try {
          result = { trips: JSON.parse('[' + tripsMatch[0].split('[').slice(1).join('[').split(']').slice(0,-1).join(']') + ']') };
        } catch {
          return NextResponse.json({ error: 'AI response parsing failed — please try again' }, { status: 500 });
        }
      } else {
        return NextResponse.json({ error: 'AI response parsing failed — please try again' }, { status: 500 });
      }
    }

    if (!result?.trips?.length) {
      return NextResponse.json({ error: 'No trips generated — try adjusting your budget or dates' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      trips: result.trips,
      meta: { groupSize, nights, budget: effectiveBudget, departure, departureAirport: departureCode },
    });
  } catch (e) {
    console.error('Trip generation error:', e);
    return NextResponse.json({ error: 'Trip generation failed — please try again' }, { status: 500 });
  }
}
