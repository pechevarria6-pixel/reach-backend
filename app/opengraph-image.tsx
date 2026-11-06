import { ImageResponse } from 'next/og';
import { BRAND } from '@/lib/brand';
import { frauncesFor } from '@/lib/og-font';

// ─── The picture a shared link carries ───────────────────────────────────
// A link to alcanzar.io pasted into a group chat showed no picture at all,
// and that preview is most people's first sight of Reach (2026-11-06).
export const runtime = 'edge';
export const alt = 'Reach — plans with your people, actually made.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const mark = await fetch(new URL('../public/logo-mark.png', import.meta.url)).then(r => r.arrayBuffer());
  const font = await frauncesFor('ReachPlans with your people, actually made.Trips and nights out, planned together.');
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', background: `radial-gradient(circle at 50% 30%, #4A1B20 0%, ${BRAND.bg} 55%, ${BRAND.page} 100%)`,
        color: BRAND.t1, fontFamily: font ? 'Fraunces' : 'serif',
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={mark as unknown as string} width={520} height={147} style={{ marginBottom: 36 }} />
        <div style={{ fontSize: 112, fontWeight: 600, color: BRAND.accent, letterSpacing: -2 }}>Reach</div>
        <div style={{ fontSize: 44, marginTop: 18, color: BRAND.t1 }}>Plans with your people, actually made.</div>
        <div style={{ fontSize: 28, marginTop: 22, color: BRAND.t2 }}>Trips and nights out, planned together.</div>
      </div>
    ),
    { ...size, emoji: 'twemoji', ...(font ? { fonts: [{ name: 'Fraunces', data: font, weight: 600, style: 'normal' }] } : {}) },
  );
}
