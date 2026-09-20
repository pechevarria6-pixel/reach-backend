// ─── Not showing somebody the same place twice ──────────────────────────
// Discover keeps offering places people have already been, and there was no
// way to say so. The only options were to ignore a card forever or to stop
// opening the screen.
//
// Two different sentences are being collected here, and they are not the
// same and must not be treated the same:
//
//   "Already done it"  — a record, not a refusal. They went. The place stays
//                        on the screen with a note saying so, because a
//                        pottery studio you liked is somewhere to go back to
//                        and nobody taps "done" meaning "never again".
//   "Not for me"       — a refusal. That one hides, permanently, because
//                        hiding it is the whole reason somebody taps it.
//
// The first version hid both, with 'done' coming back after four months for
// kinds judged repeatable and never for the rest. That put the app in charge
// of deciding whether you might want to return to a place you had enjoyed —
// which is not a judgement it is in any position to make, and got crafts
// wrong immediately. Everything stays available. What you have done is
// yours to see, not a filter applied to you.

export type Verdict = 'done' | 'not_interested';

export interface Feedback {
  itemRef: string;
  vertical: string;
  verdict: Verdict;
  /** When they said so, ISO. */
  at: string;
}

/**
 * May this be shown to the person who ruled on it?
 *
 * Everything stays except an outright refusal. Marking somewhere done is
 * keeping track, not asking for it to go away, and a place you enjoyed is
 * somewhere you might go back to — which is your call and not the app's.
 */
export function mayShow(f: Feedback): boolean {
  return f.verdict !== 'not_interested';
}

/** The refs to keep out of one person's Discover — refusals, and only those. */
export function hiddenFor(feedback: Feedback[]): Set<string> {
  const out = new Set<string>();
  for (const f of latestPerItem(feedback).values()) if (!mayShow(f)) out.add(f.itemRef);
  return out;
}

/** The refs they have been to, so the card can say so. */
export function visitedIn(feedback: Feedback[]): Set<string> {
  const out = new Set<string>();
  for (const f of latestPerItem(feedback).values()) if (f.verdict === 'done') out.add(f.itemRef);
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
 * Only an outright refusal from the organiser rules anything out, because
 * they are the one building the thing and they said no. Everything else is
 * a note beside the card, and the group decides — including most of them
 * having been before, which an earlier version treated as the group having
 * collectively done it. Five people who have all been to a place they liked
 * may well be going back together; that is the sort of thing a group
 * chooses, not something to be decided for them.
 */
export function groupVerdict(
  verdicts: { userId: string; verdict: Verdict; name?: string }[],
  organiserId: string,
  /** Only for the wording — nothing is excluded on a count any more. */
  groupSize: number,
): GroupCall {
  const rows = verdicts ?? [];
  if (rows.some(v => v.userId === organiserId && v.verdict === 'not_interested')) {
    return { exclude: true, note: null };
  }

  const done = rows.filter(v => v.verdict === 'done');

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
    const all = groupSize > 0 && done.length >= groupSize;
    return {
      exclude: false,
      note: all
        ? "You've all been here before — going back?"
        : who.length === 1
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
