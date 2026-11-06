// ─── A person's own photo, or none ───────────────────────────────────────
// Clerk gives every account without a photo a generated stand-in — a purple
// silhouette served from img.clerk.com whose path is base64 JSON saying
// {"type":"default",…}. The app showed it as if it were their picture, so a
// new person's profile opened on a stranger-blue blob in front of maroon and
// gold (new-user walk, 2026-11-06). That is not a photo of anyone: treat it
// as none, and the app draws their initials.

/** Whether a Clerk image URL is Clerk's generated default, not an upload. */
export function isClerkDefault(url: string | null | undefined): boolean {
  if (!url) return false;
  const m = /^https:\/\/img\.clerk\.com\/([A-Za-z0-9_-]+)/.exec(String(url));
  if (!m) return false;
  try {
    const s = m[1] + '='.repeat((4 - (m[1].length % 4)) % 4);
    const json = typeof atob === 'function'
      ? atob(s.replace(/-/g, '+').replace(/_/g, '/'))
      : Buffer.from(s, 'base64url').toString('utf8');
    return /"type"\s*:\s*"default"/.test(json);
  } catch {
    return false;
  }
}

/** The photo to show for someone: theirs, or null for initials. */
export function ownPhoto(url: string | null | undefined): string | null {
  return url && !isClerkDefault(url) ? url : null;
}
