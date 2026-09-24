// ─── A photograph OF the thing on the card ──────────────────────────────
// People want to see what they are being sent to: the band, the room, the
// ballpark. The rule that governs every picture here is the same one that
// governs every sentence (CLAUDE.md): Reach may only show what it can point
// at. A photograph sits on a card only when something about THAT row says it
// is a photograph of that place or that act:
//
//   a venue   its own OpenStreetMap entry names the picture — a `wikidata`
//             item (whose P18 is the item's image), a `wikimedia_commons`
//             file, or an `image` tag pointing at a Commons file — or its own
//             website publishes one as og:image (the harvest reads that);
//   an event  Ticketmaster's own listing carries the act's or the event's
//             image, and failing that the listing's venue image;
//   a place   Wikipedia's page image for the destination (destination-photo).
//
// Never a search. A search for "Red Hat Amphitheater" returns a picture of
// something called that, which is a guess dressed as a fact. Never Google,
// Yelp or Tripadvisor (the owner's decision). No picture is always better
// than the wrong one: the card keeps its gradient.
//
// Commons only, for anything from Wikimedia. Commons hosts only freely
// licensed media, and every file carries its author and licence, which are
// taken with it and shown with it. A file without a credit we can print is
// not shown.
//
// Nothing here runs when somebody opens a screen. The venue job
// (lib/discovery/photo-job.ts) resolves photos in the background and keeps
// them on the row; Ticketmaster's image arrives in the response Discover was
// already reading. A page view costs Wikimedia nothing.

import { WORLD_DESTINATIONS } from './world-destinations.ts';

export const AGENT = 'Reach/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

/** A picture ready for a card: where it is, whose it is, where to check. */
export interface PlacePhoto {
  url: string;
  /** The line printed with it, e.g. "Jane Doe / Wikimedia Commons, CC BY-SA 4.0". */
  credit: string;
  /** Where the credit can be followed: the file's Commons page. */
  link: string | null;
  source: 'wikimedia' | 'og' | 'ticketmaster';
  /** What the picture shows, for its alt text, when that is not the card's own title. */
  of?: string | null;
}

// ─── What the map row says ───────────────────────────────────────────────

/**
 * The tags on a mapped place that point at a photograph of it, and nothing
 * else. Kept on discovery_venues.osm_tags beside the visit tags so the photo
 * job can read them without asking the map again.
 *
 * `wikidata` is dropped when it is the same item as `brand:wikidata` or
 * `operator:wikidata`: that is the chain, not this branch, and the chain's
 * image is a logo or another branch's front door.
 */
export function photoTagsOf(tags: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const qid = String(tags.wikidata ?? '').trim();
  const chain = [tags['brand:wikidata'], tags['operator:wikidata']].map(v => String(v ?? '').trim());
  if (/^Q[1-9]\d*$/.test(qid) && !chain.includes(qid)) out.wikidata = qid;
  const commons = String(tags.wikimedia_commons ?? '').trim();
  if (commons) out.wikimedia_commons = commons.slice(0, 300);
  const image = String(tags.image ?? '').trim();
  if (image) out.image = image.slice(0, 500);
  return out;
}

