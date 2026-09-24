// ─── What the checkout screen is allowed to show, and charge ────────────
// From a production screenshot on 18 September: three rows all titled
// "restaurant", each saying "We'll handle this one for you", a total of $0,
// and "Looks good" ready to be tapped.
//
// Reading the rows behind it, the three were not duplicates. They were three
// different reservations — a seafood dinner, a night in Canyonlands, a last
// seafood dinner — every one of them rendered as the word `restaurant`,
// because the screen did this:
//
//     (b.detail && (b.detail.title || b.detail.name)) || b.vertical
//
// `bookings.detail` is a string. `.title` and `.name` on a string are both
// undefined, so every row fell through to the enum. That matters more than
// it looks: dedupe on what the screen was displaying would have collapsed
// three real reservations into one and quietly dropped two of somebody's
// dinners.
//
// So the order here is deliberate — name the rows properly first, then
// collapse only what is genuinely the same row.

import { reachBuys } from './booking/charged.ts';

export type CheckoutRow = {
  id?: string;
  vertical: string;
  /** bookings.detail — a string, sometimes an object from older rows. */
  detail?: unknown;
  price_cents?: number | null;
  mode?: string | null;
  provider?: string | null;
  status?: string | null;
  itinerary_item_id?: string | null;
  scheduled_date?: string | null;
};


/**
 * Rows written before the concierge label was shortened.
 *
 * They hold the whole request in one string, which on the Moab trip reads:
 *
 *   Reservation request: Seafood dinner at Desert Bistro,  · 2026-09-17
 *   Day 3 · Evening · party of 2 · "Mesa Arch at sunrise means a crowd…"
 *
 * The name is the part before the first separator. Trimming it here rather
 * than rewriting the rows means nobody's existing trip has its booking
 * history edited to make a screen look tidier.
 */
export function tidyLegacy(detail: string): string {
  let text = detail.replace(/^Reservation request:\s*/i, '');
  const cut = text.indexOf(' · ');
  if (cut > 0) text = text.slice(0, cut);
  // A missing city left "Desert Bistro, " with nothing after the comma.
  return text.replace(/,\s*$/, '').trim() || detail;
}

/**
 * What this row is, in the words it was booked under.
 *
 * Never the vertical. "restaurant" is a category, and a person looking at a
 * checkout screen is entitled to know which restaurant.
 */
/**
 * What a row with no name of its own should be called.
 *
 * Never "Trip item (details coming)". Eleven rows in the table have no
 * detail — mostly flights that failed before a provider ever named one — and
 * that string promised details were on their way when nothing was coming.
 * It is a placeholder, and the rule is that a placeholder never reaches a
 * screen.
 *
 * An article makes these read as a description rather than a title, which is
 * what they are: the row says what kind of thing it was, the status chip
 * says it could not be booked, and the reason sits underneath. That is three
 * true things, which beats one invented one.
 */
const UNNAMED: Record<string, string> = {
  flight: 'A flight',
  hotel: 'Somewhere to stay',
  restaurant: 'A table',
  activity: 'An activity',
  event: 'A ticket',
  transport: 'Getting around',
};

/**
 * Whether this row carries a name of its own.
 *
 * `dedupe` used to ask "is the title the placeholder string?", which tied a
 * correctness rule to a piece of copy. Changing the copy would then have
 * merged two unnamed rows into one and dropped somebody's booking — the very
 * thing the test beside it was written to prevent. The question is about the
 * row, so it is asked of the row.
 */
export function hasOwnName(row: CheckoutRow): boolean {
  const d = row.detail;
  if (typeof d === 'string') return d.trim().length > 0;
  if (d && typeof d === 'object') {
    const o = d as { title?: unknown; name?: unknown };
    return [o.title, o.name].some(v => typeof v === 'string' && v.trim().length > 0);
  }
  return false;
}

