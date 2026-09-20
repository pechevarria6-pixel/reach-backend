// ─── Not showing somebody the same place twice ──────────────────────────
// Discover keeps offering places people have already been, and there was no
// way to say so. The only options were to ignore a card forever or to stop
// opening the screen.
//
// Two different sentences are being collected here, and they are not the
// same and must not be treated the same:
//
//   "Already done it"  — a positive signal. They went. They may well go
//                        again, and the fact they chose it says what they
//                        like. A restaurant can come round again; the
//                        Museum of Natural History cannot.
//   "Not for me"       — a refusal. It never comes back, and it says
//                        something about the category too.
//
// Collapsing those into one "hide" would lose the difference between a place
// somebody loved and a place they would not go to at gunpoint.

export type Verdict = 'done' | 'not_interested';

export interface Feedback {
  itemRef: string;
  vertical: string;
  verdict: Verdict;
  /** When they said so, ISO. */
  at: string;
}

/**
 * Things worth doing more than once.
 *
 * A dinner is repeatable; a landmark is not. Somebody who has done the
 * Statue of Liberty has done it, and offering it again next spring is the
 * app not listening. Somewhere they ate and liked is a different matter
 * entirely, which is the whole reason 'done' is kept apart from 'not for me'.
 */
const REPEATABLE = new Set(['restaurant', 'bar', 'cafe', 'night', 'nightlife', 'event', 'live music']);

/** How long before somewhere they have been is worth offering again. */
const COOLDOWN_DAYS = 120;

export function isRepeatable(vertical: string): boolean {
  return REPEATABLE.has(String(vertical || '').toLowerCase().trim());
}

/**
 * May this be shown to the person who ruled on it?
 *
 * 'not for me' is permanent — there is no cooldown on a refusal, and a
 * refusal that quietly expires is the app deciding it knows better.
 */
export function mayShow(f: Feedback, now: Date = new Date()): boolean {
  if (f.verdict === 'not_interested') return false;
  if (!isRepeatable(f.vertical)) return false;
  const days = (now.getTime() - new Date(f.at).getTime()) / 86400000;
  return Number.isFinite(days) && days >= COOLDOWN_DAYS;
}

/** The refs to keep out of one person's Discover, given everything they said. */
export function hiddenFor(feedback: Feedback[], now: Date = new Date()): Set<string> {
  const latest = latestPerItem(feedback);
  const out = new Set<string>();
  for (const f of latest.values()) if (!mayShow(f, now)) out.add(f.itemRef);
  return out;
}

/**
 * One verdict per item — the most recent.
 *
 * Somebody can change their mind, and the older row must not win. Rows
 * arrive in whatever order the database returns them, so this does not
 * assume they are sorted.
 */
export function latestPerItem(feedback: Feedback[]): Map<string, Feedback> {
  const byItem = new Map<string, Feedback>();
  for (const f of feedback ?? []) {
    const held = byItem.get(f.itemRef);
    if (!held || new Date(f.at).getTime() > new Date(held.at).getTime()) byItem.set(f.itemRef, f);
  }
  return byItem;
}

export interface GroupCall {
  /** Keep it out of the group's options entirely. */
  exclude: boolean;
  /** Said next to it when one member has been but the group has not. */
  note: string | null;
}

/**
 * What a group does with what its members have said.
 *
 * One person's history does not veto everybody else's trip. Somebody who has
 * already seen the cathedral has not thereby decided that five other people
 * may not see it, and an app that silently removed it would be making that
 * call on their behalf.
 *
 * So: a refusal from the organiser rules it out, because they are the one
 * building the thing. A majority having been already means the group has
 * collectively done it. Anything less is a note beside the card, and the
 * group decides.
 */
export function groupVerdict(
  verdicts: { userId: string; verdict: Verdict; name?: string }[],
  organiserId: string,
  groupSize: number,
): GroupCall {
  const rows = verdicts ?? [];
  if (rows.some(v => v.userId === organiserId && v.verdict === 'not_interested')) {
    return { exclude: true, note: null };
  }

  const done = rows.filter(v => v.verdict === 'done');
  // More than half the group, not merely more than half of those who spoke.
  if (groupSize > 0 && done.length * 2 > groupSize) {
    return { exclude: true, note: null };
  }

  // A refusal from somebody who is not the organiser still matters — it is
  // said out loud rather than acted on, because they have to come too.
  const refused = rows.filter(v => v.verdict === 'not_interested');
  if (refused.length) {
    const who = refused.map(v => firstName(v.name)).filter(Boolean);
    return {
      exclude: false,
      note: who.length === 1
        ? `${who[0]} would rather not — worth checking before you pick it.`
        : `${who.length} of you would rather not — worth checking before you pick it.`,
    };
  }

  if (done.length) {
    const who = done.map(v => firstName(v.name)).filter(Boolean);
    return {
      exclude: false,
      note: who.length === 1
        ? `${who[0]}'s been here — still worth it for the group?`
        : `${who.length} of you have been here — still worth it for the group?`,
    };
  }

  return { exclude: false, note: null };
}

function firstName(name?: string): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/** A stable key for a place, whatever source it came from. */
export function refOf(source: string, id: string): string {
  return `${String(source || 'unknown').toLowerCase()}:${String(id || '').trim()}`;
}
