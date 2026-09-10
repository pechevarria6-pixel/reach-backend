'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

type Invite = {
  status: string;
  groupName: string | null;
  groupEmoji: string | null;
  invitedBy: string | null;
};

const shell: React.CSSProperties = {
  minHeight: '100vh',
  background: '#08080E',
  color: '#EEEEFF',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 24,
  textAlign: 'center',
};

const button: React.CSSProperties = {
  background: '#6C63FF',
  color: 'white',
  border: 'none',
  borderRadius: 12,
  padding: '14px 28px',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};

export default function InvitePage({ params }: { params: { token: string } }) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${params.token}`)
      .then(async r => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error || 'That invite could not be found.');
        setInvite(body);
      })
      .catch(e => setError(e.message));
  }, [params.token]);

  // Signing in with the invited address joins automatically, so a signed-in
  // visitor only needs one tap to cover the mismatched-address case too.
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/invites/${params.token}`, { method: 'POST' });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || 'Could not join that group.');
      router.push('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that group.');
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div style={shell}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 30 }}>reach</div>
        <p style={{ color: '#9A9AB8', maxWidth: 320 }}>{error}</p>
        <a href="/home" style={{ ...button, textDecoration: 'none' }}>Go to Reach</a>
      </div>
    );
  }

  if (!invite || !isLoaded) {
    return (
      <div style={shell}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 30 }}>reach</div>
        <p style={{ color: '#9A9AB8' }}>Loading your invite…</p>
      </div>
    );
  }

  if (invite.status !== 'pending') {
    const message =
      invite.status === 'expired' ? 'This invite has expired.'
      : invite.status === 'revoked' ? 'This invite was withdrawn.'
      : 'This invite has already been used.';
    return (
      <div style={shell}>
        <div style={{ fontSize: 44 }}>{invite.groupEmoji || '✈️'}</div>
        <p style={{ color: '#9A9AB8', maxWidth: 320 }}>{message}</p>
        <a href="/home" style={{ ...button, textDecoration: 'none' }}>Go to Reach</a>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={{ fontSize: 56 }}>{invite.groupEmoji || '✈️'}</div>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 30 }}>
        {invite.groupName || 'A group'}
      </div>
      <p style={{ color: '#9A9AB8', maxWidth: 320, lineHeight: 1.5 }}>
        {invite.invitedBy ? `${invite.invitedBy} invited you` : 'You have been invited'} to plan
        trips together on Reach.
      </p>

      {isSignedIn ? (
        <button style={{ ...button, opacity: busy ? 0.6 : 1 }} onClick={accept} disabled={busy}>
          {busy ? 'Joining…' : `Join ${invite.groupName || 'the group'}`}
        </button>
      ) : (
        <a
          href={`/sign-up?redirect_url=${encodeURIComponent(`/invite/${params.token}`)}`}
          style={{ ...button, textDecoration: 'none' }}
        >
          Sign up to join
        </a>
      )}

      <p style={{ color: '#6A6A88', fontSize: 12, maxWidth: 300 }}>
        Signing in with the email address this was sent to joins you automatically.
      </p>
    </div>
  );
}
