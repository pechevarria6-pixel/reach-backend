'use client';

// ─── Welcome ──────────────────────────────────────────────────────────────
// The first thing anybody does after signing up, and until now it was three
// cards asking for permissions and nothing else. Reach then knew a name it
// had guessed from an email address and nothing whatever about the person,
// so every suggestion it made for weeks was aimed at everybody.
//
// Now it asks who you are, asks for what it needs, and hands straight over
// to the taste quiz — which is the part that makes the rest of the app worth
// opening. Nothing here is a gate: every step can be skipped, because an
// account somebody cannot finish creating is worse than a thin profile.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { BRAND } from '@/lib/brand';

type Step = 'you' | 'location' | 'notifications' | 'ready';
const STEPS: Step[] = ['you', 'location', 'notifications', 'ready'];

/** Set the moment onboarding is shown; read by the gate in the app shell. */
export const ONBOARDING_SEEN = 'reach_onboarding_seen';

export default function OnboardingPage() {
  const { user } = useUser();
  const router = useRouter();

  // Seeing this screen is what counts, not finishing it. Somebody who taps
  // past every step has still been asked, and the gate on Home must not keep
  // sending them back. Wrapped because storage throws in a private window.
  useEffect(() => {
    try { localStorage.setItem(ONBOARDING_SEEN, '1'); } catch {}
  }, []);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Clerk gives a first name for a Google sign-up and nothing at all for an
  // Apple private relay, which is how the home screen ended up greeting
  // people as "there". Prefill what there is and let them fix it.
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [homeCity, setHomeCity] = useState('');
  const [homeAirport, setHomeAirport] = useState('');

  const current = STEPS[step];
  const airportOk = !homeAirport || /^[A-Za-z]{3}$/.test(homeAirport.trim());

  const saveYou = async () => {
    const body: Record<string, string> = {};
    if (firstName.trim()) body.firstName = firstName.trim();
    if (lastName.trim()) body.lastName = lastName.trim();
    if (homeCity.trim()) body.homeCity = homeCity.trim();
    if (homeAirport.trim()) body.homeAirport = homeAirport.trim().toUpperCase();
    if (!Object.keys(body).length) return;
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Worth knowing about, not worth stopping for: they can set all of this
      // again in Profile, and blocking the only route into the app over a
      // failed name save would be the worse of the two outcomes.
      if (!res.ok) console.error('[welcome] could not save your details', res.status);
    } catch (e) {
      console.error('[welcome] could not save your details', e);
    }
  };

  // A refusal is a perfectly good answer, and so is ignoring the prompt
  // entirely. Nothing here may block the flow.
  const askFor = async (what: Step) => {
    try {
      if (what === 'location' && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>(resolve => {
          let settled = false;
          const done = () => { if (!settled) { settled = true; resolve(); } };
          navigator.geolocation.getCurrentPosition(done, done, { timeout: 10000, maximumAge: 600000 });
          setTimeout(done, 12000);
        });
      }
      if (what === 'notifications' && typeof Notification !== 'undefined'
          && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (e) {
      console.error('[welcome] permission request failed', what, e);
    }
  };

  const finish = async (withQuiz: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await user?.update({ unsafeMetadata: { onboardingComplete: true } });
    } catch (e) {
      // Marking this is a convenience, not a gate. Stranding somebody on the
      // last screen of a welcome flow is far worse than a missing flag.
      console.error('[welcome] could not mark complete', e);
    }
    // The quiz lives in the app rather than here, so there is one of it
    // rather than two that drift apart.
    router.push(withQuiz ? '/home?start=taste' : '/home');
  };

  const next = async () => {
    if (busy) return;
    setBusy(true);
    if (current === 'you') await saveYou();
    else await askFor(current);
    setBusy(false);
    setStep(s => s + 1);
  };

  const card = {
    you: {
      icon: '👋', title: 'First, who are we talking to?',
      why: 'Your name is what your group sees. The city and airport are where every price we quote starts from.',
    },
    location: {
      icon: '📍', title: 'What’s on near you',
      why: 'Reach shows what is happening around you tonight, and fills in where you are leaving from when you plan a trip.',
    },
    notifications: {
      icon: '🔔', title: 'When the group needs you',
      why: 'A vote waiting on you, a share to pay, a booking confirmed. Only the things that actually need you.',
    },
    ready: {
      icon: '✨', title: 'Now the good bit',
      why: 'Nine quick questions about what you are into — pottery, cooking, live music, whatever it is. Everything Reach suggests from here reads your answers.',
    },
  }[current];

  const input: React.CSSProperties = {
    width: '100%', padding: '13px 14px', borderRadius: 14,
    border: `1px solid ${BRAND.border}`, background: BRAND.s2, color: BRAND.t1,
    fontSize: 15, fontFamily: 'inherit', marginBottom: 10,
  };

  return (
    <main style={{ minHeight: '100dvh', background: BRAND.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-body)' }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 40 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? BRAND.accent : BRAND.border, transition: 'all .3s' }} />
          ))}
        </div>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 88, height: 88, borderRadius: 28, background: 'rgba(212,168,67,0.14)', border: '1px solid rgba(212,168,67,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, margin: '0 auto 24px' }}>
            {card.icon}
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: BRAND.t1, marginBottom: 12 }}>{card.title}</h1>
          <p style={{ fontSize: 15, color: BRAND.t2, lineHeight: 1.7 }}>{card.why}</p>
          {current !== 'you' && current !== 'ready' && (
            <p style={{ fontSize: 12, color: BRAND.t3, marginTop: 12 }}>You can change this at any time in Settings.</p>
          )}
        </div>

        {current === 'you' && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <input style={input} value={firstName} onChange={e => setFirstName(e.target.value)}
                placeholder="First name" autoComplete="given-name" id="first-name" />
              <input style={input} value={lastName} onChange={e => setLastName(e.target.value)}
                placeholder="Last name" autoComplete="family-name" id="last-name" />
            </div>
            <input style={input} value={homeCity} onChange={e => setHomeCity(e.target.value)}
              placeholder="Where you live, like Edinburgh" autoComplete="address-level2" id="home-city" />
            <input style={{ ...input, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}
              value={homeAirport} maxLength={3} onChange={e => setHomeAirport(e.target.value)}
              placeholder="Nearest airport, like EDI" id="home-airport" />
            {!airportOk && (
              <div style={{ fontSize: 12, color: '#D9534F', marginBottom: 6 }}>
                An airport code is three letters, like EDI or JFK.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {current === 'ready' ? (
            <>
              <button onClick={() => finish(true)} disabled={busy} style={primary}>
                {busy ? 'Setting up your account…' : 'Take the quiz →'}
              </button>
              <button onClick={() => finish(false)} disabled={busy} style={secondary}>
                Skip for now
              </button>
            </>
          ) : (
            <>
              <button onClick={next} disabled={busy || !airportOk} style={primary}>
                {busy ? 'One moment…' : current === 'you' ? 'Continue →' : 'Allow →'}
              </button>
              <button onClick={() => setStep(s => s + 1)} disabled={busy} style={secondary}>
                {current === 'you' ? 'I’ll do this later' : 'Not now'}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const primary: React.CSSProperties = {
  width: '100%', minHeight: 52, padding: '15px 20px',
  background: `linear-gradient(135deg, ${BRAND.accentDeep}, ${BRAND.accent})`,
  color: BRAND.onAccent, border: 'none', borderRadius: 16,
  fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const secondary: React.CSSProperties = {
  width: '100%', minHeight: 48, padding: '14px 20px',
  background: BRAND.s2, color: BRAND.t2, border: `1px solid ${BRAND.border}`,
  borderRadius: 16, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
};
