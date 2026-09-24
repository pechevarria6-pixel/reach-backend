// ─── Somewhere to look, when the plan names no place ─────────────────────
// A line that says "book a cooking class" or "dinner near the waterfront,
// seafood" is marked book-ahead, and with no named place it offered nothing
// to press: a checklist item that tells you to book, with nowhere to book
// it. 26 of the lines in saved plans were exactly that on 2026-09-24.
//
// These are searches on real services, offered as somewhere to look — the
// same honesty as a ticket line's "Also try StubHub". Reach has not asked
// any of them whether anything is free and never implies that it has. A
// line that names a place never gets these; its own site and number are the
// answer.

export interface FindLink { label: string; url: string }

const enc = encodeURIComponent;

/** The words worth searching for, from a line written as a sentence. */
function gist(title: string): string {
  return String(title || '')
    .replace(/\b(book|reserve|look for|find|grab|head to|have|try|ideally|somewhere|a|an|the|with|for|near|then|and|follow(ed)? (it|by)|in mind)\b/gi, ' ')
    .replace(/[—–,.;:()]/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
}

export function findLinks(input: { title?: string | null; type?: string | null; city?: string | null }): FindLink[] {
  const city = String(input.city || '').trim();
  const what = gist(String(input.title || ''));
  if (!what) return [];
  const q = city ? `${what} ${city}` : what;
  const maps = { label: 'Search the map', url: `https://www.google.com/maps/search/?api=1&query=${enc(q)}` };
  if (input.type === 'restaurant') {
    return [
      { label: 'Find a table on OpenTable', url: `https://www.opentable.com/s?term=${enc(q)}` },
      maps,
    ];
  }
  if (input.type === 'activity' || input.type === 'event') {
    return [
      { label: 'Search Viator', url: `https://www.viator.com/searchResults/all?text=${enc(q)}` },
      maps,
    ];
  }
  return [maps];
}
