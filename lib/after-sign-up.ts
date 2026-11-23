/**
 * Where a new account goes after sign-up: onboarding, always — but carrying
 * an invite it came from. forceRedirectUrl overrode the invite page's
 * redirect_url, so a friend who signed up from an invite was never brought
 * back to it, and with any address but the invited one the invite was simply
 * lost (2026-11-06). Only an invite path is carried: an open redirect is not.
 */
/** What a visitor chose on the front page: a night out, a weekend, a trip. Only these three. */
export const START_KINDS = ['night', 'weekend', 'trip'] as const;
export type StartKind = typeof START_KINDS[number];
export function startKind(raw: unknown): StartKind | null {
  return (START_KINDS as readonly string[]).includes(String(raw ?? '')) ? raw as StartKind : null;
}

export function afterSignUp(search: string): string {
  let back: string | null = null;
  let kind: StartKind | null = null;
  try {
    const q = new URLSearchParams(search);
    back = q.get('redirect_url');
    kind = startKind(q.get('kind'));
  } catch { back = null; }
  const params = new URLSearchParams();
  if (back && /^\/invite\/[A-Za-z0-9_-]{8,}$/.test(back)) params.set('next', back);
  // What they picked on the front page goes along too: one of three words, never a path.
  if (kind) params.set('kind', kind);
  const qs = params.toString();
  return qs ? `/onboarding?${qs}` : '/onboarding';
}
