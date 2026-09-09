import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function POST(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { vibe, destStyle, accommodation, dealbreakers, budget, nights, travelers, location, planType, cuisine, genre } = body;

  const type = (planType as string) || 'trip';

  const prompts: Record<string, string> = {
    restaurant: `You are a restaurant recommendation engine. Generate 6 restaurant recommendations for a group dinner.
Cuisine: ${cuisine || 'any'}, Atmosphere: ${vibe || 'casual'}, Budget: $${budget || 100}pp, Group size: ${travelers || 4}, Location: ${location || 'US city'}.
Return ONLY a JSON array with 6 items, each: {"title":"Name, City","sub":"Cuisine · Neighborhood","price":"$XX pp","emoji":"🍽️","reason":"Why perfect for this group","highlights":["item1","item2","item3"],"bestFor":"occasion type","avoid":false}`,

    concert: `You are a concert recommendation engine. Generate 6 event recommendations for a group night out.
Genre: ${genre || 'any'}, Venue: ${destStyle || 'any'}, Budget: $${budget || 150}pp, Group size: ${travelers || 4}, Location: ${location || 'US city'}.
Return ONLY a JSON array with 6 items, each: {"title":"Artist/Event","sub":"Genre · Venue","price":"$XX pp","emoji":"🎵","reason":"Why this group will love it","highlights":["h1","h2","h3"],"bestFor":"fan type","avoid":false}`,

    weekend: `You are a weekend getaway recommendation engine. Generate 6 short trip destinations (2-3 nights).
Vibe: ${vibe || 'mix'}, Style: ${destStyle || 'any'}, Accommodation: ${accommodation || 'hotel'}, Budget: $${budget || 500}pp, Group: ${travelers || 4}, From: ${location || 'US'}.
Avoid: ${(dealbreakers || []).join(', ') || 'nothing'}.
Return ONLY a JSON array with 6 items, each: {"title":"Destination, State","sub":"2 nights · Style","price":"$XXX weekend","emoji":"🏡","reason":"Why perfect weekend","highlights":["h1","h2","h3"],"bestFor":"group type","avoid":false}`,

    trip: `You are a travel recommendation engine. Generate 6 trip destinations.
Vibe: ${vibe || 'mix'}, Style: ${destStyle || 'city'}, Accommodation: ${accommodation || 'hotel'}, Budget: $${budget || 2000}pp, ${nights || 7} nights, ${travelers || 4} travelers, From: ${location || 'US'}.
Avoid: ${(dealbreakers || []).join(', ') || 'nothing'}.
Return ONLY a JSON array with 6 items, each: {"title":"City, Country","sub":"${nights || 7} nights · Style","price":"$X,XXX","emoji":"✈️","reason":"Why perfect for this group","highlights":["h1","h2","h3"],"bestFor":"traveler type","avoid":false}`,
  };

  const prompt = prompts[type] || prompts.trip;

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ recommendations: getFallback(type, budget) });
    }

    const data = await response.json();
    const text = (data.content[0]?.text || '[]') as string;
    let recommendations;
    try {
      recommendations = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      recommendations = getFallback(type, budget);
    }
    return NextResponse.json({ recommendations });
  } catch {
    return NextResponse.json({ recommendations: getFallback(type, budget) });
  }
}

function getFallback(type: string, budget: number): object[] {
  const defaults: Record<string, object[]> = {
    restaurant: [
      { title: "Nobu", sub: "Japanese · Downtown", price: "$120 pp", emoji: "🍱", reason: "World-class sushi perfect for a special group dinner", highlights: ["Signature black cod", "Omakase menu", "Stunning atmosphere"], bestFor: "Special occasions" },
      { title: "Carbone", sub: "Italian-American · Greenwich Village", price: "$95 pp", emoji: "🍝", reason: "Classic NYC Italian with incredible energy and great for groups", highlights: ["Rigatoni vodka", "Veal parmesan", "Live DJ vibes"], bestFor: "Fun nights out" },
      { title: "STK Steakhouse", sub: "Steakhouse · Midtown", price: "$110 pp", emoji: "🥩", reason: "High-energy steakhouse that's perfect for celebrating together", highlights: ["Wagyu beef", "Rooftop bar", "Group-friendly menu"], bestFor: "Celebrations" },
    ],
    concert: [
      { title: "Rolling Loud Festival", sub: "Hip-Hop · Outdoor festival", price: "$180 pp", emoji: "🎤", reason: "The biggest names in hip-hop for an unforgettable group experience", highlights: ["Multiple stages", "Surprise guests", "Full day event"], bestFor: "Hip-hop fans" },
      { title: "Jazz in Central Park", sub: "Jazz · Outdoor venue", price: "$45 pp", emoji: "🎷", reason: "Intimate outdoor jazz perfect for a relaxed group evening", highlights: ["Beautiful setting", "Local legends", "Picnic-friendly"], bestFor: "Chill groups" },
    ],
    trip: [
      { title: "Lisbon, Portugal", sub: "7 nights · Culture & food", price: "$1,800", emoji: "🇵🇹", reason: "Perfect blend of history, food, and nightlife at an affordable price", highlights: ["Alfama district", "Pastéis de Belém", "Sintra day trip"], bestFor: "Culture lovers" },
      { title: "Tulum, Mexico", sub: "5 nights · Beach & wellness", price: "$1,600", emoji: "🌴", reason: "Beautiful cenotes, beach clubs, and vibrant nightlife", highlights: ["Mayan ruins", "Cenote swimming", "Beach clubs"], bestFor: "Beach groups" },
      { title: "Tokyo, Japan", sub: "8 nights · City adventure", price: "$2,400", emoji: "🗼", reason: "Incredible food scene, safe, endlessly fascinating", highlights: ["Shibuya crossing", "Ramen bars", "Akihabara"], bestFor: "Food & culture lovers" },
    ],
    weekend: [
      { title: "Napa Valley, CA", sub: "2 nights · Wine & food", price: "$450 weekend", emoji: "🍷", reason: "World-class wineries and restaurants perfect for a group getaway", highlights: ["Wine tasting", "Farm-to-table dining", "Scenic drives"], bestFor: "Wine lovers" },
      { title: "Palm Springs, CA", sub: "2 nights · Desert & pools", price: "$380 weekend", emoji: "🌵", reason: "Mid-century modern vibes, pools, and great restaurants", highlights: ["Pool parties", "Art museums", "Date shakes"], bestFor: "Social groups" },
    ],
  };
  return defaults[type] || defaults.trip;
}
