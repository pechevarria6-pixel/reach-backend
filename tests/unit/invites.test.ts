// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, newInviteToken, claimInvitesFor } from '../../lib/invites.ts';

test('emails normalise to a single comparable form', () => {
  assert.equal(normalizeEmail('  Bob@Example.COM '), 'bob@example.com');
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(42), '');
});

test('invite tokens are unguessable and url-safe', () => {
  const a = newInviteToken();
  const b = newInviteToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32, `token too short: ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'must survive a URL path without escaping');
});

// ── A stub standing in for the Supabase query builder ────────────────────
// Only the handful of chained calls lib/invites.ts actually makes.
function makeDb(state: {
  invites: any[];
  members: { group_id: string; user_id: string }[];
}) {
  const calls: string[] = [];
  const api = (table: string) => {
    const filters: Record<string, any> = {};
    const builder: any = {
      select() { return builder; },
      eq(col: string, val: any) { filters[col] = val; return builder; },
      in(col: string, vals: any[]) { filters[`${col}__in`] = vals; return builder; },
      maybeSingle() {
        if (table === 'group_members') {
          const hit = state.members.find(
            m => m.group_id === filters.group_id && m.user_id === filters.user_id
          );
          return Promise.resolve({ data: hit || null });
        }
        return Promise.resolve({ data: null });
      },
      insert(row: any) {
        calls.push(`insert:${table}`);
        if (table === 'group_members') state.members.push(row);
        return Promise.resolve({ error: null });
      },
      update(patch: any) {
        calls.push(`update:${table}:${patch.status}`);
        const target = { ...filters };
        return {
          eq(col: string, val: any) {
            for (const inv of state.invites) {
              if (inv.id === val) Object.assign(inv, patch);
            }
            return Promise.resolve({ error: null });
          },
          in(col: string, vals: any[]) {
            for (const inv of state.invites) {
              if (vals.includes(inv.id)) Object.assign(inv, patch);
            }
            return Promise.resolve({ error: null });
          },
          then(res: any) { return Promise.resolve({ error: null }).then(res); },
        };
      },
      then(resolve: any) {
        if (table === 'group_invites') {
          const rows = state.invites.filter(
            i => i.email === filters.email && i.status === filters.status
          );
          return Promise.resolve({ data: rows }).then(resolve);
        }
        return Promise.resolve({ data: [] }).then(resolve);
      },
    };
    return builder;
  };
  return { from: api, calls } as any;
}

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

test('a live invite becomes a membership', async () => {
  const state = {
    invites: [{ id: 'i1', group_id: 'g1', email: 'bob@example.com', role: 'member', status: 'pending', expires_at: future }],
    members: [] as any[],
  };
  const db = makeDb(state);
  const res = await claimInvitesFor(db, 'u-bob', 'Bob@Example.com');

  assert.deepEqual(res.joined, ['g1']);
  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].user_id, 'u-bob');
  assert.equal(state.invites[0].status, 'accepted');
});

test('claiming twice does not duplicate the membership', async () => {
  const state = {
    invites: [{ id: 'i1', group_id: 'g1', email: 'bob@example.com', role: 'member', status: 'pending', expires_at: future }],
    members: [] as any[],
  };
  const db = makeDb(state);
  await claimInvitesFor(db, 'u-bob', 'bob@example.com');
  const second = await claimInvitesFor(db, 'u-bob', 'bob@example.com');

  assert.deepEqual(second.joined, [], 'invite is no longer pending');
  assert.equal(state.members.length, 1);
});

test('an expired invite is retired, not honoured', async () => {
  const state = {
    invites: [{ id: 'i1', group_id: 'g1', email: 'bob@example.com', role: 'member', status: 'pending', expires_at: past }],
    members: [] as any[],
  };
  const db = makeDb(state);
  const res = await claimInvitesFor(db, 'u-bob', 'bob@example.com');

  assert.deepEqual(res.joined, []);
  assert.equal(state.members.length, 0);
  assert.equal(state.invites[0].status, 'expired');
});

test('someone already in the group is reported, not re-added', async () => {
  const state = {
    invites: [{ id: 'i1', group_id: 'g1', email: 'bob@example.com', role: 'member', status: 'pending', expires_at: future }],
    members: [{ group_id: 'g1', user_id: 'u-bob' }],
  };
  const db = makeDb(state);
  const res = await claimInvitesFor(db, 'u-bob', 'bob@example.com');

  assert.deepEqual(res.joined, []);
  assert.deepEqual(res.alreadyIn, ['g1']);
  assert.equal(state.members.length, 1);
  assert.equal(state.invites[0].status, 'accepted');
});

test('no email or no user is a no-op, never a throw', async () => {
  const db = makeDb({ invites: [], members: [] });
  assert.deepEqual(await claimInvitesFor(db, 'u-bob', ''), { joined: [], alreadyIn: [] });
  assert.deepEqual(await claimInvitesFor(db, '', 'bob@example.com'), { joined: [], alreadyIn: [] });
});

test('one address can claim invites to several groups at once', async () => {
  const state = {
    invites: [
      { id: 'i1', group_id: 'g1', email: 'bob@example.com', role: 'member', status: 'pending', expires_at: future },
      { id: 'i2', group_id: 'g2', email: 'bob@example.com', role: 'admin', status: 'pending', expires_at: future },
    ],
    members: [] as any[],
  };
  const db = makeDb(state);
  const res = await claimInvitesFor(db, 'u-bob', 'bob@example.com');

  assert.deepEqual(res.joined.sort(), ['g1', 'g2']);
  assert.equal(state.members.find(m => m.group_id === 'g2')?.role, 'admin');
});