export function itemTitle(row: CheckoutRow, fallback?: string | null): string {
  const d = row.detail;
  if (typeof d === 'string' && d.trim()) return tidyLegacy(d.trim());
  // Older rows stored an object. Both spellings appear in the table.
  if (d && typeof d === 'object') {
    const o = d as { title?: unknown; name?: unknown };
    for (const v of [o.title, o.name]) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  // The itinerary line this booking was made from, where the caller knows
  // it. A booking of "13 nights in Moab" is that, whatever the provider
  // managed to return.
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return UNNAMED[row.vertical] ?? 'Part of this trip';
}

/**
 * The same row twice, collapsed.
 *
 * Keyed on the itinerary line where there is one, because that is what a
 * booking is actually of, and two rows from one line are the duplicate we
 * care about. Only rows with no line fall back to name-matching, and a row
 * with no usable name is never merged with another — two unnamed rows are
 * two rows until somebody proves otherwise.
 */
/**
 * How much a row means, when two describe the same itinerary line.
 *
 * Keeping whichever came back first was wrong: a line that failed and was
 * then booked would have shown the failure and hidden the booking.
 */
const WEIGHT: Record<string, number> = {
  confirmed: 6, redirected: 5, booking: 4, pending: 4, awaiting_approval: 3, quoted: 2, failed: 1, cancelled: 0,
};
const weigh = (row: CheckoutRow) => WEIGHT[row.status ?? ''] ?? 2;

export function dedupe(rows: CheckoutRow[]): CheckoutRow[] {
  const seen = new Map<string, number>();
  const out: CheckoutRow[] = [];
  // A cancelled row is an attempt that a later one replaced. It is history,
  // not part of the trip, and listing it only raises a question the screen
  // cannot answer.
  for (const row of (rows ?? []).filter(r => r.status !== 'cancelled')) {
    const name = itemTitle(row);
    const key = row.itinerary_item_id
      ? `line:${row.itinerary_item_id}`
      : !hasOwnName(row)
        ? null                                   // never merged
        : `${row.vertical}|${name.toLowerCase()}|${row.scheduled_date ?? ''}`;
    if (key && seen.has(key)) {
      // Same line twice: keep whichever actually says more about the trip.
      const at = seen.get(key) as number;
      if (weigh(row) > weigh(out[at])) out[at] = row;
      continue;
    }
    if (key) seen.set(key, out.length);
    out.push(row);
  }
  return out;
}

function priced(row: CheckoutRow): boolean {
  return typeof row.price_cents === 'number' && row.price_cents > 0;
}

const isConcierge = (row: CheckoutRow) => row.provider === 'concierge' || row.mode === 'concierge';
const settled = (row: CheckoutRow) => row.status !== 'failed' && row.status !== 'cancelled';

/**
 * A row that costs money to the person tapping the button: one Reach buys.
 *
 * A table somebody rings up about is a request with no price, settled at the
 * venue. A redirect — a table on Resy, a ticket, a flight handed to the
 * airline's own site — is bought by the person on someone else's checkout,
 * so it is never in this total and never stops anybody paying for the rest.
 *
 * A priced concierge row used to count. That was the flight for somebody
 * with an X passport marker: the group paid $236 for it and no process
 * anywhere booked it. Such a flight is now handed to the airline when it is
 * quoted, with no price, and a concierge row is never charged for.
 */
function charged(row: CheckoutRow): boolean {
  if (!settled(row)) return false;
  // The server's own rule, so the total on this screen is the total Stripe
  // is asked for.
  return reachBuys(row);
}


/**
 * The same journey booked twice.
 *
 * Puerto Vallarta holds two confirmed Duffel orders — MHW2Y3 and SFYVFK —
 * both RDU → PVR on 2026-11-02, $138.09 and $135.02. Neither carries an
 * itinerary_item_id, because both predate the bridge that links a booking to
 * the line it was made from, so `dedupe` cannot tell they are one flight: it
 * falls back to the name, and "American Airlines · RDU → PVR" is not
 * "Duffel Airways · RDU → PVR".
 *
 * The plan's funding target is the sum of the two. Somebody would be charged
 * $273.11 to take one flight.
 *
 * The route and the date are what make it the same journey, whoever is
 * flying it, so that is what this reads. Nothing is cancelled here — those
 * are live orders at an airline and only a person may decide which one
 * goes — but the screen stops being quiet about it.
 */
const ROUTE = /\b([A-Z]{3})\s*(?:→|->|-)\s*([A-Z]{3})\b[^\d]*(\d{4}-\d{2}-\d{2})/;

export function journeyOf(row: CheckoutRow): string | null {
  const d = typeof row.detail === 'string' ? row.detail : '';
  const m = ROUTE.exec(d);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Groups of confirmed rows that are the same journey. One entry per clash. */
export function doubleBooked(rows: CheckoutRow[] | null | undefined): CheckoutRow[][] {
  const byJourney = new Map<string, CheckoutRow[]>();
  for (const r of rows ?? []) {
    if (r?.status !== 'confirmed') continue;
    const key = journeyOf(r);
    if (!key) continue;
    byJourney.set(key, [...(byJourney.get(key) ?? []), r]);
  }
  return [...byJourney.values()].filter(g => g.length > 1);
}

/**
 * What GET /api/plans/[planId]/funding says, as far as this screen needs it.
 * Every figure is the server's: net of refunds, split the way funding splits.
 */
export interface FundingView {
  targetCents?: number | null;
  collectedCents?: number | null;
  funded?: boolean | null;
  memberCount?: number | null;
  myShareCents?: number | null;
  myPaidCents?: number | null;
  myRemainingCents?: number | null;
}

/**
 * The one thing the bottom of the checkout screen offers.
 *
 * A funded plan had no Book button. Approval only ran straight after a
 * payment made in the same visit, so somebody who paid, closed the app and
 * came back — or a second member opening a trip somebody else had paid for
 * in full — found "Looks good", which started another payment, over a total
 * already covered. The server then said "Nothing left to pay", and the plan
 * sat funded and unbooked with no way on from the screen.
 */
export type CheckoutStep =
  /** This person owes a share and it can be paid. */
  | 'pay'
  /** They paid before and owe more now: a price rose or a line was added. */
  | 'top_up'
  /** Paid for in full with something waiting: "Book it" runs approval. */
  | 'book'
  /** Their part is paid; others on the trip still owe theirs. */
  | 'waiting'
  /** A booking is with the provider at this moment. */
  | 'in_progress'
  /** Nothing waiting, and something is bought. */
  | 'booked'
  /** Money was paid in, nothing was bought, and nothing is waiting. */
  | 'paid_nothing_booked'
  /** Nothing here for Reach to charge, and nothing coming. */
  | 'nothing'
  /** Nothing can happen yet; blockedCopy says why. */
  | 'blocked';

const cents = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));

