// ─── What a card may say about price ─────────────────────────────────────
// Every venue and most events with no price read "Price at the door" — a
// claim that there is a door, a charge, and that it is paid there, about
// parks and trails as much as bars. And a price that was the venue's own
// words ("$15 adv / $20 dos") sat above "per person, all-in", which nobody
// had checked. Only what we know: their price as they wrote it, or where to
// find it, or that it is not listed.

export function priceLabel(f: { price?: string | null; provider?: string | null; url?: string | null }): {
  line: string; known: boolean; note: string | null;
} {
  const price = (f.price || '').trim();
  if (price) return { line: price, known: true, note: 'as listed' };
  if (f.provider === 'ticketmaster') return { line: 'Price on Ticketmaster', known: false, note: null };
  if (f.url) return { line: 'Price on their site', known: false, note: null };
  return { line: 'Price not listed', known: false, note: null };
}
