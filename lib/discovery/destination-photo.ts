// ─── A picture of the place somebody is actually going ──────────────────
// A trip card carried the same orange gradient as everything else, so Moab
// and Charleston and Puerto Vallarta all looked identical — on the screen
// whose whole job is to make somebody want to go.
//
// Wikimedia Commons is the source, reached through Wikipedia's page image.
// It is the right one rather than the convenient one: Commons hosts only
// freely licensed media, so there is no question about whether the picture
// can be shown, and every file carries its photographer and licence, which
// are taken with it. A photograph is somebody's work.
//
// Verified against five real destinations before this was written — Moab,
// Charleston, Puerto Vallarta, Raleigh and Aspen all returned a usable
// photograph, with licence and author attached.

export interface DestinationPhoto {
  url: string;
  width: number;
  height: number;
  /** Who took it. Shown wherever the picture is, because it is their work. */
  artist: string | null;
  licence: string | null;
  /** The file's page on Commons, so the credit can be followed. */
  source: string | null;
}

import { locate } from './geocode.ts';
import { milesBetween } from './cache.ts';
import { usStateName } from './regions.ts';

const API = 'https://en.wikipedia.org/w/api.php';

/**
 * How far an article's own coordinates may sit from the place, in miles.
 * A town's article is pinned at its centre; forty miles is a county, not a
 * country — and "Moab" the ancient kingdom is pinned in Jordan.
 */
const SAME_PLACE_MILES = 40;
const AGENT = 'Reach/1.0 (+https://www.alcanzar.io; hello@alcanzar.io)';

/** Markup out of the attribution fields, which arrive as HTML. */
function plainText(html: string | undefined): string | null {
  if (!html) return null;
  const text = String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : null;
}

/**
 * The title to ask about.
 *
 * "Moab, Utah, USA" is how a trip names itself and not how an encyclopaedia
 * does. The country is dropped and the state kept, because "Moab" alone is
 * a town in several countries and "Moab, Utah" is one place.
 */
