// ─── Three trip ideas, one set, voted on by everybody ──────────────────
// A group trip's three ideas used to live on one phone. Whoever pressed
// "Find our trips" saw them; their Vote and Veto buttons counted on that
// phone and nowhere else; and whoever tapped "Pick this" decided for the
// whole group — including people who had never seen the options.
//
// Now the ideas are saved on the plan (plans.trip_options), every member
// sees the same three, votes and vetoes are recorded on the server, and only
// the organiser makes the pick. This file is the part of that which is
// decisions rather than database calls, so each rule can be tested on its
// own:
//
//   - who the organiser is, and who may pick
//   - whether a "Find" shows the saved ideas, builds new ones, or is refused
//   - the count: votes, vetoes, the leader, a tie, everyone having voted
//   - what the screen is told — counts, never who vetoed or who voted what
//   - the duplicate guard: one undecided group trip per group at a time
//
// Nothing here reads the database; lib/trip-ideas-store.ts does.

/** One of the three ideas, as the options stage returned it. */
export interface TripIdea {
  /** Assigned when saved, unique within the set. */
  id: string;
  /** What a vote names. The destination, told apart when two share one. */
  title: string;
  destination: string;
  city?: string | null;
  country_code?: string | null;
  tagline?: string;
  vibe?: string;
  costs?: unknown;
  total_per_person?: number;
  /** The days, once written. Absent until then. */
  itinerary?: unknown[] | null;
  used_suggestions?: string[];
  [k: string]: unknown;
}

/** What plans.trip_options holds. */
export interface SavedIdeas {
  /** Which set this is. A regenerate replaces the set, never edits it. */
  set: string;
  /** Bumped on every write, so two writes cannot both land on one read. */
  rev: number;
  mode: 'trip' | 'night';
  foundBy: string;
  foundAt: string;
  options: TripIdea[];
}

const TIER_WORD: Record<string, string> = { saver: 'saver', on_budget: 'on budget', stretch: 'stretch' };

/**
 * The saved form of a fresh set of ideas. Ids are the set's, not the
 * model's: the model's ids are whatever it felt like writing, and a vote or
 * a set of days has to land on exactly one option. Titles are what a vote
 * names, so two ideas at the same place — which is the point when the group
 * has already said where — are told apart by their price tier.
 */
export function ideasFrom(
  trips: Array<Record<string, unknown>>,
  meta: { set: string; foundBy: string; foundAt: string; mode: 'trip' | 'night' },
): SavedIdeas {
  const counts = new Map<string, number>();
  for (const t of trips) {
    const d = String(t.destination ?? '').trim();
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const used = new Set<string>();
  const options = trips.map((t, i) => {
    const destination = String(t.destination ?? '').trim() || `Idea ${i + 1}`;
    let title = destination;
    if ((counts.get(destination) ?? 0) > 1) {
      const tier = TIER_WORD[String(t.tier ?? '')];
      title = tier ? `${destination} · ${tier}` : `${destination} · ${i + 1}`;
    }
    // Still a repeat (two "saver"s at one place): number it.
    if (used.has(title)) title = `${title} · ${i + 1}`;
    used.add(title);
    return { ...t, id: `${meta.set}:${i + 1}`, title, destination } as TripIdea;
  });
  return { set: meta.set, rev: 1, mode: meta.mode, foundBy: meta.foundBy, foundAt: meta.foundAt, options };
}

/** plans.trip_options, read back — or null when it is not a set of ideas. */
export function readIdeas(raw: unknown): SavedIdeas | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.set !== 'string' || !Array.isArray(r.options) || !r.options.length) return null;
  const options = (r.options as unknown[]).filter(
    (o): o is TripIdea => !!o && typeof o === 'object'
      && typeof (o as TripIdea).id === 'string' && typeof (o as TripIdea).title === 'string',
  );
  if (!options.length) return null;
  return {
    set: r.set,
    rev: Number.isFinite(Number(r.rev)) ? Number(r.rev) : 1,
    mode: r.mode === 'night' ? 'night' : 'trip',
    foundBy: String(r.foundBy ?? ''),
    foundAt: String(r.foundAt ?? ''),
    options,
  };
}

/** The set with one option's days written in. Null if that option is not in it. */
export function withDays(saved: SavedIdeas, optionId: string, days: unknown[]): SavedIdeas | null {
  if (!saved.options.some(o => o.id === optionId)) return null;
  return {
    ...saved,
    rev: saved.rev + 1,
    options: saved.options.map(o => (o.id === optionId ? { ...o, itinerary: days } : o)),
  };
}

// ─── Who decides ────────────────────────────────────────────────────────

/**
 * The organiser: whoever set the trip up, or an admin of the group. The same
 * rule that already decides who may move a trip's dates or delete it
 * (app/api/plans/[planId]/route.ts) — one idea of "organiser", not two.
 */
export function isOrganiser(p: { role?: string | null; createdBy?: string | null; userId: string }): boolean {
  return p.role === 'admin' || (!!p.createdBy && p.createdBy === p.userId);
}

