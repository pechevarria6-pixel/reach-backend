// ─── The one next thing to do on a plan ─────────────────────────────────
// Field feedback, 25 September: people finish a checkout step and then sit
// there, because nothing says what happens next. Before this, three places
// each worked it out their own way — the Home "Waiting on you" list, the
// progress card on the plan screen, and the checkout screen's own step — and
// the sign-off tabs were a fourth. Four answers to one question is how this
// app's bugs usually look: two screens disagreeing about the same trip.
//
// So this is the answer, and every screen asks it. It is built ON TOP of
// what already decides these things, never beside it:
//
//   checkoutState / stepOf   (lib/checkout.ts)    what the money and rows allow
//   bookedClaim              (lib/checkout.ts)    whether "booked" may be said
//   bookingTracker           (lib/plan-steps.ts)  what the Book tab lists to book
//
// A second machine reading the same rows would drift from the first the day
// somebody fixed one of them.
//
// ── The rail ──
//
// The owner's decision of 25 September: one progress rail, Plan → Vote →
// Lock in → Pay → Booked, replaces the three sign-off tabs (Overview →
// Budget → Book) asked for on the 24th. The rail is `rail` on the answer,
// worked out here from the same place the state is, so the dots and the
// button under them cannot disagree. Vote is there only when there is a
// vote, never on a plan for one; Pay only when Reach buys something.
//
// "Lock in" is the plan agreed: plans.status past planning and voting, which
// is what opens the booking (the Book tab's "Book everything" has always
// waited on it). The sign-offs, POST /api/plans/[id]/review and the
// plans.review column are left in place and read by nothing.
//
// ── What "booked" means here ──
//
// Only what the rows say (the spec's non-negotiable). `booked` needs:
//   - bookedClaim === 'all_booked' over the rows that count. Left out of
//     that count: a redirect somebody has recorded a confirmation number
//     for (they bought it elsewhere; Reach did not, so it is neither booked
//     nor a gap), and a row every traveller sits out. A redirect with no
//     confirmation is not left out — it stops at `finish_elsewhere` first.
//     A held row ('quoted') is not booked either: it stops at
//     `needs_attention` first, because the person chose to wait on it.
//   - every line the Book tab lists done (bookingTracker), a line bought
//     elsewhere with a confirmation number counting as done — or, where
//     nothing needs booking at all, the plan locked in and whatever needs
//     reserving reserved.
//
// A redirect is a row whose mode is 'redirect', whatever its status: POST
// /api/bookings writes a Ticketmaster seat or a Resy table as
// 'awaiting_approval' like everything else, and checkout never approves it
// (Reach does not buy it), so it never reaches 'redirected'. Only the flight
// handed to the airline at approval is written 'redirected'. Reading the
// status alone missed the common hand-off entirely.
//
// A plan with no booking rows at all — a night of walk-ins — reaches
// `booked` once it is locked in, but `allBooked` is false and the copy never
// says "booked": nothing was. The celebration reads `allBooked`.
//
// ── Solo ──
//
// A plan for one never waits on anybody. `waiting_on_others` and
// `waiting_on_payments` are unreachable when memberCount is 1, and the copy
// for one person is singular. tests/unit/next-action.test.ts holds both.
import {
  checkoutState, bookedClaim, bookedWording, dedupe, itemTitle, supportMailto,
  type BookedClaim, type CheckoutRow, type CheckoutStep, type FundingView,
} from './checkout.ts';
import { reachBuys } from './booking/charged.ts';
import { bookingTracker, type TrackLine } from './plan-steps.ts';

export const NEXT_STATES = [
  'needs_trip_input',
  'waiting_on_others',
  'vote_open',
  'lock_in',
  'pay_share',
  'waiting_on_payments',
  'needs_travel_details',
  'ready_to_book',
  'finish_elsewhere',
  'booking_in_progress',
  'needs_attention',
  'booked',
] as const;
export type NextState = typeof NEXT_STATES[number];

/** Where a button goes. Screen names are the app's own (push in reach-app.jsx). */
export type Screen = 'planDetail' | 'planPrefs' | 'groupTrip' | 'checkout' | 'profile';
export type PlanTab = 'overview' | 'budget' | 'bookings' | 'vote' | 'members' | 'itinerary';

