'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { BRAND } from '@/lib/brand';

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
    if (!isLast) { setStep(s => s + 1); return; }
    if (saving) return;
    setSaving(true);
    try {
      // Marking onboarding complete is a convenience, not a gate. If Clerk
      // refuses it, going to the app anyway is far better than stranding
      // somebody on the last step of a welcome flow with a dead button —
      // which is what happened, because nothing cleared `saving` on a throw.
      await user?.update({ unsafeMetadata: { onboardingComplete: true } });
    } catch (e) {
      console.error('[onboarding] could not mark complete', e);
    } finally {
      setSaving(false);
      router.push('/home');
    }
  };

  return (
    <main style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 48 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? BRAND.accent : BRAND.border, transition: 'all .3s' }} />
          ))}
        </div>

        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ width: 88, height: 88, borderRadius: 28, background: 'rgba(212,168,67,0.14)', border: '1px solid rgba(212,168,67,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, margin: '0 auto 24px' }}>
            {current.icon}
          </div>
          <h1 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 28, color: BRAND.t1, marginBottom: 12 }}>{current.title}</h1>
          <p style={{ fontSize: 15, color: BRAND.t2, lineHeight: 1.7 }}>{current.why}</p>
          <p style={{ fontSize: 12, color: BRAND.t3, marginTop: 12 }}>You can change this at any time in Settings.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={handleNext} disabled={saving} style={{ width: '100%', minHeight: 52, padding: '15px 20px', background: `linear-gradient(135deg, ${BRAND.accentDeep}, ${BRAND.accent})`, color: BRAND.onAccent, border: 'none', borderRadius: 16, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Setting up your account…' : isLast ? 'Get started →' : 'Allow →'}
          </button>
          {!isLast && (
            <button onClick={() => setStep(s => s + 1)} style={{ width: '100%', minHeight: 48, padding: '14px 20px', background: BRAND.s2, color: BRAND.t2, border: `1px solid ${BRAND.border}`, borderRadius: 16, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>
              Not now
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
