// ─── What to pack, from what the trip actually holds ─────────────────────
// A week out, the T-7 ping (lib/pings.ts) hands somebody a packing list. A
// generic list — "sunscreen, adapter, umbrella" — is a list of guesses about
// a trip we have the itinerary for: sunscreen for a February week in Boston,
// an adapter for a drive to Asheville. Every one of those is a claim about
// the trip, and none of them came from it.
//
// So every line here has a reason that points at something we hold:
//
//   the dates       "Clothes for 3 nights" — counted on the calendar from
//                   the plan's own start and end, never from a clock.
//   a flight line   "ID for the airport" — there is a flight on the plan.
//   a hotel line    "Your hotel's booking reference" — there is a stay.
//   a line's words  "Walking shoes" because a line says "hike". The word
//                   lists are per thing, and narrow on purpose: a match has
//                   to be a word the line actually uses, so "Hikers' Bar"
//                   does not ask anybody to bring boots (see the tests).
//
// What it never says: the weather, the destination's plugs, its customs, or
// anything a line does not mention. A trip whose lines give nothing up gets
// no list at all, and the ping is not sent — an empty list dressed up as
// advice is the thing CLAUDE.md calls rewording a screen that is wrong.
//
// Pure, so every rule is settled in tests/unit/packing.test.ts.
import { nightsBetween } from './away.ts';

/** One itinerary line, as much of it as the list reads. */
export interface PackLine {
  id?: string | null;
  type?: string | null;
  title?: string | null;
  subtitle?: string | null;
}

export interface PackItem {
  /** What to bring, as somebody writes it on a list. */
  item: string;
  /** Why: the line or fact it came from, so the list can say. */
  because: string;
}

interface Rule {
  item: string;
  /** Whole words (or short phrases) that have to appear in the line. */
  words: RegExp;
  /** A word that means the line is about something else ("hikers' bar"). */
  not?: RegExp;
}

// Each pattern matches whole words only. Ordered as a list is read: what you
// wear, then what you carry.
const RULES: Rule[] = [
  { item: 'Walking shoes', words: /\b(hike|hikes|hiking|trail|trails|trek|trekking|walking tour|summit)\b/i, not: /\b(bar|pub|brewery|taproom|tavern)\b/i },
  { item: 'Swimwear', words: /\b(beach|swim|swimming|snorkel|snorkelling|snorkeling|pool|hot springs?|water ?park)\b/i, not: /\b(billiards?|pool hall|pool table)\b/i },
  { item: 'Warm layers', words: /\b(ski|skiing|snowboard|snowboarding|snowshoe|snowshoeing|glacier|ice skating)\b/i },
  { item: 'Clothes that can get wet', words: /\b(kayak|kayaking|canoe|canoeing|rafting|paddleboard|paddleboarding|tubing|boat tour)\b/i },
  { item: 'Something smart for dinner', words: /\b(tasting menu|black tie|dress code|jacket required)\b/i },
  { item: 'Your tickets', words: /\b(concert|gig|tickets?|festival)\b/i },
];

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** The line's name as the list cites it, or null when it has none. */
function nameOf(line: PackLine): string | null {
  const t = clean(line.title);
  return t ? t.slice(0, 80) : null;
}

/**
 * The packing list for a trip, built only from its dates and its lines.
 * Empty when nothing we hold says what to bring.
 */
export function packingList(input: {
  startDate?: unknown;
  endDate?: unknown;
  lines: PackLine[];
}): PackItem[] {
  const out: PackItem[] = [];
  const seen = new Set<string>();
  const add = (item: string, because: string) => {
    if (seen.has(item)) return;
    seen.add(item);
    out.push({ item, because });
  };

  const nights = nightsBetween(input.startDate, input.endDate);
  if (nights !== null && nights >= 1) {
    add(`Clothes for ${nights} night${nights === 1 ? '' : 's'}`, 'Your dates');
  }

  const lines = (Array.isArray(input.lines) ? input.lines : []).filter(Boolean);
  for (const l of lines) {
    const type = clean(l.type).toLowerCase();
    const name = nameOf(l);
    if (type === 'flight') add('ID for the airport', name ?? 'Your flight');
    if (type === 'hotel') add("Your hotel's booking reference", name ?? 'Your stay');
  }

  for (const rule of RULES) {
    for (const l of lines) {
      const text = `${clean(l.title)} ${clean(l.subtitle)}`;
      if (!rule.words.test(text)) continue;
      if (rule.not && rule.not.test(text)) continue;
      const name = nameOf(l);
      if (!name) continue;
      add(rule.item, name);
      break;
    }
  }

  // Clothes for the nights is not a list by itself: every trip has dates. A
  // list with nothing from the itinerary in it is not built from the
  // itinerary, and is not sent.
  return out.some(i => i.because !== 'Your dates') ? out : [];
}

/** The list as one line for a phone: "Walking shoes (Sunrise hike), Swimwear (…)". */
export function packingLine(items: PackItem[], max = 4): string {
  const shown = items.slice(0, Math.max(1, max));
  const rest = items.length - shown.length;
  const text = shown
    .map(i => (i.because === 'Your dates' ? i.item : `${i.item} (${i.because})`))
    .join(', ');
  return rest > 0 ? `${text}, and ${rest} more` : text;
}
