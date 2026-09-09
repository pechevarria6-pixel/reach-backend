import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', background: '#08080E',
    }}>
      <SignUp />
    </main>
  );
}
