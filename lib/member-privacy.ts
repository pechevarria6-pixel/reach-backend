// Group members do not see each other's email addresses (owner, 2026-11-22).
// Three routes hand the group's member rows to the screen — the groups list,
// one group, one plan — and each selected users(email) for everybody. A
// person's own row keeps theirs; everyone else's goes before the response.
// Inviting by email still works: that is the inviter typing an address they
// already have, and the invite list shows only what the inviter typed.

type UserBit = { id?: unknown; email?: unknown; [k: string]: unknown } | null | undefined;
type MemberRow = { user_id?: unknown; users?: UserBit | UserBit[]; [k: string]: unknown };

const strip = (u: UserBit, me: string): UserBit => {
  if (!u || typeof u !== 'object') return u;
  if (String(u.id ?? '') === me) return u;
  const { email: _hidden, ...rest } = u;
  return rest;
};

/** Member rows with every email but the reader's own removed. */
export function withoutOthersEmails<T extends MemberRow>(rows: T[] | null | undefined, me: string): T[] {
  return (rows ?? []).map(m => {
    if (!m || typeof m !== 'object' || !('users' in m)) return m;
    const users = Array.isArray(m.users) ? m.users.map(u => strip(u, me)) : strip(m.users, me);
    return { ...m, users } as T;
  });
}
