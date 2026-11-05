// ─── "Everyone has voted", whichever way it came true ───────────────────
// The organiser hears once, per set of ideas, when the last vote that
// counts is in. That used to be checked on a vote and nowhere else — so a
// vote finished by the one member still to vote leaving the group was never
// announced: the count read "Everyone has voted" for whoever opened the
// screen, and the person who makes the pick was never told to.
//
// The decision is everyoneVotedNotice, on rows already read; the two calls
// below read them, claim the announcement once (claimOnce), and send it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readIdeas, tallyVotes, voteTitles, shownTitle, everyoneVotedCopy } from './trip-vote.ts';
import { membersOf, organisersOf, readVetoes, type Member } from './trip-ideas-store.ts';
import { claimOnce } from './everyone-in.ts';
import { notifyUsers, type Note, type Sender } from './notify-user.ts';

export interface VotePlan {
  id: string;
  group_id?: string | null;
  status?: string | null;
  trip_options?: unknown;
  vote_options?: unknown;
  created_by?: string | null;
  destination_style?: string | null;
}

/**
 * What the organiser is told, and the key it is told under — or null when
 * the vote is not complete, or not open. `actorId` is whoever made it come
 * true, by voting or by leaving: they are looking at it, or gone.
 */
export function everyoneVotedNotice(p: {
  plan: VotePlan;
  members: Member[];
  votes: Array<{ user_id: string; option: string }>;
  vetoes: Array<{ user_id: string; option: string }>;
  actorId: string;
}): { key: string; told: string[]; note: Note } | null {
  if (p.plan.status !== 'voting') return null;
  const ideas = readIdeas(p.plan.trip_options);
  const view = tallyVotes({
    titles: voteTitles(p.plan), votes: p.votes, vetoes: p.vetoes,
    memberIds: p.members.map(m => m.userId), me: p.actorId,
  });
  if (!view.everyoneVoted) return null;
  const shown = (t: string) => shownTitle(ideas?.options ?? [], t);
  const groupId = String(p.plan.group_id ?? '');
  return {
    key: `${p.plan.id}:${ideas?.set ?? 'votes'}`,
    told: organisersOf(p.members, p.plan.created_by ?? null).filter(id => id !== p.actorId),
    note: {
      kind: 'everyone_voted',
      title: 'Everyone has voted',
      // A vote on a set place has no pick to promise: locking it in closes it.
      body: everyoneVotedCopy({
        undecided: p.plan.destination_style === 'undecided',
        leader: view.leader, tied: view.tied, vetoes: view.vetoes, shown,
      }),
      url: `/home?vote=${encodeURIComponent(p.plan.id)}&group=${encodeURIComponent(groupId)}`,
      planId: p.plan.id,
    },
  };
}

/** Reads the vote, and tells the organiser if it is complete and nobody has yet. */
export async function tellOrganiserIfEveryoneVoted(
  db: SupabaseClient, plan: VotePlan, actorId: string, send: Sender | null,
): Promise<boolean> {
  const [members, { data: votes, error }, vetoRead] = await Promise.all([
    membersOf(db, String(plan.group_id)),
    db.from('votes').select('user_id, option').eq('plan_id', plan.id),
    readVetoes(db, plan.id),
  ]);
  // A veto read that failed would say "Most votes: Porto" with the vetoes
  // against it left out, and the one announcement is spent on it. Say
  // nothing this time; the next vote or leave reads again.
  if (!members || error || (vetoRead as { error?: unknown }).error) return false;
  const notice = everyoneVotedNotice({
    plan, members, actorId,
    votes: (votes ?? []).map(v => ({ user_id: String(v.user_id), option: String(v.option) })),
    vetoes: vetoRead.rows,
  });
  if (!notice) return false;
  if (!(await claimOnce(db, plan.id, actorId, 'everyone_voted', notice.key))) return false;
  if (!notice.told.length) return false;
  await notifyUsers(db, notice.told, notice.note, send);
  return true;
}

