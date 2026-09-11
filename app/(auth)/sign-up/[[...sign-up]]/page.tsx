import { SignUp } from '@clerk/nextjs';
import { clerkAppearance, authShell } from '@/lib/clerk-appearance';

export default function SignUpPage() {
  return (
    <main style={authShell}>
      <SignUp appearance={clerkAppearance} />
    </main>
  );
}
