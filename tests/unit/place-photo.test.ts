// A photo sits on a card only when its own row vouches for it.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  photoTagsOf, commonsFile, photoRefsOf, venuePhotos, commonsCredit, rowPhoto,
  ticketmasterImage, eventPhoto, siteCredit, sameThing, nameAgreement, fileNamesThing,
} from '../../lib/discovery/place-photo.ts';
import { photoUpdate, resolvePhotos } from '../../lib/discovery/photo-job.ts';
import { keptTagsOf } from '../../lib/discovery/osm.ts';
import { cachedVenues, cachedEvents, rememberEvents } from '../../lib/discovery/cache.ts';
import { eventFromProvider } from '../../lib/discovery/find-event.ts';
import { cachedDestinationPhoto, destinationKey } from '../../lib/discovery/destination-photo.ts';
import { itemFromRow, rowFromItem } from '../../lib/contracts/itinerary-item.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// ─── A fake Wikimedia, answering only what it holds ─────────────────────
type Files = Record<string, { artist?: string; licence?: string; url?: string }>;
type Item = string | { file: string; label: string; lat?: number; lng?: number; human?: boolean };
function fakeWikimedia(p18: Record<string, Item>, files: Files, opts: { down?: boolean } = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (opts.down) return new Response('busy', { status: 500 });
    const u = new URL(url);
    if (u.hostname === 'www.wikidata.org') {
      const entities: Record<string, unknown> = {};
      for (const id of (u.searchParams.get('ids') || '').split('|')) {
        const it = typeof p18[id] === 'string' ? { file: p18[id] as string, label: '' } : p18[id] as Exclude<Item, string> | undefined;
        entities[id] = it ? {
          labels: { en: { value: it.label } },
          claims: {
            P18: [{ rank: 'normal', mainsnak: { datavalue: { value: it.file } } }],
            ...(it.lat != null ? { P625: [{ rank: 'normal', mainsnak: { datavalue: { value: { latitude: it.lat, longitude: it.lng } } } }] } : {}),
            ...(it.human ? { P31: [{ rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } : {}),
          },
        } : { claims: {} };
      }
      return Response.json({ entities });
    }
    if (u.hostname === 'commons.wikimedia.org') {
      const titles = (u.searchParams.get('titles') || '').split('|');
      const pages = titles.map(t => {
        const name = t.replace(/^File:/, '');
        const f = files[name];
        if (!f) return { title: t, missing: true };
        return {
          title: t,
          imageinfo: [{
            thumburl: f.url ?? `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(name)}/800px-x.jpg`,
            descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`,
            extmetadata: {
              ...(f.artist !== undefined ? { Artist: { value: `<a href="x">${f.artist}</a>` } } : {}),
              ...(f.licence !== undefined ? { LicenseShortName: { value: f.licence } } : {}),
            },
          }],
        };
      });
      return Response.json({ query: { pages } });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

// ─── The row's own tags, and nothing else ───────────────────────────────

test('the tags that name a picture are kept on the row; the chain\'s wikidata is not', () => {
  assert.deepEqual(photoTagsOf({ wikidata: 'Q1459878', name: 'NCMA', fixme: 'x' }), { wikidata: 'Q1459878' });
  assert.deepEqual(photoTagsOf({ wikidata: 'Q37158', 'brand:wikidata': 'Q37158' }), {}, 'Starbucks the brand is not this branch');
  const kept = keptTagsOf({ cuisine: 'thai', wikimedia_commons: 'File:Front.jpg', image: 'https://x.example/a.jpg', fixme: 'check' });
  assert.deepEqual(kept, { cuisine: 'thai', wikimedia_commons: 'File:Front.jpg', image: 'https://x.example/a.jpg' });
});

test('only a Commons file counts — a picture hosted anywhere else is not ours to show', () => {
  assert.equal(commonsFile('File:Briggs_Hardware.jpeg'), 'Briggs Hardware.jpeg');
  assert.equal(commonsFile('https://commons.wikimedia.org/wiki/File:Briggs-Hardware-Building-20080321.jpeg'), 'Briggs-Hardware-Building-20080321.jpeg');
  assert.equal(commonsFile('http://en.wikipedia.org/wiki/File:Capital_Club_Building,_Raleigh.jpg'), 'Capital Club Building, Raleigh.jpg');
  assert.equal(commonsFile('https://upload.wikimedia.org/wikipedia/commons/e/e3/Capital_Club_Building%2C_Raleigh.jpg'), 'Capital Club Building, Raleigh.jpg');
  // Real image tags from Raleigh venues, 2026-09-24.
  assert.equal(commonsFile('https://lh5.googleusercontent.com/p/AF1QipMKsyrLTGiLjXu5SPURmaqvUxaOHM02C2kcuUA=w800-h500-k-no'), null);
  assert.equal(commonsFile('https://images.squarespace-cdn.com/content/v1/51683440/IMG_6873.JPG'), null);
  assert.equal(commonsFile('Category:Museums in Raleigh'), null, 'a folder of pictures is not a picture of this place');
  assert.equal(commonsFile('File:Cary Theater logo.png'), null, 'a logo is not what the place looks like');
  assert.equal(commonsFile('File:Raleigh locator map.svg'), null);
});

test('a venue gets the photo its own entry names, with its credit, and never another venue\'s', async () => {
  const wiki = fakeWikimedia(
    {
      Q1459878: { file: 'North Carolina Museum of Art West Building.jpg', label: 'North Carolina Museum of Art', lat: 35.8101, lng: -78.7027 },
      Q7286926: { file: 'Raleigh Little Theatre logo.png', label: 'Raleigh Little Theatre', lat: 35.78, lng: -78.66 },
    },
    {
      'North Carolina Museum of Art West Building.jpg': { artist: 'Justin Doub', licence: 'CC BY 2.0' },
      'Capital Club Building, Raleigh.jpg': { artist: 'Bz3rk', licence: 'CC BY-SA 3.0' },
      'Uncredited.jpg': { licence: 'CC BY-SA 4.0' },
    },
  );
  const photos = await venuePhotos([
    { key: 'museum', tags: { wikidata: 'Q1459878' }, name: 'North Carolina Museum of Art', lat: 35.8102, lng: -78.7030, city: 'Raleigh' },
    { key: 'theatre', tags: { wikidata: 'Q7286926' }, name: 'Raleigh Little Theatre', lat: 35.78, lng: -78.66 },
    { key: 'club', tags: { image: 'https://commons.wikimedia.org/wiki/File:Capital_Club_Building,_Raleigh.jpg' } },
    { key: 'bare', tags: { wikimedia_commons: 'File:Uncredited.jpg' } },
    { key: 'none', tags: { cuisine: 'thai' } },
  ], wiki.impl);

  assert.equal(photos.get('museum')?.credit, 'Justin Doub / Wikimedia Commons, CC BY 2.0');
  assert.match(String(photos.get('museum')?.link), /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.equal(photos.get('club')?.credit, 'Bz3rk / Wikimedia Commons, CC BY-SA 3.0');
  assert.equal(photos.has('theatre'), false, 'its item\'s image is a logo');
  assert.equal(photos.has('bare'), false, 'no author and not public domain: no credit we can print');
  assert.equal(photos.has('none'), false, 'nothing names a picture, so nothing is looked up by name');
  assert.ok(wiki.calls.every(c => !/search|srsearch|list=/.test(c)), 'never a search');
  assert.ok(wiki.calls.every(c => /wikidata\.org|commons\.wikimedia\.org/.test(c)));
});

// Real cases from the held venues, 2026-09-24: each item's image would have
// put a picture of something else on the card.
const ITEM = { names: ['Laogai Museum'], at: { lat: 38.9067, lng: -77.0276 }, person: false, file: 'DalaiLama LRF2009.jpg' };
test('a map entry\'s wikidata item has to be this place, and its image of it', () => {
  const venue = { name: 'Laogai Museum', lat: 38.9068, lng: -77.0277, city: 'Washington' };
  assert.deepEqual(sameThing(venue, ITEM), { ok: false, why: 'not_of_it' }, "the Dalai Lama is not the museum");
  assert.deepEqual(sameThing(venue, { ...ITEM, file: 'Laogai Museum front.jpg' }), { ok: true });
  assert.deepEqual(sameThing({ name: 'Silvia Monfort', lat: 48.83, lng: 2.30 }, { names: ['Silvia Monfort'], at: null, person: true, file: 'Silvia Monfort.jpg' }),
    { ok: false, why: 'person' }, 'the actress, not the theatre');
  assert.deepEqual(sameThing({ name: 'Showbox SoDo', lat: 47.5866, lng: -122.3341 },
    { names: ['The Showbox'], at: { lat: 47.6085, lng: -122.3395 }, person: false, file: 'Seattle - Showbox marquee 01.jpg' }),
  { ok: false, why: 'name' }, 'the other Showbox, 2.4 km away: one word of its name is not its name');
  assert.deepEqual(sameThing({ name: 'Showbox', lat: 47.5866, lng: -122.3341 },
    { names: ['The Showbox SoDo'], at: { lat: 47.6085, lng: -122.3395 }, person: false, file: 'Seattle - Showbox marquee 01.jpg' }),
  { ok: false, why: 'far' }, 'a one-word venue name still needs the kilometre');
  // 2026-09-24 review: an item named by one word of the venue's name passed
  // the name check whenever it was within a kilometre — which the place a
  // venue stands in always is.
  assert.deepEqual(sameThing({ name: 'AMC Southpoint 17', lat: 35.9036, lng: -78.9446, city: 'Durham' },
    { names: ['The Streets at Southpoint', 'Southpoint'], at: { lat: 35.9040, lng: -78.9440 }, person: false, file: 'Southpoint fountain.jpg' }),
  { ok: false, why: 'name' }, 'the mall it stands in, by its one-word alias');
  assert.deepEqual(sameThing({ name: 'Carolina Theatre', lat: 35.9953, lng: -78.9020, city: 'Durham' },
    { names: ['Carolina'], at: { lat: 35.9970, lng: -78.9000 }, person: false, file: 'Carolina Hurricanes arena.jpg' }),
  { ok: false, why: 'name' }, 'a neighbour whose whole name is one word of the venue\'s');
  assert.deepEqual(sameThing({ name: 'Leif Erikson Statue', lat: 47.68, lng: -122.406 },
    { names: ['Leif Erikson Statue'], at: { lat: 47.6799, lng: -122.406 }, person: false, file: 'Shilshole Bay Marina Washington6.jpg' }),
  { ok: false, why: 'not_of_it' }, 'the marina it stands in');
  assert.deepEqual(sameThing({ name: 'San Juan Marriott Resort & Stellaris Casino', lat: 18.456, lng: -66.070, city: 'San Juan' },
    { names: ['San Juan Marriott Resort & Stellaris Casino', 'Puerto Rico Sheraton'], at: { lat: 18.4561, lng: -66.0703 }, person: false, file: 'San Juan, Condado beach, Puerto Rico.jpg' }),
  { ok: false, why: 'not_of_it' }, 'the beach, named by the town and a former name');
  assert.deepEqual(sameThing({ name: 'Pope House Museum', lat: 35.7745, lng: -78.6401 },
    { names: ['Pope House'], at: { lat: 35.7746, lng: -78.6402 }, person: false, file: 'Pope House.jpg' }), { ok: true });
  assert.deepEqual(sameThing({ name: 'Tolbooth Museum', lat: 56.96, lng: -2.20 },
    { names: ['Stonehaven Tolbooth'], at: { lat: 56.96, lng: -2.20 }, person: false, file: 'Old Tolbooth Museum.jpg' }),
  { ok: false, why: 'name' }, 'one shared word is not the same name');
});

test('names agree exactly, closely, or not at all', () => {
  assert.equal(nameAgreement('Théâtre de la Bastille', 'theatre de la bastille'), 'exact');
  assert.equal(nameAgreement('Pope House Museum', 'Pope House'), 'close');
  assert.equal(nameAgreement('Showbox SoDo', 'The Showbox'), null, 'the item is named by one word of the venue: another place');
  assert.equal(nameAgreement('Showbox', 'The Showbox at the Market'), 'close', 'the venue is named by one word: close enough to need the kilometre');
  assert.equal(nameAgreement('AMC Southpoint 17', 'Southpoint'), null, 'the mall, not the cinema');
  assert.equal(nameAgreement('Carolina Theatre', 'Carolina'), null);
  assert.equal(nameAgreement('Tolbooth Museum', 'Stonehaven Tolbooth'), null);
  assert.equal(nameAgreement('Laogai Museum', 'Laogai Research Foundation'), null);
  assert.equal(fileNamesThing('Paris 75005 Grande Galerie de l\'Evolution.jpg', ['Jardin des Plantes'], null), false);
});

test('a credit needs a licence, and an author unless the file asks for none', () => {
  assert.equal(commonsCredit('Jane', 'CC BY-SA 4.0'), 'Jane / Wikimedia Commons, CC BY-SA 4.0');
  assert.equal(commonsCredit(null, 'Public domain'), 'Wikimedia Commons, Public domain');
  assert.equal(commonsCredit(null, 'CC BY-SA 4.0'), null);
  assert.equal(commonsCredit('Jane', null), null);
});

test('a row\'s photo is shown only from a source that can be named', () => {
  assert.deepEqual(rowPhoto({ image_url: 'https://upload.wikimedia.org/x.jpg', image_source: 'wikimedia', image_credit: 'J / Wikimedia Commons, CC0', image_link: 'https://commons.wikimedia.org/wiki/File:x.jpg' }),
    { url: 'https://upload.wikimedia.org/x.jpg', credit: 'J / Wikimedia Commons, CC0', link: 'https://commons.wikimedia.org/wiki/File:x.jpg', source: 'wikimedia' });
  assert.equal(rowPhoto({ image_url: 'https://upload.wikimedia.org/x.jpg', image_source: 'wikimedia' }), null, 'uncredited');
  assert.equal(rowPhoto({ image_url: 'https://static.wixstatic.com/room.jpg', image_source: 'og', website: 'https://www.doodles.example/' })?.credit,
    "the venue's website (doodles.example)");
  assert.equal(rowPhoto({ image_url: 'https://x.example/a.jpg', image_source: null }), null, 'from nowhere we can say');
  assert.equal(rowPhoto({ image_url: 'http://x.example/a.jpg', image_source: 'og' }), null);
  assert.equal(siteCredit(null), "the venue's website");
});

// ─── Ticketmaster: the act, never the stock crowd ───────────────────────

const img = (ratio: string, width: number, fallback = false, name = `${ratio}-${width}`) =>
  ({ ratio, width, height: Math.round(width / 1.7), fallback, url: `https://s1.ticketm.net/dam/${name}.jpg` });

test('Ticketmaster\'s generic category art never counts as a picture of the act', () => {
  assert.equal(ticketmasterImage([img('16_9', 1024, true), img('3_2', 640, true)]), null);
  assert.equal(ticketmasterImage([img('16_9', 205), img('16_9', 2048), img('16_9', 1136), img('3_2', 1024)]), 'https://s1.ticketm.net/dam/16_9-1136.jpg');
  assert.equal(ticketmasterImage([img('4_3', 305), img('3_2', 640)]), 'https://s1.ticketm.net/dam/3_2-640.jpg');
});

test('an event shows its act, then its own art, then its hall — and says which', () => {
  const act = eventPhoto({
    name: 'J. Cole: The Fall Off Tour', images: [img('16_9', 1024, false, 'event')],
    _embedded: { attractions: [{ name: 'J. Cole', images: [img('16_9', 1024, false, 'cole')] }], venues: [{ name: 'PNC Arena', images: [img('16_9', 1024, false, 'pnc')] }] },
  });
  assert.equal(act?.url, 'https://s1.ticketm.net/dam/cole.jpg');
  assert.equal(act?.of, 'J. Cole');
  assert.equal(act?.credit, 'Ticketmaster');
  const hall = eventPhoto({
    name: 'Hurricanes v Bruins', images: [img('16_9', 1024, true)],
    _embedded: { attractions: [{ name: 'Carolina Hurricanes', images: [img('16_9', 1024, true)] }], venues: [{ name: 'PNC Arena', images: [img('16_9', 1024, false, 'pnc')] }] },
  });
  assert.equal(hall?.url, 'https://s1.ticketm.net/dam/pnc.jpg');
  assert.equal(hall?.of, 'PNC Arena', 'a hall is not the team');
  assert.equal(eventPhoto({ name: 'x', images: [img('16_9', 1024, true)] }), null);
});

// ─── The job: answered once, kept on the row ────────────────────────────

test('a miss is written down only when every request answered', () => {
  const now = '2026-09-24T05:15:00Z';
  const found = { url: 'https://upload.wikimedia.org/a.jpg', credit: 'J / Wikimedia Commons, CC0', link: null, source: 'wikimedia' as const };
  assert.equal(photoUpdate(found, null, true, now)?.image_source, 'wikimedia');
  assert.deepEqual(photoUpdate(null, 'og', true, now), { image_checked_at: now }, 'the og image is left alone');
  assert.equal(photoUpdate(null, 'wikimedia', true, now)?.image_url, null, 'the entry no longer vouches for it');
  assert.equal(photoUpdate(null, 'wikimedia', false, now), null, 'could not ask is not has no picture');
});

function jobDb(rows: Record<string, any>[], opts: { unmigrated?: boolean } = {}) {
  const updates: { change: Record<string, unknown>; where: Record<string, unknown> }[] = [];
  const ors: string[] = [];
  const from = () => {
    const b: any = {
      _change: null as Record<string, unknown> | null,
      _where: {} as Record<string, unknown>,
      select() { return b; },
      or(expr: string) { ors.push(expr); return b; },
      order() { return b; },
      limit() {
        if (opts.unmigrated) return Promise.resolve({ data: null, error: { code: '42703', message: 'column discovery_venues.image_checked_at does not exist' } });
        return Promise.resolve({ data: rows, error: null });
      },
      update(change: Record<string, unknown>) { b._change = change; return b; },
      eq(c: string, v: unknown) {
        b._where[c] = v;
        if (b._change && 'osm_type' in b._where && 'osm_id' in b._where) {
          updates.push({ change: b._change, where: { ...b._where } });
          return Promise.resolve({ error: null });
        }
        return b;
      },
    };
    return b;
  };
  return { db: { from } as any, updates, ors };
}

test('the job reads only rows whose entry names a picture, and writes each place once', async () => {
  const wiki = fakeWikimedia(
    { Q1459878: { file: 'North Carolina Museum of Art.jpg', label: 'North Carolina Museum of Art', lat: 35.81, lng: -78.70 } },
    { 'North Carolina Museum of Art.jpg': { artist: 'Justin Doub', licence: 'CC BY 2.0' } });
  const ncma = { name: 'North Carolina Museum of Art', lat: 35.8101, lng: -78.7027, city: 'Raleigh' };
  const { db, updates, ors } = jobDb([
    { osm_type: 'way', osm_id: 1, osm_tags: { wikidata: 'Q1459878' }, image_source: null, ...ncma },
    { osm_type: 'way', osm_id: 1, osm_tags: { wikidata: 'Q1459878' }, image_source: null, ...ncma },
    { osm_type: 'node', osm_id: 2, osm_tags: { image: 'https://lh5.googleusercontent.com/p/x' }, image_source: 'og' },
  ]);
  const run = await resolvePhotos(db, { fetchImpl: wiki.impl, now: new Date('2026-09-24T05:15:00Z') });
  assert.ok(ors.some(o => /osm_tags->>wikidata\.not\.is\.null/.test(o)), 'filtered to entries that name a picture');
  assert.equal(run.read, 2);
  assert.equal(run.stored, 1);
  assert.equal(updates.length, 2, 'one write per place, not per interest');
  const museum = updates.find(u => u.where.osm_id === 1)!;
  assert.equal(museum.change.image_credit, 'Justin Doub / Wikimedia Commons, CC BY 2.0');
  assert.deepEqual(updates.find(u => u.where.osm_id === 2)!.change, { image_checked_at: '2026-09-24T05:15:00.000Z' });
});

test('before the migration the job says which file to run and writes nothing', async () => {
  const { db, updates } = jobDb([], { unmigrated: true });
  const run = await resolvePhotos(db, { fetchImpl: (async () => { throw new Error('no request expected'); }) as typeof fetch });
  assert.equal(run.pending, 'sql/place-photos-2026-09-24.sql');
  assert.equal(updates.length, 0);
});

test('when Wikimedia is down nothing is marked as having no picture', async () => {
  const wiki = fakeWikimedia({}, {}, { down: true });
  const { db, updates } = jobDb([{ osm_type: 'node', osm_id: 9, osm_tags: { wikidata: 'Q1' }, image_source: 'wikimedia' }]);
  const run = await resolvePhotos(db, { fetchImpl: wiki.impl });
  assert.ok(run.failed > 0);
  assert.equal(updates.length, 0, 'the photo it had stays, and it is asked again tomorrow');
});

// ─── Nothing is fetched when somebody opens a screen ────────────────────

function readDb(tables: Record<string, Record<string, any>[]>, opts: { noPhotoColumns?: boolean } = {}) {
  const selects: string[] = [];
  const from = (table: string) => {
    let cols = '';
    const only: Array<(r: Record<string, any>) => boolean> = [];
    const b: any = {
      select(c: string) { cols = c; selects.push(c); return b; },
      // Each interest is its own read, as in the table.
      in(c: string, vs: unknown[]) { only.push(r => vs.includes(r[c])); return b; },
      gte() { return b; }, lte() { return b; }, gt() { return b; }, neq() { return b; },
      is() { return b; }, or() { return b; }, order() { return b; }, eq() { return b; },
      limit() { return b; },
      then(resolve: (v: unknown) => void) {
        if (opts.noPhotoColumns && /image_credit/.test(cols)) {
          return resolve({ data: null, error: { code: '42703', message: `column ${table}.image_credit does not exist` } });
        }
        return resolve({ data: (tables[table] ?? []).filter(r => only.every(f => f(r))), error: null });
      },
    };
    return b;
  };
  return { db: { from } as any, selects };
}

const SEEKER = { lat: 35.7796, lng: -78.6382, city: 'Raleigh', interests: ['museums & history'], avoid: [] };
const MUSEUM = {
  osm_type: 'way', osm_id: 1, name: 'North Carolina Museum of Art', lat: 35.81, lng: -78.70, city: 'Raleigh',
  website: 'https://ncartmuseum.org', interest: 'museums & history', kind: 'museum', street: null,
  image_url: 'https://upload.wikimedia.org/wikipedia/commons/2/2b/NC_Art_Museum.jpg', image_source: 'wikimedia',
  image_credit: 'Justin Doub / Wikimedia Commons, CC BY 2.0', image_link: 'https://commons.wikimedia.org/wiki/File:NC_Art_Museum.jpg',
};

test('Discover reads the photo off the row and never asks anybody for one', async () => {
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = (async () => { asked++; throw new Error('a page view must not fetch'); }) as typeof fetch;
  try {
    const { db } = readDb({ discovery_venues: [MUSEUM] });
    const { findings } = await cachedVenues(db, SEEKER);
    assert.equal(findings[0].image, MUSEUM.image_url);
    assert.equal(findings[0].imageCredit, MUSEUM.image_credit);
    assert.equal(findings[0].imageLink, MUSEUM.image_link);
    await cachedEvents(readDb({ discovery_events: [] }).db, SEEKER);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(asked, 0);
});

test('before the migration Discover still reads, and shows only what it can credit', async () => {
  const { db, selects } = readDb({ discovery_venues: [{ ...MUSEUM, image_credit: undefined, image_link: undefined }] }, { noPhotoColumns: true });
  const { findings, status } = await cachedVenues(db, SEEKER);
  assert.equal(status, 'ok');
  assert.equal(findings[0].image, null, 'a Wikimedia picture without its credit is not shown');
  assert.ok(selects.some(s => !/image_credit/.test(s)), 'retried without the new columns');
});

test('before the migration every interest is still read, not only the first to retry', async () => {
  // The interests are read in parallel. A shared "no photo columns" flag
  // meant every read that failed while the first was retrying gave up —
  // measured on the live Raleigh table: 8 findings instead of 40.
  const rows = ['museums & history', 'live music', 'film & theatre'].map((interest, i) => ({
    ...MUSEUM, osm_id: 10 + i, name: `Place ${i}`, interest, kind: 'museum', image_source: null, image_url: null,
  }));
  const { db } = readDb({ discovery_venues: rows }, { noPhotoColumns: true });
  const { findings } = await cachedVenues(db, { ...SEEKER, interests: ['museums & history', 'live music', 'film & theatre'] });
  assert.equal(findings.length, 3);
});

test('a cached gig shows the act\'s picture it was stored with; a class shows its studio\'s', async () => {
  const day = '2099-01-01';
  const { db } = readDb({
    discovery_events: [
      { id: 1, title: 'J. Cole', starts_on: day, source: 'ticketmaster', interest: 'music', booking_url: 'https://tm.example/1',
        venue_name: 'PNC Arena', lat: 35.80, lng: -78.72, image_url: 'https://s1.ticketm.net/dam/cole.jpg', image_credit: 'Ticketmaster' },
      { id: 2, title: 'Wheel throwing', starts_on: day, source: 'harvest', interest: 'museums & history', booking_url: 'https://studio.example',
        discovery_venues: { name: 'Studio', lat: 35.78, lng: -78.64, city: 'Raleigh', street: null, website: 'https://studio.example',
          image_url: 'https://studio.example/room.jpg', image_source: 'og' } },
      { id: 3, title: 'Uncredited', starts_on: day, source: 'ticketmaster', interest: 'music', booking_url: 'https://tm.example/3',
        venue_name: 'Hall', lat: 35.80, lng: -78.70, image_url: 'https://s1.ticketm.net/dam/x.jpg', image_credit: null },
    ],
  });
  const { findings } = await cachedEvents(db, SEEKER);
  const gig = findings.find(f => f.title === 'J. Cole')!;
  assert.equal(gig.image, 'https://s1.ticketm.net/dam/cole.jpg');
  assert.equal(gig.imageCredit, 'Ticketmaster');
  const cls = findings.find(f => f.title === 'Wheel throwing')!;
  assert.equal(cls.image, 'https://studio.example/room.jpg');
  assert.equal(cls.imageOf, 'Studio', 'the alt text says it is the studio, not the class');
  assert.equal(findings.find(f => f.title === 'Uncredited')!.image, null);
});

// 2026-09-24 review: what a picture is of was dropped on the way to the
// itinerary line and to the cache, so the alt text named the wrong thing —
// the venue over the band's photo, the gig over its hall's.
test('a cached gig keeps whose picture it is — a hall stays a hall', async () => {
  const day = '2099-01-01';
  const { db } = readDb({
    discovery_events: [
      { id: 1, title: 'Hurricanes v Bruins', starts_on: day, source: 'ticketmaster', interest: 'sports', booking_url: 'https://tm.example/1',
        venue_name: 'PNC Arena', lat: 35.80, lng: -78.72, image_url: 'https://s1.ticketm.net/dam/pnc.jpg', image_credit: 'Ticketmaster', image_of: 'PNC Arena' },
    ],
  });
  const { findings } = await cachedEvents(db, SEEKER);
  assert.equal(findings[0].imageOf, 'PNC Arena', 'the picture is of the hall, not "Hurricanes v Bruins"');

  const written: Record<string, unknown>[] = [];
  const store = { from: () => ({ upsert: async (rows: Record<string, unknown>[]) => { written.push(...rows); return { error: null }; } }) } as any;
  await rememberEvents(store, [{ ...findings[0], id: 'tm_1', source: 'ticketmaster' } as any], () => 'sports');
  assert.equal(written[0].image_of, 'PNC Arena', 'stored with whose it is');
  written.length = 0;
  await rememberEvents(store, [{ ...findings[0], id: 'tm_1', source: 'ticketmaster', imageCredit: null } as any], () => 'sports');
  assert.equal(written[0].image_of, null, 'nothing to describe without a picture');
});

test('an event found for an itinerary keeps whose picture it is', async () => {
  const prior = process.env.TICKETMASTER_API_KEY;
  process.env.TICKETMASTER_API_KEY = 'test';
  try {
    const listing = {
      name: 'The Milk Carton Kids', url: 'https://www.ticketmaster.com/e/1', dates: { start: { localDate: '2099-01-01' } },
      images: [img('16_9', 1024, false, 'event')],
      _embedded: { attractions: [{ name: 'The Milk Carton Kids', images: [img('16_9', 1024, false, 'mck')] }], venues: [{ name: '9:30 CLUB', city: { name: 'Washington' } }] },
    };
    const fake = (async () => new Response(JSON.stringify({ _embedded: { events: [listing] } }), { status: 200 })) as typeof fetch;
    const found = await eventFromProvider(['milk', 'carton', 'kids'], 'Washington', fake);
    assert.equal(found?.venue, '9:30 CLUB');
    assert.equal(found?.photo?.of, 'The Milk Carton Kids', 'the line names the venue; the picture is the band');
  } finally {
    if (prior === undefined) delete process.env.TICKETMASTER_API_KEY; else process.env.TICKETMASTER_API_KEY = prior;
  }
});

test('an itinerary line\'s alt text says what the picture is of, not which venue the line names', () => {
  const row = { title: 'See The Milk Carton Kids live at 9:30 CLUB.', venue_name: '9:30 CLUB',
    venue_image_url: 'https://s1.ticketm.net/dam/mck.jpg', venue_image_credit: 'Ticketmaster', venue_image_of: 'The Milk Carton Kids' };
  const item = itemFromRow(row);
  assert.equal(item.venue_image_of, 'The Milk Carton Kids');
  assert.equal(rowFromItem(item as unknown as Record<string, unknown>, 0).venue_image_of, 'The Milk Carton Kids');
  assert.equal(itemFromRow({ title: 'x', venue_image_of: 'A band' }).venue_image_of, null, 'nothing to describe without a picture');
  const src = read('app/api/trips/generate/route.ts');
  assert.match(src, /slot\.place_photo_of = realEvent\.photo\.of/, 'the act, from the listing');
  assert.match(src, /slot\.place_photo_of = cited\.name/, 'the place, from the row it cited');
  assert.match(src, /slot\.place_photo_of = null; slot\.place_photo_link = null; \}/, "whatever the model wrote is cleared");
  const app = read('components/reach-app.jsx');
  assert.ok(app.includes('venue_image_of:sl.place_photo_of||null'), 'slotRow carries it');
  assert.ok(app.includes('alt={photoAlt(item.venue_image_of,item.title)}'), 'the line describes its picture, not its venue');
  assert.ok(!app.includes('photoAlt(item.venue_name'), 'never the venue the line names');
});

// 2026-09-24 review: the credit was one line with an ellipsis and the
// licence last, so on a phone the licence was what got cut — and three of
// the places it appeared had no link to follow either.
test('a photo credit is shown whole, and can be followed wherever we hold its page', () => {
  const app = read('components/reach-app.jsx');
  const credit = app.slice(app.indexOf('function PhotoCredit('), app.indexOf('function photoAlt('));
  assert.ok(credit.length > 0);
  assert.doesNotMatch(credit, /nowrap|ellipsis/, 'the licence comes last; cutting the line cuts the licence');
  assert.doesNotMatch(credit, /title=\{text\}/, 'a tooltip is nothing on a touch screen');
  const uses = app.match(/<PhotoCredit [^>]*\/>/g) ?? [];
  assert.ok(uses.length >= 5);
  for (const u of uses) assert.match(u, /link=\{/, `a credit with no way to its source: ${u}`);
  assert.ok(app.includes('venue_image_link:sl.place_photo_link||null'), 'slotRow carries the page');
  const src = read('app/api/trips/generate/route.ts');
  assert.match(src, /slot\.place_photo_link = cited\.photo\.link/);
  assert.match(read('app/api/nearby/route.ts'), /image_link: e\.image && e\.imageCredit \? \(e\.imageLink/);
  const row = { title: 'Museum morning', venue_image_url: 'https://upload.wikimedia.org/a.jpg', venue_image_credit: 'J / Wikimedia Commons, CC BY-SA 4.0',
    venue_image_link: 'https://commons.wikimedia.org/wiki/File:a.jpg' };
  const item = itemFromRow(row);
  assert.equal(item.venue_image_link, row.venue_image_link);
  assert.equal(rowFromItem(item as unknown as Record<string, unknown>, 0).venue_image_link, row.venue_image_link);
  assert.equal(itemFromRow({ ...row, venue_image_link: 'javascript:alert(1)' }).venue_image_link, null);
});

// ─── Destinations, kept ──────────────────────────────────────────────────

function destDb(row: Record<string, unknown> | null, opts: { missing?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  const from = () => {
    const b: any = {
      select() { return b; }, eq() { return b; },
      maybeSingle() {
        return Promise.resolve(opts.missing
          ? { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.destination_photos'" } }
          : { data: row, error: null });
      },
      upsert(r: Record<string, unknown>) { writes.push(r); return Promise.resolve({ error: null }); },
    };
    return b;
  };
  return { db: { from }, writes };
}

test('a destination asked about once is not asked about again', async () => {
  const kept = { url: 'https://upload.wikimedia.org/wikipedia/commons/m.jpg', credit: 'Quintin Soloviev · CC BY 4.0', source: 'x', width: 1200, height: 800, checked_at: '2026-09-01T00:00:00Z' };
  const never = (async () => { throw new Error('asked Wikipedia'); }) as typeof fetch;
  const { db } = destDb(kept);
  const p = await cachedDestinationPhoto(db, 'Moab, Utah, USA', { fetchImpl: never });
  assert.equal(p?.credit, 'Quintin Soloviev · CC BY 4.0');
  // A recent miss stands too.
  const miss = destDb({ url: null, credit: null, checked_at: '2026-09-20T00:00:00Z' });
  assert.equal(await cachedDestinationPhoto(miss.db, 'Nowhereville', { fetchImpl: never, now: new Date('2026-09-24T00:00:00Z') }), null);
  assert.equal(destinationKey('Moab, Utah, USA'), 'moab, utah');
});

test('before the table exists it is the live lookup, and nothing is written', async () => {
  const { db, writes } = destDb(null, { missing: true });
  const dead = (async () => new Response('', { status: 503 })) as typeof fetch;
  assert.equal(await cachedDestinationPhoto(db, 'Charleston', { fetchImpl: dead }), null);
  assert.equal(writes.length, 0);
  const down = destDb(null);
  await cachedDestinationPhoto(down.db, 'Charleston', { fetchImpl: dead });
  assert.equal(down.writes.length, 0, 'an unanswered lookup is not kept as "no photograph"');
});

// ─── The line, the contract and the client ──────────────────────────────

test('an itinerary line keeps its venue photo through a save and a reload, credit and all', () => {
  const row = { title: 'Museum morning', venue_image_url: 'https://upload.wikimedia.org/a.jpg', venue_image_credit: 'J / Wikimedia Commons, CC0' };
  const item = itemFromRow(row);
  assert.equal(item.venue_image_url, row.venue_image_url);
  const back = rowFromItem(item as unknown as Record<string, unknown>, 0);
  assert.equal(back.venue_image_credit, row.venue_image_credit);
  // Both or neither.
  assert.equal(rowFromItem({ title: 'x', venue_image_url: 'https://a.example/a.jpg' }, 0).venue_image_url, null);
  assert.equal(itemFromRow({ title: 'x', venue_image_url: 'javascript:alert(1)', venue_image_credit: 'c' }).venue_image_url, null);
});

test('the generator attaches a line\'s photo only from the row it cited or the listing that sold the ticket', () => {
  const src = read('app/api/trips/generate/route.ts');
  assert.match(src, /slot\.place_photo = null; slot\.place_photo_credit = null;/, 'whatever the model wrote is cleared');
  assert.match(src, /if \(cited\?\.photo && !slot\.ticket_url\) \{\s*slot\.place_photo = cited\.photo\.url;/);
  assert.match(src, /if \(realEvent\.photo\) \{ slot\.place_photo = realEvent\.photo\.url;/);
});

test('every client field list carries the picture and its credit', () => {
  const app = read('components/reach-app.jsx');
  // slotRow: the line built from a generated slot.
  assert.match(app, /venue_image_url:sl\.place_photo,venue_image_credit:sl\.place_photo_credit/);
  // expFromFinding: the card and the detail screen.
  for (const f of ['imageCredit:e.image&&e.imageCredit', 'imageLink:e.imageLink', 'imageOf:e.imageOf']) {
    assert.ok(app.includes(f), `expFromFinding lost ${f}`);
  }
  // convertPlan and the post-pick refresh both carry the plan's picture and credit.
  assert.ok(app.includes('imageUrl:p.image_url||null') && app.includes('imageCredit:p.image_credit||null'));
  assert.ok(app.includes('imageUrl:saved.image_url||p.imageUrl||null') && app.includes('imageCredit:saved.image_credit||p.imageCredit||null'));
  // Every picture is drawn through the frame that hides it, and its credit, on failure.
  assert.ok(app.includes('onError={()=>setBad(src)}'));
  assert.doesNotMatch(app, /backgroundImage:`url\(/, 'a background image has no alt text and no failure path');
});

test('the nightly job is scheduled once a day, and is gated like the other jobs', () => {
  const crons = JSON.parse(read('vercel.json')).crons as { path: string; schedule: string }[];
  const job = crons.find(c => c.path === '/api/discovery/photos');
  assert.ok(job, 'scheduled');
  assert.match(job!.schedule, /^\d+ \d+ \* \* \*$/, 'Hobby runs a cron once a day; anything more frequent is rejected silently');
  assert.match(read('app/api/discovery/photos/route.ts'), /CRON_SECRET/);
});
