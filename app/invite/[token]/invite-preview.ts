// What a shared invite link says about itself before anybody opens it: the
// group's name and emoji and who sent it — what the invite page shows anyone
// holding the link, and never the invited address.
import { createServerClient } from '@/lib/supabase';

export interface InvitePreview { groupName: string | null; groupEmoji: string | null; invitedBy: string | null }

export async function invitePreview(token: string): Promise<InvitePreview | null> {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(token)) return null;
  try {
    const db = createServerClient();
    const { data } = await db.from('group_invites')
      .select('groups(name, emoji), users:invited_by(name)')
      .eq('token', token).maybeSingle();
    if (!data) return null;
    const g = Array.isArray(data.groups) ? data.groups[0] : data.groups;
    const u = Array.isArray(data.users) ? data.users[0] : data.users;
    return { groupName: g?.name ?? null, groupEmoji: g?.emoji ?? null, invitedBy: u?.name ?? null };
  } catch {
    return null;
  }
}
