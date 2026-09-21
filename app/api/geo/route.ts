// ─── Asking the map from the server, because the browser cannot ─────────
// Four places in the app called nominatim.openstreetmap.org straight from
// the browser: the "where are you going" search, the same search on a second
// screen, the reverse lookup that turns a device's coordinates into a city,
// and the fallback that turns somebody's home city into a point.
//
// All four fail in production. The e2e suite caught it as console noise —
//
//   Access to fetch at 'https://nominatim.openstreetmap.org/reverse?...'
//   from origin 'https://www.alcanzar.io' has been blocked by CORS policy
//
// — and the consequences are not noise at all. The reverse lookup failing
// means somebody's city renders as "Your location". The home-city fallback
// failing means the fallback silently does nothing, so a person who denied
// location and told us where they live gets neither. That is the exact
// failure the code beside it warns about: a trip planned from Aberdeen
// coming back with things to do in San Francisco.
//
// It also should never have been a browser call. Nominatim's usage policy
// requires a User-Agent identifying the application, which a browser will
// not let a page set, so every one of these was anonymous traffic against a
// volunteer-run service. From here it is identified, cached, and bounded.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';

const API = 'https://nominatim.openstreetmap.org';
const AGENT = 'Reach/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

export interface GeoHit {
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
}

/** The parts of an address that answer "what city is this". */
function cityOf(address: Record<string, string> | undefined): string | null {
  if (!address) return null;
  return address.city || address.town || address.village
    || address.municipality || address.county || null;
}

export async function GET(req: NextRequest) {
  // Signed in only. This is a proxy to somebody else's donated service, and
  // an open one is an invitation to make Reach the reason they rate-limit us.
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;

  const params = req.nextUrl.searchParams;
  const q = (params.get('q') || '').trim();
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));

  const reverse = Number.isFinite(lat) && Number.isFinite(lng);
  if (!reverse && q.length < 3) {
    return NextResponse.json({ error: 'Give a place to look for, or a point to look up' }, { status: 400 });
  }

  const limit = Math.min(Math.max(Number(params.get('limit')) || 6, 1), 10);
  const url = reverse
    ? `${API}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    : `${API}/search?format=json&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(8000),
      // A town does not move, and everybody on the same trip asks about the
      // same one.
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      console.error('[geo] the map returned', { status: res.status, reverse });
      return NextResponse.json({ error: 'The map is not answering just now' }, { status: 502 });
    }

    const body = await res.json();
    const rows = Array.isArray(body) ? body : [body];
    const hits: GeoHit[] = rows
      .map((h: Record<string, unknown>) => ({
        label: String(h.display_name ?? ''),
        lat: Number(h.lat),
        lng: Number(h.lon),
        city: cityOf(h.address as Record<string, string> | undefined),
        state: (h.address as Record<string, string> | undefined)?.state ?? null,
      }))
      .filter(h => h.label && Number.isFinite(h.lat) && Number.isFinite(h.lng));

    return NextResponse.json({ hits });
  } catch (err) {
    // Unreachable is not "there is no such place". The caller keeps whatever
    // it had and may ask again; what it must never do is invent a location.
    console.error('[geo] could not ask the map', err instanceof Error ? err.message : 'failed');
    return NextResponse.json({ error: 'The map is not answering just now' }, { status: 502 });
  }
}
