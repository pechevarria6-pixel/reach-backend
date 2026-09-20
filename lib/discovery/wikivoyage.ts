// ─── Somebody who has actually been there ───────────────────────────────
// Everything else this app knows about a place is machine-shaped. A map
// knows Pasta Jay's is a restaurant at 4 South Main St. It does not know to
// order the Tortellone Alfredo, and that is the part a person wanted.
//
// Wikivoyage is written by travellers and licensed CC BY-SA, so it can be
// used rather than merely linked, and its listings are structured:
//
//   {{eat | name=Pasta Jay's | phone=+1 435-259-2900 | address=4 South Main St
//     | content=Order the Tortellone Alfredo or the Chicken Pesto Tortellone. }}
//
// A name, a number somebody can ring, and an opinion held by a human being.
// Moab has twenty-six of them.
//
// The commercial travel writers — Nomadic Matt, The Points Guy, Adventurous
// Kate — are deliberately not read here. Their writing is their livelihood,
// not an open data set, and lifting it into Reach would be taking the
// product. Nor are they linked: a trip is not a place to send somebody
// somewhere else. What Reach shows, Reach is allowed to show.
//
// Wikivoyage is credited because its licence asks to be, which is the price
// of using the words at all, and because a reader is owed the difference
// between a stranger's opinion and a fact.
//
// What matters for accuracy: an opinion is attributed, never stated in
// Reach's own voice, and never allowed to become an operational absolute.
// "A traveller on Wikivoyage says order the Tortellone" is true whether or
// not the dish is still on the menu. "Cash only" said flatly is not that
// kind of sentence, which is why nothing here produces one — see
// paymentLine() in ./verify.ts for where that line is drawn.

const API = 'https://en.wikivoyage.org/w/api.php';
const AGENT = 'Reach/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

/** The listing kinds worth reading, mapped to what this app calls them. */
const KINDS: Record<string, string> = {
  eat: 'restaurant',
  drink: 'bar',
  see: 'attraction',
  do: 'activity',
  sleep: 'hotel',
  buy: 'shop',
};

export interface Advice {
  name: string;
  kind: string;
  address: string | null;
  phone: string | null;
  url: string | null;
  hours: string | null;
  /** As the page states it. Never converted, never turned into a number. */
  price: string | null;
  lat: number | null;
  lng: number | null;
  /** What the traveller actually said. Shown as theirs, not as ours. */
  note: string | null;
  /** CC BY-SA asks for credit, and a reader deserves to know whose view it is. */
  credit: { source: 'wikivoyage'; page: string; url: string };
}

/** Wiki markup, reduced to the sentence underneath it. */
export function plain(text: string): string {
  return String(text || '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')   // [[Arches|the park]] → the park
    .replace(/\[\[([^\]]*)\]\]/g, '$1')            // [[Arches]]          → Arches
    .replace(/\[(?:https?:)\S+\s+([^\]]*)\]/g, '$1')
    .replace(/'''?/g, '')                          // bold and italics
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a template body on pipes that belong to it.
 *
 * A listing can hold a link with its own pipe — [[Arches National Park|the
 * park]] — and splitting naively cuts the sentence in half mid-word. So
 * brackets and nested braces are counted, and only a pipe at depth zero
 * separates two fields.
 */
export function fields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let part = '';
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; part += two; i++; continue; }
    if (two === ']]' || two === '}}') { depth--; part += two; i++; continue; }
    const c = body[i];
    if (c === '|' && depth <= 0) { parts.push(part); part = ''; continue; }
    part += c;
  }
  parts.push(part);

  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 1) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    const value = plain(p.slice(eq + 1));
    if (key && value) out[key] = value;
  }
  return out;
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Pull every listing out of a page's wikitext. */
export function listingsFrom(wikitext: string, page: string): Advice[] {
  const pageUrl = `https://en.wikivoyage.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`;
  const out: Advice[] = [];
  const text = String(wikitext || '');

  // Walk the braces rather than matching them: a listing whose content holds
  // its own {{...}} ends early under a lazy regex, and the note gets cut.
  const open = /\{\{\s*(eat|drink|see|do|sleep|buy|listing)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    let depth = 0;
    let end = -1;
    for (let i = m.index; i < text.length; i++) {
      if (text.startsWith('{{', i)) { depth++; i++; continue; }
      if (text.startsWith('}}', i)) { depth--; i++; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) continue;

    const raw = text.slice(m.index, end);
    const body = raw.slice(2, -2);
    const f = fields(body.slice(body.indexOf('|') + 1));

    const name = f.name || f.alt;
    if (!name) continue;

    const declared = m[1].toLowerCase();
    const kind = KINDS[declared] ?? KINDS[(f.type || '').toLowerCase()] ?? 'attraction';

    out.push({
      name,
      kind,
      address: f.address || null,
      phone: f.phone || f.tollfree || null,
      url: f.url || null,
      hours: f.hours || null,
      price: f.price || null,
      lat: num(f.lat),
      lng: num(f.long ?? f.lon),
      note: f.content || null,
      credit: { source: 'wikivoyage', page, url: pageUrl },
    });
  }
  return out;
}

/**
 * What travellers say about a town.
 *
 * Returns an empty list when the page does not exist, which is the common
 * case for a small town and is not an error — it means we have nothing to
 * add, and adding nothing is the correct behaviour.
 */
export async function adviceFor(
  place: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ advice: Advice[]; page: string | null }> {
  const page = String(place || '').split(',')[0].trim();
  if (!page) return { advice: [], page: null };

  const url = `${API}?action=parse&page=${encodeURIComponent(page)}`
    + '&prop=wikitext&format=json&formatversion=2&redirects=1';

  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { advice: [], page: null };
    const json = await res.json() as {
      parse?: { title?: string; wikitext?: string };
      error?: { code?: string };
    };
    // "missingtitle" is a town nobody has written up. Nothing to say.
    if (json.error || !json.parse?.wikitext) return { advice: [], page: null };

    const title = json.parse.title ?? page;
    return { advice: listingsFrom(json.parse.wikitext, title), page: title };
  } catch {
    // Unreachable is not absent. The caller shows what it already has.
    return { advice: [], page: null };
  }
}

/**
 * The line shown under a place, in the traveller's voice and not ours.
 *
 * Kept short and always credited. The full note lives behind the link, on
 * the page whose licence lets us quote it at all.
 */
export function attributedNote(a: Advice, limit = 140): string | null {
  if (!a.note) return null;
  const note = a.note.length > limit ? `${a.note.slice(0, limit - 1).trimEnd()}…` : a.note;
  // Named, because an itinerary line names more than one place and the note
  // is only ever about one of them. "Dinner at the raw bar of La Leche, then
  // live music on the Malecón at La Santa" carried "popular dance club where
  // the beats keep pulsing into the wee hours" with nothing to say which of
  // the three it meant, and read as a description of the restaurant.
  return `${a.name}: ${note} — a traveller on Wikivoyage`;
}
