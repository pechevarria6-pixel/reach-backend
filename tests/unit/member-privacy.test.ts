// Run with: npm run test:unit
// Group members never see each other's email addresses (owner, 2026-11-22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withoutOthersEmails } from '../../lib/member-privacy.ts';

test("only the reader's own email survives", () => {
  const rows = [
    { user_id: 'me', role: 'admin', users: { id: 'me', name: 'Me', email: 'me@x.com', avatar_url: null } },
    { user_id: 'them', role: 'member', users: { id: 'them', name: 'Them', email: 'them@x.com', avatar_url: 'a.png' } },
  ];
  const out = withoutOthersEmails(rows, 'me');
  assert.equal(out[0].users && !Array.isArray(out[0].users) ? out[0].users.email : null, 'me@x.com');
  assert.ok(!JSON.stringify(out).includes('them@x.com'));
  assert.equal((out[1].users as { name: string }).name, 'Them', 'the name and picture stay');
  assert.equal(rows[1].users.email, 'them@x.com', 'the input is not mutated');
  assert.deepEqual(withoutOthersEmails(null, 'me'), []);
  assert.ok(!JSON.stringify(withoutOthersEmails([{ users: [{ id: 'x', email: 'x@x.com' }] }], 'me')).includes('x@x.com'));
});

test('every route that hands member rows to a screen strips them', () => {
  assert.match(readFileSync('app/api/groups/route.ts', 'utf8'), /group_members: withoutOthersEmails\(g\.group_members, user\.id\)/);
  assert.match(readFileSync('app/api/groups/[id]/route.ts', 'utf8'), /members: withoutOthersEmails\(membersRes\.data, user\.id\)/);
  assert.match(readFileSync('app/api/plans/[planId]/route.ts', 'utf8'), /members: withoutOthersEmails\(membersRes\.data, user\.id\)/);
});
