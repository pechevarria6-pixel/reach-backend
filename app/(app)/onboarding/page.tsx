'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';

const steps = [
  {
    icon: '📍',
    title: 'Location access',
    why: 'Reach shows events near you and automatically fills in your departure city when planning trips.',
    permission: 'location',
  },
  {
    icon: '🔔',
    title: 'Push notifications',
    why: 'Get real-time updates when your group votes, when approvals are needed, or when bookings are confirmed.',
    permission: 'notifications',
  },
  {
    icon: '🛡️',
    title: 'Your data, your choice',
    why: 'Reach only collects what is needed to plan your experiences. You control everything.',
    permission: 'privacy',
    isPrivacy: true,
  },
];

export default function OnboardingPage() {
  const { user } = useUser();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const current = steps[step];
  const isLast = step === steps.length - 1;

  const handleNext = async () => {
    if (isLast) {
      setSaving(true);
      // Mark onboarding complete in Clerk metadata
      await user?.update({ unsafeMetadata: { onboardingComplete: true } });
      router.push('/home');
    } else {
      setStep(s => s + 1);
    }
  };

  return (
    <main style={{ minHeight: '100vh', background: '#08080E', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'Space Grotesk, sans-serif' }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 48 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? '#6C63FF' : '#2C2C3A', transition: 'all .3s' }} />
          ))}
        </div>

        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ width: 88, height: 88, borderRadius: 28, background: 'rgba(108,99,255,0.14)', border: '1px solid rgba(108,99,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, margin: '0 auto 24px' }}>
            {current.icon}
          </div>
          <h1 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 28, color: '#EEEEFF', marginBottom: 12 }}>{current.title}</h1>
          <p style={{ fontSize: 15, color: '#9090B0', lineHeight: 1.7 }}>{current.why}</p>
          <p style={{ fontSize: 12, color: '#55556A', marginTop: 12 }}>You can change this at any time in Settings.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={handleNext} disabled={saving} style={{ width: '100%', padding: '15px 20px', background: '#6C63FF', color: 'white', border: 'none', borderRadius: 16, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'Space Grotesk, sans-serif' }}>
            {saving ? 'Setting up your account…' : isLast ? 'Get started →' : 'Allow →'}
          </button>
          {!isLast && (
            <button onClick={() => setStep(s => s + 1)} style={{ width: '100%', padding: '14px 20px', background: '#18181F', color: '#9090B0', border: '1px solid #2C2C3A', borderRadius: 16, fontSize: 15, cursor: 'pointer', fontFamily: 'Space Grotesk, sans-serif' }}>
              Not now
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
