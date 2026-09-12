'use client';
// @ts-nocheck
import { useUser, useClerk } from '@clerk/nextjs';
import { BRAND, SURFACE } from '@/lib/brand';
import ReachAppCoreUntyped from './reach-app.jsx';

// reach-app.jsx is untyped JS, so TS infers no props for it. Declare the one
// prop the wrapper actually passes.
const ReachAppCore = ReachAppCoreUntyped as unknown as (
  props: { realUser: unknown; onSignOut: () => void }
) => JSX.Element;

export default function ReachAppWrapper() {
  const { user, isLoaded } = useUser();
  // Signing out has to end the Clerk session, not just clear React state.
  // It used to do the latter, so the cookie survived and one refresh put the
  // same account straight back in.
  const { signOut } = useClerk();

  if (!isLoaded) {
    return (
      <div style={{
        // The app's own tokens do not exist until the main component mounts,
        // so this splash carries its own themed pair. Without it the loading
        // state flashes the dark palette before a light-theme app appears.
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100dvh', background: 'var(--shell-surface)', flexDirection: 'column', gap: 16,
        fontFamily: 'Space Grotesk, sans-serif',
      }}>
        <style>{`:root{--shell-surface:${SURFACE.light};--shell-ink:#241C10;}`
          + `:root[data-theme="dark"]{--shell-surface:${SURFACE.dark};--shell-ink:${BRAND.t1};}`}</style>
        <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 28, color: 'var(--shell-ink)' }}>reach</div>
        <div style={{ width: 32, height: 32, border: `3px solid ${BRAND.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const email = user?.emailAddresses[0]?.emailAddress || '';

  // Clerk has no first name for anyone who signed up with Apple private relay
  // or a bare email. The old fallback put the whole address in `name`, and the
  // home greeting splits `name` on a space — which yields the entire address,
  // so it greeted people with "Hey ntzc6jh94w@privaterelay.appleid.com".
  // Derive something short and human instead, and never fall through to a
  // raw address.
  const localPart = email.split('@')[0] || '';
  const fromEmail = localPart
    .split(/[._+-]+/)[0]                      // "ada.lovelace" → "ada"
    .replace(/\d+$/, '');                     // "ada99" → "ada"
  const derivedFirst =
    user?.firstName?.trim() ||
    // A local part that is random relay noise is no better than nothing.
    (fromEmail.length >= 2 && /^[a-zA-Z]+$/.test(fromEmail)
      ? fromEmail[0].toUpperCase() + fromEmail.slice(1).toLowerCase()
      : '');

  const realUser = user ? {
    name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || derivedFirst || email || 'there',
    firstName: derivedFirst,
    email,
    avatar: user.imageUrl || '',
    provider: user.externalAccounts[0]?.provider || 'email',
    clerkId: user.id,
  } : null;

  return <ReachAppCore realUser={realUser} onSignOut={() => signOut({ redirectUrl: '/sign-in' })} />;
}
