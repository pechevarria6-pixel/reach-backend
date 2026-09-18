// ─── What counts as a category worth showing ────────────────────────────
// Discover builds its filter pills from whatever categories come back, and
// a pill reading "Undefined" appeared in production between "Sports" and
// "Wine tasting". The cause was not a bug in our mapping: Ticketmaster's own
// word for an unclassified event is the literal string "Undefined". The
// guard that was meant to catch it, `|| 'Event'`, never fired, because a
// non-empty string is truthy.
//
// Any provider can send us one of these, so the rule lives in one place
// rather than being remembered at each call site.

/**
 * Words that are a provider saying "we don't know", not a category.
 *
 * Deliberately short. "Other" is not here: plenty of catalogues use it as a
 * real label, and dropping its pill would make those things harder to find
 * for the sake of tidiness. This list is only the ones that are machine
 * noise in any language — a null that became a string somewhere upstream.
 */
const NOT_A_CATEGORY = new Set(['undefined', 'null', 'nil', 'n/a', '-']);

/**
 * The category, or null when the value is a provider's way of saying it has
 * none. Null rather than a substitute, so the caller decides what an
 * unclassified thing should be called in its own context.
 */
export function usableCategory(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (NOT_A_CATEGORY.has(text.toLowerCase())) return null;
  return text;
}

/**
 * The filter pills for a set of items: every category that is real and has
 * something behind it, in alphabetical order. A tab with nothing under it is
 * a dead end, and a tab with no name is worse.
 */
export function visibleCategories(items: { category?: unknown }[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items ?? []) {
    const category = usableCategory(item?.category);
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => a.localeCompare(b));
}
