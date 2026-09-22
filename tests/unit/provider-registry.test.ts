import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Quoting used Duffel and approval used Kiwi, which invents a date of birth.
// The provider that prices a thing must be the one that books it.
const ROUTES = ['app/api/bookings/route.ts', 'app/api/bookings/[id]/approve/route.ts'];

test('both booking routes take their providers from the one registry', () => {
  for (const r of ROUTES) {
    const src = readFileSync(r, 'utf8');
    assert.match(src, /from '@\/lib\/booking\/registry'/, `${r} does not import the registry`);
    assert.doesNotMatch(src, /const PROVIDERS\s*:/, `${r} defines its own provider map`);
    assert.doesNotMatch(src, /kiwiFlights/, `${r} still names Kiwi`);
  }
});

test('the registry books flights with Duffel', () => {
  const src = readFileSync('lib/booking/registry.ts', 'utf8');
  assert.match(src, /flight:\s*duffelFlights/);
});
