'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand';

type Invite = {
  status: string;
  groupName: string | null;
  groupEmoji: string | null;
  invitedBy: string | null;
};

const shell: React.CSSProperties = {
  minHeight: '100dvh',
  background: BRAND.bg,
  color: BRAND.t1,
  fontFamily: 'var(--font-body)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 24,
  textAlign: 'center',
};

const button: React.CSSProperties = {
  background: BRAND.accent,
  color: BRAND.onAccent,
  border: 'none',
  borderRadius: 12,
  padding: '14px 28px',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
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
        // The first step of the growth loop, and the only one that happens
        // before anybody has an account — so it cannot come from the server
        // knowing who did it. Never awaited: an invitation must render
        // whether or not this lands.
        void fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'invite_link_opened', groupId: body?.groupId ?? body?.group_id ?? null }),
        }).catch(() => {});
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
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 30 }}>reach</div>
        <p style={{ color: BRAND.t2, maxWidth: 320 }}>{error}</p>
        <a href="/home" style={{ ...button, textDecoration: 'none' }}>Go to Reach</a>
      </div>
    );
  }

  if (!invite || !isLoaded) {
    return (
      <div style={shell}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 30 }}>reach</div>
        <p style={{ color: BRAND.t2 }}>Loading your invite…</p>
      </div>
    );
  }

  if (invite.status !== 'pending') {
    // What happened, and what to do about it. A person holding a link a
    // friend sent has no way of knowing whether to retype it, wait, or ask
    // — and the one thing that always works is asking for another.
    const message =
      invite.status === 'expired' ? 'This invite has expired. Ask whoever sent it for a fresh link.'
      : invite.status === 'revoked' ? 'This invite was withdrawn. Ask whoever sent it if that was a mistake.'
      : 'This invite has already been used. Ask whoever sent it for one of your own.';
    return (
      <div style={shell}>
        <div style={{ fontSize: 44 }}>{invite.groupEmoji || '✈️'}</div>
        <p style={{ color: BRAND.t2, maxWidth: 320 }}>{message}</p>
        <a href="/home" style={{ ...button, textDecoration: 'none' }}>Go to Reach</a>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={{ fontSize: 56 }}>{invite.groupEmoji || '✈️'}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 30 }}>
        {invite.groupName || 'A group'}
      </div>
      <p style={{ color: BRAND.t2, maxWidth: 320, lineHeight: 1.5 }}>
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

      <p style={{ color: BRAND.t2, fontSize: 12, maxWidth: 300 }}>
        Signing in with the email address this was sent to joins you automatically.
      </p>
    </div>
  );
}
