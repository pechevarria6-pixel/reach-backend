import { authShell } from '@/lib/clerk-appearance';
import { ThemedSignIn } from '@/components/ThemedAuth';

export default function SignInPage() {
  return (
    <main style={authShell}>
      <ThemedSignIn />
    </main>
  );
}