export type Cta = { label: string } & (
  /** Opens a screen in the app. */
  | { kind: 'navigate'; route: { screen: Screen; params: Record<string, string> } }
  /** POST /api/plans/[id]/notify with this kind — the reminder that exists. */
  | { kind: 'nudge'; nudge: 'vote' | 'funding' | 'prefs' }
  /** Somewhere outside the app: the seller's site, a phone number, the inbox. */
  | { kind: 'link'; href: string }
  /**
   * "I've got it": the person says they bought it elsewhere. A booking row
   * takes a confirmation number (bookings.confirmation_number); an itinerary
   * line is marked filled, as the Book tab already does.
   */
  | { kind: 'confirm'; bookingId?: string; itemId?: string }
);

export interface NextAction {
  state: NextState;
  title: string;
  body: string | null;
  /** The one thing to press. Null only for booking_in_progress: nothing to do but wait. */
  cta: Cta | null;
  secondary?: Cta | null;
  /** The status chip, from the same answer: never from plans.status. */
  chip: string;
  /** First names, where the state is a wait on people. Never on a solo plan. */
  waitingOn?: string[];
  /** The checkout step this was read from, once there are rows to read. */
  checkoutStep: CheckoutStep | null;
  /** bookedClaim over the rows that count, or null when there are none. */
  claim: BookedClaim | null;
  /** Every row that counts is confirmed, and there is at least one. What the celebration reads. */
  allBooked: boolean;
  /** The progress rail, from this same answer: the only progress a screen draws. */
  rail: RailDot[];
}

/** Plan → Vote → Lock in → Pay → Booked (the owner's decision 1, 25 September). */
export type RailKey = 'plan' | 'vote' | 'lock' | 'pay' | 'booked';
export interface RailDot {
  key: RailKey;
  label: string;
  state: 'done' | 'current' | 'todo';
}

/** A booking row as the contract carries it (lib/contracts/booking.ts), plus what checkout reads. */
export type NextBooking = Omit<CheckoutRow, 'vertical'> & {
  vertical?: string | null;
  redirect_url?: string | null;
  provider_ref?: string | null;
  /** Written by "I've got it" (sql booking-confirmation, 2026-09-25). Absent before that runs. */
  confirmation_number?: string | null;
};

/** An itinerary line as the screen holds it (ItineraryItem in lib/contracts/itinerary-item.ts). */
export type NextLine = TrackLine & {
  title?: string | null;
  venue_name?: string | null;
  venue_phone?: string | null;
};

export interface NextPlan {
  id: string;
  groupId?: string | null;
  /** planning | voting | approved | booked | cancelled | completed */
  status?: string | null;
  /** 'restaurant' is a night out. */
  type?: string | null;
  title?: string | null;
  /** 'undecided' while there is no destination yet. */
  destStyle?: string | null;
  /** Whether there are ideas to vote on or pick from. */
  hasOptions?: boolean;
  createdBy?: string | null;
  /**
   * The reader decides for this plan — whoever set it up, or an admin of the
   * group (isOrganiser in lib/trip-vote.ts, worked out by the screen, which
   * holds the reader's role). Without it only createdBy is read, and a plan
   * made before created_by was recorded would wait on nobody for ever.
   */
  organiserIsMe?: boolean;
  itinerary?: NextLine[] | null;
}

/** GET /api/plans/[id]/readiness → preferences (ReadinessReport in lib/plan-readiness.ts). */
export interface AnswersView {
  members: { userId: string; name: string; ready: boolean; answered: boolean }[];
  waitingOn: string[];
  solo: boolean;
  wentAhead?: boolean;
}

/** GET /api/plans/[id]/readiness → travelers (Readiness in lib/essentials.ts). */
export interface DetailsView {
  travelers: { userId: string; name: string; ready: boolean; missing: string[] }[];
}

/** GET /api/plans/[id]/vote, as far as this needs it. */
export interface VoteView {
  decided?: boolean | null;
  myVote?: string | null;
  everyoneVoted?: boolean | null;
  mayPick?: boolean | null;
  /** 'you' for the reader, first names for everyone else. */
  stillToVote?: string[] | null;
  organiser?: { name: string; isYou: boolean } | null;
}

