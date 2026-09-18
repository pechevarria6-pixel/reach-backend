// ─── Finding a real activity to book ─────────────────────────────────────
// A generated itinerary says "Kayak tour of the bay". Viator sells by
// productCode, so that line cannot be booked as written — the bridge has been
// reporting it as "needs picking from the activity listings first", which was
// honest and useless.
//
// This turns the line into a real product: the city becomes a destinationId,
// the words become a search, and the best match comes back with its code and
// its price. When nothing matches well enough it says so and the line stays
// the traveller's own to arrange. Reach books what it can and is plain about
// the rest — some things are cash at the door, and no API changes that.

const BASE = process.env.VIATOR_BASE || 'https://api.sandbox.viator.com/partner';

function headers() {
  return {
    'exp-api-key': process.env.VIATOR_API_KEY ?? '',
    Accept: 'application/json;version=2.0',
    'Accept-Language': 'en-US',
    'Content-Type': 'application/json',
  };
}

export type ViatorProduct = {
  productCode: string;
  title: string;
  priceCents: number | null;
  currency: string;
  url: string | null;
  /** 0–1, how much of the itinerary line's wording this title carries. */
  score: number;
};

type Destination = { destinationId: number; name: string; type: string };

// 3,394 destinations, and they do not move. Fetched once per instance.
let destinations: Destination[] | null = null;
let destinationsAt = 0;
const DAY = 86_400_000;

async function allDestinations(): Promise<Destination[]> {
  if (destinations && Date.now() - destinationsAt < DAY) return destinations;
  try {
    const res = await fetch(`${BASE}/destinations`, { headers: headers(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.error('[viator] destinations refused', res.status);
      return destinations ?? [];
    }
    const json = await res.json();
    const list = Array.isArray(json?.destinations) ? json.destinations : [];
    if (!list.length) return destinations ?? [];
    destinations = list;
    destinationsAt = Date.now();
    return list;
  } catch (e) {
    console.error('[viator] destinations unreachable', e instanceof Error ? e.message : String(e));
    return destinations ?? [];
  }
}

/** The city's own id, preferring a city over a region of the same name. */
export async function destinationIdFor(city: string): Promise<number | null> {
  const wanted = (city || '').trim().toLowerCase();
  if (!wanted) return null;
  const list = await allDestinations();
  const exact = list.filter(d => String(d.name).toLowerCase() === wanted);
  const pick = exact.find(d => d.type === 'CITY')
    ?? exact[0]
    ?? list.find(d => d.type === 'CITY' && String(d.name).toLowerCase().includes(wanted));
  return pick ? Number(pick.destinationId) : null;
}

/** Words worth matching on: the short ones carry no meaning. */
function terms(text: string): string[] {
  const stop = new Set(['the','a','an','and','or','of','at','in','on','for','with','to','from','your','our','tour','trip','day']);
  return (text || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stop.has(w));
}

/**
 * How much of the line's wording a product title carries, 0–1.
 *
 * One word in common is not a match. "Kayak tour of the bay" against "Sunset
 * Cruise on the Bay" shares only "bay" — half the line once filler is
 * stripped, which a plain ratio would wave through and book. So a single
 * overlapping word scores nothing unless the line is a single word.
 */
export function titleScore(line: string, title: string): number {
  const wanted = terms(line);
  if (!wanted.length) return 0;
  const have = new Set(terms(title));
  const hits = wanted.filter(w => have.has(w)).length;
  if (hits === 0) return 0;
  if (hits === 1 && wanted.length > 1) return 0;
  return hits / wanted.length;
}

/**
 * The best real product for a line of an itinerary, or null.
 *
 * Null is a perfectly good answer: plenty of what a group does on a trip is
 * not a ticketed product, and a walk on the beach should not come back as a
 * sunset cruise because both mention the sea.
 */
export async function findProduct(
  city: string, line: string, startDate?: string | null, endDate?: string | null,
): Promise<ViatorProduct | null> {
  if (!process.env.VIATOR_API_KEY) return null;
  const destination = await destinationIdFor(city);
  if (!destination) return null;

  const body: Record<string, unknown> = {
    filtering: { destination: String(destination) },
    sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
    pagination: { start: 1, count: 20 },
    currency: 'USD',
  };
  if (startDate && endDate) (body.filtering as Record<string, unknown>).startDate = startDate;
  if (startDate && endDate) (body.filtering as Record<string, unknown>).endDate = endDate;

  try {
    const res = await fetch(`${BASE}/products/search`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error('[viator] product search refused', { status: res.status, destination });
      return null;
    }
    const json = await res.json();
    const products: any[] = json?.products ?? [];
    const scored = products.map(p => {
      const price = p?.pricing?.summary?.fromPrice ?? p?.pricing?.summary?.fromPriceBeforeDiscount;
      return {
        productCode: String(p?.productCode ?? ''),
        title: String(p?.title ?? ''),
        priceCents: typeof price === 'number' ? Math.round(price * 100) : null,
        currency: String(p?.pricing?.currency ?? 'USD'),
        url: p?.productUrl ?? null,
        score: titleScore(line, String(p?.title ?? '')),
      };
    }).filter(p => p.productCode);

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    // Half the line's words have to appear in the title. Below that it is a
    // different activity with a word in common, and booking it would be worse
    // than booking nothing.
    return best && best.score >= 0.5 ? best : null;
  } catch (e) {
    console.error('[viator] product search unreachable', e instanceof Error ? e.message : String(e));
    return null;
  }
}
