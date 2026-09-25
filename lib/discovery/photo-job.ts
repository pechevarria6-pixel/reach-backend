// ─── Finding the photograph a venue's own map entry names ───────────────
// Nightly, never in a request (see /api/discovery/photos). Each venue whose
// OpenStreetMap entry names a picture of it — a wikidata item, a Commons
// file, an image tag pointing at Commons — is looked up in batches of fifty
// and the thumbnail, its author and its licence are kept on the row. After
// that Discover and the itinerary menu read a column; nobody's screen ever
// waits on Wikimedia, and Wikimedia is asked about each place once a month.
//
// What it never does is look a venue up by its name. That finds a picture
// of something with the same name, which is the wrong-photo failure this
// whole feature is built to avoid.
import type { SupabaseClient } from '@supabase/supabase-js';
import { venuePhotos, photoRefsOf, type Asked, type PlacePhoto } from './place-photo.ts';

/** Places looked at per run. A few requests to Wikimedia per fifty. */
export const PHOTO_PER_RUN = 300;

/**
 * Places whose map entry points at a picture that is not of them, found by
 * looking at what the job stored. Each is never given a Wikimedia photo, and
 * one it has is taken off. Keyed osm_type/osm_id, with why — a place is only
 * ever here because somebody looked at the picture.
 */
export const PHOTO_DENIED: Record<string, string> = {
  'node/445403900': 'Silvia Monfort (Paris): the item\'s image is a portrait, not the theatre',
  'way/28992713': 'AMC Southpoint 17: the photo is the mall\'s fountain, not the cinema',
  'node/13418749009': 'Fred Astaire Dance Studios: tagged with the chain\'s item, whose photo is another branch',
};
/** How long an answer stands before the entry is asked about again. */
export const PHOTO_FRESH_DAYS = 30;
export const PHOTO_SQL = 'sql/place-photos-2026-09-24.sql';

type Row = {
  osm_type: string; osm_id: number; osm_tags: Record<string, string> | null; image_source: string | null;
  name: string | null; lat: number | null; lng: number | null; city: string | null;
};

export interface PhotoRun {
  /** Distinct places read. */
  read: number;
  /** Of those, the ones whose entry names a picture we can look up. */
  withRefs: number;
  found: number;
  stored: number;
  /** A place that had a Wikimedia photo and no longer does. */
  cleared: number;
  /** Wikidata items turned away as not this place, or their image as not of it. */
  rejected: number;
  /** Requests to Wikimedia that did not answer. Misses are not written down then. */
  failed: number;
  pending?: string;
}

const pendingColumns = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /image_checked_at|image_credit|image_link/.test(e.message || ''));

/**
 * Which rows to look at: an entry that names a picture, not looked at in
 * the last month. The refs filter is on the stored tags, so a place with
 * none of them costs nothing, ever.
 */
function due(db: SupabaseClient, limit: number, now: Date) {
  const stale = new Date(now.getTime() - PHOTO_FRESH_DAYS * 86400_000).toISOString();
  return db.from('discovery_venues')
    // The name and the point are what a wikidata item is checked against.
    .select('osm_type, osm_id, osm_tags, image_source, name, lat, lng, city')
    .or('osm_tags->>wikidata.not.is.null,osm_tags->>wikimedia_commons.not.is.null,osm_tags->>image.not.is.null')
    .or(`image_checked_at.is.null,image_checked_at.lt.${stale}`)
    .order('image_checked_at', { ascending: true, nullsFirst: true })
    // A place is a row per interest; read enough rows for `limit` places.
    .limit(limit * 3) as unknown as Promise<{ data: Row[] | null; error: { code?: string; message?: string } | null }>;
}

/**
 * The update a place gets, or null when nothing should be written.
 *
 * Found: the photo, its credit and its page, and the date.
 * Not found, and every request answered: the date — and a Wikimedia photo
 * it used to have is taken off, because the entry no longer vouches for it.
 * Not found because Wikimedia did not answer: nothing. "Could not ask" is
 * not "has no picture".
 */
export function photoUpdate(photo: PlacePhoto | null, had: string | null, allAnswered: boolean, now: string): Record<string, unknown> | null {
  if (photo) {
    return { image_url: photo.url, image_source: 'wikimedia', image_credit: photo.credit, image_link: photo.link, image_checked_at: now };
  }
  if (!allAnswered) return null;
  return had === 'wikimedia'
    ? { image_url: null, image_source: null, image_credit: null, image_link: null, image_checked_at: now }
    : { image_checked_at: now };
}

export async function resolvePhotos(
  db: SupabaseClient,
  opts: { limit?: number; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<PhotoRun> {
  const limit = opts.limit ?? PHOTO_PER_RUN;
  const now = opts.now ?? new Date();
  const run: PhotoRun = { read: 0, withRefs: 0, found: 0, stored: 0, cleared: 0, rejected: 0, failed: 0 };

  const { data, error } = await due(db, limit, now);
  if (error) {
    if (pendingColumns(error)) {
      console.error(`[photos] the photo columns are not there yet — run ${PHOTO_SQL}`);
      return { ...run, pending: PHOTO_SQL };
    }
    throw new Error(error.message || 'could not read venues');
  }

  const places = new Map<string, Row>();
  for (const r of data ?? []) {
    const key = `${r.osm_type}/${r.osm_id}`;
    // Any row of the place will do for its tags; a wikimedia source on any
    // of them is what it "had".
    const seen = places.get(key);
    if (!seen || r.image_source === 'wikimedia') places.set(key, r);
    if (places.size >= limit && !seen) break;
  }
  run.read = places.size;
  const usable = [...places.entries()].filter(([key, r]) => {
    if (PHOTO_DENIED[key]) return false;
    const refs = photoRefsOf(r.osm_tags);
    return refs.wikidata || refs.file;
  });
  run.withRefs = usable.length;

  const asked: Asked = { failed: 0 };
  const rejected = new Map<string, string>();
  const photos = await venuePhotos(
    usable.map(([key, r]) => ({ key, tags: r.osm_tags, name: r.name, lat: r.lat, lng: r.lng, city: r.city })),
    opts.fetchImpl ?? fetch, asked, rejected,
  );
  run.rejected = rejected.size;
  run.failed = asked.failed;
  run.found = photos.size;

  const stamp = now.toISOString();
  // Every place read is answered for — including one whose tags turned out
  // to name nothing usable (a Category, a logo), so it is not read again
  // tomorrow.
  for (const [key, r] of places) {
    const change = photoUpdate(photos.get(key) ?? null, r.image_source, asked.failed === 0, stamp);
    if (!change) continue;
    const { error: wrote } = await db.from('discovery_venues').update(change)
      .eq('osm_type', r.osm_type).eq('osm_id', r.osm_id);
    if (wrote) {
      console.error('[photos] could not store a photo', { place: key, code: wrote.code, message: wrote.message });
      if (pendingColumns(wrote)) return { ...run, pending: PHOTO_SQL };
      continue;
    }
    if (change.image_url) run.stored += 1;
    if ('image_url' in change && change.image_url === null) run.cleared += 1;
  }
  return run;
}
