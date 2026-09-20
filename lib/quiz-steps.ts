// ─── What order the planning questions come in ──────────────────────────
// Planning a trip asks for dates and then asks a run of questions. The dates
// used to come first, so the first thing anybody faced was a fortnight of
// calendar before they had said a word about what the trip was — and the one
// open question, "What's this trip about?", the only part that is not a list
// to pick from, came after it.
//
// That is backwards. Somebody who knows they want a ski week for Kyle's
// fortieth should say so before being asked to pin down which Tuesday, and
// the blurb answers some of the later questions anyway: a goal that plainly
// names the kind of trip means we stop asking what kind.
//
// The index arithmetic is here rather than inline in the screen because it
// is the kind that breaks quietly — an off-by-one shows a question twice or
// skips one, and nothing throws.

export interface Step {
  /** The date step, or the question to put on screen. */
  kind: 'dates' | 'question';
  question?: { id: string; optional?: boolean; free?: boolean; multi?: boolean };
}

/**
 * The screens, in order, for a set of questions.
 *
 * The date step goes straight after the blurb. Placed relative to it rather
 * than fixed at index 1, because the blurb is carried over when it is
 * already known — and then it is not asked at all, and the dates lead.
 */
export function stepsFor<T extends { id: string }>(asked: T[]): ({ kind: 'dates' } | { kind: 'question'; question: T })[] {
  const steps: ({ kind: 'dates' } | { kind: 'question'; question: T })[] = [];
  const goalAt = asked.findIndex(q => q.id === 'goalBlurb');

  if (goalAt < 0) steps.push({ kind: 'dates' });
  asked.forEach((question, i) => {
    steps.push({ kind: 'question', question });
    if (i === goalAt) steps.push({ kind: 'dates' });
  });
  return steps;
}

/** Which screen index holds the dates. */
export function dateStepIndex<T extends { id: string }>(asked: T[]): number {
  return stepsFor(asked).findIndex(s => s.kind === 'dates');
}
