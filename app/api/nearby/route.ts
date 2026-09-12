// ─── /api/nearby ─────────────────────────────────────────────────────────
// Real, on-sale events near a point, from Ticketmaster's Discovery API.
//
// This used to fall back twice when Ticketmaster had nothing: first to a model
// that invented plausible local events ("Live Music Night, Tonight, Local
// Venue"), then to eight hardcoded fixtures of the same shape. Neither could
// be bought and neither was real, so the screen filled with listings that did
// not exist. An empty answer that says why is worth more than a fixture.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';

type Reason = 'ok' | 'no_key' | 'no_location' | 'none_nearby' | 'provider_error';

const EMOJI: Record<string, string> = {
  Music: '🎵', Sports: '🏆', 'Arts & Theatre': '🎭',
  Film: '🎬', Miscellaneous: '🎉', Family: '👨‍👩‍👧',
};


// Lowest advertised price across every range the event publishes, or null when
// it publishes none.
function priceFrom(e: any): string | null {
  const mins = (e.priceRanges ?? [])
    .map((r: any) => r?.min)
    .filter((n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (!mins.length) return null;
  const low = Math.min(...mins);
  return low === 0 ? 'Free' : `From $${Math.round(low)}`;
}

// An event is past once its end date, or its start date when there is no end,
// is before today. Compared by local date so an event tonight still counts.
function notPast(e: any): boolean {
  const day = e.dates?.end?.localDate || e.dates?.start?.localDate;
  if (!day) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const when = new Date(`${day}T23:59:59`);
  return when.getTime() >= today.getTime();
}

function empty(reason: Reason, city: string) {
  return NextResponse.json({ events: [], reason, city });
}

export async function GET(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const lat = req.nextUrl.searchParams.get('lat');
  const lng = req.nextUrl.searchParams.get('lng');
  const city = req.nextUrl.searchParams.get('city') || '';

  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    console.error('[nearby] TICKETMASTER_API_KEY is not set');
    return empty('no_key', city);
  }
  if (!lat || !lng) return empty('no_location', city);

  // Only what has not happened yet. Without startDateTime the Discovery API
  // happily returns events from the past, sorted to the top by date ascending.
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url =
    `https://app.ticketmaster.com/discovery/v2/events.json` +
    `?apikey=${encodeURIComponent(key)}` +
    `&latlong=${encodeURIComponent(`${lat},${lng}`)}` +
    `&startDateTime=${encodeURIComponent(now)}` +
    `&radius=90&unit=miles&size=20&sort=date,asc`;

  let data: any;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      console.error('[nearby] Ticketmaster returned', res.status);
      return empty('provider_error', city);
    }
    data = await res.json();
  } catch (e: any) {
    console.error('[nearby] Ticketmaster request failed:', e?.message);
    return empty('provider_error', city);
  }

  const events = (data?._embedded?.events ?? [])
    // No url means nothing to buy, which is the whole point of the card.
    // Belt and braces: the API is asked for future events, but a stale cached
    // page or a timezone edge can still slip one through.
    .filter((e: any) => e?.url && e?.name && notPast(e))
    .map((e: any) => {
      const venue = e._embedded?.venues?.[0];
      const start = e.dates?.start?.localDate;
      const when = start
        ? new Date(`${start}T12:00:00`).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          })
        : 'Date TBC';
      const segment = e.classifications?.[0]?.segment?.name || 'Event';
      return {
        id: e.id,
        title: e.name,
        meta: `${when} · ${venue?.name || 'Venue TBC'}`,
        emoji: EMOJI[segment] || '🎫',
        // Ticketmaster omits priceRanges on plenty of events. That is "we are
        // not told", not "free" — labelling it free is a lie about money.
        price: priceFrom(e),
        dist: venue?.distance != null ? `${Math.round(venue.distance)} mi` : null,
        category: segment,
        date: start || null,
        venue: venue?.name || null,
        // The link that actually sells the ticket. Ticketmaster's booking API
        // is invite-only, so this handoff is the only way to complete a
        // purchase — the UI says so rather than implying Reach takes payment.
        url: e.url,
      };
    });

  return NextResponse.json({
    events,
    reason: events.length ? 'ok' : 'none_nearby',
    city,
    source: 'ticketmaster',
  });
}
