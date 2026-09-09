'use client';
import ReachApp from '@/components/ReachApp';

// Static import — ReachApp.tsx is a client component that handles the Clerk
// user itself (useUser) and only renders the core app once isLoaded is true,
// so there is no SSR/undefined-user window and no dynamic-chunk caching issue.
export default function HomePage() {
  return <ReachApp />;
}
