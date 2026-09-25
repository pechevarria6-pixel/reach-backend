// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  venmoLinks, cashAppLink, zelleContact, settleOptions, amountOf, venmoHandle, cashtag,
} from '../../lib/settle-links.ts';

test("Venmo opens on the payee's handle with the amount and the note — the spec's own URL", () => {
  const v = venmoLinks({ handle: 'sam-ortiz', amountCents: 4200, note: 'Cabo trip' });
  assert.deepEqual(v, {
    app: 'venmo://paycharge?txn=pay&recipients=sam-ortiz&amount=42.00&note=Cabo%20trip',
    web: 'https://venmo.com/sam-ortiz?txn=pay&amount=42.00&note=Cabo%20trip',
  });
});

test('a handle typed with its @ is the same handle', () => {
  assert.equal(venmoLinks({ handle: '@sam-ortiz', amountCents: 4200, note: 'Cabo trip' })?.app,
    'venmo://paycharge?txn=pay&recipients=sam-ortiz&amount=42.00&note=Cabo%20trip');
});

test('Cash App is the cashtag and the amount', () => {
  assert.equal(cashAppLink({ cashtag: 'SamO', amountCents: 4200 }), 'https://cash.app/$SamO/42.00');
  assert.equal(cashAppLink({ cashtag: '$SamO', amountCents: 1805 }), 'https://cash.app/$SamO/18.05');
});

test('amounts are dollars and two places of cents, and only a real debt is one', () => {
  assert.equal(amountOf(4200), '42.00');
  assert.equal(amountOf(5), '0.05');
  assert.equal(amountOf(123456), '1234.56');
  for (const bad of [0, -100, 42.5, NaN, '4200', null]) assert.equal(amountOf(bad), null, String(bad));
});

test('a note is encoded, not able to add parameters of its own', () => {
  const v = venmoLinks({ handle: 'sam-ortiz', amountCents: 100, note: 'Tacos & beer&amount=9999' });
  assert.ok(v);
  assert.equal(new URL(v.web).searchParams.get('amount'), '1.00');
  assert.equal(new URL(v.web).searchParams.get('note'), 'Tacos & beer&amount=9999');
});

test('no note is no note parameter, not an empty one', () => {
  assert.equal(venmoLinks({ handle: 'sam-ortiz', amountCents: 100 })?.web, 'https://venmo.com/sam-ortiz?txn=pay&amount=1.00');
});

test('a handle we cannot read is no link at all, so the screen asks for one', () => {
  for (const bad of ['', 'sam', 'sam ortiz', 'sam/../x', '@', null, undefined, 42]) {
    assert.equal(venmoHandle(bad), null, String(bad));
    assert.equal(venmoLinks({ handle: bad, amountCents: 4200 }), null, String(bad));
  }
  for (const bad of ['', '$', '1234', 'sam o', 'x'.repeat(21)]) {
    assert.equal(cashtag(bad), null, bad);
    assert.equal(cashAppLink({ cashtag: bad, amountCents: 4200 }), null, bad);
  }
});

test('Zelle has no link: an email or a phone to copy, and nothing else', () => {
  assert.deepEqual(zelleContact(' sam@example.com '), { kind: 'email', value: 'sam@example.com' });
  assert.deepEqual(zelleContact('(555) 010-1234'), { kind: 'phone', value: '(555) 010-1234' });
  assert.deepEqual(zelleContact('+1 555 010 1234'), { kind: 'phone', value: '+1 555 010 1234' });
  for (const bad of ['sam', '555-1234', 'sam@', '', null]) assert.equal(zelleContact(bad), null, String(bad));
  const all = settleOptions({ amountCents: 4200, zelle: 'sam@example.com' });
  assert.equal(all.venmo, null);
  assert.equal(all.cashApp, null);
  assert.ok(!JSON.stringify(all.zelle).includes('://'), 'no pretend link');
});

test('someone who gave no handles has no ways to pay listed — never a broken one', () => {
  assert.deepEqual(settleOptions({ amountCents: 4200 }), { venmo: null, cashApp: null, zelle: null });
  // Nor for a line that is not a debt.
  assert.deepEqual(settleOptions({ amountCents: 0, venmo: 'sam-ortiz', cashtag: 'SamO', zelle: 'sam@example.com' }),
    { venmo: null, cashApp: null, zelle: null });
});
