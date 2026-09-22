import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors FIX_FOR in components/reach-app.jsx. Kept here because these are
// the exact sentences the booking providers return, and a reason that no
// longer routes anywhere is a screen that says what is wrong and offers
// nothing — which is the state this replaced.
const FIX_FOR = [
  { when: /name of whoever|date of birth|gender|passenger|traveller|traveler|essentials/i, section: 'flying' },
  { when: /home airport/i, section: 'flying' },
  { when: /passport|document/i, section: 'documents' },
];
const fixFor = (why: string) => FIX_FOR.find(f => f.when.test(String(why || ''))) ?? null;

test('the real refusals from production route somewhere', () => {
  // Verbatim from /api/plans/<id>/bookable against the live deployment.
  assert.equal(fixFor('We need the name of whoever the room is under before this can be booked.')?.section, 'flying');
  assert.equal(fixFor('add your home airport in Profile and we can price this flight')?.section, 'flying');
});

test('the traveller-essentials wordings all route to flying details', () => {
  for (const why of [
    "Marco hasn't given their date of birth yet",
    'every passenger needs a gender on file',
    'traveller details are missing for two people',
  ]) {
    assert.equal(fixFor(why)?.section, 'flying', `no route for: ${why}`);
  }
});

test('a reason nobody can act on gets no button', () => {
  // "No rates available" is not the traveller's fault and there is nothing in
  // Profile that fixes it. Offering a button would be worse than none.
  assert.equal(fixFor('No rates available'), null);
  assert.equal(fixFor('this trip has no dates yet'), null);
  assert.equal(fixFor(''), null);
});
