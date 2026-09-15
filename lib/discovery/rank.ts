import type { Finding } from './types.ts';

/**
 * Something found because of an interest outranks something found by being
 * nearby. That is the whole point of asking what somebody is into: a pottery
 * studio they will actually go to beats a stadium show they will not, and
 * sorting by distance or date buries it every time.
 */
export function rank(findings: Finding[], interests: string[]): Finding[] {
  const wanted = interests.map(i => i.toLowerCase());
  const score = (f: Finding) => {
    let s = 0;
    if (f.because) s += 100;                       // found because of them
    const hay = `${f.title} ${f.category} ${f.meta}`.toLowerCase();
    if (wanted.some(w => w.length > 2 && hay.includes(w))) s += 40;
    if (f.price) s += 5;                           // a price is a kindness
    if (f.date) s += 3;                            // something happening beats something open
    return s;
  };
  // Interleave by source so one prolific provider cannot take the whole page.
  const bySource = new Map<string, Finding[]>();
  for (const f of [...findings].sort((a, b) => score(b) - score(a))) {
    if (!bySource.has(f.source)) bySource.set(f.source, []);
    bySource.get(f.source)!.push(f);
  }
  const lanes = [...bySource.values()];
  const out: Finding[] = [];
  for (let i = 0; out.length < findings.length; i++) {
    let moved = false;
    for (const lane of lanes) {
      if (lane[i]) { out.push(lane[i]); moved = true; }
    }
    if (!moved) break;
  }
  return out;
}

