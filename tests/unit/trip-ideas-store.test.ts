import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveIdeas, attachDays } from '../../lib/trip-ideas-store.ts';
import { ideasFrom } from '../../lib/trip-vote.ts';

// One plans row in memory, and enough of the PostgREST builder for what
// saveIdeas and attachDays ask of it: eq, in, is, and the ->> path filters
// on trip_options, applied in the same statement as the update.
function fakePlans(row: Record<string, any>) {
  const field = (r: Record<string, any>, col: string) => {
    const m = /^trip_options->>(\w+)$/.exec(col);
    if (!m) return r[col];
    const v = r.trip_options?.[m[1]];
    return v == null ? null : String(v);
  };
  let writes = 0;
  const db = {
    row,
    get writes() { return writes; },
    from() {
      const filters: Array<(r: Record<string, any>) => boolean> = [];
      let patch: Record<string, any> | null = null;
      const q: any = {
        select() { return q; },
        update(p: Record<string, any>) { patch = p; return q; },
        eq(col: string, v: unknown) { filters.push(r => field(r, col) === v); return q; },
        in(col: string, vs: unknown[]) { filters.push(r => vs.includes(field(r, col))); return q; },
        is(col: string, v: unknown) { filters.push(r => (field(r, col) ?? null) === v); return q; },
        async maybeSingle() {
          const hit = filters.every(f => f(row));
          if (patch) {
            if (!hit) return { data: null, error: null };
            Object.assign(row, patch); writes++;
            return { data: { id: row.id }, error: null };
          }
          return { data: hit ? { ...row } : null, error: null };
        },
      };
      return q;
    },
  };
  return db;
}

const meta = { set: 'S1', foundBy: 'u2', foundAt: '2026-09-23T10:00:00Z', mode: 'trip' as const };
const ideas = ideasFrom([{ destination: 'Lisbon' }, { destination: 'Porto' }, { destination: 'Seville' }], meta);

test('ideas are not saved onto a cancelled trip, and it is not reopened for a vote', async () => {
  const db = fakePlans({ id: 'p1', destination_style: 'undecided', status: 'cancelled', trip_options: null });
  const r = await saveIdeas(db as never, 'p1', ideas, null);
  assert.equal(r.outcome, 'taken');
  assert.equal(db.row.status, 'cancelled');
  assert.equal(db.row.trip_options, null);
});

test('ideas are saved onto a trip still waiting on the group, and the vote opens', async () => {
  const db = fakePlans({ id: 'p1', destination_style: 'undecided', status: 'planning', trip_options: null });
  const r = await saveIdeas(db as never, 'p1', ideas, null);
  assert.equal(r.outcome, 'saved');
  assert.equal(db.row.status, 'voting');
  assert.deepEqual(db.row.vote_options, ['Lisbon', 'Porto', 'Seville']);
});

test('a member writes days onto an idea that has none', async () => {
  const db = fakePlans({ id: 'p1', destination_style: 'undecided', status: 'voting', trip_options: ideas });
  assert.equal(await attachDays(db as never, 'p1', 'S1:1', [{ day: 1 }]), true);
  assert.deepEqual(db.row.trip_options.options[0].itinerary, [{ day: 1 }]);
});

test('a member cannot replace days already written; the organiser can', async () => {
  const withDays = { ...ideas, options: ideas.options.map((o, i) => (i === 0 ? { ...o, itinerary: [{ day: 'first' }] } : o)) };
  const db = fakePlans({ id: 'p1', destination_style: 'undecided', status: 'voting', trip_options: withDays });
  assert.equal(await attachDays(db as never, 'p1', 'S1:1', [{ day: 'again' }]), false);
  assert.deepEqual(db.row.trip_options.options[0].itinerary, [{ day: 'first' }]);
  assert.equal(db.writes, 0);

  assert.equal(await attachDays(db as never, 'p1', 'S1:1', [{ day: 'again' }], { organiser: true }), true);
  assert.deepEqual(db.row.trip_options.options[0].itinerary, [{ day: 'again' }]);
});
