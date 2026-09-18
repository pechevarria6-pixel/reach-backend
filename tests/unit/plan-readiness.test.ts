import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answeredStandingQuiz, firstNameOf, waitingSentence } from '../../lib/plan-readiness.ts';

test('somebody who told us anything has had their say', () => {
  assert.equal(answeredStandingQuiz({ cuisines: ['thai'] }), true);
  assert.equal(answeredStandingQuiz({ budget_range: 'mid' }), true);
  assert.equal(answeredStandingQuiz({ no_way_jose: ['heights'] }), true);
  assert.equal(answeredStandingQuiz({ drink_style: 'wine' }), true);
});

test('empty answers are not answers', () => {
  assert.equal(answeredStandingQuiz({ cuisines: [], music_genres: [] }), false);
  assert.equal(answeredStandingQuiz({}), false);
  assert.equal(answeredStandingQuiz(null), false);
  assert.equal(answeredStandingQuiz(undefined), false);
});

test('a first name is what the group gets told', () => {
  assert.equal(firstNameOf('Marco Diaz'), 'Marco');
  assert.equal(firstNameOf('Priya'), 'Priya');
  assert.equal(firstNameOf('  '), 'someone');
  assert.equal(firstNameOf(''), 'someone');
});

test('the group is told who it is waiting on, by name', () => {
  assert.equal(
    waitingSentence(['Marco']),
    "Votes open when everyone's in — waiting on Marco.",
  );
  assert.equal(
    waitingSentence(['Marco', 'Sam']),
    "Votes open when everyone's in — waiting on Marco and Sam.",
  );
  assert.equal(
    waitingSentence(['Marco', 'Sam', 'Priya']),
    "Votes open when everyone's in — waiting on Marco, Sam and Priya.",
  );
  assert.equal(waitingSentence([]), null, 'nobody outstanding means nothing to say');
});
