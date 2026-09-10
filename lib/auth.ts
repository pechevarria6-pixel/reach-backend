// ─── Identity and authorization helpers ──────────────────────────────────
// Every table in Reach keys users by `users.id` (a UUID), never by the Clerk
// id. Clerk is the identity provider; `users` is the system of record. Routes
// that stored `auth().userId` directly wrote Clerk ids into columns holding
// UUIDs elsewhere, so the same person appeared as two different people
// depending on which endpoint wrote the row.
//
// Use `requireUser` / `requirePlanMember` / `requireGroupMember` in every
// authenticated route. Each returns a discriminated union; bail out with
// `if (isFail(ctx)) return ctx.error;` and the rest of the payload is
// resolved. The guard is a type predicate rather than a plain `!ctx.ok`
// check because this project compiles with `strict: false`, and without
// strictNullChecks TypeScript will not narrow on a literal discriminant.
import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AppUser = { id: string; clerk_id: string; email: string };

type Fail = { ok: false; error: NextResponse };
type UserOk = { ok: true; db: SupabaseClient; user: AppUser };
type GroupOk = UserOk & { groupId: string; role: 'admin' | 'member' };
type PlanOk = UserOk & { plan: { id: string; group_id: string; [k: string]: unknown }; role: 'admin' | 'member' };

/** Narrow a helper result to its failure branch. */
export function isFail<T extends { ok: true }>(r: Fail | T): r is Fail {
  return !r.ok;
}

const fail = (message: string, status: number): Fail => ({
  ok: false,
  error: NextResponse.json({ error: message }, { status }),
});

/**
 * Resolve the caller to a row in `users`, creating one on first sight.
 *
 * The Clerk webhook is the normal path for user creation, but it can be
 * unconfigured, delayed, or have missed a signup. Without this fallback the
 * first API call after signup fails with "User not found" and the account is
 * permanently unusable.
 */
export async function requireUser(): Promise<Fail | UserOk> {
  const { userId: clerkId } = auth();
  if (!clerkId) return fail('Unauthorized', 401);

  const db = createServerClient();

  const { data: existing } = await db
    .from('users')
    .select('id, clerk_id, email')
    .eq('clerk_id', clerkId)
    .maybeSingle();
  if (existing) return { ok: true, db, user: existing as AppUser };

  const cu = await currentUser();
  const email =
    cu?.primaryEmailAddress?.emailAddress ??
    cu?.emailAddresses?.[0]?.emailAddress ??
    `${clerkId}@no-email.reach`;
  const name = [cu?.firstName, cu?.lastName].filter(Boolean).join(' ') || null;

  const { data: created, error } = await db
    .from('users')
    .insert({
      clerk_id: clerkId,
      email,
      name,
      avatar_url: cu?.imageUrl || null,
      consent_recorded_at: new Date().toISOString(),
    })
    .select('id, clerk_id, email')
    .single();

  if (error || !created) {
    // A concurrent request may have inserted the same clerk_id first.
    const { data: raced } = await db
      .from('users')
      .select('id, clerk_id, email')
      .eq('clerk_id', clerkId)
      .maybeSingle();
    if (raced) return { ok: true, db, user: raced as AppUser };

    console.error('[requireUser] could not create user', error);
    return fail("Couldn't set up your profile", 500);
  }

  return { ok: true, db, user: created as AppUser };
}

/** Resolve the caller and assert they belong to `groupId`. */
export async function requireGroupMember(groupId: string): Promise<Fail | GroupOk> {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx;

  const { data: membership } = await ctx.db
    .from('group_members')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();

  if (!membership) return fail('Forbidden', 403);
  return { ...ctx, groupId, role: membership.role };
}

/**
 * Resolve the caller and assert they belong to the group that owns `planId`.
 * Returns the plan too, since callers almost always need it.
 */
export async function requirePlanMember(planId: string): Promise<Fail | PlanOk> {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx;

  const { data: plan } = await ctx.db
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return fail('Plan not found', 404);

  const { data: membership } = await ctx.db
    .from('group_members')
    .select('role')
    .eq('group_id', plan.group_id)
    .eq('user_id', ctx.user.id)
    .maybeSingle();

  if (!membership) return fail('Forbidden', 403);
  return { ...ctx, plan, role: membership.role };
}

/** Ids of every member of a group, for per-head splits. */
export async function groupMemberIds(db: SupabaseClient, groupId: string): Promise<string[]> {
  const { data } = await db.from('group_members').select('user_id').eq('group_id', groupId);
  return (data || []).map(m => m.user_id as string);
}
