import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleTitle, destinationPhoto, credit } from '../../lib/discovery/destination-photo.ts';

test('a trip names itself differently from an encyclopaedia', () => {
  // "Moab, Utah, USA" is how a trip is titled. The country is dropped and
  // the state kept, because "Moab" alone is a town in several countries.
  assert.equal(articleTitle('Moab, Utah, USA'), 'Moab, Utah');
  assert.equal(articleTitle('Puerto Vallarta, Mexico'), 'Puerto Vallarta');
  assert.equal(articleTitle('Charleston, South Carolina'), 'Charleston, South Carolina');
  assert.equal(articleTitle(''), null);
});

/** Wikipedia answering as it really does, without the network. */
function fakeWiki(opts: { source?: string; artist?: string; licence?: string; pageimage?: string } = {}) {
  const {
    source = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Moab.jpg',
    artist = 'Quintin Soloviev', licence = 'CC BY 4.0', pageimage = 'Moab.jpg',
  } = opts;
  return (async (url: string) => {
    if (String(url).includes('nominatim')) {
      return { ok: true, json: async () => ([{ lat: '38.5733', lon: '-109.5498', display_name: 'Moab, Utah', class: 'place', type: 'town', address: { country_code: 'us', 'ISO3166-2-lvl4': 'US-UT' } }]) };
    }
    if (String(url).includes('prop=pageimages')) {
      return { ok: true, json: async () => ({ query: { pages: [{ thumbnail: { source, width: 1200, height: 900 }, pageimage, coordinates: [{ lat: 38.57, lon: -109.55 }] }] } }) };
    }
    return { ok: true, json: async () => ({ query: { pages: [{ imageinfo: [{
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Moab.jpg',
      extmetadata: { Artist: { value: `<a href="x">${artist}</a>` }, LicenseShortName: { value: licence } },
    }] }] } }) };
  }) as unknown as typeof fetch;
}

test('a photograph comes back with who took it and under what', async () => {
  const p = await destinationPhoto('Moab, Utah, USA', fakeWiki());
  assert.equal(p?.artist, 'Quintin Soloviev');
  assert.equal(p?.licence, 'CC BY 4.0');
  assert.equal(credit(p!), 'Quintin Soloviev · CC BY 4.0');
});

test('markup is stripped from the credit, which arrives as HTML', async () => {
  const p = await destinationPhoto('Moab', fakeWiki({ artist: 'Jane Doe' }));
  assert.equal(p?.artist, 'Jane Doe');
});

test('only Commons — anywhere else may be there under fair use', async () => {
  // Fair use is a claim about editorial context, not a licence to put a
  // picture on a card in a product.
  const p = await destinationPhoto('Moab', fakeWiki({ source: 'https://upload.wikimedia.org/wikipedia/en/3/3f/Poster.jpg' }));
  assert.equal(p, null);
});

test('no photographer, no photograph', async () => {
  // A picture without its credit is somebody's work used without saying
  // whose, so it is dropped rather than shown bare.
  const p = await destinationPhoto('Moab', fakeWiki({ artist: '' }));
  assert.equal(p, null);
});

test('a place with no page image keeps the gradient', async () => {
  const empty = (async () => ({ ok: true, json: async () => ({ query: { pages: [{}] } }) })) as unknown as typeof fetch;
  assert.equal(await destinationPhoto('Nowhereville', empty), null);
});

test('unreachable is not "no photograph of Charleston exists"', async () => {
  const dead = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal(await destinationPhoto('Charleston', dead), null);
});

