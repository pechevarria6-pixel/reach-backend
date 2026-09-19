import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  missingFor, isReady, readinessOf, blockingMessage, validBirthDate, maskNumber,
} from '../../lib/essentials.ts';

// A fixed today, so a test written in September still passes in March.
const TODAY = new Date('2026-09-18T12:00:00Z');

const COMPLETE = {
  firstName: 'Priya',
  lastName: 'Raman',
  dateOfBirth: '1991-04-02',
  gender: 'female',
  // The airline's requirement: a real order came back "Field 'phone_number'
  // can't be blank", so a record without one is not a complete record.
  phone: '+1 555 123 4567',
  knownTravelerNumber: 'TT1234567',
  homeAirport: 'RDU',
};

test('a complete record is ready', () => {
  assert.equal(isReady(COMPLETE, TODAY), true);
  assert.deepEqual(missingFor(COMPLETE, TODAY), []);
});

test('an empty record needs all four', () => {
  assert.deepEqual(missingFor(null, TODAY), ['legal name', 'date of birth', 'gender', 'phone number']);
});

test('no phone is not ready, however complete the rest is', () => {
  assert.deepEqual(missingFor({ ...COMPLETE, phone: null }, TODAY), ['phone number']);
  // Half a number is nobody's number.
  assert.deepEqual(missingFor({ ...COMPLETE, phone: '555' }, TODAY), ['phone number']);
});

test('half a name is not a name — a ticket carries both', () => {
  assert.deepEqual(missingFor({ ...COMPLETE, lastName: '  ' }, TODAY), ['legal name']);
});

test('declining to say is an answer, and it is not a blank form', () => {
  // It cannot go through automatic booking — see duffelGender — but that
  // booking is made by a person rather than failed, so somebody who has told
  // us where they stand is not left staring at an unfinished form for ever.
  assert.deepEqual(missingFor({ ...COMPLETE, gender: 'unspecified' }, TODAY), []);
});

test('x is a real passport marker and is accepted', () => {
  assert.equal(isReady({ ...COMPLETE, gender: 'x' }, TODAY), true);
});

test('a date of birth has to be a real past date', () => {
  assert.equal(validBirthDate('1991-04-02', TODAY), true);
  assert.equal(validBirthDate('2026-12-01', TODAY), false, 'not yet born');
  assert.equal(validBirthDate('1991-02-30', TODAY), false, 'no such day');
  assert.equal(validBirthDate('91-04-02', TODAY), false, 'two-digit year');
  assert.equal(validBirthDate('1024-04-02', TODAY), false, 'century slip');
  assert.equal(validBirthDate('', TODAY), false);
  assert.equal(validBirthDate(null, TODAY), false);
});

// The visibility rule, which is the whole point of this module.
test('readiness carries status and never a value', () => {
  const r = readinessOf('u1', 'Priya', COMPLETE, TODAY);
  assert.deepEqual(r, { userId: 'u1', name: 'Priya', ready: true, missing: [] });

  // Serialised and searched, because a leak would arrive as an extra key
  // somebody added later, not as a deliberate one.
  const json = JSON.stringify(readinessOf('u1', 'Priya', COMPLETE, TODAY));
  for (const secret of ['1991-04-02', 'female', 'TT1234567', 'Raman', 'RDU']) {
    assert.equal(json.includes(secret), false, `readiness leaked ${secret}`);
  }
});

test('readiness names what is missing, not what was given', () => {
  const r = readinessOf('u2', 'Marco', { firstName: 'Marco', lastName: 'Diaz' }, TODAY);
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ['date of birth', 'gender', 'phone number']);
});

test('the group is told who to ask, by name', () => {
  const list = [
    readinessOf('u1', 'Priya', COMPLETE, TODAY),
    readinessOf('u2', 'Marco', null, TODAY),
    readinessOf('u3', 'Sam', null, TODAY),
  ];
  assert.equal(
    blockingMessage(list),
    'Marco and Sam need to add their travel details before flights can be booked.',
  );
  assert.equal(
    blockingMessage([list[0], list[1]]),
    'Marco needs to add their travel details before flights can be booked.',
  );
  assert.equal(blockingMessage([list[0]]), null, 'nobody blocking means no message');
});

test('a document number shows four characters at most', () => {
  assert.deepEqual(maskNumber('TT1234567'), { present: true, last4: '4567' });
  assert.deepEqual(maskNumber(null), { present: false });
});
