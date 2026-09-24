'use client';
// ─── A shared quiz result ───────────────────────────────────────────────
// "Invite your crew to find out theirs" sends a link here. It opens with no
// account, because the person it was sent to does not have one yet — that is
// the point of it. Everything shown comes from the link itself (shareCode in
// lib/traveler-profile): the result and the dials, which are all a group
// member would see anyway. No id, no database read, nothing private.

import { useEffect } from 'react';
import { BRAND } from '@/lib/brand';
import { DIALS, DIAL_COPY, RESULT_COPY, EVERYTHING_COPY, dialLabel, fromShareCode } from '@/lib/traveler-profile';

/** Remembered through sign-up so the join can be counted once, in the app. */
const FROM_SHARE = 'reach_from_quiz_share';

const shell: React.CSSProperties = {
  minHeight: '100dvh', background: BRAND.bg, color: BRAND.t1, fontFamily: 'var(--font-body)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 14, padding: '24px 16px', textAlign: 'center',
};

const button: React.CSSProperties = {
  background: BRAND.accent, color: BRAND.onAccent, border: 'none', borderRadius: 12,
  padding: '14px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'var(--font-body)', textDecoration: 'none',
};

export default function SharedResult({ params }: { params: { code: string } }) {
  const p = fromShareCode(decodeURIComponent(params.code || ''));

  useEffect(() => {
    // Opened before anybody has an account, like an invitation. Never awaited.
    void fetch('/api/track', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'quiz_share_opened', props: { valid: !!p } }),
    }).catch(() => {});
  }, []);

  const join = () => {
    try { localStorage.setItem(FROM_SHARE, '1'); } catch { /* private window: the join just goes uncounted */ }
  };

  if (!p) {
    return (
      <div style={shell}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 30 }}>reach</div>
        <p style={{ color: BRAND.t2, maxWidth: 320 }}>This link has been cut short somewhere. Ask whoever sent it to share it again.</p>
        <a href="/sign-up?redirect_url=%2Fhome%3Fstart%3Dtaste" style={button} onClick={join}>Find out yours</a>
      </div>
    );
  }

  const copy = p.primary ? RESULT_COPY[p.primary] : null;
  const title = copy ? copy.name : EVERYTHING_COPY.name;
  const side = p.primary && p.secondary ? `with a side of ${RESULT_COPY[p.secondary].short}` : null;
  const shown = DIALS.filter(d => !p.unanswered.includes(d));

  return (
    <div style={shell}>
      <div style={{ width: '100%', maxWidth: 360, background: BRAND.s2, border: `1px solid ${BRAND.border}`, borderRadius: 22, padding: '26px 20px' }}>
        <div style={{ fontSize: 12, color: BRAND.t3, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>A friend on Reach is</div>
        <div style={{ fontSize: 52, marginBottom: 6 }}>{copy ? copy.emoji : EVERYTHING_COPY.emoji}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, color: BRAND.accent, lineHeight: 1.15 }}>{title}</div>
        {side && <div style={{ fontSize: 14, color: BRAND.t2, marginTop: 4 }}>{side}</div>}
        <div style={{ fontSize: 14, color: BRAND.t1, marginTop: 10, lineHeight: 1.5 }}>{copy ? copy.line : EVERYTHING_COPY.line}</div>
        {shown.length > 0 && (
          <div style={{ marginTop: 18, textAlign: 'left' }}>
            {shown.map(d => (
              <div key={d} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: BRAND.t2, marginBottom: 4 }}>
                  <span>{DIAL_COPY[d].label}</span><span style={{ color: BRAND.t1 }}>{dialLabel(d, p.dials[d])}</span>
                </div>
                <div style={{ height: 6, background: BRAND.border, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${p.dials[d]}%`, height: '100%', background: BRAND.accent, borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p style={{ color: BRAND.t2, maxWidth: 320, lineHeight: 1.5, fontSize: 14 }}>
        Six taps, about a minute. Then real places near you that fit.
      </p>
      <a href="/sign-up?redirect_url=%2Fhome%3Fstart%3Dtaste" style={button} onClick={join}>Find out yours</a>
    </div>
  );
}
