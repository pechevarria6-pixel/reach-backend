import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',
  // An invite link has to be openable by someone with no account yet. The
  // page shows only the group name and who invited them — never the address.
  '/invite/(.*)',
  '/privacy',
  '/terms',
]);

const withClerk = clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return;

  // API routes handle their own auth and return proper 401 JSON responses.
  // Clerk's protect() answers an unauthenticated API request with 404, which
  // breaks REST semantics and the Playwright API tests.
  if (req.nextUrl.pathname.startsWith('/api')) return;

  // protect() also 404s an unauthenticated *page* request, so a signed-out
  // visitor opening /home saw "This page could not be found" instead of the
  // sign-in screen. Redirect explicitly, and send them back where they were
  // headed once they're in.
  const { userId, redirectToSignIn } = auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|json|txt)).*)',
    '/(api|trpc)(.*)',
  ],
};

// A `__session` cookie shaped like a JWT but not decodable makes Clerk throw
// while it works out who the caller is — which happens before any of the
// above, on every route, public ones included. The whole site then answers
// 500 MIDDLEWARE_INVOCATION_FAILED for that browser, sign-in and sign-up with
// it, so the one page that could fix the problem is the one page that cannot
// load. Nothing clears it but emptying the cookie jar by hand, which nobody
// knows to do. A truncated cookie, a half-written one, or a session from a
// rotated key all arrive here.
//
// So a failure is treated as "signed out with a broken cookie": drop the
// Clerk cookies and send the caller back to the same address, where the
// retry has nothing left to choke on. The marker stops that becoming a loop
// if the cookies cannot be cleared — the second pass says plainly what to do
// rather than bouncing for ever.
const CLEARED = 'session_reset';
// __session_<id> and __client_uat_<id> are the multi-instance variants.
const CLERK_COOKIE = /^(__session|__client_uat|__clerk_db_jwt|__client)(_|$)/;

// Clerk's own screens live under these, and it walks between them:
// /sign-up/verify-email-address, /sign-in/factor-one, /sign-up/sso-callback.
// What it never does is repeat the base — /sign-up/sign-up — and that address
// renders nothing at all, silently. Links that stacked before the routing was
// pinned are in people's history and in sent emails, so they are straightened
// out here rather than left to blank.
const STACKED = /^\/(sign-in|sign-up)(?:\/\1)+(\/.*)?$/;

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const stacked = STACKED.exec(req.nextUrl.pathname);
  if (stacked) {
    const url = req.nextUrl.clone();
    // Keep whatever Clerk was doing after the repeats, and the query with it.
    url.pathname = `/${stacked[1]}${stacked[2] ?? ''}`;
    console.error('[middleware] straightened a stacked auth path', {
      from: req.nextUrl.pathname, to: url.pathname,
    });
    return NextResponse.redirect(url);
  }

  try {
    return await withClerk(req, ev);
  } catch (error) {
    const { pathname, searchParams } = req.nextUrl;
    console.error('[middleware] Clerk could not read the session', {
      pathname,
      cleared: searchParams.has(CLEARED),
      error: error instanceof Error ? error.message : String(error),
    });

    if (pathname.startsWith('/api')) {
      return NextResponse.json(
        { error: 'Your session could not be read. Clear this site\'s cookies and sign in again.' },
        { status: 401 },
      );
    }

    if (searchParams.has(CLEARED)) {
      // Cookies survived the first attempt, so stop and say so.
      return new NextResponse(
        'Your browser is sending a sign-in cookie we cannot read, so Reach cannot load.\n\n' +
        'Clear cookies and site data for alcanzar.io, then open the site again.\n',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
      );
    }

    const url = req.nextUrl.clone();
    url.searchParams.set(CLEARED, '1');
    const res = NextResponse.redirect(url);
    const host = req.nextUrl.hostname;
    const parent = host.split('.').slice(-2).join('.');
    for (const cookie of req.cookies.getAll()) {
      if (!CLERK_COOKIE.test(cookie.name)) continue;
      // A cookie set for www.alcanzar.io and one set for .alcanzar.io are two
      // different cookies, and a delete only reaches the domain it names — so
      // both have to be sent. They are appended rather than set through
      // res.cookies, which is keyed by name and would keep only the last.
      res.headers.append('set-cookie', `${cookie.name}=; Path=/; Max-Age=0; SameSite=Lax`);
      if (parent && parent !== host) {
        res.headers.append('set-cookie', `${cookie.name}=; Path=/; Max-Age=0; Domain=.${parent}; SameSite=Lax`);
      }
    }
    res.headers.set('cache-control', 'no-store');
    return res;
  }
}