export function articleTitle(destination: string): string | null {
  const parts = String(destination || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  // A trailing country is the one part an article title rarely carries.
  // A two-letter code ("PR", "MX") is how plans store the country, and
  // never part of an article title either.
  const COUNTRY = /^(usa|us|united states|uk|united kingdom|england|scotland|wales|mexico|canada|france|spain|italy|portugal|germany|[a-z]{2})$/i;
  const kept = parts.length > 1 && COUNTRY.test(parts[parts.length - 1])
    ? parts.slice(0, -1)
    : parts;

  return kept.slice(0, 2).join(', ');
}

/**
 * A photograph of a destination, or null.
 *
 * Null is a perfectly good answer: the card keeps the gradient, which is
 * better than a picture of the wrong place. Nothing here guesses — if the
 * encyclopaedia has no page image for that title, there is no photograph.
 */
export async function destinationPhoto(
  destination: string,
  fetchImpl: typeof fetch = fetch,
  /** Counts a lookup that could not be made, so a miss is not cached for it. */
  asked?: { failed: number },
  /** Where the place is, when the caller knows. Otherwise it is looked up. */
  where?: { lat: number; lng: number; subdivision?: string | null } | null,
): Promise<DestinationPhoto | null> {
  const failed = () => { if (asked) asked.failed += 1; return null; };
  const title = articleTitle(destination);
  if (!title) return null;

  try {
    // The article must be OF this place. "Moab, US" asked Wikipedia for
    // "Moab" and got the ancient kingdom's map; "St. Augustine" got a
    // portrait of the saint. A town's article carries coordinates at the
    // town, so the page is kept only when its own point is near the place
    // the map puts this destination — and a page with no point (a person,
    // a saint, a book) never is.
    const parts = String(destination).split(',').map(p => p.trim()).filter(Boolean);
    const cc = parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1]) ? parts[parts.length - 1] : null;
    const at = where ?? await locate(cc ? parts.slice(0, -1).join(', ') : parts.join(', '), cc, fetchImpl);
    if (!at) return failed();
    const town = parts[0];
    const state = usStateName(at.subdivision);
    // The encyclopaedia's own disambiguations: "Moab, Utah", "Rincón, Puerto Rico".
    let countryName: string | null = null;
    try { countryName = cc ? new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()) ?? null : null; } catch { countryName = null; }
    const titles = [...new Set([
      title,
      ...(state && !title.includes(',') ? [`${town}, ${state}`] : []),
      ...(countryName && !title.includes(',') ? [`${town}, ${countryName}`] : []),
    ])];

    type Page = { thumbnail?: { source: string; width: number; height: number }; pageimage?: string; coordinates?: { lat: number; lon: number }[] };
    let page: Page | undefined;
    for (const t of titles) {
      const q = `${API}?action=query&prop=pageimages|coordinates&piprop=thumbnail|name&colimit=1`
        + `&pithumbsize=1200&titles=${encodeURIComponent(t)}`
        + '&format=json&formatversion=2&redirects=1';
      const res = await fetchImpl(q, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return failed();
      const json = await res.json() as { query?: { pages?: Page[] } };
      const candidate = json.query?.pages?.[0];
      const pin = candidate?.coordinates?.[0];
      if (candidate?.thumbnail?.source && pin && milesBetween(at.lat, at.lng, pin.lat, pin.lon) <= SAME_PLACE_MILES) {
        page = candidate;
        break;
      }
    }
    const thumb = page?.thumbnail;
    if (!thumb?.source) return null;

    // Commons only. An image served from elsewhere on Wikipedia may be there
    // under fair use, which is a claim about editorial context and not a
    // licence to put it on a card in a product.
    if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(thumb.source)) return null;

    const photo: DestinationPhoto = {
      url: thumb.source,
      width: thumb.width,
      height: thumb.height,
      artist: null,
      licence: null,
      source: page?.pageimage
        ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`
        : null,
    };

    // Credit, in a second call. A photograph without its photographer is
    // somebody's work taken without saying whose, so a failure here returns
    // no photograph rather than an uncredited one.
    if (!page?.pageimage) return null;
    const infoQ = `${API}?action=query&titles=File:${encodeURIComponent(page.pageimage)}`
      + '&prop=imageinfo&iiprop=extmetadata|url&format=json&formatversion=2';
    const infoRes = await fetchImpl(infoQ, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(8000) });
    if (!infoRes.ok) return failed();

    const infoJson = await infoRes.json() as {
      query?: { pages?: { imageinfo?: { descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[] }[] };
    };
    const info = infoJson.query?.pages?.[0]?.imageinfo?.[0];
    photo.artist = plainText(info?.extmetadata?.Artist?.value);
    photo.licence = plainText(info?.extmetadata?.LicenseShortName?.value);
    if (info?.descriptionurl) photo.source = info.descriptionurl;

    return photo.artist ? photo : null;
  } catch {
    // Unreachable is not "no photograph of Charleston exists". The card keeps
    // the gradient and the next generation asks again.
    return failed();
  }
}

/** The line shown under or over the picture. Short, and always present. */
export function credit(photo: DestinationPhoto): string {
  return [photo.artist, photo.licence].filter(Boolean).join(' · ');
}

// ─── Kept, so nobody waits on Wikipedia twice for Moab ──────────────────
// Every trip idea, every plan card and every pick asked Wikipedia again for
// the same town. The answer is kept per destination in destination_photos
// (sql/place-photos-2026-09-24.sql), a miss included, so the second trip to
// Charleston costs one indexed read. Until the table exists this is exactly
// the live lookup it replaces.

/** A destination's photo as a card shows it. */
export interface CardPhoto {
  url: string;
  /** "Quintin Soloviev · CC BY 4.0" — the plan card's long-standing form. */
  credit: string;
  source: string | null;
  width: number | null;
  height: number | null;
}

/** How long a miss stands before the town is asked about again. */
export const MISS_DAYS = 14;

/** The key a destination is kept under: its article title, lower-cased. */
export function destinationKey(destination: string): string | null {
  const t = articleTitle(destination);
  return t ? t.toLowerCase() : null;
}

type Db = { from: (t: string) => any };
const tableMissing = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || /destination_photos/.test(e.message || ''));

/**
 * A destination's photo, from the kept answer when there is one, else from
 * Wikipedia — and then kept. Null is a real answer and is kept too, unless
 * the lookup could not be made at all.
 */
export async function cachedDestinationPhoto(
  db: Db,
  destination: string,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<CardPhoto | null> {
  const key = destinationKey(destination);
  if (!key) return null;
  const now = opts.now ?? new Date();

  let canKeep = true;
  try {
    const { data, error } = await db.from('destination_photos')
      .select('url, credit, source, width, height, checked_at').eq('destination', key).maybeSingle();
    if (error) {
      canKeep = !tableMissing(error);
      if (canKeep) console.error('[destination-photo] could not read the kept photo', { key, code: error.code });
    } else if (data) {
      if (data.url && data.credit) return { url: data.url, credit: data.credit, source: data.source ?? null, width: data.width ?? null, height: data.height ?? null };
      const age = now.getTime() - new Date(data.checked_at).getTime();
      if (!data.url && age < MISS_DAYS * 86400_000) return null;
    }
  } catch {
    canKeep = false;
  }

  const asked = { failed: 0 };
  const live = await destinationPhoto(destination, opts.fetchImpl ?? fetch, asked);
  const photo: CardPhoto | null = live
    ? { url: live.url, credit: credit(live), source: live.source, width: live.width ?? null, height: live.height ?? null }
    : null;

  if (canKeep && (photo || asked.failed === 0)) {
    try {
      const { error } = await db.from('destination_photos').upsert({
        destination: key, url: photo?.url ?? null, credit: photo?.credit ?? null, source: photo?.source ?? null,
        width: photo?.width ?? null, height: photo?.height ?? null, checked_at: now.toISOString(),
      }, { onConflict: 'destination' });
      // Keeping it is a courtesy to the next card; failing to is not this one's problem.
      if (error && !tableMissing(error)) console.error('[destination-photo] could not keep the photo', { key, code: error.code });
    } catch { /* see above */ }
  }
  return photo;
}
