import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialable } from '../../lib/discovery/phone.ts';

test("Bella Monica's stored number dials nobody, so it is not kept", () => {
  assert.equal(dialable('3121103'), null);
});
test('the formats already in the table become one', () => {
  assert.equal(dialable('9198388595'), '+19198388595');
  assert.equal(dialable('+19102462106'), '+19102462106');
  assert.equal(dialable('19102462496'), '+19102462496');
  assert.equal(dialable('(919) 838-8595'), '+19198388595');
});
test('OSM lists can carry two numbers; the first is used', () => {
  assert.equal(dialable('+1 435-259-3035;+1 435-259-0000'), '+14352593035');
});
test('an international number is kept only in E.164', () => {
  assert.equal(dialable('+52 322 222 0000', 'MX'), '+523222220000');
  assert.equal(dialable('322 222 0000', 'MX'), null);
});