/** A Commons file name out of whatever form a mapper wrote it in, or null. */
export function commonsFile(value: unknown): string | null {
  let v = String(value ?? '').trim();
  if (!v) return null;
  // https://commons.wikimedia.org/wiki/File:Front_door.jpg
  // (or a Wikipedia file page, which shows the same Commons file — and when
  // the file is local to Wikipedia instead, Commons has no such page and the
  // lookup finds nothing, which is the right answer for a fair-use file).
  let m = /^https?:\/\/(?:commons\.(?:m\.)?wikimedia|[a-z-]+\.(?:m\.)?wikipedia)\.org\/wiki\/((?:File|Image):[^?#]+)/i.exec(v);
  if (m) v = safeDecode(m[1]);
  // https://upload.wikimedia.org/wikipedia/commons/a/ab/Front_door.jpg (and thumbs of it)
  m = /^https?:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(v);
  if (m) v = `File:${safeDecode(m[1])}`;
  // Anything else with a scheme is a picture somewhere else, under terms
  // nobody has read. Not ours to show.
  if (/^[a-z]+:\/\//i.test(v)) return null;
  // A Category is a folder of pictures, not a picture of this place.
  const file = /^(?:File|Image):(.+)$/i.exec(v);
  if (!file) return null;
  const name = file[1].replace(/_/g, ' ').trim();
  return usableFile(name) ? name : null;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Whether a file is plausibly a photograph rather than a logo, a map or a
 * diagram. Vector files are almost never photographs of a room; a file
 * named "logo" or "locator map" is not what the place looks like.
 */
export function usableFile(name: string): boolean {
  if (!/\.(jpe?g|png|webp|tiff?)$/i.test(name)) return false;
  return !/\b(logo|logotype|locator|location map|map|flag|coat of arms|seal|icon|diagram|floor ?plan|plan)\b/i.test(name.replace(/[_-]/g, ' '));
}

/** What a venue row points at, in the order the owner asked for. */
export function photoRefsOf(tags: Record<string, string> | null | undefined): { wikidata: string | null; file: string | null } {
  const t = photoTagsOf(tags ?? {});
  return {
    wikidata: t.wikidata ?? null,
    file: commonsFile(t.wikimedia_commons) ?? commonsFile(t.image),
  };
}

// ─── Wikidata and Commons, batched ───────────────────────────────────────

type Fetch = typeof fetch;
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
/** Both APIs take fifty ids or titles a request. */
const BATCH = 50;

/**
 * Counts requests that did not answer, so a caller can tell "no picture"
 * from "could not ask". Only the first may be written down as a fact.
 */
export interface Asked { failed: number }

async function getJson(fetchImpl: Fetch, url: string, asked?: Asked, wait = (ms: number) => new Promise(r => setTimeout(r, ms))): Promise<any | null> {
  const fail = () => { if (asked) asked.failed += 1; return null; };
  // maxlag=5 asks the servers to refuse us while their replicas are behind,
  // which is the etiquette for a background job. A refusal says how long to
  // wait; three polite tries, then this batch waits for tomorrow's run.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT }, signal: AbortSignal.timeout(15000) });
      const json = res.ok ? await res.json().catch(() => null) : null;
      const lagged = json?.error?.code === 'maxlag' || res.status === 503 || res.status === 429;
      if (lagged && attempt < 2) {
        const after = Number(res.headers?.get?.('retry-after')) || 5;
        await wait(Math.min(30, Math.max(1, after)) * 1000);
        continue;
      }
      if (!res.ok) { console.error('[place-photo] wikimedia answered', res.status); return fail(); }
      if (!json || json.error) { console.error('[place-photo] wikimedia refused', json?.error?.code ?? 'unreadable'); return fail(); }
      return json;
    } catch (e) {
      console.error('[place-photo] wikimedia unreachable', e instanceof Error ? e.message : e);
      return fail();
    }
  }
  return fail();
}

/** What a Wikidata item says about itself that lets us check it is this place. */
export interface WikidataItem {
  /** Its image (P18), as a Commons file name, when it has a usable one. */
  file: string | null;
  /** Every label and alias, in every language. */
  names: string[];
  /** Its coordinate (P625), when it has one. */
  at: { lat: number; lng: number } | null;
  /** Instance of human (P31 = Q5): a person, never a venue. */
  person: boolean;
}

/**
 * What each Wikidata item says: its image, its names, where it is. Items
 * that do not exist are simply absent.
 */
export async function wikidataItems(qids: string[], fetchImpl: Fetch = fetch, asked?: Asked): Promise<Map<string, WikidataItem>> {
  const out = new Map<string, WikidataItem>();
  const ids = [...new Set(qids.filter(q => /^Q[1-9]\d*$/.test(q)))];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    // No maxlag here, deliberately. Wikidata's lag figure is dominated by its
    // query service, which trails by minutes most of the day and has nothing
    // to do with reading an entity — with maxlag=5 every request on
    // 2026-09-24 was refused for "wdqs: 485 seconds lagged". maxlag is the
    // etiquette for edits; this reads, fifty items a request, named agent.
    const json = await getJson(fetchImpl, `${WIKIDATA}?action=wbgetentities&props=claims|labels|aliases&format=json`
      + `&ids=${chunk.map(encodeURIComponent).join('|')}`, asked);
    for (const [id, entity] of Object.entries<any>(json?.entities ?? {})) {
      if (!entity || entity.missing !== undefined) continue;
      const live = (p: string): any[] => (entity.claims?.[p] ?? []).filter((c: any) => c?.rank !== 'deprecated');
      const pick = (p: string) => { const c = live(p); return (c.find(x => x.rank === 'preferred') ?? c[0])?.mainsnak?.datavalue?.value; };
      const file = pick('P18');
      const coord = pick('P625');
      const names = [
        ...Object.values<any>(entity.labels ?? {}).map(l => l?.value),
        ...Object.values<any>(entity.aliases ?? {}).flat().map((a: any) => a?.value),
      ].filter((n): n is string => typeof n === 'string' && !!n.trim());
      out.set(id, {
        file: typeof file === 'string' && usableFile(file) ? file.replace(/_/g, ' ') : null,
        names: [...new Set(names)],
        at: coord && Number.isFinite(coord.latitude) && Number.isFinite(coord.longitude) ? { lat: coord.latitude, lng: coord.longitude } : null,
        person: live('P31').some(c => c?.mainsnak?.datavalue?.value?.id === 'Q5'),
      });
    }
  }
  return out;
}

/** The images alone, for a caller that has no venue to check them against. */
export async function wikidataImages(qids: string[], fetchImpl: Fetch = fetch, asked?: Asked): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [id, item] of await wikidataItems(qids, fetchImpl, asked)) if (item.file) out.set(id, item.file);
  return out;
}

