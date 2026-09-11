import { SignIn } from '@clerk/nextjs';
import { clerkAppearance, authShell } from '@/lib/clerk-appearance';

export default function SignInPage() {
  return (
    <main style={authShell}>
      <SignIn appearance={clerkAppearance} />
    </main>
  );
}
