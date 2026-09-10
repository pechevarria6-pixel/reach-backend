// ─── Group invites ───────────────────────────────────────────────────────
// An invite names an email address that may not have an account yet. It is
// claimed the first time that person authenticates with the address, so the
// common path needs no link click: invite bob@example.com, Bob signs up, Bob
// is in the group.
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const INVITE_TTL_DAYS = 30;

/** Addresses are compared exactly, so normalise on the way in and out. */
export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function newInviteToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export type ClaimResult = { joined: string[]; alreadyIn: string[] };

/**
 * Turn every live invite for `email` into a real membership.
 *
 * Idempotent and safe to call on every sign-in. Only call it with an address
 * the identity provider has verified — an unverified address would let
 * someone join a group by claiming a stranger's email at signup.
 */
export async function claimInvitesFor(
  db: SupabaseClient,
  userId: string,
  email: string
): Promise<ClaimResult> {
  const address = normalizeEmail(email);
  const result: ClaimResult = { joined: [], alreadyIn: [] };
  if (!address || !userId) return result;

  const { data: invites } = await db
    .from('group_invites')
    .select('id, group_id, role, expires_at')
    .eq('email', address)
    .eq('status', 'pending');

  if (!invites?.length) return result;

  const now = Date.now();
  const live = invites.filter(i => new Date(i.expires_at).getTime() > now);
  const stale = invites.filter(i => new Date(i.expires_at).getTime() <= now);

  if (stale.length) {
    await db.from('group_invites')
      .update({ status: 'expired' })
      .in('id', stale.map(i => i.id));
  }

  for (const invite of live) {
    const { data: existing } = await db
      .from('group_members')
      .select('id')
      .eq('group_id', invite.group_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      result.alreadyIn.push(invite.group_id);
    } else {
      const { error } = await db.from('group_members').insert({
        group_id: invite.group_id,
        user_id: userId,
        role: invite.role || 'member',
      });
      // A concurrent claim may have inserted the same row; that is a success.
      if (error && !String(error.code).startsWith('23')) {
        console.error('[claimInvites] could not join group', invite.group_id, error);
        continue;
      }
      result.joined.push(invite.group_id);
    }

    await db.from('group_invites')
      .update({ status: 'accepted', accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq('id', invite.id);
  }

  return result;
}
