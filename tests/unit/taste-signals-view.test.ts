// Run with: npm run test:unit
//
// v_taste_signals (sql/user-taste-profile-2026-09-25.sql) promises that the
// inferred profile cannot learn anything the quiz marks PRIVATE. The first
// version of it kept dietary_needs out by column name and then copied
// users.quiz_answers in whole — which carries `dietary` — so the promise was
// broken one level down. Behaviour is exercised against a real Postgres in the
// migration harness; this test holds the part that drifts: a new PRIVATE key
// added to QuizAnswers must be stripped by the view too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../sql/user-taste-profile-2026-09-25.sql', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../../lib/traveler-profile.ts', import.meta.url), 'utf8');

const view = (() => {
  const a = sql.indexOf('create or replace view public.v_taste_signals as');
  const b = sql.indexOf('comment on view public.v_taste_signals');
  assert.ok(a >= 0 && b > a, 'the view is in the file');
  // Comments say what is left out and why; only the SQL itself counts here.
  return sql.slice(a, b).replace(/--.*$/gm, '');
})();

/** Keys of QuizAnswers whose doc comment starts with PRIVATE. */
function privateQuizKeys(): string[] {
  const body = profile.slice(profile.indexOf('export interface QuizAnswers'));
  const block = body.slice(0, body.indexOf('\n}'));
  return [...block.matchAll(/\/\*\*\s*PRIVATE\b[^*]*\*\/\s*(\w+)\??:/g)].map(m => m[1]);
}

/** Every `- array[...]` key list the view subtracts from a jsonb column. */
function strippedLists(): string[][] {
  return [...view.matchAll(/-\s*array\[([^\]]*)\]/g)]
    .map(m => [...m[1].matchAll(/'([^']+)'/g)].map(k => k[1]));
}

test('the quiz still marks its private answers, so this test has something to check', () => {
  const keys = privateQuizKeys();
  for (const k of ['dietary', 'dislikes', 'no_way_text', 'free_interests']) assert.ok(keys.includes(k), k);
});

test('both copies of the quiz answers in the view drop every PRIVATE key', () => {
  const lists = strippedLists();
  // users.quiz_answers and plan_preferences.answers.
  assert.equal(lists.length, 2, `two stripped copies, found ${lists.length}`);
  assert.match(view, /u\.quiz_answers\s*-\s*array\[/);
  assert.match(view, /pp\.answers\s*-\s*array\[/);
  for (const list of lists) {
    for (const k of privateQuizKeys()) assert.ok(list.includes(k), `${k} is stripped`);
    // "I eat everything" is a dietary answer too.
    assert.ok(list.includes('eat_everything'));
  }
});

test('no raw private or free-text column is selected', () => {
  for (const col of ['dietary_needs', 'trip_summary', 'summary_text', 'no_way_jose']) {
    assert.doesNotMatch(view, new RegExp(`\\b${col}\\b`), col);
  }
  // A bare quiz_answers / answers reference would be the whole object again.
  assert.doesNotMatch(view, /u\.quiz_answers(?!\s*-\s*array)/);
  assert.doesNotMatch(view, /pp\.answers(?!\s*-\s*array)/);
});

test('the deletion filter wraps every branch, not only the first', () => {
  assert.match(view, /\)\s*s\s+join public\.users du on du\.id = s\.user_id and du\.deletion_scheduled_at is null;\s*$/);
  assert.equal(view.match(/deletion_scheduled_at/g)?.length, 1);
});

test('a booking is only a signal for members who were on it', () => {
  const booked = view.slice(view.indexOf("'booked'"), view.indexOf('from public.events'));
  assert.match(booked, /not exists \(\s*select 1 from public\.item_optouts o/);
  assert.match(booked, /o\.item_ref = b\.id::text/);
  assert.match(booked, /o\.user_id = gm\.user_id/);
  assert.match(booked, /gm\.joined_at::date <= coalesce\(p\.end_date, p\.start_date, b\.created_at::date\) \+ 1/);
});