// ─── Is the item this place? ─────────────────────────────────────────────
// A map entry's wikidata tag is a mapper's claim, and measured across the
// 164 held venues that carry one it is wrong often enough to matter: the
// Silvia Monfort theatre points at the actress, the Laogai Museum at its
// foundation (whose image is the Dalai Lama), a Leif Erikson statue at the
// marina it stands in, a Marriott at the beach in front of it, AMC
// Southpoint at the shopping mall. Each of those would have put a picture of
// something else on the card, which is the one thing this must not do.
//
// So the item has to show it is the same thing: not a person, called what
// the venue is called, and — where it says where it is — there. A name that
// matches exactly may be some way off (a state park's point and its item's
// can be miles apart); a looser match has to be within a kilometre.

const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'el', 'los', 'las', 'del', 'y', 'et', 'der', 'die', 'das']);

/** A name as comparable words: lower case, no accents, no punctuation, no filler. */
export function nameWords(name: string): string[] {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(w => w && !FILLER.has(w));
}

/**
 * 'exact', 'close' or null: how well the venue's name `a` agrees with an
 * item's name `b`. Not symmetric, on purpose — see the one-word rule below.
 */
export function nameAgreement(a: string, b: string): 'exact' | 'close' | null {
  const x = nameWords(a), y = nameWords(b);
  if (!x.length || !y.length) return null;
  if (x.join(' ') === y.join(' ')) return 'exact';
  const X = new Set(x), Y = new Set(y);
  const shared = [...X].filter(w => Y.has(w)).length;
  const within = shared === X.size || shared === Y.size;
  const jaccard = shared / new Set([...x, ...y]).size;
  // Every word of the shorter name, or most of both — and never on the
  // strength of one shared word alone ("Showbox" is two venues).
  //
  // The one exception is a venue whose own name IS one word: "Showbox" is
  // all of "The Showbox at the Market", and the kilometre check does the rest.
  // The other way round is not the same place: an item called "Southpoint"
  // is the mall the AMC Southpoint 17 stands in, and an item called
  // "Carolina" is not the Carolina Theatre. Something whose whole name is
  // one word of the venue's is what contains it, or what it is named after
  // — and it is always within a kilometre, so distance cannot catch it.
  return shared >= 1 && (within || jaccard >= 0.5) && (shared >= 2 || X.size === 1) ? 'close' : null;
}

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 111.2;
  const dLng = (b.lng - a.lng) * 111.2 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** How far an item may sit from the venue, by how well the names agree. */
