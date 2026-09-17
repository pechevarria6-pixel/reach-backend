import { authShell } from '@/lib/clerk-appearance';
import { ThemedSignUp } from '@/components/ThemedAuth';

export default function SignUpPage() {
  return (
    <main style={authShell}>
      <ThemedSignUp />
    </main>
  );
}
