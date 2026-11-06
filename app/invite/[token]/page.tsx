'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
// ─── The first screen a friend of a member ever sees ────────────────────
// It was a fixed maroon page with a test-tube emoji, a name and a button:
// nothing about what Reach is, no way in for someone who already has an
// account, and a dark screen in front of a cream sign-up (2026-11-06).
const CSS = `
.iv{--bg:#EBEFEC;--s1:#F4F7F5;--s2:#E4EAE6;--bd:#D8DED4;--ac:#EC6032;--acd:#D24E24;--on:#2A1D06;--link:#2B583B;--t1:#142119;--t2:#576E61;--t3:#5E766A;--tint:rgba(236,96,50,.12);--tintbd:rgba(236,96,50,.30)}
:root[data-theme="dark"] .iv{--bg:#2C0E18;--s1:#36121B;--s2:#3F1619;--bd:#5A2430;--ac:#C3A342;--acd:#A8892F;--on:#2A1D06;--link:#C3A342;--t1:#FEF7D9;--t2:#CFC182;--t3:#B89A6A;--tint:rgba(195,163,66,.14);--tintbd:rgba(195,163,66,.32)}
.iv{min-height:100dvh;background:var(--bg);color:var(--t1);font-family:var(--font-body);display:flex;flex-direction:column;align-items:center;padding:20px 16px calc(24px + env(safe-area-inset-bottom));-webkit-font-smoothing:antialiased}
.iv *{box-sizing:border-box}
.iv-brand{font-family:var(--font-display);font-size:22px;font-weight:600;color:var(--t1);text-decoration:none;align-self:center;margin-bottom:auto;padding:4px 0 24px}
.iv-card{width:100%;max-width:400px;margin:0 auto auto;text-align:center}
.iv-emoji{width:88px;height:88px;border-radius:28px;background:var(--tint);border:1px solid var(--tintbd);display:flex;align-items:center;justify-content:center;font-size:44px;margin:0 auto 20px}
.iv h1{font-family:var(--font-display);font-weight:600;font-size:30px;line-height:1.15;margin:0 0 10px;letter-spacing:-.01em;overflow-wrap:anywhere}
.iv-lede{color:var(--t2);font-size:16px;line-height:1.55;margin:0 auto 22px;max-width:22em}
.iv-what{list-style:none;padding:14px 16px;margin:0 0 22px;background:var(--s1);border:1px solid var(--bd);border-radius:18px;text-align:left;display:grid;gap:10px}
.iv-what li{display:flex;gap:10px;font-size:14px;line-height:1.45;color:var(--t2)}
.iv-what span{flex:0 0 auto}
.iv-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;border:none;border-radius:999px;background:linear-gradient(135deg,var(--acd),var(--ac));color:var(--on);font-weight:700;font-size:16px;text-decoration:none;cursor:pointer;font-family:inherit}
.iv-go[disabled]{opacity:.6;cursor:default}
.iv-alt{display:inline-block;margin-top:14px;color:var(--t2);font-size:14.5px;text-decoration:none}
.iv-alt b{color:var(--link)}
.iv-note{color:var(--t3);font-size:12.5px;line-height:1.5;margin:16px auto 0;max-width:300px}
.iv-go:focus-visible,.iv-alt:focus-visible,.iv-brand:focus-visible{outline:3px solid var(--link);outline-offset:3px}
`;

type Invite = {
  status: string;
  groupName: string | null;
  groupEmoji: string | null;
  invitedBy: string | null;
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="iv">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <a href="/" className="iv-brand">Reach</a>
      <div className="iv-card">{children}</div>
    </main>
  );
}

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
      // Straight to the group they just joined. Plain /home dropped them on
      // a generic screen whose first thing was somebody else's "Pay".
      router.push(body?.groupId ? `/home?group=${encodeURIComponent(body.groupId)}&joined=1` : '/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that group.');
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Frame>
        <div className="iv-emoji" aria-hidden="true">🔗</div>
        <h1>That link didn&rsquo;t work</h1>
        <p className="iv-lede">{error} Ask whoever sent it for a fresh one.</p>
        <a href="/home" className="iv-go">Go to Reach</a>
      </Frame>
    );
  }

  if (!invite || !isLoaded) {
    return (
      <Frame>
        <p className="iv-lede" role="status">Opening your invite…</p>
      </Frame>
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
      <Frame>
        <div className="iv-emoji" aria-hidden="true">{invite.groupEmoji || '✈️'}</div>
        <h1>{invite.groupName || 'This group'}</h1>
        <p className="iv-lede">{message}</p>
        <a href="/home" className="iv-go">Go to Reach</a>
      </Frame>
    );
  }

  const back = encodeURIComponent(`/invite/${params.token}`);
  return (
    <Frame>
      <div className="iv-emoji" aria-hidden="true">{invite.groupEmoji || '✈️'}</div>
      <h1>{invite.groupName || 'A group'}</h1>
      <p className="iv-lede">
        {invite.invitedBy ? `${invite.invitedBy} invited you` : 'You have been invited'} to plan
        trips and nights out together on Reach.
      </p>
      <ul className="iv-what" aria-label="What happens in Reach">
        <li><span aria-hidden="true">✍️</span>Everyone says what they are into, once.</li>
        <li><span aria-hidden="true">🗺️</span>Reach finds options from real places that suit the whole group.</li>
        <li><span aria-hidden="true">🗳️</span>You vote, and the plan lives in one place.</li>
      </ul>

      {isSignedIn ? (
        <button className="iv-go" onClick={accept} disabled={busy}>
          {busy ? 'Joining…' : `Join ${invite.groupName || 'the group'}`}
        </button>
      ) : (
        <>
          <a href={`/sign-up?redirect_url=${back}`} className="iv-go">Sign up to join</a>
          <a href={`/sign-in?redirect_url=${back}`} className="iv-alt">Already on Reach? <b>Sign in</b></a>
        </>
      )}

      <p className="iv-note">
        Use the email address the invite was sent to, and you join the group automatically.
      </p>
    </Frame>
  );
}