/**
 * What the rest of the group hears when somebody opens a vote. The QA run
 * on 2026-11-05 sent a Charleston trip to the group for a vote and the other
 * member heard nothing: the vote waited on somebody who had no way to know
 * it was open. Names only the options the group is shown, never a count.
 */
export function voteOpenedNote(p: {
  planId: string; groupId: string; title: string | null; by: string | null; night: boolean; options: string[];
}): Note {
  const what = !p.title || p.title === 'Where next?' ? (p.night ? 'your next night out' : 'your next trip') : p.title;
  const options = p.options.filter(Boolean).slice(0, 3);
  return {
    kind: 'vote_open',
    title: p.by && p.by !== 'Someone' ? `${p.by} wants your vote` : 'The vote is open',
    body: options.length ? `${options.join(' · ')} — vote on ${what}.` : `Vote on ${what}.`,
    url: `/home?vote=${encodeURIComponent(p.planId)}&group=${encodeURIComponent(p.groupId)}`,
    planId: p.planId,
  };
}

/**
 * Who hears what when a vote is opened, from the plan's readiness read.
 *
 * Votes open when everyone's in (POST /vote answers 403 until then). The
 * QA walk of 5 November opened a vote while B had not answered, and B was
 * told "Test wants your vote" — then refused on pressing Vote. So:
 *
 *   · everybody in: the rest of the group hears "wants your vote";
 *   · somebody still to answer: they are asked to say what they want, with
 *     the vote named as what waits on them, and those who have answered
 *     hear nothing yet — there is nothing they can do until then.
 *
 * `readiness` null is a read that failed: nobody is told anything, because
 * telling the wrong people the wrong thing is worse than the faces on the
 * vote, which can still nudge.
 */
export function voteOpenedNotes(p: {
  planId: string; groupId: string; title: string | null; by: string | null; night: boolean; options: string[];
  actorId: string;
  readiness: { allReady: boolean; members: Array<{ userId: string; ready: boolean }> } | null;
  /** Everybody in the group, for when readiness has no rows (a plan for one). */
  memberIds: string[];
}): Array<{ to: string[]; note: Note }> {
  if (!p.readiness) return [];
  if (p.readiness.allReady) {
    const to = p.memberIds.filter(id => id !== p.actorId);
    return to.length ? [{ to, note: voteOpenedNote(p) }] : [];
  }
  const waiting = p.readiness.members.filter(m => !m.ready && m.userId !== p.actorId).map(m => m.userId);
  if (!waiting.length) return [];
  const what = !p.title || p.title === 'Where next?' ? (p.night ? 'your next night out' : 'your next trip') : p.title;
  return [{
    to: waiting,
    note: {
      kind: 'prefs',
      title: p.by && p.by !== 'Someone' ? `${p.by} is waiting on you` : 'Your answers are still to come',
      body: `Say what you want from ${what} — the vote opens once everyone has answered.`,
      url: `/home?answer=${encodeURIComponent(p.planId)}`,
      planId: p.planId,
    },
  }];
}

/**
 * After somebody leaves a group: every vote open in it that their going
 * has completed. A failed read tells nobody — this is a courtesy, never a
 * gate, and the count itself is right whatever happens here.
 */
export async function tellWhereLeavingCompletesTheVote(
  db: SupabaseClient, groupId: string, actorId: string, send: Sender | null,
): Promise<void> {
  const { data, error } = await db.from('plans').select('*').eq('group_id', groupId).eq('status', 'voting');
  if (error) {
    console.error('[vote] could not read the open votes after somebody left', { groupId, code: error.code });
    return;
  }
  for (const plan of (data ?? []) as VotePlan[]) {
    await tellOrganiserIfEveryoneVoted(db, plan, actorId, send).catch(e => {
      console.error('[vote] could not tell the organiser the vote is complete', { planId: plan.id, error: e instanceof Error ? e.message : String(e) });
      return false;
    });
  }
}
