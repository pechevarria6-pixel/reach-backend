// ─── Two kinds of id for the same person ────────────────────────────────
// Clerk knows somebody as `user_2abc...`. Every table here knows them as a
// uuid. They are both strings, both truthy, and both look like an id at a
// glance — so a route that reaches for the wrong one does not crash. It
// writes a row keyed to nobody, or reads none and reports an empty account.
//
// The resolution belongs at the boundary and nowhere else: lib/auth.ts turns
// the Clerk id into the row once, and everything downstream uses `ctx.user.id`.
// Three routes used to do that resolution themselves, correctly, which is
// three chances to do it incorrectly later.
//
// This is the belt: a uuid is a shape, so the wrong id can be recognised
// rather than trusted.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID.test(value.trim());
}

/** Clerk's own shape, for saying which mistake was made rather than "invalid". */
export function looksLikeClerkId(value: unknown): boolean {
  return typeof value === 'string' && /^user_[A-Za-z0-9]+$/.test(value.trim());
}

/**
 * The app's id for a person, or a thrown error naming the confusion.
 *
 * Used where a Clerk id reaching the column would be silent — a filter that
 * matches nothing reads as an empty account, and an insert keyed to it reads
 * as somebody else's row.
 */
export function appUserId(value: unknown, field = 'user_id'): string {
  if (isUuid(value)) return String(value).trim();
  if (looksLikeClerkId(value)) {
    throw new Error(
      `${field} was given a Clerk id (${String(value).slice(0, 12)}…). `
      + 'Resolve it through requireUser() and pass ctx.user.id.',
    );
  }
  throw new Error(`${field} is not an id this app recognises`);
}