/** Wikipedia with one page per title, and the map placing the town. */
function wikiByTitle(pages: Record<string, object>, place: { lat: string; lon: string; sub: string }) {
  return (async (url: string) => {
    const u = String(url);
    if (u.includes('nominatim')) {
      return { ok: true, json: async () => ([{ lat: place.lat, lon: place.lon, display_name: 'x', class: 'place', type: 'town', address: { country_code: 'us', 'ISO3166-2-lvl4': place.sub } }]) };
    }
    if (u.includes('prop=pageimages')) {
      const title = decodeURIComponent(/titles=([^&]+)/.exec(u)![1]);
      return { ok: true, json: async () => ({ query: { pages: [pages[title] ?? {}] } }) };
    }
    return { ok: true, json: async () => ({ query: { pages: [{ imageinfo: [{ descriptionurl: 'd', extmetadata: { Artist: { value: 'A Photographer' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }] } }) };
  }) as unknown as typeof fetch;
}
const img = (name: string) => ({ source: `https://upload.wikimedia.org/wikipedia/commons/x/${name}`, width: 1200, height: 800 });

test('"Moab" the ancient kingdom is not Moab, Utah — the article must be at the place', async () => {
  const fetchImpl = wikiByTitle({
    'Moab': { thumbnail: img('Kingdoms_of_Israel_and_Judah_map.svg'), pageimage: 'Kingdoms_of_Israel_and_Judah_map.svg', coordinates: [{ lat: 31.5, lon: 35.8 }] },
    'Moab, Utah': { thumbnail: img('Moab_Utah.jpg'), pageimage: 'Moab_Utah.jpg', coordinates: [{ lat: 38.57, lon: -109.55 }] },
  }, { lat: '38.5733', lon: '-109.5498', sub: 'US-UT' });
  const p = await destinationPhoto('Moab, US', fetchImpl);
  assert.match(String(p?.url), /Moab_Utah/);
});

test('a saint is not a city: a page with no coordinates is never the place', async () => {
  const fetchImpl = wikiByTitle({
    'St. Augustine': { thumbnail: img('Saint_Augustine_Portrait.jpg'), pageimage: 'Saint_Augustine_Portrait.jpg' },
    'St. Augustine, Florida': { thumbnail: img('St_Augustine_skyline.jpg'), pageimage: 'St_Augustine_skyline.jpg', coordinates: [{ lat: 29.89, lon: -81.31 }] },
  }, { lat: '29.8947', lon: '-81.3145', sub: 'US-FL' });
  const p = await destinationPhoto('St. Augustine, US', fetchImpl);
  assert.match(String(p?.url), /St_Augustine_skyline/);
});

test('nothing near the place means no photo, not the nearest wrong one', async () => {
  const fetchImpl = wikiByTitle({
    'Springfield': { thumbnail: img('Springfield_Illinois.jpg'), pageimage: 'Springfield_Illinois.jpg', coordinates: [{ lat: 39.8, lon: -89.65 }] },
  }, { lat: '37.2', lon: '-93.29', sub: 'US-MO' });
  assert.equal(await destinationPhoto('Springfield, US', fetchImpl), null);
});

// ── A flag is what a place is called, not what it looks like (2026-11-06) ──
import { looksLikeThePlace, cachedDestinationPhoto } from '../../lib/discovery/destination-photo.ts';

const FLAG = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5b/Flag_of_Hong_Kong.svg/1280px-Flag_of_Hong_Kong.svg.png';
function hongKong(p18: string | null) {
  const asked: string[] = [];
  const f = (async (url: string) => {
    const u = String(url); asked.push(u);
    if (u.includes('nominatim')) return { ok: true, json: async () => ([{ lat: '22.32', lon: '114.17', display_name: 'Hong Kong', class: 'place', type: 'city', address: { country_code: 'hk' } }]) };
    if (u.includes('prop=pageimages')) return { ok: true, json: async () => ({ query: { pages: [{ thumbnail: { source: FLAG, width: 1280, height: 853 }, pageimage: 'Flag_of_Hong_Kong.svg', coordinates: [{ lat: 22.3, lon: 114.2 }], pageprops: { wikibase_item: 'Q8646' } }] } }) };
    if (u.includes('wikidata.org')) return { ok: true, json: async () => ({ entities: { Q8646: { claims: p18 ? { P18: [{ rank: 'normal', mainsnak: { datavalue: { value: p18 } } }] } : {} } } }) };
    return { ok: true, json: async () => ({ query: { pages: [{ imageinfo: [{
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Hong_Kong_from_Victoria_Peak1.jpg',
      thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Hong_Kong_from_Victoria_Peak1.jpg/1200px-Hong_Kong_from_Victoria_Peak1.jpg',
      thumbwidth: 1200, thumbheight: 800,
      extmetadata: { Artist: { value: 'Mustang Joe' }, LicenseShortName: { value: 'CC0' } },
    }] }] } }) };
  }) as unknown as typeof fetch;
  return { f, asked };
}

test('a thumbnail of a flag is read by its original file, not its ".svg.png" ending', () => {
  assert.equal(looksLikeThePlace(FLAG), false);
  assert.equal(looksLikeThePlace('https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/Raleigh_Skyline.jpg/1280px-Raleigh_Skyline.jpg'), true);
});

test('an article that leads with its flag shows the place\'s own Wikidata photograph, credited', async () => {
  const { f, asked } = hongKong('Hong Kong from Victoria Peak1.jpg');
  const p = await destinationPhoto('Hong Kong, HK', f);
  assert.match(p!.url, /Victoria_Peak1\.jpg/);
  assert.equal(p!.artist, 'Mustang Joe');
  assert.ok(asked.some(u => u.includes('File:Hong_Kong_from_Victoria_Peak1.jpg')), 'the credit is for the picture shown, not the flag');
});

test('a flag with no photograph behind it keeps the gradient', async () => {
  assert.equal(await destinationPhoto('Hong Kong, HK', hongKong(null).f), null);
});

test('a flag kept before the check is asked about again', async () => {
  let wrote: any = null;
  const db = { from: () => ({
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: { url: FLAG, credit: 'x · y', source: null, width: 1, height: 1, checked_at: '2026-11-01T00:00:00Z' }, error: null }),
    upsert: async (row: any) => { wrote = row; return { error: null }; },
  }) };
  const got = await cachedDestinationPhoto(db, 'Hong Kong, HK', { fetchImpl: hongKong('Hong Kong from Victoria Peak1.jpg').f });
  assert.match(got!.url, /Victoria_Peak1/);
  assert.match(wrote.url, /Victoria_Peak1/);
});