export interface CheckoutState {
  rows: CheckoutRow[];
  /** What the screen offers. Only as good as the funding it was given. */
  step: CheckoutStep;
  /** Whether "Book it" may run approval now. */
  canBook: boolean;
  /** Rows approval would be asked to book. */
  waiting: CheckoutRow[];
  /** Rows the provider refused. The pay button stays shut while any exist. */
  broken: CheckoutRow[];
  /** Confirmed bookings that are the same journey. Never empty-checked away. */
  clashes: CheckoutRow[][];
  totalCents: number;
  canPay: boolean;
  /** Why the button is off, in words for the screen. Null when it is on. */
  blockedCopy: string | null;
  /** Set when something real is being arranged that has no price yet. */
  conciergeNote: string | null;
  /**
   * Nothing here is Reach's to charge for, and nothing ever will be.
   *
   * A concert where the ticket is bought from the seller, an evening of
   * walk-ins, a day of things you turn up to: the total is nought and no
   * quote is coming. That used to be indistinguishable from "we have not
   * priced it yet", so the screen said "we're still pricing this — check
   * back soon" for ever, over a button that could never switch on, on a
   * plan that was already as finished as it was ever going to be.
   *
   * A plan can be complete without Reach taking any money.
   */
  nothingToCharge: boolean;
}

/**
 * Everything the screen needs to decide what to show and whether to let
 * anybody pay.
 */