const EXACT_KM = 25;
const CLOSE_KM = 1;

/**
 * Words that say what kind of place something is, or where, and so cannot
 * say WHICH place a picture is of: every file in Paris says Paris, and a
 * fountain at a mall and the theatre across from it both say "theatre".
 */
const TELLS_NOTHING = new Set([
  'museum', 'musee', 'museo', 'theatre', 'theater', 'teatro', 'park', 'parc', 'parque', 'center', 'centre', 'centro',
  'hall', 'art', 'arts', 'gallery', 'galerie', 'house', 'maison', 'casa', 'building', 'church', 'eglise', 'garden',
  'gardens', 'jardin', 'club', 'bar', 'cafe', 'restaurant', 'hotel', 'beach', 'square', 'street', 'rue', 'road',
  'north', 'south', 'east', 'west', 'downtown', 'city', 'national', 'state', 'international', 'historic', 'old', 'new',
  'saint', 'san', 'santa', 'sainte', 'from', 'view', 'with', 'for', 'exterior', 'interior', 'entrance',
]);

/** The towns people travel to, whose names are in every file taken there. */
const TOWN_WORDS = new Set(WORLD_DESTINATIONS.flatMap(d => nameWords(d.name)));

/**
 * Whether a file's own name says it is of this place.
 *
 * Even the right item's image is not always a picture of the place: the
 * Laogai Museum's is "DalaiLama_LRF2009.jpg", the Duke Lemur Center's a
 * slow loris, Cape Fear Botanical Garden's one flower, the San Juan
 * Marriott's the beach in front of it. Nobody here can look at the picture,
 * but the file's name is somebody saying what it shows — so it has to share
 * a word with the place's own name that is not its kind or its town. That
 * turns away some good photographs with cryptic names; no picture is better
 * than the wrong one.
 */
export function fileNamesThing(file: string, names: string[], town?: string | null): boolean {
  const skip = new Set([...TELLS_NOTHING, ...TOWN_WORDS, ...nameWords(String(town ?? ''))]);
  const telling = (w: string) => w.length >= 3 && !skip.has(w);
  const said = new Set(nameWords(file.replace(/\.[a-z]+$/i, '')).filter(telling));
  return names.some(n => nameWords(n).some(w => telling(w) && said.has(w)));
}

/** Whether a Wikidata item is plausibly the venue itself, and its image of it — and if not, why. */
export function sameThing(
  venue: { name?: string | null; lat?: number | null; lng?: number | null; city?: string | null },
  item: WikidataItem,
): { ok: true } | { ok: false; why: 'person' | 'name' | 'far' | 'no_name' | 'not_of_it' } {
  if (item.person) return { ok: false, why: 'person' };
  if (!venue.name) return { ok: false, why: 'no_name' };
  const agree = item.names.map(n => nameAgreement(String(venue.name), n));
  const best = agree.includes('exact') ? 'exact' : agree.includes('close') ? 'close' : null;
  if (!best) return { ok: false, why: 'name' };
  const here = Number.isFinite(venue.lat) && Number.isFinite(venue.lng) ? { lat: Number(venue.lat), lng: Number(venue.lng) } : null;
  if (item.at && here && kmBetween(here, item.at) > (best === 'exact' ? EXACT_KM : CLOSE_KM)) return { ok: false, why: 'far' };
  // A looser name with nowhere to check it against is not enough.
  if (best === 'close' && !(item.at && here)) return { ok: false, why: 'far' };
  // The venue's own name, not the item's aliases: an alias in some language
  // ("… de Paris", a hotel's former name "Puerto Rico Sheraton") matched a
  // file of the town or the beach, which is the picture this is here to stop.
  if (item.file && !fileNamesThing(item.file, [String(venue.name)], venue.city)) return { ok: false, why: 'not_of_it' };
  return { ok: true };
}

