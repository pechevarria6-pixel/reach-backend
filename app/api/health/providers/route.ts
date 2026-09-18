// ─── /api/health/providers — which lanes actually work right now ─────────
// Every provider degrades quietly by design: a missing key means that lane
// says nothing rather than breaking a screen. Which is right for a visitor
// and useless for whoever has to know why Discover is empty — a dormant lane
// and a broken one look identical from the outside.
//
// This asks each one the cheapest question it answers and reports what came
// back. Reads only: nothing here books, charges, writes or generates. Keys
// are never echoed, only their shape.
//
// Protected by CRON_SECRET, like the other health check and the jobs.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TIMEOUT_MS = 6000;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[health/providers] CRON_SECRET is not set — refusing to run');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

type Lane = {
  provider: string;
  /** What it feeds: discovery, booking, weather, ai, infrastructure. */
  lane: string;
  key: 'not required' | 'set' | 'MISSING';
  status: 'ok' | 'dormant' | 'refused' | 'unreachable' | 'unknown';
  ms: number | null;
  detail: string | null;
};

async function probe(
  provider: string, lane: string, keyName: string | null, url: string | null,
  init?: RequestInit,
): Promise<Lane> {
  const key = keyName ? process.env[keyName] : undefined;
  const keyState: Lane['key'] = !keyName ? 'not required' : key ? 'set' : 'MISSING';

  // No key is not a fault. It is a lane switched off, and saying so is the
  // whole point of this endpoint.
  if (keyName && !key) {
    return { provider, lane, key: keyState, status: 'dormant', ms: null, detail: `${keyName} is not set` };
  }
  if (!url) {
    return { provider, lane, key: keyState, status: 'unknown', ms: null, detail: 'key present; no free check to call' };
  }

  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - started;
    if (res.ok) return { provider, lane, key: keyState, status: 'ok', ms, detail: null };
    // The status is the useful part. A provider's body can quote the key back,
    // so it is never included. 400 counts as a rejection when a key was sent:
    // Resend answers an invalid key that way, and reading it as "bad request"
    // hid a production mailer that had stopped working.
    const rejected = keyName && [400, 401, 403].includes(res.status);
    return {
      provider, lane, key: keyState, status: 'refused', ms,
      detail: `HTTP ${res.status}${rejected ? ' — key rejected' : ''}`,
    };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider, lane, key: keyState, status: 'unreachable', ms,
      detail: /abort|timeout/i.test(msg) ? `no answer in ${TIMEOUT_MS}ms` : msg.slice(0, 120),
    };
  }
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Not authorised' }, { status: 401 });

  // ── ?sample=liteapi — what inventory does a lane actually hold? ───────
  // Whether LiteAPI carries apartments and aparthotels decides whether big
  // groups can be offered a whole place through a lane we already pay for.
  // The keys live here and nowhere else, so the question is answered here:
  // one read, no booking, nothing stored, and only for a caller holding
  // CRON_SECRET.
  if (req.nextUrl.searchParams.get('sample') === 'liteapi') {
    const key = process.env.LITEAPI_KEY;
    if (!key) return NextResponse.json({ error: 'LITEAPI_KEY is not set' }, { status: 503 });
    const city = (req.nextUrl.searchParams.get('city') || 'Raleigh').slice(0, 60);
    const base = process.env.LITEAPI_BASE || 'https://api.liteapi.travel/v3.0';
    const res = await fetch(
      `${base}/data/hotels?countryCode=US&cityName=${encodeURIComponent(city)}&limit=50`,
      { headers: { 'X-API-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(20000) },
    ).catch(() => null);
    if (!res || !res.ok) {
      return NextResponse.json({ city, error: `LiteAPI answered ${res ? res.status : 'nothing'}` }, { status: 502 });
    }
    const json = await res.json().catch(() => null);
    const rows: any[] = json?.data ?? json?.hotels ?? [];
    const types: Record<string, number> = {};
    for (const h of rows) {
      const t = String(h?.hotelType ?? h?.property_type ?? h?.type ?? 'untyped');
      types[t] = (types[t] ?? 0) + 1;
    }
    return NextResponse.json({
      city,
      returned: rows.length,
      propertyTypes: types,
      // Names only, so the shape of the inventory is readable without
      // copying a provider's catalogue into our logs.
      sampleNames: rows.slice(0, 8).map(h => h?.name ?? h?.hotelName ?? '(unnamed)'),
      fields: Object.keys(rows[0] ?? {}).slice(0, 20),
    });
  }

  const UA = { 'User-Agent': 'Reach (pechevarria6@gmail.com)' };
  // Southern Pines, the pilot area — a real point, so a provider that answers
  // only for covered regions answers honestly.
  const LAT = 35.17, LNG = -79.39;

  const lanes = await Promise.all([
    // ── Discovery ──────────────────────────────────────────────────────
    probe('weather.gov', 'weather', null, `https://api.weather.gov/points/${LAT},${LNG}`, { headers: UA }),
    probe('NOAA CO-OPS tides', 'weather', null,
      'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions'),
    probe('Open Brewery DB', 'discovery', null, 'https://api.openbrewerydb.org/v1/breweries?per_page=1'),
    // Overpass answers 406 to a request with no User-Agent, which looks like
    // a broken lane and is not one.
    probe('OpenStreetMap (Overpass)', 'discovery', null, 'https://overpass-api.de/api/status', { headers: UA }),
    probe('Ticketmaster', 'discovery', 'TICKETMASTER_API_KEY',
      `https://app.ticketmaster.com/discovery/v2/events.json?size=1&apikey=${process.env.TICKETMASTER_API_KEY ?? ''}`),
    probe('Yelp', 'discovery', 'YELP_API_KEY',
      'https://api.yelp.com/v3/businesses/search?latitude=35.17&longitude=-79.39&limit=1',
      { headers: { Authorization: `Bearer ${process.env.YELP_API_KEY ?? ''}` } }),

    // ── Booking ────────────────────────────────────────────────────────
    probe('LiteAPI (hotels)', 'booking', 'LITEAPI_KEY',
      `${process.env.LITEAPI_BASE || 'https://api.liteapi.travel/v3.0'}/data/countries`,
      { headers: { 'X-API-Key': process.env.LITEAPI_KEY ?? '', accept: 'application/json' } }),
    probe('Viator (activities)', 'booking', 'VIATOR_API_KEY', null),
    probe('Kiwi/Tequila (flights)', 'booking', 'TEQUILA_API_KEY', null),
    probe('AeroAPI (flight status)', 'booking', 'AEROAPI_KEY', null),

    // ── Everything the app cannot run without ──────────────────────────
    probe('Anthropic', 'ai', 'ANTHROPIC_API_KEY', 'https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
    }),
    probe('Supabase', 'infrastructure', 'SUPABASE_SERVICE_ROLE_KEY',
      `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/rest/v1/`, {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        },
      }),
    // Resend answers a bad key with 400 "API key is invalid" rather than 401,
    // so a rejected key has to be read from the status, not assumed from it.
    probe('Resend (email)', 'infrastructure', 'RESEND_API_KEY', 'https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ''}` },
    }),
  ]);

  // Stripe is checked by /api/health/stripe, which reads the balance. Only
  // the key's shape and mode are reported here, so this endpoint stays a
  // read of configuration rather than a second Stripe call.
  const sk = process.env.STRIPE_SECRET_KEY;
  const mode = sk ? (/^(sk|rk)_live_/.test(sk) ? 'LIVE' : /^(sk|rk)_test_/.test(sk) ? 'test' : 'not a secret key') : null;
  lanes.push({
    provider: 'Stripe', lane: 'payments', key: sk ? 'set' : 'MISSING',
    status: sk ? 'unknown' : 'dormant', ms: null,
    detail: sk ? `${mode} mode — see /api/health/stripe for a live check` : 'STRIPE_SECRET_KEY is not set',
  });

  const counts = lanes.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  // Ops-facing, so plain text is offered too: a table you can read in a
  // terminal beats JSON you have to pipe through something.
  if (req.nextUrl.searchParams.get('format') === 'text') {
    const rows = lanes.map(l =>
      `${l.provider.padEnd(26)} ${l.lane.padEnd(15)} ${l.key.padEnd(12)} ${l.status.padEnd(12)} ` +
      `${(l.ms === null ? '' : l.ms + 'ms').padEnd(8)} ${l.detail ?? ''}`.trimEnd());
    const head = `${'PROVIDER'.padEnd(26)} ${'LANE'.padEnd(15)} ${'KEY'.padEnd(12)} ${'STATUS'.padEnd(12)} ${'TIME'.padEnd(8)} DETAIL`;
    return new NextResponse([head, '-'.repeat(head.length), ...rows, '', JSON.stringify(counts)].join('\n'), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return NextResponse.json({ checkedAt: new Date().toISOString(), counts, lanes });
}
