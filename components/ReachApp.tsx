'use client';
// @ts-nocheck
import { useUser } from '@clerk/nextjs';
import { BRAND } from '@/lib/brand';
import ReachAppCoreUntyped from './reach-app.jsx';

// reach-app.jsx is untyped JS, so TS infers no props for it. Declare the one
// prop the wrapper actually passes.
const ReachAppCore = ReachAppCoreUntyped as unknown as (
  props: { realUser: unknown }
) => JSX.Element;

export default function ReachAppWrapper() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100dvh', background: BRAND.bg, flexDirection: 'column', gap: 16,
        fontFamily: 'Space Grotesk, sans-serif',
      }}>
        <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 28, color: BRAND.t1 }}>reach</div>
        <div style={{ width: 32, height: 32, border: `3px solid ${BRAND.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const realUser = user ? {
    name: user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : (user.emailAddresses[0]?.emailAddress || 'there'),
    firstName: user.firstName || '',
    email: user.emailAddresses[0]?.emailAddress || '',
    avatar: user.imageUrl || '',
    provider: user.externalAccounts[0]?.provider || 'email',
    clerkId: user.id,
  } : null;

  return <ReachAppCore realUser={realUser} />;
}