/**
 * Who may make the final pick. Somebody on their own always may — there is
 * nobody to wait for and no vote. In a group, only the organiser: the pick
 * is made for everybody, and it used to be made by whoever tapped first.
 */
export function mayPick(p: { role?: string | null; createdBy?: string | null; userId: string; memberCount: number }): boolean {
  if (p.memberCount <= 1) return true;
  return isOrganiser(p);
}

export type FindDecision =
  | { action: 'show' }
  | { action: 'generate'; replacing: string | null }
  | { action: 'refuse'; status: 403; error: string };

/**
 * What a "Find our trips" does on a plan. One set of ideas per plan at a
 * time: a second Find shows the saved ideas rather than building three more
 * over the top of a vote in progress. Building a different three is its own
 * act, and only the organiser's, because it throws everybody's votes away.
 */
export function findDecision(p: { saved: SavedIdeas | null; regenerate: boolean; organiser: boolean }): FindDecision {
  if (!p.regenerate) return p.saved ? { action: 'show' } : { action: 'generate', replacing: null };
  if (!p.organiser) {
    return { action: 'refuse', status: 403, error: 'Only whoever set this trip up can swap the ideas for three different ones.' };
  }
  return { action: 'generate', replacing: p.saved?.set ?? null };
}

// ─── The count ──────────────────────────────────────────────────────────

export interface VoteRow { user_id: string; option: string }
export interface VetoRow { user_id: string; option: string }

/**
 * What every member's screen is told. Counts only: how many votes each idea
 * has, how many vetoes, and the caller's own vote and vetoes. Never who voted
 * for what and never who vetoed — the same rule as readiness, which says who
 * has answered and never what they said.
 */
export interface VoteView {
  counts: Record<string, number>;
  vetoes: Record<string, number>;
  myVote: string | null;
  myVetoes: string[];
  /** Members with a vote on one of these ideas. */
  voted: number;
  /** Members of the group. */
  total: number;
  everyoneVoted: boolean;
  /** Ids of members still to vote. The route turns these into first names. */
  notVoted: string[];
  /** The idea with the most votes, when exactly one has. */
  leader: string | null;
  /** Two or more level at the top. The organiser's call. */
  tied: string[];
}

export function tallyVotes(p: {
  titles: string[];
  votes: VoteRow[];
  vetoes: VetoRow[];
  memberIds: string[];
  me: string;
}): VoteView {
  const titles = new Set(p.titles);
  const members = new Set(p.memberIds);
  const counts: Record<string, number> = Object.fromEntries(p.titles.map(t => [t, 0]));
  const vetoCounts: Record<string, number> = Object.fromEntries(p.titles.map(t => [t, 0]));
  const votedBy = new Set<string>();
  let myVote: string | null = null;

  // A vote only counts on one of these ideas, from somebody still in the
  // group, once. A vote left over from the previous set, or from somebody
  // who has since left, is not a vote on anything anybody can see.
  for (const v of p.votes) {
    if (!titles.has(v.option) || !members.has(v.user_id) || votedBy.has(v.user_id)) continue;
    votedBy.add(v.user_id);
    counts[v.option] += 1;
    if (v.user_id === p.me) myVote = v.option;
  }
  const vetoSeen = new Set<string>();
  const myVetoes: string[] = [];
  for (const v of p.vetoes) {
    const key = `${v.user_id}\u0000${v.option}`;
    if (!titles.has(v.option) || !members.has(v.user_id) || vetoSeen.has(key)) continue;
    vetoSeen.add(key);
    vetoCounts[v.option] += 1;
    if (v.user_id === p.me) myVetoes.push(v.option);
  }

  const top = Math.max(0, ...Object.values(counts));
  const atTop = top > 0 ? p.titles.filter(t => counts[t] === top) : [];
  const total = members.size;
  return {
    counts,
    vetoes: vetoCounts,
    myVote,
    myVetoes,
    voted: votedBy.size,
    total,
    everyoneVoted: total > 1 && votedBy.size >= total,
    notVoted: p.memberIds.filter(id => !votedBy.has(id)),
    leader: atTop.length === 1 ? atTop[0] : null,
    tied: atTop.length > 1 ? atTop : [],
  };
}

// ─── One undecided group trip at a time ─────────────────────────────────

export const WAITING_STATUSES = ['planning', 'voting'] as const;

/**
 * The group trip already waiting on this group, if there is one. Starting a
 * second one would ask everybody the same questions twice and split their
 * answers across two trips, and neither would ever be found. The caller
 * gets the one that exists instead.
 */
export function waitingTripIn(
  plans: Array<{ id: string; destination_style?: string | null; status?: string | null; created_at?: string | null }>,
): string | null {
  const open = plans
    .filter(p => p.destination_style === 'undecided'
      && (WAITING_STATUSES as readonly string[]).includes(String(p.status ?? 'planning')))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return open[0]?.id ?? null;
}
