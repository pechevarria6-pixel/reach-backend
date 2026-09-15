// ─── Rules about people, not about providers ─────────────────────────────
// This lived in the Yelp module, which meant every other source had to
// import Yelp in order to respect somebody's hard nos.

/**
 * Anything a hard no matches never reaches the screen, whatever it scored.
 *
 * Whole words only. A plain substring test rules out a Departures Bar for
 * somebody who said no to art, and a cartwheel class along with it — which is
 * the worst way for this to fail, because the person never sees what was
 * taken away or why.
 */
export function notRuledOut(text: string, avoid: string[]): boolean {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return !avoid.some(raw => {
    const a = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (a.length < 3) return false;
    return hay.includes(` ${a} `);
  });
}