export function checkoutState(
  rows: CheckoutRow[],
  opts: { ignoreBroken?: boolean; funding?: FundingView | null } = {},
): CheckoutState {
  const deduped = dedupe(rows ?? []);
  const chargeable = deduped.filter(charged);

  const totalCents = chargeable.filter(priced)
    .reduce((s, r) => s + (r.price_cents as number), 0);

  // A row we intend to charge for but cannot price is the dangerous case:
  // it is going on the trip and its cost is not in the number on the screen.
  const unpricedCharged = chargeable.filter(r => !priced(r));

  // Real things being arranged that genuinely have no price yet — the table,
  // not the seat.
  const conciergeCount = deduped.filter(r => settled(r) && isConcierge(r) && !priced(r)).length;

  // A booking that failed is not a reason to let somebody pay.
  //
  // `charged()` drops failed rows, so they were invisible to this: a plan
  // with a flight that could not be booked still offered "Looks good" over a
  // total that quietly excluded it. The person confirms a trip they think is
  // whole, and finds out later that a piece of it never happened.
  //
  // Failed rows are listed on the screen either way — each says what went
  // wrong — so this only stops the button, which is the thing that cannot be
  // undone.
  const broken = deduped.filter(r => r.status === 'failed');

  // Blocked by a failure, and never trapped by one.
  //
  // Blocking outright would deadlock a real plan: Moab's flight cannot be
  // booked at any price because the trip started five days ago, so a rule of
  // "no failures, no payment" would mean that trip could never pay for its
  // hotel either. The screen offers "Book the rest without these" and that
  // sets `ignoreBroken` — a decision somebody makes on purpose, once, having
  // read what failed and why.
  const canPay = totalCents > 0 && unpricedCharged.length === 0
    && (broken.length === 0 || opts.ignoreBroken === true);

  // Nothing chargeable at all AND nothing being arranged, as opposed to
  // something chargeable we have not priced yet. Waiting is the right
  // answer to the second, and to a table somebody is still arranging, and
  // never to the first.
  const nothingToCharge = chargeable.length === 0 && conciergeCount === 0;

  const waiting = deduped.filter(r => r.status === 'awaiting_approval');
  const blocked = unpricedCharged.length > 0 || (broken.length > 0 && opts.ignoreBroken !== true);
  const step = stepOf({
    funding: opts.funding ?? null, waiting, blocked, canPay, nothingToCharge,
    inProgress: chargeable.filter(r => r.status === 'booking').length,
    // 'pending' on a row Reach pays for is money handed to a provider that
    // has not answered yet. It may be bought, so "nothing was booked" would
    // be a guess.
    bought: chargeable.filter(r => r.status === 'confirmed' || r.status === 'pending').length,
  });

  return {
    rows: deduped,
    step,
    canBook: step === 'book',
    waiting,
    broken,
    clashes: doubleBooked(deduped),
    totalCents,
    canPay,
    nothingToCharge,
    blockedCopy: canPay ? null
      : broken.length && !opts.ignoreBroken
        // Named, because "something went wrong" sends somebody looking. The
        // row itself carries the provider's reason.
        ? `${broken.length === 1 ? "One booking couldn't be made" : `${broken.length} bookings couldn't be made`}. Fix it, or carry on without it.`
        : nothingToCharge
          ? 'Nothing here for Reach to pay for — the tickets and tables are yours to book.'
          : "We're still pricing this — check back soon.",
    // "concierge" is our word for how we handle something, not a word anybody
    // outside this codebase should have to read. It shipped to the checkout
    // screen under the total and a founder saw it there.
    conciergeNote: conciergeCount
      ? '+ a few things we price once they are confirmed'
      : null,
  };
}

/**
 * Which step, from the rows and the money. Order matters: something waiting
 * to be booked on a plan paid for in full is booked, whoever is looking and
 * whatever they personally paid — approval checks the plan's money, not the
 * presser's — and nobody is offered a payment the plan does not need.
 *
 * Without funding figures (the read failed) the screen falls back to what it
 * did before: pay if the rows allow it. The server refuses a payment nobody
 * owes, so that fallback cannot take money twice.
 */
