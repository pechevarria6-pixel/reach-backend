/**
 * Where a new account goes after sign-up: onboarding, always — but carrying
 * an invite it came from. forceRedirectUrl overrode the invite page's
 * redirect_url, so a friend who signed up from an invite was never brought
 * back to it, and with any address but the invited one the invite was simply
 * lost (2026-11-06). Only an invite path is carried: an open redirect is not.
 */
export function afterSignUp(search: string): string {
  let back: string | null = null;
  try { back = new URLSearchParams(search).get('redirect_url'); } catch { back = null; }
  return back && /^\/invite\/[A-Za-z0-9_-]{8,}$/.test(back)
    ? `/onboarding?next=${encodeURIComponent(back)}`
    : '/onboarding';
}
