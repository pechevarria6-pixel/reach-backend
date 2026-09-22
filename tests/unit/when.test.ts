import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen } from '../../lib/discovery/when.ts';

const TODAY = '2026-09-22';

test('a one-off date in the text becomes a date', () => {
  // Verbatim from discovery_events, where starts_on is null.
  assert.equal(parseWhen('Fri, Sep 25', TODAY).on, '2026-09-25');
  assert.equal(parseWhen('Sat, Sep 26', TODAY).on, '2026-09-26');
});

test('the weekday is the check on the year, not decoration', () => {
  // Sep 25 is a Friday in 2026 and a Thursday in 2025. Guessing the year
  // wrong puts a festival on the wrong day for ever, so a candidate is only
  // taken when the day it falls on is the day the text names.
  const good = parseWhen('Fri, Sep 25', TODAY);
  assert.equal(good.on, '2026-09-25');
  assert.equal(good.confirmed, true);

  // The same date claimed as a Monday agrees with no nearby year.
  assert.equal(parseWhen('Mon, Sep 25', TODAY).on, null);
});

test('a date with no weekday is taken but not called confirmed', () => {
  const p = parseWhen('Nov 06', TODAY);
  assert.equal(p.on, '2026-11-06');
  assert.equal(p.confirmed, false, 'nothing checked it');
});

test('a date already gone rolls to next year', () => {
  // A listing harvested in December saying "Jan 4" means the January after.
  const p = parseWhen('Jan 4', '2026-12-20');
  assert.equal(p.on, '2027-01-04');
});

test('an explicit year is believed, and still checked when it can be', () => {
  // Sep 25 2025 is a Thursday; Sep 25 2026 is a Friday.
  //
  // With no weekday in the text there is nothing to check against, so the
  // stated year stands and the result says it was not confirmed. This
  // assertion was written the other way round first — expecting the parser
  // to refuse a date nobody had contradicted — which would have been the
  // check inventing a disagreement.
  const bare = parseWhen('Sep 25, 2025', TODAY);
  assert.equal(bare.on, '2025-09-25');
  assert.equal(bare.confirmed, false);

  // Named and agreeing.
  const agrees = parseWhen('Thu, Sep 25, 2025', TODAY);
  assert.equal(agrees.on, '2025-09-25');
  assert.equal(agrees.confirmed, true);

  // Named and disagreeing: refused, even though the year is explicit. A
  // listing that contradicts itself is not a date.
  assert.equal(parseWhen('Fri, Sep 25, 2025', TODAY).on, null);
});

test('a weekly thing is weekly, not a date', () => {
  for (const [text, idx] of [
    ['Mondays, 4:00-5:00pm', 1],
    ['every Wednesday at 7', 3],
    ['Friday nights', 5],
    ['each Sunday', 0],
  ] as [string, number][]) {
    const p = parseWhen(text, TODAY);
    assert.equal(p.everyWeekdayIndex, idx, `wrong day for: ${text}`);
    assert.equal(p.on, null, `${text} is not a single date`);
  }
});

test('a real example from the table, start to finish', () => {
  // "Pub Trivia Night — every Wednesday Night at 7 PM" is the venue_note on
  // a live itinerary row. Wednesday is 3.
  assert.equal(parseWhen('Pub Trivia Night — every Wednesday Night at 7 PM', TODAY).everyWeekdayIndex, 3);
});

test('nonsense is refused rather than guessed at', () => {
  assert.equal(parseWhen('Feb 30', TODAY).on, null);
  assert.equal(parseWhen('by appointment', TODAY).on, null);
  assert.equal(parseWhen('', TODAY).on, null);
  assert.equal(parseWhen(null, TODAY).on, null);
  // A bad "today" cannot be reasoned from.
  assert.equal(parseWhen('Fri, Sep 25', 'not-a-date').on, null);
});