export interface NextActionInput {
  plan: NextPlan;
  bookings: NextBooking[] | null | undefined;
  funding: FundingView | null | undefined;
  /** Who has answered for this trip. Null when the read failed: nobody is then named. */
  readiness: AnswersView | null | undefined;
  /** Who can be put on a flight. Null when unknown: nobody is asked for anything. */
  essentials: DetailsView | null | undefined;
  memberCount: number;
  /** The reader's user id. */
  me: string | null | undefined;
  vote?: VoteView | null;
  /** item_optouts: booking ids somebody sits out (lib/participation.ts). */
  skips?: { ref: string; userId: string }[] | null;
  /** What the last press answered, where it refused: 402 short of money, 409 a price rise. */
  outcome?: { status: number; priceChangeCents?: number | null } | null;
  now?: Date;
}

// ─── Words ──────────────────────────────────────────────────────────────

const cents = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));

/** $1,474 or $12.50 — the pennies only where there are some. */
export function usd(amount: number): string {
  const c = cents(amount);
  const whole = c % 100 === 0;
  return `$${(c / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** "Sam", "Sam and Alex", "Sam, Alex and Priya". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Providers by the name they trade under; anything else by its site. */
const PROVIDER_NAMES: Record<string, string> = {
  resy: 'Resy', opentable: 'OpenTable', ticketmaster: 'Ticketmaster', stubhub: 'StubHub',
  seatgeek: 'SeatGeek', duffel: 'the airline', liteapi: 'the hotel', viator: 'Viator',
  eventbrite: 'Eventbrite', dice: 'DICE',
};

/** Where a redirect finishes, named from what the row holds — never guessed. */
export function providerName(row: { provider?: string | null; redirect_url?: string | null }): string | null {
  const p = String(row.provider ?? '').trim().toLowerCase();
  if (p && PROVIDER_NAMES[p]) return PROVIDER_NAMES[p];
  try {
    if (row.redirect_url) return new URL(row.redirect_url).hostname.replace(/^www\./, '');
  } catch { /* not a URL: said without a name */ }
  return null;
}

const trips = (plan: NextPlan) => (plan.type === 'restaurant' ? 'nights out' : 'trips');
const called = (plan: NextPlan) => (plan.title?.trim() || (plan.type === 'restaurant' ? 'this night out' : 'this trip'));

// ─── The answer ─────────────────────────────────────────────────────────

export function getNextAction(input: NextActionInput): NextAction | null {
  const { plan } = input;
  // A trip called off has nothing next. Every other plan always has something.
  if (plan.status === 'cancelled') return null;

  // isSoloCount in lib/joining.ts, said here so this file stays light enough
  // for the client bundle (joining.ts reaches Stripe). The test holds them
  // together.
  const solo = !(input.memberCount > 1);
  const me = input.me ?? null;
  const funding = input.funding ?? null;
  const lines = plan.itinerary ?? [];
  const organiser = solo || plan.organiserIsMe === true || (!!me && plan.createdBy === me) || input.vote?.organiser?.isYou === true;
  const organiserName = input.vote?.organiser && !input.vote.organiser.isYou ? input.vote.organiser.name : null;

  const nav = (screen: Screen, tab?: PlanTab) => ({
    kind: 'navigate' as const,
    route: {
      screen,
      params: {
        ...(screen === 'profile' ? {} : { planId: plan.id }),
        ...(screen !== 'profile' && plan.groupId ? { groupId: plan.groupId } : {}),
        ...(tab ? { initialTab: tab } : {}),
      },
    },
  });

  /** A hand-off to the seller's own site, still open (see the top of this file). */
  const handedOff = (r: NextBooking) => (r.mode === 'redirect' || r.status === 'redirected')
    && !['confirmed', 'failed', 'cancelled'].includes(String(r.status ?? ''));
  const gotElsewhere = (r: NextBooking) => handedOff(r) && !!r.confirmation_number?.trim();

  const rows = (input.bookings ?? []).map(r => ({ ...r, vertical: r.vertical ?? '' }) as CheckoutRow & NextBooking);
  const live = dedupe(rows) as (CheckoutRow & NextBooking)[];
  const cs = rows.length ? checkoutState(rows, { funding, now: input.now }) : null;

  const base = { checkoutStep: cs?.step ?? null, claim: null as BookedClaim | null, allBooked: false };

  // ── The rail: which dots there are, and which one this answer is on ──
  // A vote only where there is one, and never for one person. Pay only where
  // Reach buys something: a line it books that is not a table or a seat
  // (those are bought from the seller), a row it pays a provider for, or
  // money already asked for or in.
  const hasVote = !solo && plan.hasOptions === true;
  const buys = lines.some(l => l.booking_mode === 'reach' && l.type !== 'restaurant' && l.type !== 'event')
    || live.some(r => reachBuys(r) && r.status !== 'failed' && r.status !== 'cancelled')
    || cents(funding?.targetCents) > 0 || cents(funding?.collectedCents) > 0;
  // Something that has to be booked by somebody, so that "Booked" is a true
  // word for the last dot. Otherwise it is "All set".
  const anythingToBook = live.length > 0 || bookingTracker(lines, []).total > 0;
  const keys: RailKey[] = ['plan', ...(hasVote ? ['vote' as const] : []), 'lock', ...(buys ? ['pay' as const] : []), 'booked'];
  const LABEL: Record<RailKey, string> = { plan: 'Plan', vote: 'Vote', lock: 'Lock in', pay: 'Pay', booked: anythingToBook ? 'Booked' : 'All set' };
  /** Where the answer being built sits on the rail. Moved on as the checks below pass. */
  let stage: RailKey = 'plan';
  const railAt = (state: NextState): RailDot[] => {
    const at = state === 'booked' ? keys.length
      : Math.max(0, keys.indexOf(stage === 'pay' && !buys ? 'booked' : stage === 'vote' && !hasVote ? 'plan' : stage));
    return keys.map((key, i) => ({ key, label: LABEL[key], state: i < at ? 'done' : i === at ? 'current' : 'todo' }));
  };
  const say = (a: Omit<NextAction, 'checkoutStep' | 'claim' | 'allBooked' | 'rail'> & Partial<NextAction>): NextAction =>
    ({ ...base, rail: railAt(a.state), ...a });

  const waitOn = (names: string[], title: string, body: string | null, cta: Cta): NextAction | null => {
    // Never on a plan for one, whatever the rows or the reads say.
    if (solo) return null;
    const who = names.filter(n => n && n !== 'you');
    if (!who.length) return null;
    return say({ state: 'waiting_on_others', title, body, cta, chip: 'Waiting', waitingOn: who });
  };
  const remind = (names: string[], nudge: 'vote' | 'funding' | 'prefs'): Cta => ({
    label: names.length === 1 ? `Remind ${names[0]}` : 'Remind them', kind: 'nudge', nudge,
  });

  // ── Before anything is moving: answers, the vote, the plan itself ──
  // "Moving" is money in or a row past held. A plan that has started paying
  // is never sent back to a vote or a sign-off because a rule changed under
  // it — the same grace plan-readiness gives trips already in flight.
  const moving = live.some(r => r.status !== 'quoted') || cents(funding?.collectedCents) > 0;
  // Agreed: past planning and voting. 'booked' is the old word for the same
  // thing further on, and a plan already moving is past it whatever it says.
  const lockedIn = moving || ['approved', 'booked', 'completed'].includes(String(plan.status ?? ''));

  if (!moving) {
    const answers = input.readiness && !input.readiness.solo && !solo ? input.readiness : null;
    const mine = answers?.members.find(m => m.userId === me);
    if (mine && !mine.ready) {
      return say({
        state: 'needs_trip_input', title: 'Add your two cents',
        body: `Say what you want from ${called(plan)}. The ${trips(plan)} are built from what each of you says.`,
        cta: { label: 'Answer →', ...nav('planPrefs') }, chip: 'Planning',
      });
    }

    const undecided = plan.destStyle === 'undecided';
    const voting = !solo && plan.status === 'voting' && plan.hasOptions === true && input.vote?.decided !== true;

    if (undecided && !voting && answers && answers.waitingOn.length) {
      const w = waitOn(answers.waitingOn, `Waiting on ${list(answers.waitingOn)}`,
        `They haven't said what they want from ${called(plan)} yet. Nothing is found until they do.`,
        remind(answers.waitingOn, 'prefs'));
      if (w) return w;
    }

    if (voting) {
      stage = 'vote';
      const v = input.vote;
      if (!v) {
        // The vote could not be read, so whether this person has voted is
        // not known. Said as the vote being open, which is true.
        return say({ state: 'vote_open', title: `${called(plan)} is being voted on`, body: null,
          cta: { label: 'Open the vote →', ...nav('planDetail', 'vote') }, chip: 'Voting' });
      }
      if (!v.myVote) {
        return say({ state: 'vote_open', title: 'Pick the one you want', body: `The vote on ${called(plan)} is open.`,
          cta: { label: 'Vote →', ...nav('planDetail', 'vote') }, chip: 'Voting' });
      }
      if (v.everyoneVoted && v.mayPick) {
        return say({ state: 'vote_open', title: 'Everyone has voted', body: 'The pick is yours.',
          cta: { label: 'Pick →', ...nav('planDetail', 'vote') }, chip: 'Voting' });
      }
      if (!v.everyoneVoted) {
        const still = (v.stillToVote ?? []).filter(n => n !== 'you');
        const w = waitOn(still, `Waiting on ${list(still)}`, `You've voted. The vote on ${called(plan)} is still open.`,
          remind(still, 'vote'));
        if (w) return w;
      }
      const w = waitOn([organiserName ?? 'the organiser'], `Waiting on ${organiserName ?? 'the organiser'} to pick`,
        'Everyone has voted.', { label: 'See the votes →', ...nav('planDetail', 'vote') });
      if (w) return w;
    }

    if (undecided) {
      if (plan.hasOptions) stage = 'vote';
      return plan.hasOptions
        ? say({ state: 'needs_trip_input', title: 'Pick the one you want', body: `The ideas for ${called(plan)} are ready.`,
          cta: { label: 'See them →', ...nav('groupTrip') }, chip: 'Planning' })
        // "Everyone has answered" only where every member's answer is in the
        // read. plan-readiness counts a member nobody has asked as ready, so
        // an empty waitingOn is not the same thing, and a failed read says
        // nothing about anybody.
        : !solo && answers && answers.members.length > 0 && answers.members.every(m => m.answered)
          ? say({ state: 'needs_trip_input', title: 'Everyone has answered',
            body: `Find the ${trips(plan)} — built from what each of you said.`,
            cta: { label: 'Find them →', ...nav('groupTrip') }, chip: 'Planning' })
          : say({ state: 'needs_trip_input', title: `Find the ${trips(plan)}`,
            body: `Nothing is picked for ${called(plan)} yet.`,
            cta: { label: 'Find them →', ...nav('groupTrip') }, chip: 'Planning' });
    }

    if (!lines.length) {
      return say({ state: 'needs_trip_input', title: 'Plan the days', body: `${called(plan)} has no day-by-day plan yet.`,
        cta: { label: 'Plan them →', ...nav('planDetail', 'itinerary') }, chip: 'Planning' });
    }

    // Lock in: the plan agreed. Until it is, nothing is priced or booked —
    // the Book tab's "Book everything" waits on the same status.
    stage = 'lock';
    // A vote on a plan whose place was already set (options put to the group
    // from the create flow) has no pick of its own: locking the plan in is
    // what closes it, so until then the rail is still on the vote.
    if (!lockedIn && hasVote && plan.status === 'voting') stage = 'vote';
    if (!lockedIn) return lockIn();
  }

  function lockIn(): NextAction {
    const body = hasVote && !organiser ? null : 'Nothing is priced or booked until it is.';
    if (organiser) {
      return say({ state: 'lock_in', title: 'Lock it in', body, cta: { label: 'Lock it in →', ...nav('planDetail', 'overview') }, chip: 'Planning' });
    }
    const who = organiserName ?? 'the organiser';
    return waitOn([who], `Waiting on ${who} to lock it in`, 'Nothing is priced or booked until then.',
      { label: 'See the plan →', ...nav('planDetail', 'overview') })
      // Unreachable (solo is always the organiser); the type wants an answer.
      ?? say({ state: 'lock_in', title: 'Lock it in', body, cta: { label: 'Lock it in →', ...nav('planDetail', 'overview') }, chip: 'Planning' });
  }

  // Locked in, and lines Reach books with no row yet: checkout is what makes
  // the rows (it asks /bookable on the way in — the B1 bridge) and prices them.
  stage = 'pay';
  const rowed = new Set(live.map(r => r.itinerary_item_id).filter(Boolean));
  const unrowed = lines.filter(l => l.booking_mode === 'reach' && !!l.id && !rowed.has(l.id));
  if (!moving && unrowed.length) {
    return say({
      state: 'pay_share', title: 'See what it costs',
      body: `${unrowed.length === 1 ? '1 thing' : `${unrowed.length} things`} for Reach to book. Checkout prices ${unrowed.length === 1 ? 'it' : 'them'}, and nothing is charged until you pay.`,
      cta: toCheckout('See the prices →'), chip: 'Locked in',
    });
  }

  // ── The checkout: what the money and the rows allow ──
  const myDetails = input.essentials?.travelers.find(t => t.userId === me) ?? null;
  const flightWaiting = !!cs?.waiting.some(r => r.vertical === 'flight');
  const needsMyDetails = (): NextAction | null => {
    if (!flightWaiting || !myDetails || myDetails.ready) return null;
    const missing = myDetails.missing.length ? list(myDetails.missing) : 'your travel details';
    return say({ state: 'needs_travel_details', title: 'Add your travel details',
      body: `Flights can't be booked without your ${missing}.`,
      cta: { label: 'Add them →', ...nav('profile') }, chip: 'Details needed' });
  };
  const attention = (title: string, body: string | null, cta: Cta): NextAction =>
    say({ state: 'needs_attention', title, body, cta, chip: 'Needs you' });
  const write = (what: string): Cta => ({
    label: 'Write to us', kind: 'link',
    href: supportMailto({ planId: plan.id, planName: plan.title, what, bookings: live.map(r => r.id ?? null) }),
  });
  // A declaration, so the lock-in step above can use it too.
  function toCheckout(label: string): Cta { return { label, ...nav('checkout') }; }

  if (input.outcome?.status === 409) {
    const up = cents(input.outcome.priceChangeCents);
    return attention(up ? `Price went up ${usd(up)}` : 'The price changed', 'Nothing was booked at the new price.',
      toCheckout('Still book it?'));
  }
  if (input.outcome?.status === 402 && !solo) {
    return say({ state: 'waiting_on_payments', title: 'A few people still need to chip in',
      body: 'Nothing is booked until the trip is paid for.', cta: remind([], 'funding'), chip: 'Paying' });
  }

  if (cs) {
    if (cs.step === 'in_progress') { stage = 'booked'; return inProgress(cs.rows.find(r => r.status === 'booking') ?? null); }
    if (cs.step === 'in_doubt') {
      return attention("This may have gone through",
        "It was sent to be booked and no answer came back, so it isn't tried again from here. Write to us before booking it anywhere else.",
        write('A booking that may have gone through'));
    }
    if (cs.clashes.length) {
      return attention('Booked twice', "The same journey is booked more than once. Reach won't cancel either on its own — write to us and say which one goes.",
        write('The same journey booked twice'));
    }
    const heldOnly = cs.step === 'blocked' && cs.broken.length === 0
      && live.filter(r => reachBuys(r) && r.status !== 'failed').every(r => r.status === 'quoted');
    if (cs.step === 'blocked' && !heldOnly) {
      return cs.broken.length
        ? attention(cs.broken.length === 1 ? "One booking couldn't be made" : `${cs.broken.length} bookings couldn't be made`,
          'Each one says why. Fix it, or book the rest without it.', toCheckout('See what went wrong →'))
        // Blocked with nothing broken is one of two things, and they are not
        // said the same way: a row with no price (the rows cannot be paid
        // for), or rows that can be paid for and money that does not cover
        // them with nobody left owing (the funding figures and the rows
        // disagree). Only the first is "no price".
        : !cs.canPay && !cs.nothingToCharge
          ? attention('Something here has no price yet', "It can't be paid for until it has one.", toCheckout('Open checkout →'))
          : attention("What's paid doesn't cover this yet", 'Checkout has what is paid and what is left.', toCheckout('Open checkout →'));
    }
    if (cs.step === 'paid_nothing_booked') {
      return attention('Paid, and nothing is booked', 'Nothing is waiting to be booked either. Checkout says what happened.',
        toCheckout('Open checkout →'));
    }
    if (cs.step === 'pay' || cs.step === 'top_up') {
      const details = needsMyDetails();
      if (details) return details;
      const owe = cents(funding?.myRemainingCents);
      const paid = cents(funding?.myPaidCents);
      return say({
        state: 'pay_share',
        title: owe ? (solo ? `Pay ${usd(owe)}` : `Chip in ${usd(owe)}`) : (solo ? 'Pay for it' : 'Chip in your share'),
        body: cs.step === 'top_up'
          ? `You've paid ${usd(paid)}. This is what was added or went up since.`
          : solo ? 'What Reach books for this trip. It books once it is paid for.' : 'Your share of what Reach books. It books once the trip is paid for.',
        cta: toCheckout('Pay →'), chip: 'Paying',
      });
    }
    if (cs.step === 'waiting') {
      // stepOf never says waiting for a plan of one; asked again here.
      if (!solo) {
        return say({ state: 'waiting_on_payments',
          title: `${usd(cents(funding?.collectedCents))} of ${usd(cents(funding?.targetCents))} in`,
          body: "Your share is paid. It books once the rest is in.", cta: remind([], 'funding'), chip: 'Paying' });
      }
    }
    if (cs.step === 'book') {
      stage = 'booked';
      const details = needsMyDetails();
      if (details) return details;
      const others = flightWaiting ? (input.essentials?.travelers ?? []).filter(t => !t.ready && t.userId !== me) : [];
      if (others.length) {
        const names = others.map(t => t.name.trim().split(/\s+/)[0] || 'someone');
        const w = waitOn(names, `Waiting on ${list(names)}`,
          `${names.length === 1 ? 'They need' : 'They each need'} to add their travel details before flights can be booked.`,
          { label: "See who's going →", ...nav('planDetail', 'members') });
        if (w) return w;
      }
      const what = cs.waiting.map(r => itemTitle(r));
      return say({ state: 'ready_to_book', title: "It's paid for — book it",
        body: what.length ? `${list(what.slice(0, 3))}${what.length > 3 ? ` and ${what.length - 3} more` : ''}.` : null,
        cta: toCheckout('Book it →'), chip: 'Ready to book' });
    }
  }

  function inProgress(row: (CheckoutRow & NextBooking) | null): NextAction {
    const name = row ? itemTitle(row) : null;
    return say({ state: 'booking_in_progress', title: 'Being booked now',
      body: `${name ? `${name} is` : "It's"} with the provider. Open the trip again in a minute to see how it went.`,
      cta: null, chip: 'Booking' });
  }

  // ── After the round: what is left, and whether it is booked ──
  stage = 'booked';
  const mySkips = new Set((input.skips ?? []).filter(s => s.userId === me).map(s => s.ref));
  const skipCount = new Map<string, number>();
  for (const s of input.skips ?? []) skipCount.set(s.ref, (skipCount.get(s.ref) ?? 0) + 1);

  const unfinished = live.filter(r => handedOff(r) && !gotElsewhere(r) && !(r.id && mySkips.has(r.id)));
  if (unfinished.length) {
    const r = unfinished[0];
    const where = providerName(r);
    const name = itemTitle(r);
    return say({
      state: 'finish_elsewhere', title: where ? `Finish on ${where}` : `Finish ${name}`,
      body: `${name} is booked on ${where ? `${where}'s` : 'the seller\'s'} own site, not through Reach. Say once you've got it.`,
      cta: r.redirect_url ? { label: where ? `Finish on ${where} →` : 'Finish it →', kind: 'link', href: r.redirect_url } : toCheckout('Open checkout →'),
      secondary: r.id ? { label: "I've got it ✓", kind: 'confirm', bookingId: r.id } : null,
      chip: 'Almost there',
    });
  }

  // The whole row, so the day bookingTracker learns to read a confirmation
  // number this reads it too. Until then a line bought elsewhere, with the
  // number to show for it, is read as done: it is booked, just not by Reach,
  // and with the sign-offs gone there is no tab left to refuse it.
  const tracker = bookingTracker(lines, live.map(r => ({
    ...r, itinerary_item_id: r.itinerary_item_id ?? null,
    status: gotElsewhere(r) ? 'confirmed' : String(r.status ?? ''),
  })));
  const yours = tracker.items.filter(i => i.who === 'you' && !i.done);
  if (yours.length) {
    const line = yours[0].line;
    const name = line.venue_name?.trim() || line.title?.trim() || 'This one';
    const cta: Cta = line.venue_website
      ? { label: 'Book on their site →', kind: 'link', href: line.venue_website }
      : line.venue_phone
        ? { label: `Call ${name}`, kind: 'link', href: `tel:${line.venue_phone.replace(/[^\d+]/g, '')}` }
        : { label: 'Open the list →', ...nav('planDetail', 'bookings') };
    return say({
      state: 'finish_elsewhere', title: `Book ${name}`,
      body: `Reach can't book this one. ${line.venue_website ? "It's booked on their own site" : line.venue_phone ? 'They take bookings by phone' : 'It needs booking ahead'} — say once it's done.`,
      cta, secondary: line.id ? { label: "I've got it ✓", kind: 'confirm', itemId: line.id } : null,
      chip: 'Almost there',
    });
  }

  // Moving, and a line Reach books still has no row: /bookable was asked
  // and skipped it (a flight when members' airports differ, say). Sending
  // anybody back to "Lock it in" loops — the budget is signed and the same
  // skip happens again — and "Nothing is booked until then" is untrue once
  // something is. Checkout lists what /bookable skipped and why.
  if (unrowed.length) {
    const first = unrowed[0] as NextLine;
    const name = first.venue_name?.trim() || first.title?.trim() || null;
    return attention(
      unrowed.length === 1 ? `${name ?? 'One thing'} has no price yet` : `${unrowed.length} things have no price yet`,
      `Reach couldn't price ${unrowed.length === 1 ? 'it' : 'them'}, so ${unrowed.length === 1 ? "it isn't" : "they aren't"} booked. Checkout says why.`,
      toCheckout('See why →'));
  }

  const held = live.filter(r => r.status === 'quoted' && reachBuys(r));
  if (held.length) {
    const name = itemTitle(held[0]);
    return attention(held.length === 1 ? `${name} is on hold` : `${held.length} things are on hold`,
      solo ? "Held back from the booking, so it isn't booked and isn't in what you pay." : "Held back from the booking, so it isn't booked and isn't in anyone's share.",
      toCheckout('See what is held →'));
  }

  // The rows that count toward "booked" (see the top of this file).
  const counted = live.filter(r =>
    !gotElsewhere(r)
    && !(r.id && input.memberCount > 0 && (skipCount.get(r.id) ?? 0) >= input.memberCount));
  const claim = counted.length ? bookedClaim(counted) : null;
  // What the Book tab still lists as to book.
  const leftOnTab = tracker.items.filter(i => !i.done);
  base.claim = claim;
  base.allBooked = claim === 'all_booked' && leftOnTab.length === 0;

  if (claim && claim !== 'all_booked') {
    if (claim === 'booked_with_gaps' || claim === 'nothing_booked') {
      const w = bookedWording(claim);
      return attention(w.title, w.sub, toCheckout("See what's next →"));
    }
    // Still open and not failed: with a provider that has not answered, or
    // a request nobody has confirmed.
    const answering = counted.find(r => r.status === 'pending' && reachBuys(r));
    if (answering) return inProgress(answering);
    const open = counted.find(r => r.status !== 'confirmed');
    return attention(`${open ? itemTitle(open) : 'Something'} isn't booked yet`, 'Checkout says where it stands.',
      toCheckout('Open checkout →'));
  }

  // The rows say nothing is left, and the Book tab still lists a line as to
  // book (a row everybody sits out, say). Not booked, so not said to be.
  if (leftOnTab.length) {
    const t = leftOnTab[0].line as NextLine;
    const row = live.find(r => r.itinerary_item_id && r.itinerary_item_id === t.id) ?? null;
    const name = t.venue_name?.trim() || t.title?.trim() || (row ? itemTitle(row) : 'One thing');
    return attention(`${name} is still to book`,
      "It stays on the Book tab's list until it is booked or taken off the plan.",
      { label: 'Open the Book tab →', ...nav('planDetail', 'bookings') });
  }

  return say({
    state: 'booked',
    title: base.allBooked ? bookedWording('all_booked').title : "You're all set",
    body: base.allBooked ? 'Every booking is confirmed.'
      : anythingToBook ? 'Everything on it is sorted.' : 'Nothing on this one needs booking.',
    cta: { label: 'See your trip →', ...nav('planDetail', 'bookings') },
    chip: base.allBooked ? '✓ Booked' : '✅ Ready to go',
  });
}
