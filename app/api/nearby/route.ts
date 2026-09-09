import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { userId: clerkId } = auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const lat = req.nextUrl.searchParams.get('lat');
  const lng = req.nextUrl.searchParams.get('lng');
  const city = req.nextUrl.searchParams.get('city') || '';

  // Get user preferences for personalization
  const supabase = createServerClient();
  const { data: userData } = await supabase
    .from('users')
    .select('cuisines, music_genres, activity_vibe, dining_vibe, nightlife_style, concert_types')
    .eq('clerk_id', clerkId)
    .single();

  const userCuisines = userData?.cuisines?.slice(0, 3) || [];
  const userMusic = userData?.music_genres?.slice(0, 3) || [];
  const userActivities = userData?.activity_vibe?.slice(0, 3) || [];

  // Try Ticketmaster first (fast, reliable)
  if (process.env.TICKETMASTER_API_KEY && lat && lng) {
    try {
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${process.env.TICKETMASTER_API_KEY}&latlong=${lat},${lng}&radius=90&unit=miles&size=10&sort=date,asc`;
      const res = await fetch(url, { next: { revalidate: 3600 } }); // cache 1 hour
      if (res.ok) {
        const data = await res.json();
        const events = (data._embedded?.events || []).map((e: any) => ({
          id: e.id,
          title: e.name,
          meta: `${new Date(e.dates.start.localDate).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${e._embedded?.venues?.[0]?.name || 'Venue TBD'}`,
          emoji: getEmoji(e.classifications?.[0]?.segment?.name),
          price: e.priceRanges?.[0] ? `From $${Math.round(e.priceRanges[0].min)}` : 'Free',
          dist: e._embedded?.venues?.[0]?.distance ? `${Math.round(e._embedded.venues[0].distance)} mi` : null,
          category: e.classifications?.[0]?.segment?.name || 'Event',
          url: e.url,
        }));
        return NextResponse.json({ events, source: 'ticketmaster', city });
      }
    } catch (e) {}
  }

  // Use AI with a focused, fast prompt
  if (process.env.ANTHROPIC_API_KEY) {
    const locationStr = city || (lat && lng ? `coordinates ${lat},${lng}` : 'a US city');
    
    const prompt = `List 8 specific local experiences near ${locationStr} right now.

User likes: ${[...userCuisines, ...userMusic, ...userActivities].join(', ') || 'mixed interests'}

Return ONLY this JSON array, nothing else:
[{"id":"1","title":"Specific Venue or Event Name","meta":"When · Where (neighborhood)","emoji":"🎵","price":"$XX or Free","dist":"X mi","category":"Concert|Restaurant|Bar|Outdoor|Sports|Art|Festival"}]

Rules: Real venue names. Mix categories. Specific to ${locationStr || 'the area'}. Short meta (under 40 chars).`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800, // Much smaller — just a list
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = (data.content[0]?.text || '').replace(/```json|```/g, '').trim();
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
          const events = JSON.parse(text.slice(start, end + 1));
          return NextResponse.json({ events, source: 'ai', city: locationStr });
        }
      }
    } catch (e) {}
  }

  // Fast static fallback — curated by category, no AI needed
  return NextResponse.json({
    events: [
      { id:'1', title:'Live Music Night', meta:'Tonight · Local Venue', emoji:'🎵', price:'From $15', dist:'0.5 mi', category:'Concert' },
      { id:'2', title:'Weekend Brunch Pop-up', meta:'Sat & Sun 10am · Downtown', emoji:'🥞', price:'From $25', dist:'0.8 mi', category:'Restaurant' },
      { id:'3', title:'Rooftop Bar Night', meta:'Fri & Sat · City Center', emoji:'🍹', price:'Free entry', dist:'1.2 mi', category:'Bar' },
      { id:'4', title:'Farmers Market', meta:'Sat 8am–1pm · Main St', emoji:'🌿', price:'Free', dist:'0.6 mi', category:'Outdoor' },
      { id:'5', title:'Comedy Show', meta:'This weekend · Comedy Club', emoji:'😂', price:'From $20', dist:'1.5 mi', category:'Comedy' },
      { id:'6', title:'Art Gallery Opening', meta:'Friday 6pm · Arts District', emoji:'🎨', price:'Free', dist:'1.8 mi', category:'Art' },
      { id:'7', title:'Food & Wine Festival', meta:'This weekend · Waterfront', emoji:'🍷', price:'From $35', dist:'2.1 mi', category:'Festival' },
      { id:'8', title:'Outdoor Movie Night', meta:'Saturday 8pm · City Park', emoji:'🎬', price:'From $12', dist:'1.0 mi', category:'Outdoor' },
    ],
    source: 'fallback',
    city,
  });
}

function getEmoji(segment: string) {
  const map: Record<string, string> = {
    'Music': '🎵', 'Sports': '🏆', 'Arts & Theatre': '🎭',
    'Film': '🎬', 'Miscellaneous': '🎉', 'Family': '👨‍👩‍👧',
  };
  return map[segment] || '🎫';
}