function stepOf(s: {
  funding: FundingView | null;
  waiting: CheckoutRow[];
  blocked: boolean;
  canPay: boolean;
  nothingToCharge: boolean;
  inProgress: number;
  bought: number;
}): CheckoutStep {
  const f = s.funding;
  if (!f) return s.canPay ? 'pay' : s.nothingToCharge ? 'nothing' : 'blocked';

  const paid = cents(f.myPaidCents);
  const owe = cents(f.myRemainingCents);
  const collected = cents(f.collectedCents);
  const target = cents(f.targetCents);
  const funded = f.funded === true;

  if (s.waiting.length) {
    if (funded) return s.blocked ? 'blocked' : 'book';
    if (owe > 0) return s.canPay ? (paid > 0 ? 'top_up' : 'pay') : 'blocked';
    // Nothing left for this person to pay and the plan is still short, so
    // somebody else owes. Never said on a trip for one: there is nobody else.
    return (f.memberCount ?? 1) > 1 && collected < target ? 'waiting' : 'blocked';
  }
  if (s.inProgress > 0) return 'in_progress';
  if (s.bought > 0) return 'booked';
  if (collected > 0) return 'paid_nothing_booked';
  return s.nothingToCharge ? 'nothing' : 'blocked';
}

// ─── What the success screen may claim ──────────────────────────────────
// "You're all booked!" once sat above two lines both reading "Quoted",
// because the screen counted rows rather than reading them. That was fixed
// by requiring every row to be settled — and the fix still counted
// `redirected` as booked, and then left failed rows out of the question
// altogether: a hotel that could not be booked sat under "You're all
// booked!", on the screen that had just taken the money for it.
//
// So the claim is read from the same de-duplicated rows the screen lists
// (a line that failed and was then booked is the booking, not the failure),
// and a failure is a gap the headline has to own. Confirmed is a booking.
// Redirected is somebody sent to Resy, which only they know the end of.
// Everything else is honest about what it is.

export type BookedClaim =
  /** Every row on the screen came back confirmed. */
  | 'all_booked'
  /** Some confirmed, and at least one could not be booked. */
  | 'booked_with_gaps'
  /** Some confirmed, others still waiting on the person or the provider. */
  | 'partly_booked'
  /** Nothing confirmed, and at least one could not be booked. */
  | 'nothing_booked'
  /** Nothing confirmed yet, and nothing has failed either. */
  | 'paid_only';

type ClaimRow = { status?: string | null } & Partial<CheckoutRow>;

export function bookedClaim(rows: ClaimRow[] | null | undefined): BookedClaim {
  const live = dedupe((rows ?? []).map(r => ({ vertical: '', ...r }) as CheckoutRow));
  const confirmed = live.filter(r => r.status === 'confirmed').length;
  const failed = live.filter(r => r.status === 'failed').length;
  if (!confirmed) return failed ? 'nothing_booked' : 'paid_only';
  if (failed) return 'booked_with_gaps';
  return confirmed === live.length ? 'all_booked' : 'partly_booked';
}

/** The headline and the line under it, per claim. */
export function bookedWording(claim: BookedClaim): { title: string; sub: string } {
  switch (claim) {
    case 'all_booked':
      return { title: "You're all booked!", sub: 'Every booking below is confirmed' };
    case 'booked_with_gaps':
      return {
        title: 'Booked, with gaps',
        sub: "Not everything could be booked. Each one that couldn't says why and what you can do next.",
      };
    case 'partly_booked':
      return {
        title: "Some of it's booked",
        sub: 'The rest is waiting on you or on the place — see below',
      };
    case 'nothing_booked':
      return {
        title: 'Nothing was booked',
        sub: 'Each booking below says why it failed and what you can do next.',
      };
    case 'paid_only':
      return {
        title: 'Nothing is booked yet',
        sub: 'Each line below says where it stands.',
      };
  }
}

// ─── Somewhere to write to ──────────────────────────────────────────────
// Every screen after a payment used to end in "quote reference pi_… and
// we'll sort it", "we'll follow up" or "we'll confirm each one with you".
// Nothing in the app follows up: no process reads those screens. What does
// exist is an inbox, and the one useful thing a screen can do is open it
// with the references already written in, so whoever reads it can find the
// payment without asking.

export const SUPPORT_EMAIL = 'hello@alcanzar.io';

