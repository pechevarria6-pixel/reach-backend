import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesOf, featureRecords, tooManyUnreadable } from '../../lib/discovery/feature-lines.ts';

async function* chunks(...parts: string[]) { for (const p of parts) yield p; }
const collect = async <T>(g: AsyncIterable<T>) => { const out: T[] = []; for await (const x of g) out.push(x); return out; };

test('a carriage return inside a name does not cut the record in two', async () => {
  // What osmium wrote for the Italian and Russian records: a raw \r inside a value.
  const rec = (id: number, name: string) => `{"type":"Feature","id":${id},"properties":{"name":"${name}"}}`;
  const bad = { count: 0, sample: null };
  const out = await collect(featureRecords<{ id: number; properties: { name: string } }>(
    linesOf(chunks(rec(1, 'Trattoria\rda Mario') + '\n' + rec(2, 'Bar') + '\n')), bad));
  assert.deepEqual(out.map(f => f.id), [1, 2]);
  assert.equal(out[0].properties.name, 'Trattoria da Mario');
  assert.equal(bad.count, 0);
});

test('a record split across chunks is put back together, and the last line needs no newline', async () => {
  const lines = await collect(linesOf(chunks('{"a":', '1}\n{"b"', ':2}')));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test('a record that still cannot be read is skipped and counted, not fatal', async () => {
  const bad = { count: 0, sample: null as string | null };
  const out = await collect(featureRecords(linesOf(chunks('{"ok":1}\n{"broken":\n{"ok":2}\n')), bad));
  assert.equal(out.length, 2);
  assert.equal(bad.count, 1);
  assert.match(String(bad.sample), /broken/);
});

test('the record separator geojsonseq may use is stripped', async () => {
  const bad = { count: 0, sample: null };
  const out = await collect(featureRecords(linesOf(chunks('\x1e{"x":1}\n')), bad));
  assert.deepEqual(out, [{ x: 1 }]);
});

test('a stray unreadable record is tolerated, a mostly broken export is not', () => {
  assert.equal(tooManyUnreadable({ count: 1, sample: null }, 30000), false);
  assert.equal(tooManyUnreadable({ count: 40, sample: null }, 30000), true);
  assert.equal(tooManyUnreadable({ count: 6, sample: null }, 100), true);
  assert.equal(tooManyUnreadable({ count: 0, sample: null }, 0), false);
});
