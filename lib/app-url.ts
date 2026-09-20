// ─── Where to send somebody back to ─────────────────────────────────────
// Every invitation link and every link in every email is built from this.
// On production NEXT_PUBLIC_APP_URL was still set to a deployment URL from
// before the move to alcanzar.io — https://reach-app.vercel.app — which
// answers 404. So every invite anybody sent, and every "see your trip" link
// in every email, was dead, and nothing said so: the link is generated, the
// response says invited, and the person who clicks it is the only one who
// finds out.
//
// Two rules come out of that.
//
// A *.vercel.app host is never where you send somebody. It is a deployment
// artifact: it changes on every push, it is not the name on the app, and a
// preview URL in an email outlives the preview. Configured or not, it is
// refused here.
//
// And the request's own origin is worth more than a configured value,
// because it is where the person already is — it cannot be stale by
// definition. The env var is the fallback for the places with no request to
// ask: a webhook from Stripe, a scheduled job.

/** The public home of this app, when nothing better is known. */
const CANONICAL = 'https://www.alcanzar.io';

/** A host nobody should be emailed a link to. */
function isDeploymentHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname.endsWith('.vercel.app') || hostname === 'localhost' || hostname.startsWith('127.');
  } catch {
    return true;                       // unparseable is not somewhere to send anybody
  }
}

function clean(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Where a link should point.
 *
 * Pass the request when there is one. A link built from the origin somebody
 * is already using is correct without anyone having to maintain it.
 */
export function appUrl(req?: { url: string } | null): string {
  if (req?.url) {
    try {
      const origin = new URL(req.url).origin;
      if (!isDeploymentHost(origin)) return clean(origin);
    } catch {
      // Fall through to the configured value.
    }
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && !isDeploymentHost(configured)) return clean(configured);

  if (configured) {
    // Loud, because this is somebody's invitation quietly going nowhere and
    // the only other way to find out is to click one.
    console.error('[app-url] NEXT_PUBLIC_APP_URL points at a deployment host — links would 404', {
      configured, using: CANONICAL,
    });
  }
  return CANONICAL;
}