/** Markup out of Commons' attribution fields, which arrive as HTML. */
export function plainText(html: unknown): string | null {
  if (!html) return null;
  const text = String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 100) : null;
}

/** Where Commons serves its files and their thumbnails. */
export const COMMONS_MEDIA = /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//;

const NO_AUTHOR_NEEDED = /^(public domain|pd|cc0)/i;

/**
 * The credit line a Commons file needs, or null when we cannot print one.
 * A licence is always required. An author is required unless the file is
 * public domain or CC0, which ask for none.
 */
export function commonsCredit(artist: string | null, licence: string | null): string | null {
  if (!licence) return null;
  if (!artist && !NO_AUTHOR_NEEDED.test(licence)) return null;
  return artist ? `${artist} / Wikimedia Commons, ${licence}` : `Wikimedia Commons, ${licence}`;
}

/**
 * A card-sized thumbnail, its credit and its page, per Commons file name.
 * A file whose credit cannot be printed is left out, not shown bare.
 */
export async function commonsPhotos(files: string[], fetchImpl: Fetch = fetch, width = 800, asked?: Asked): Promise<Map<string, PlacePhoto>> {
  const out = new Map<string, PlacePhoto>();
  const names = [...new Set(files.map(f => f.replace(/_/g, ' ').trim()).filter(Boolean))];
  for (let i = 0; i < names.length; i += BATCH) {
    const chunk = names.slice(i, i + BATCH);
    const json = await getJson(fetchImpl, `${COMMONS}?action=query&prop=imageinfo&iiprop=url|extmetadata`
      + `&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=${width}&format=json&formatversion=2&maxlag=5`
      + `&titles=${chunk.map(n => encodeURIComponent(`File:${n}`)).join('|')}`, asked);
    if (!json) continue;
    // Commons normalises titles ("File:a b.jpg" → "File:A b.jpg"), so what
    // comes back is mapped to what was asked.
    const titled = new Map<string, string>();
    for (const n of chunk) titled.set(`File:${n}`, n);
    for (const nrm of json.query?.normalized ?? []) {
      const was = titled.get(nrm.from);
      if (was) titled.set(nrm.to, was);
    }
    for (const page of json.query?.pages ?? []) {
      const name = titled.get(page?.title);
      const info = page?.imageinfo?.[0];
      if (!name || !info) continue;
      const url = String(info.thumburl || info.url || '');
      // Commons' own servers only — thumbnails now come from thumb., the
      // originals from upload. Anything else is not the file we credited.
      if (!COMMONS_MEDIA.test(url)) continue;
      const credit = commonsCredit(plainText(info.extmetadata?.Artist?.value), plainText(info.extmetadata?.LicenseShortName?.value));
      if (!credit) continue;
      out.set(name, { url, credit, link: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name.replace(/ /g, '_'))}`, source: 'wikimedia' });
    }
  }
  return out;
}

/**
 * Photos for a batch of venues, keyed by whatever the caller keys them by,
 * from each one's own tags and nothing else. One request per fifty venues to
 * Wikidata and one per fifty files to Commons.
 *
 * A file the entry names directly (wikimedia_commons, or an image tag at
 * Commons) is the mapper's photograph of this place and is taken as it is.
 * A wikidata item's image is taken only when the item is shown to be the
 * same place (sameThing); `rejected` counts the ones that were not.
 */
export async function venuePhotos<K>(
  venues: { key: K; tags: Record<string, string> | null | undefined; name?: string | null; lat?: number | null; lng?: number | null; city?: string | null }[],
  fetchImpl: Fetch = fetch,
  asked?: Asked,
  rejected?: Map<K, string>,
): Promise<Map<K, PlacePhoto>> {
  const refs = venues.map(v => ({ v, ...photoRefsOf(v.tags) }));
  const items = await wikidataItems(refs.map(r => r.wikidata).filter((q): q is string => !!q), fetchImpl, asked);
  const fileFor = new Map<K, string>();
  for (const r of refs) {
    let fromItem: string | null = null;
    const item = r.wikidata ? items.get(r.wikidata) : undefined;
    if (item?.file) {
      const same = sameThing(r.v, item);
      if ('why' in same) rejected?.set(r.v.key, `${r.wikidata}: ${same.why}`);
      else fromItem = item.file;
    }
    const file = fromItem ?? r.file;
    if (file) fileFor.set(r.v.key, file);
  }
  const photos = await commonsPhotos([...fileFor.values()], fetchImpl, 800, asked);
  const out = new Map<K, PlacePhoto>();
  for (const [key, file] of fileFor) {
    const p = photos.get(file.replace(/_/g, ' ').trim());
    if (p) out.set(key, p);
  }
  return out;
}

// ─── The venue's own website ─────────────────────────────────────────────

/** The credit for an og:image: whose site it came from, by name. */
export function siteCredit(website: string | null | undefined): string {
  try {
    const host = new URL(String(website)).hostname.replace(/^www\./, '');
    return `the venue's website (${host})`;
  } catch {
    return "the venue's website";
  }
}

/**
 * A venue row's photo, as a card shows it, or null.
 *
 * Wikimedia only with its stored credit. The venue's og:image is credited to
 * its own site. Anything else — an image_source this code has never heard of
 * — is not shown, because nobody can say where it came from.
 */
export function rowPhoto(row: {
  image_url?: string | null; image_source?: string | null; image_credit?: string | null;
  image_link?: string | null; website?: string | null;
}): PlacePhoto | null {
  const url = String(row.image_url ?? '');
  if (!/^https:\/\//.test(url)) return null;
  if (row.image_source === 'wikimedia') {
    return row.image_credit ? { url, credit: row.image_credit, link: row.image_link ?? null, source: 'wikimedia' } : null;
  }
  if (row.image_source === 'og') return { url, credit: siteCredit(row.website), link: row.website ?? null, source: 'og' };
  return null;
}

// ─── Ticketmaster ────────────────────────────────────────────────────────

type TmImage = { url?: string; ratio?: string; width?: number; height?: number; fallback?: boolean };

/**
 * The best card image from a Ticketmaster image list, or null.
 *
 * `fallback: true` is Ticketmaster's generic category art — a stock concert
 * crowd for every gig it has no picture of. That is exactly the picture of
 * somewhere else this code exists to keep off a card, so it never counts.
 * Wide first (16:9 at about a card's width), then 3:2, then anything real.
 */
export function ticketmasterImage(images: unknown): string | null {
  const real = (Array.isArray(images) ? images as TmImage[] : [])
    .filter(i => i && i.fallback !== true && typeof i.url === 'string' && /^https:\/\//.test(i.url) && Number(i.width) >= 300);
  if (!real.length) return null;
  const near = (list: TmImage[]) => [...list].sort((a, b) => Math.abs(Number(a.width) - 1024) - Math.abs(Number(b.width) - 1024))[0];
  const wide = real.filter(i => i.ratio === '16_9');
  const three = real.filter(i => i.ratio === '3_2');
  return String((near(wide) ?? near(three) ?? near(real))!.url);
}

/**
 * An event's photo from its own listing: the act (the first attraction),
 * then the event's own art, then the venue's picture. Null when none of
 * them carries a real one.
 */
export function eventPhoto(e: any): PlacePhoto | null {
  const attraction = e?._embedded?.attractions?.[0];
  const venue = e?._embedded?.venues?.[0];
  const act = ticketmasterImage(attraction?.images);
  const own = act ? null : ticketmasterImage(e?.images);
  const hall = act || own ? null : ticketmasterImage(venue?.images);
  const url = act ?? own ?? hall;
  if (!url) return null;
  // Said in the alt text: the act, the event, or — when it is the venue's
  // picture — the venue, so nobody is told a hall is the band.
  const of = act ? attraction?.name : own ? e?.name : venue?.name;
  return { url, credit: 'Ticketmaster', link: null, source: 'ticketmaster', of: typeof of === 'string' ? of : null };
}

/** What a card says about a picture. "Photo: …", always. */
export function creditLine(credit: string | null | undefined): string | null {
  return credit ? `Photo: ${credit}` : null;
}
