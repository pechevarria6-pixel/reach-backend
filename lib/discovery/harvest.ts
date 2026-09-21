// ─── Reading a venue's own page ──────────────────────────────────────────
// The map tells us Stockbridge Ceramics is a pottery on Raeburn Place with a
// website. It does not tell us there is a wheel-throwing evening on
// Wednesday at seven for forty-five pounds. Only the studio's own page says
// that, so this goes and reads it.
//
// What was measured on five real Edinburgh studio sites before any of this
// was written:
//
//   • Four served their content in the HTML and could be read straight off.
//     Three of those yielded real bookable classes with real prices.
//   • One was Wix, which ships 700KB of widget boilerplate and fetches the
//     actual words from the browser afterwards. There is nothing in that
//     page to read, with or without the scripts.
//   • Almost none published schema.org Event markup, so a structured-data
//     parser would have found nothing on any of them. Extraction has to
//     read prose.
//
// Web search was measured too, as a way round the Wix problem: sixty-eight
// seconds and eleven searches for one venue. That is not a harvester, so a
// page we cannot read is recorded as unreadable and the venue still shows
// with its link — exactly what it showed before.
import Anthropic from '@anthropic-ai/sdk';

const UA = 'ReachDiscovery/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';
// Reading one page should take seconds. A site that needs longer is one we
// come back to, not one we hold a job open for.
const FETCH_MS = 8000;
// Below this there is nothing to read. Measured: a Wix shell strips to about
// 238 characters, while the thinnest real page of the five was about 1,880.
const READABLE_MIN = 900;

export type HarvestStatus = 'ok' | 'nothing_found' | 'needs_render' | 'blocked' | 'unreachable';

export interface HarvestedEvent {
  title: string;
  when_text: string;
  starts_on: string | null;
  price_text: string;
  booking_url: string;
}

export interface Harvest {
  status: HarvestStatus;
  events: HarvestedEvent[];
  readUrl?: string;
  detail?: string;
  /** The venue's own og:image, when they publish one. Costs no extra request. */
  imageUrl?: string | null;
}

// ── Manners ─────────────────────────────────────────────────────────────
// A studio's robots.txt is them saying what they want. Honouring it costs
// one cached request per host and is the difference between a crawler and a
// nuisance.
const robotsCache = new Map<string, string[]>();

export function disallowedPaths(robotsTxt: string, agent = 'reachdiscovery'): string[] {
  const lines = robotsTxt.split('\n').map(l => l.replace(/#.*$/, '').trim());
  const rules: Record<string, string[]> = {};
  let current: string[] = [];
  for (const line of lines) {
    const ua = /^user-agent:\s*(.+)$/i.exec(line);
    if (ua) {
      const name = ua[1].trim().toLowerCase();
      rules[name] = rules[name] || [];
      current = rules[name];
      continue;
    }
    const dis = /^disallow:\s*(.*)$/i.exec(line);
    // An empty Disallow means "nothing is disallowed" and must not be read
    // as "/" — that would turn the most permissive robots.txt into a wall.
    if (dis && dis[1].trim()) current.push(dis[1].trim());
  }
  return rules[agent] ?? rules['*'] ?? [];
}

export async function robotsAllows(url: string): Promise<boolean> {
  let target: URL;
  try { target = new URL(url); } catch { return false; }
  const origin = target.origin;

  if (!robotsCache.has(origin)) {
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_MS),
      });
      // No robots.txt is permission. A 500 is not a refusal either, but it is
      // not permission we can read, so treat it as open and go gently.
      robotsCache.set(origin, res.ok ? disallowedPaths(await res.text()) : []);
    } catch {
      robotsCache.set(origin, []);
    }
  }
  const denied = robotsCache.get(origin) ?? [];
  return !denied.some(rule => rule === '/' || target.pathname.startsWith(rule));
}

// ── Finding the page that lists the classes ─────────────────────────────
const WORTH_READING = /class|course|workshop|event|whats-?on|what-?s-?on|book|timetable|schedule|session/i;

