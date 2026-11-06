import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BRAND } from '@/lib/brand';
import { frauncesFor } from '@/lib/og-font';
import { invitePreview } from './invite-preview';

export const alt = 'An invitation to plan together on Reach';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function InviteImage({ params }: { params: { token: string } }) {
  const p = await invitePreview(params.token);
  const mark = await readFile(join(process.cwd(), 'public', 'logo-mark.png'));
  const src = `data:image/png;base64,${mark.toString('base64')}`;
  const name = p?.groupName ?? 'Your group';
  const lead = p?.invitedBy ? `${p.invitedBy} invited you to` : 'You’re invited to';
  const font = await frauncesFor(`${lead}${name}Plan it together on Reach`);
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', background: `radial-gradient(circle at 50% 30%, #4A1B20 0%, ${BRAND.bg} 55%, ${BRAND.page} 100%)`,
        color: BRAND.t1, fontFamily: font ? 'Fraunces' : 'serif', padding: 60, textAlign: 'center',
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={src} width={360} height={102} style={{ marginBottom: 28 }} />
        <div style={{ fontSize: 34, color: BRAND.t2 }}>{lead}</div>
        <div style={{ fontSize: name.length > 22 ? 72 : 96, fontWeight: 600, color: BRAND.t1, marginTop: 10, lineHeight: 1.05 }}>
          {`${p?.groupEmoji ? `${p.groupEmoji} ` : ''}${name}`}
        </div>
        <div style={{ fontSize: 34, marginTop: 26, color: BRAND.accent }}>Plan it together on Reach</div>
      </div>
    ),
    { ...size, emoji: 'twemoji', ...(font ? { fonts: [{ name: 'Fraunces', data: font, weight: 600, style: 'normal' }] } : {}) },
  );
}
