import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dressPicks } from '../../lib/recommendations/dress.ts';

const pick = (city: string) => ({ title: `A weekend in ${city}`, destination: { city, country: 'US', label: city } });
const db = {} as never;

test('a card gets its place\'s photo with the credit, and its best months as averages', async () => {
  const [p] = await dressPicks(db, [pick('Moab')], {
    photo: async () => ({ url: 'https://upload.wikimedia.org/x/Moab.jpg', credit: 'Quintin Soloviev · CC BY 4.0' }),
    climate: async () => ({ climate: { best: 'Best weather in Moab: April–May, September–October', credit: 'NASA POWER 1981–2020 averages for the area, not a forecast' } }),
  });
  assert.equal(p.photo?.credit, 'Quintin Soloviev · CC BY 4.0');
  assert.match(String(p.photo?.alt), /Moab/);
  assert.match(String(p.weather?.line), /April–May/);
  assert.match(String(p.weather?.credit), /not a forecast/);
});

test('no credit, no photo; nothing held, no weather line', async () => {
  const [p] = await dressPicks(db, [pick('Nowhere')], {
    photo: async () => ({ url: 'https://upload.wikimedia.org/x/a.jpg', credit: '' }),
    climate: async () => ({ climate: null }),
  });
  assert.equal(p.photo, null);
  assert.equal(p.weather, null);
});

test('a slow lookup costs the card its photo, never Home its cards', async () => {
  const started = Date.now();
  const out = await dressPicks(db, [pick('Raleigh'), pick('Moab')], {
    photo: () => new Promise(() => {}),
    climate: async () => { throw new Error('down'); },
    deadlineMs: 50,
  });
  assert.equal(out.length, 2);
  assert.ok(Date.now() - started < 1000);
  assert.equal(out[0].photo, null);
  assert.equal(out[0].weather, null);
});
