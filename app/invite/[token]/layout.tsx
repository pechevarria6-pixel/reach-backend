import type { Metadata } from 'next';
import { invitePreview } from './invite-preview';

// A link texted to a group chat is previewed before it is opened: "Join
// Charleston crew on Reach" says what it is, the site's own title did not.
export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const p = await invitePreview(params.token);
  if (!p?.groupName) return { title: 'You’re invited — Reach' };
  const title = `Join ${p.groupName} on Reach`;
  const description = `${p.invitedBy ? `${p.invitedBy} invited you` : 'You’re invited'} to plan trips and nights out together.`;
  return { title, description, openGraph: { title, description, siteName: 'Reach', type: 'website' }, twitter: { card: 'summary_large_image', title, description } };
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