export function supportMailto(input: {
  planId: string;
  planName?: string | null;
  what: string;
  payments?: (string | null | undefined)[];
  bookings?: (string | null | undefined)[];
}): string {
  const payments = [...new Set((input.payments ?? []).filter((p): p is string => !!p))];
  const bookings = [...new Set((input.bookings ?? []).filter((b): b is string => !!b))];
  const name = input.planName?.trim();
  const subject = `${input.what}${name ? ` — ${name}` : ''}`;
  const body = [
    `Plan: ${name ? `${name} ` : ''}(${input.planId})`,
    payments.length ? `Payment reference${payments.length === 1 ? '' : 's'}: ${payments.join(', ')}` : null,
    bookings.length ? `Booking${bookings.length === 1 ? '' : 's'}: ${bookings.join(', ')}` : null,
    '',
    'What happened:',
    '',
  ].filter(l => l !== null).join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ─── What a refund press says ───────────────────────────────────────────
// POST /api/plans/[planId]/funding/refund words every answer itself, and
// each one says whether anything went back (lib/refunds.ts). This only
// fills the gap when a body did not arrive.

export function refundWords(status: number, body: unknown): { ok: boolean; text: string } {
  const b = (body && typeof body === 'object' ? body : {}) as { message?: unknown; error?: unknown; refundedCents?: unknown };
  const said = [b.message, b.error].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (status >= 200 && status < 300) {
    const back = cents(b.refundedCents);
    return {
      ok: true,
      text: said ?? (back > 0
        ? `$${(back / 100).toFixed(2)} is on its way back to your card.`
        : 'Nothing was refunded.'),
    };
  }
  return { ok: false, text: said ?? "The refund didn't go through, and nothing was refunded." };
}

// ─── What is known about a fare before paying for it ────────────────────
// Duffel says, for every offer, whether the fare can be changed or refunded
// and until when its price is held. The quote stored both; the screen
// showed neither, so somebody paid their share of a non-refundable fare
// having been told nothing about it.

export interface TermsInput {
  vertical?: string | null;
  mode?: string | null;
  provider?: string | null;
  status?: string | null;
  conditions?: string[] | null;
  priceHeldUntil?: string | null;
}

/**
 * The terms line and the hold line for one row, or null when the row is not
 * something Reach is about to buy. Unknown terms are said as unknown, never
 * left blank: silence reads as "no catch".
 */
export function termsFor(row: TermsInput, now: Date = new Date()): { terms: string; hold: string | null } | null {
  if (!['flight', 'hotel'].includes(String(row.vertical))) return null;
  if (row.status !== 'awaiting_approval') return null;
  if (!reachBuys(row)) return null;
  const said = (row.conditions ?? []).filter(c => typeof c === 'string' && c.trim());
  const terms = said.length
    ? said.join(' · ')
    : row.vertical === 'flight'
      ? "The airline hasn't said whether this fare can be changed or refunded."
      : "The hotel hasn't said whether this room can be cancelled.";
  return { terms, hold: holdWords(row.priceHeldUntil, now) };
}

/**
 * When the provider's price stops being held. Approval prices every fare
 * again before it books, so after this time the price may move — and a rise
 * is asked about, or paid in, before anything is bought.
 */
export function holdWords(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() <= now.getTime()) {
    return 'The price hold has ended. The fare is checked again when it is booked.';
  }
  // Local time, the traveller's own clock, never UTC.
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const when = sameDay
    ? `${time} today`
    : `${at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
  return `Price held until ${when}. After that the fare is checked again when it is booked.`;
}

// ─── Is it me they're waiting on? ───────────────────────────────────────
// Approval refuses with the names of whoever still has travel details to
// add. Only the reader's own details can be added from their Profile, so
// the button to it is offered to somebody the refusal actually names.

type Member = { id?: unknown; name?: unknown; first_name?: unknown; last_name?: unknown };

/** The name approval would give this member — displayName in essentials-server. */
export function memberName(u: Member): string {
  return String(u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'A traveller');
}

export function namesMe(who: string[] | null | undefined, members: Member[] | null | undefined, me: string | null | undefined): boolean {
  if (!me || !who?.length) return false;
  const mine = (members ?? []).find(m => m && m.id === me);
  if (!mine) return false;
  const name = memberName(mine).trim().toLowerCase();
  return who.some(w => String(w).trim().toLowerCase() === name);
}
