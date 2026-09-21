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
    if (String(url).includes('prop=pageimages')) {
      return { ok: true, json: async () => ({ query: { pages: [{ thumbnail: { source, width: 1200, height: 900 }, pageimage }] } }) };
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