/** The link on a homepage most likely to list what is on. */
export function classesLink(html: string, base: string): string | null {
  let origin: string;
  try { origin = new URL(base).origin; } catch { return null; }
  const candidates: Array<{ href: string; score: number }> = [];
  for (const m of html.matchAll(/href="([^"#?]{2,200})"/gi)) {
    // Same site only. Following a link to a booking platform or a social page
    // is how a harvester ends up reading somebody else's login screen.
    let url: URL;
    try { url = new URL(m[1], base); } catch { continue; }
    if (url.origin !== origin) continue;
    if (/\.(png|jpe?g|gif|svg|css|js|pdf|ico|woff2?)$/i.test(url.pathname)) continue;
    if (!WORTH_READING.test(url.pathname)) continue;
    // A page about classes beats a page that merely mentions booking.
    const score = /class|course|workshop/i.test(url.pathname) ? 3
      : /event|whats-?on|timetable|schedule/i.test(url.pathname) ? 2 : 1;
    candidates.push({ href: url.toString(), score });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.href.length - b.href.length);
  return candidates[0].href;
}

/** Everything a person would read, and nothing a browser would run. */
/**
 * The picture a venue publishes about itself.
 *
 * Discover showed every card on the same orange gradient, so a jazz bar, a
 * pottery studio and a taqueria all looked like the same thing — which is
 * the opposite of what a card is for.
 *
 * `og:image` is the right source rather than a clever one: it is the image
 * the venue chose for exactly this, to be shown when somebody shares a link
 * to them. Their own photo of their own room, published for the purpose.
 * Nothing is scraped out of the page body, nothing is guessed at, and a
 * venue that publishes none simply keeps the gradient.
 *
 * Measured across six real venue sites: two had one. That is a third of
 * cards carrying a real picture where none did before, and no card carrying
 * a wrong one.
 */
export function ogImage(html: string, base: string): string | null {
  const text = String(html || '').slice(0, 300000);
  const m = text.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
    || text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)
    || text.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) return null;

  try {
    const url = new URL(m[1].trim(), base);
    // Only a real image over a real protocol. A data: URI is somebody's
    // tracking pixel or a placeholder, and either would put a grey square
    // where a photograph belongs.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (/\.svg(\?|$)/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&pound;/g, '£').replace(/&euro;/g, '€')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keeps the page's own phrasing and drops the part that will not fit. One
 * real studio lists a single taster session under twenty-four sittings; the
 * page's words are still the right words, just not all of them on a card.
 */
export function shorten(when: string, max = 90): string {
  if (when.length <= max) return when;
  const parts = when.split(/\s*,\s*/);
  if (parts.length > 2) {
    let kept = parts[0];
    let n = 1;
    while (n < parts.length && `${kept}, ${parts[n]}`.length <= max - 12) {
      kept += `, ${parts[n]}`;
      n++;
    }
    const rest = parts.length - n;
    return rest > 0 ? `${kept} +${rest} more` : kept;
  }
  return `${when.slice(0, max - 1).trimEnd()}…`;
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_MS), redirect: 'follow',
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── Turning a page into classes ─────────────────────────────────────────
const EVENTS_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          when_text: { type: 'string' },
          starts_on: { type: 'string' },
          price_text: { type: 'string' },
        },
        required: ['title', 'when_text', 'starts_on', 'price_text'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
} as const;

/**
 * Only what the page states. A model asked to describe a pottery studio will
 * happily produce a plausible Wednesday evening at forty-five pounds, and a
 * plausible class sends somebody to a locked door — which is the one failure
 * this whole engine exists to avoid.
 */
function extractionPrompt(venue: string, url: string, text: string): string {
  return `This is the text of ${url}, the website of ${venue}.

List every class, course, workshop or event it says people can book.

Rules, in order of importance:
- Only what this page actually states. Never infer, complete or tidy up.
- If the page states no bookable classes, return an empty list. An empty
  list is the right answer far more often than a plausible one.
- "starts_on" is an ISO date (YYYY-MM-DD) only when the page gives a
  specific date. For "Wednesdays, 7pm" there is no date: return "".
- "when_text" is the page's own words about when it runs.
- "price_text" is the page's own words about cost. If it gives none, return
  "" rather than guessing. Never write "Free" unless it says free.

Page text:

${text}`;
}

export async function harvestVenue(venue: { name: string; website: string }): Promise<Harvest> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { status: 'unreachable', events: [], detail: 'no ANTHROPIC_API_KEY' };

  if (!(await robotsAllows(venue.website))) {
    return { status: 'blocked', events: [], detail: 'robots.txt' };
  }

  const homeHtml = await getText(venue.website);
  if (!homeHtml) return { status: 'unreachable', events: [] };

  // Prefer the page that lists classes; fall back to the homepage, which on a
  // small studio's site is often the same thing.
  const deeper = classesLink(homeHtml, venue.website);
  let readUrl = venue.website;
  const image = ogImage(homeHtml, venue.website);
  let text = readableText(homeHtml);

  if (deeper && deeper !== venue.website && (await robotsAllows(deeper))) {
    const deeperHtml = await getText(deeper);
    if (deeperHtml) {
      const deeperText = readableText(deeperHtml);
      if (deeperText.length > text.length) {
        text = deeperText;
        readUrl = deeper;
      }
    }
  }

  if (text.length < READABLE_MIN) {
    // Wix and friends. The venue still shows with its link, exactly as it did
    // before — it simply has no dates against it.
    return { status: 'needs_render', events: [], readUrl, detail: `${text.length} chars`, imageUrl: image };
  }

  try {
    const res = await new Anthropic({ apiKey: key }).messages.create({
      // Reading one page is not hard work, and there are a great many pages.
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      output_config: { format: { type: 'json_schema', schema: EVENTS_SCHEMA } },
      messages: [{ role: 'user', content: extractionPrompt(venue.name, readUrl, text.slice(0, 14000)) }],
    });
    const raw = res.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('');

    let parsed: { events?: Array<Record<string, string>> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[harvest] could not parse', venue.name, 'len', raw.length, 'tail:', raw.slice(-200));
      return { status: 'nothing_found', events: [], readUrl, detail: 'unparseable' , imageUrl: image };
    }

    const events: HarvestedEvent[] = (parsed.events ?? [])
      .filter(e => e?.title && e.title.trim().length > 3)
      .map(e => ({
        title: e.title.trim(),
        when_text: shorten((e.when_text ?? '').trim()),
        // An empty string is not a date, and neither is anything that is not
        // shaped like one.
        starts_on: /^\d{4}-\d{2}-\d{2}$/.test(e.starts_on ?? '') ? e.starts_on : null,
        price_text: (e.price_text ?? '').trim(),
        booking_url: readUrl,
      }))
      .slice(0, 12);

    return { status: events.length ? 'ok' : 'nothing_found', events, readUrl };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'extraction failed';
    console.error('[harvest] extraction failed for', venue.name, detail);
    return { status: 'unreachable', events: [], readUrl, detail };
  }
}
