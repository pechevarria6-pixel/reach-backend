import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

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

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return;
  // API routes handle their own auth and return proper 401 JSON responses.
  // Clerk's protect() returns 404 for unauthenticated API requests, which
  // breaks REST semantics and the Playwright API tests.
  if (req.nextUrl.pathname.startsWith('/api')) return;
  auth().protect();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|json|txt)).*)',
    '/(api|trpc)(.*)',
  ],
};
