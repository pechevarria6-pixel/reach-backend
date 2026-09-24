// ─── The manual create-plan flow's screens, per kind of plan ─────────────
// The screens are rendered by these names, not by position. By position, a
// dinner ended on the hotel picker and a weekend on dealbreakers, and only a
// full trip ever reached the budget — so every other plan was saved with a
// budget nobody had chosen.
export type PlanKind = 'restaurant' | 'concert' | 'weekend' | 'trip';

export function createPlanSteps(kind: string | null | undefined): string[] {
  // Where, for every kind: a plan with no place was built for its title —
  // "Test", "Weekend Away" — with rows naming squares in no city at all.
  if (kind === 'restaurant') return ['Type', 'Where', 'When', 'Cuisine', 'Budget'];
  if (kind === 'concert') return ['Type', 'Where', 'When', 'Genre', 'Budget'];
  if (kind === 'weekend') return ['Type', 'Where', 'When', 'Vibe', 'Stay', 'Budget'];
  return ['Type', 'Where', 'When', 'Vibe', 'Stay', 'Rules', 'Budget'];
}

/** The screens the flow knows how to draw. A step name outside this is a screen nobody sees. */
export const RENDERED = new Set(['Type', 'Where', 'When', 'Cuisine', 'Genre', 'Vibe', 'Stay', 'Rules', 'Budget']);
