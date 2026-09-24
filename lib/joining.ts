// ─── Somebody joins a trip that already exists ──────────────────────────
// A solo trip is not a promise to stay solo — people change their minds, and
// "bring someone along" has to be a thing a person can do after the plan is
// made. Two facts change the moment a second person is in the group, and
// both used to stay where they were:
//
//   1. `plans.solo_mode`, set once at creation. The vote, readiness and
//      generation routes read it, so a trip that had become two people kept
//      opening votes and writing itineraries without asking the second one.
//
//   2. Who pays for what is already booked. Funding splits every priced
//      booking across every member, so the newcomer was handed half of a
//      hotel room booked for one — a room that is not theirs, priced as if
//      it were — and the person who had already paid for it saw their share
//      halve under them. Nothing already booked or paid may change because
//      somebody joined.
//
// The second depends on whether anything has actually been bought.
//
//   - Bought: a booking confirmed or pending with a provider, or anything on
//     a plan somebody has already paid into. That is
//     a seat, a room or a ticket in somebody's name, or a total somebody paid
//     against. The newcomer is recorded as not on it, with the mechanism that
//     already answers "who is paying for this booking" — item_optouts — which
//     leaves every existing share exactly where it was. Reach cannot add a
//     person to a flight or a room it has already bought.
//
//   - Not bought: a proposal ('awaiting_approval') or a quote somebody is
//     holding ('quoted'). Nothing is in anybody's name and nobody has paid, so
//     the newcomer is simply on it, and the next time checkout opens it is
//     re-priced for the new number of people (lib/booking/resize.ts) and the
//     total split between them. Keeping them off a proposal left a group that
//     gained a member with no way to put them on the flight or the hotel at
//     all: those cannot be sat out, so they cannot be sat back in either.
//
// Called from every place a membership is created for an existing group:
// POST /api/groups/[id]/members (an admin adding somebody),
// POST /api/invites/[token] (a link opened), and claimInvitesFor (an invite
// claimed at sign-in). Each of those has already decided the person may join;
// this only keeps the group's plans honest about it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { midClaim } from './booking/claim.ts';
import { reachBuys } from './booking/charged.ts';
import { flightSearchUrl } from './booking/duffel-map.ts';
import { cancelUnpaidIntent, type CancelOutcome } from './stripe-intents.ts';

/** PostgREST's code for a table that does not exist: the migration has not run. */
const NO_TABLE = 'PGRST205';

export type PriorBooking = {
  id: string | number; plan_id: string | number; status?: string | null;
  approved_at?: unknown; updated_at?: unknown;
};

/**
 * Bought: with a provider, or confirmed by one — a seat, a room or a ticket in
 * somebody's name, whether or not the money has settled. Not 'redirected':
 * that is a link to somebody else's checkout, and nothing has been bought
 * through Reach at all.
 */
export const BOUGHT: ReadonlySet<string> = new Set(['confirmed', 'pending', 'booking']);

/**
 * Bought, or at the provider this minute. An approval mid-booking named its
 * travellers before this person was in the group, so what it buys is not
 * theirs: before sql/wave1-bookings-2026-09-22.sql that row still reads
 * 'awaiting_approval', and only its claim stamp says so (midClaim).
 */
export function isBought(b: { status?: string | null; approved_at?: unknown; updated_at?: unknown }): boolean {
  return BOUGHT.has(String(b?.status ?? '')) || midClaim(b ?? {});
}
/** Priced and nothing bought: a proposal, or a quote somebody is holding (lib/booking/charged.ts). */
const UNBOUGHT = new Set(['awaiting_approval', 'quoted']);
/** What is sized by headcount, and so re-sized when somebody joins (lib/booking/resize.ts). */
const RESIZED = new Set(['flight', 'hotel']);
export type OptOutRow = { plan_id: string; item_ref: string; user_id: string };

/**
 * The rows that keep a newcomer off what was bought before they arrived.
 *
 * Bought means past approval, or anything at all on a plan somebody has paid
 * into (`paidPlans`, plan ids) — what they paid against is that plan's total,
 * and it must not move under them. A proposal or a held quote on an unpaid
 * plan is left alone: it is re-priced for everyone going instead.
 *
 * Failed and cancelled bookings are nobody's to pay for. One row per booking,
 * whatever the input repeats — Postgres refuses an upsert that names the same
 * row twice.
 */
export function latecomerOptOuts(
  bookings: PriorBooking[], userId: string, paidPlans: ReadonlySet<string> = new Set(),
): OptOutRow[] {
  if (!userId) return [];
  const seen = new Set<string>();
  const rows: OptOutRow[] = [];
  for (const b of bookings || []) {
    if (b?.id == null || b?.plan_id == null) continue;
    if (b.status === 'failed' || b.status === 'cancelled') continue;
    if (!isBought(b) && !paidPlans.has(String(b.plan_id))) continue;
    const key = `${b.plan_id}|${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ plan_id: String(b.plan_id), item_ref: String(b.id), user_id: userId });
  }
  return rows;
}

/** A group of one travels solo. Anything more is a group trip. */
export function isSoloCount(memberCount: number): boolean {
  return !(memberCount > 1);
}

/**
 * What a trip holds, as far as the screen showing the note can tell.
 *
 * `known: false` is a screen that cannot see bookings or payments (the group
 * screen); it gets the sentence that is true whichever way they fall, rather
 * than the reassuring one.
 */
export type TripHolds = { known?: boolean; bought: boolean; unbought: boolean; paidCents: number };

/**
 * TripHolds from the booking rows a screen already has. Only flights and
 * rooms count as unbought here, because those are what the bridge re-sizes
 * (lib/booking/resize.ts); a table or an activity keeps the quote it has.
 */
export function tripHolds(
  bookings: { status?: string | null; vertical?: string | null; approved_at?: unknown; updated_at?: unknown }[] | null | undefined,
  paidCents: number,
): TripHolds {
  const rows = bookings ?? [];
  return {
    bought: rows.some(b => isBought(b)),
    unbought: rows.some(b => UNBOUGHT.has(String(b?.status ?? '')) && RESIZED.has(String(b?.vertical))),
    paidCents: Math.max(0, Math.round(paidCents || 0)),
  };
}

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// A person added to a trip already booked needs somewhere to get their own
// seat or room, and Reach is not it: a Duffel order or a LiteAPI booking
// cannot take another passenger or guest, and the bridge hands back the
// booking already on the list rather than quoting a second one. So the
// sentence says where.
const OWN_BOOKING = "Reach can't add someone to a booking it has already made, so they'd book their own seat or room directly with the airline or hotel.";
// Flights and rooms only: those are what the bridge re-sizes. A table or an
// activity keeps the quote it has.
//
// What the code does, and no more. Nothing is re-priced by the join itself:
// opening checkout prices them again for everyone going (lib/booking/
// reprice.ts), and until that happens nobody can pay (funding refuses
// stale_quotes). A flight cannot be priced for a passenger who has not given
// their travel details — the bridge refuses to quote it — so that is said.
// "The cost is split between you and them" went: a share is who is on each
// booking, and it is only true once the new price is on it.
const REPRICED = "flights and rooms not bought yet have to be priced again for everyone going before anybody pays — that happens when checkout is opened, and a flight can't be priced until they've added their travel details.";

/**
 * What the screen says beside "Bring someone along".
 *
 * The one thing it must never do is let somebody believe the new person's
 * seat or room came with the invite. Each sentence is what beforeJoining and
 * the bookable bridge actually do: what is bought, and everything on a trip
 * somebody has paid towards, stays the organiser's alone and the newcomer is
 * not added to it; flights and rooms not bought are re-sized for both.
 *
 * It used to promise that "anything for them gets booked separately".
 * Nothing did: for the same flight or hotel the bridge handed back the
 * organiser's own booking. So each branch says who actually does what.
 */
export function bringAlongNote(state: TripHolds): string {
  const paid = Math.max(0, Math.round(state.paidCents || 0));
  if (state.known === false) {
    return `Anything Reach has already booked, and any trip you've paid towards, stays priced for you alone. ${OWN_BOOKING} On a trip you haven't paid towards, ${REPRICED}`;
  }
  if (paid > 0) {
    // Paid for, not necessarily booked yet: what was paid against stays as it
    // is, so nothing on it is re-sized either, and they are not added to it.
    return `You've paid ${usd(paid)} towards this trip, so everything on it stays priced for you alone and they aren't charged for any of it. They'd book their own seat or room directly with the airline or hotel.`;
  }
  if (state.bought) {
    return `What's already booked stays yours alone. ${OWN_BOOKING}${state.unbought ? ` Once they join, ${REPRICED}` : ''}`;
  }
  if (state.unbought) {
    return `Nothing's bought yet. Once they join, ${REPRICED}`;
  }
  return "It stays a trip for one until they join. After that it's planned as a group, and they get a say.";
}

/** A flight or hotel somebody is not on, and where they can get their own. */
export interface NotOn {
  vertical: 'flight' | 'hotel';
  /**
   * Bought with the airline or hotel (or being bought this minute). False is
   * paid towards and not yet bought: a different sentence, because "you
   * joined after it was booked" about a flight nobody has bought is untrue.
   */
  booked: boolean;
  /**
   * A quote somebody is holding ('quoted'): not bought, and not in any money
   * sum either, so "paid for" about it would be untrue as well.
   */
  held?: boolean;
  /** The flights by number or the hotel by name, when the row says. */
  what: string | null;
  /** A search that sells it, prefilled from the row; null when the row gives nothing to search by. */
  link: { href: string; label: string } | null;
}

type Payload = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? v as Record<string, unknown> : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Where somebody not on a booking can get their own, from what the row
 * holds and nothing else.
 *
 * A flight: Google Flights, prefilled with the same airports and dates, and
 * the flight numbers said in words. Checked with curl on 2026-09-23: the
 * route-and-dates query is read by Google Flights (the page comes back
 * naming both cities); the same query with flight numbers in it is not, and
 * opens on an empty search — so the numbers are said, not searched.
 *
 * A hotel: its own name and address on Google Maps, which carries its site
 * and phone. LiteAPI gives us the hotel's name and address and no website,
 * so a link to "the hotel's own page" would be a guess. Without a name, the
 * hotels in the trip's city.
 */
export function ownBookingLink(row: { vertical?: unknown; request_payload?: unknown; response_payload?: unknown }): NotOn['link'] {
  const req = obj(row.request_payload) as Payload;
  const res = obj(row.response_payload) as Payload;
  if (row.vertical === 'flight') {
    const f = obj(req?.flight);
    const href = flightSearchUrl({
      origin: str(f?.origin) ?? undefined, destination: str(f?.destination) ?? undefined,
      departDate: str(f?.departDate) ?? undefined, returnDate: str(f?.returnDate) ?? undefined,
    });
    return href ? { href, label: 'Search these dates on Google Flights' } : null;
  }
  if (row.vertical === 'hotel') {
    const h = obj(res?.hotel);
    const name = str(h?.name);
    const city = str(obj(req?.hotel)?.city);
    const q = name ? [name, str(h?.address) ?? city].filter(Boolean).join(', ') : city ? `hotels in ${city}` : null;
    if (!q) return null;
    return {
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      label: name ? `Find ${name} on Google Maps` : `Hotels in ${city} on Google Maps`,
    };
  }
  return null;
}

/** "AA1234 and AA567 out, AA890 back" from an offerKey ("AA1234.AA567/AA890"). */
export function flightNumbers(key: unknown): string | null {
  const k = str(key);
  if (!k) return null;
  const legs = k.split('/').map(l => l.split('.').filter(Boolean));
  if (!legs.length || legs.some(l => !l.length)) return null;
  const say = (l: string[]) => l.join(' and ');
  return legs.length === 2 ? `${say(legs[0])} out, ${say(legs[1])} back` : say(legs[0]);
}

function whatItIs(row: { vertical?: unknown; request_payload?: unknown; response_payload?: unknown }): string | null {
  const req = obj(row.request_payload);
  const res = obj(row.response_payload);
  if (row.vertical === 'flight') return flightNumbers(obj(req?.flight)?.offerKey ?? res?.offerKey);
  if (row.vertical === 'hotel') return str(obj(res?.hotel)?.name);
  return null;
}

/**
 * Which flights and hotels each member is not on, for a screen to say so.
 * Only those two: they cannot be sat out by choice (the participation route
 * refuses it), so an opt-out on one is somebody who joined after it was
 * bought or paid for (latecomerOptOuts). A dinner somebody chose to sit out
 * is their own business and not what this reports.
 *
 * Only what Reach buys, held or not: a flight handed to the airline's own
 * site was never Reach's to put anybody on. Failed and cancelled rows are
 * nothing to be on.
 */
export function notOnBooked(
  bookings: {
    id?: unknown; vertical?: string | null; status?: string | null; mode?: unknown; provider?: unknown;
    request_payload?: unknown; response_payload?: unknown; approved_at?: unknown; updated_at?: unknown;
  }[] | null | undefined,
  skips: { ref: string; userId: string }[] | null | undefined,
  memberIds: string[],
): Record<string, NotOn[]> {
  const byId = new Map<string, NotOn>();
  for (const b of bookings ?? []) {
    if (b?.id == null || !RESIZED.has(String(b.vertical))) continue;
    if (b.status === 'failed' || b.status === 'cancelled' || !reachBuys(b)) continue;
    const booked = isBought(b);
    byId.set(String(b.id), {
      vertical: b.vertical as 'flight' | 'hotel', booked, held: !booked && b.status === 'quoted',
      what: whatItIs(b), link: ownBookingLink(b),
    });
  }
  const members = new Set(memberIds);
  const out: Record<string, NotOn[]> = {};
  const seen = new Set<string>();
  for (const s of skips ?? []) {
    const it = byId.get(String(s.ref));
    if (!it || !members.has(s.userId) || seen.has(`${s.userId}|${s.ref}`)) continue;
    seen.add(`${s.userId}|${s.ref}`);
    (out[s.userId] ??= []).push(it);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.vertical.localeCompare(b.vertical));
  return out;
}

const listed = (words: string[]) =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * What the newcomer reads about the flights and hotels they are not on.
 * Booked, paid towards and held are said apart: a flight bought with the
 * airline has a seat in somebody's name; one only paid towards has not been
 * bought yet, and saying it was booked is the kind of sentence that sends
 * somebody to the airport with nothing. A held quote is neither bought nor
 * in anybody's total. "Paid for" went too: on a group where one share of
 * four is in, it is paid towards, not paid for.
 */
export function notOnSentence(items: NotOn[] | null | undefined): string | null {
  const list = items ?? [];
  if (!list.length) return null;
  const name = (i: NotOn) => {
    const kind = i.vertical === 'flight' ? 'flight' : 'hotel';
    return `the ${kind}${i.what ? ` (${i.what})` : ''}`;
  };
  const booked = list.filter(i => i.booked);
  const held = list.filter(i => !i.booked && i.held);
  const paid = list.filter(i => !i.booked && !i.held);
  const parts: string[] = [];
  const them = (n: number) => (n > 1 ? 'them' : 'it');
  if (booked.length) {
    parts.push(`${listed(booked.map(name))} ${booked.length > 1 ? 'were' : 'was'} already booked before you joined, and Reach can't add someone to a booking it has already made.`);
  }
  if (paid.length) {
    parts.push(`${listed(paid.map(name))} ${paid.length > 1 ? 'were' : 'was'} already paid towards before you joined, so ${paid.length > 1 ? 'they stay' : 'it stays'} priced without you and Reach won't add you to ${them(paid.length)}.`);
  }
  if (held.length) {
    parts.push(`${listed(held.map(name))} ${held.length > 1 ? 'were' : 'was'} on hold before you joined — not booked or paid for — on a trip somebody has paid towards, so ${held.length > 1 ? 'they stay' : 'it stays'} priced without you and Reach won't add you to ${them(held.length)}.`);
  }
  const first = parts.join(' ');
  const where = listed([...new Set(list.map(i => (i.vertical === 'flight' ? 'airline' : 'hotel')))]);
  return `${first.charAt(0).toUpperCase()}${first.slice(1)} You're not on ${list.length > 1 ? 'them' : 'it'} and aren't charged for ${list.length > 1 ? 'them' : 'it'} — book your own directly with the ${where}.`;
}

/** `error` is the sentence to show when `ok` is false. */
export type JoinOutcome = { ok: boolean; satOut?: number; error?: string };

/**
 * Before the membership row is written: keep the newcomer off what is already
 * bought. Done first, so there is no moment in which they are a member and
 * funding quotes them a share of somebody else's room.
 *
 * A failure here stops the join. Letting them in anyway would split bookings
 * already bought or paid for. The one exception is
 * a deployment that has not run sql/preferences-v1.sql: there, nobody can be
 * kept off anything, shares split evenly as they always did, and refusing
 * every join would be worse than that.
 */
export async function beforeJoining(
  db: SupabaseClient, groupId: string, userId: string,
  cancelIntent: (intentId: string) => Promise<CancelOutcome> = id => cancelUnpaidIntent(id),
): Promise<JoinOutcome> {
  const { data: plans, error: plansErr } = await db.from('plans').select('id').eq('group_id', groupId);
  if (plansErr) {
    console.error('[joining] could not read the group’s plans', { groupId, code: plansErr.code });
    return { ok: false, error: "We couldn't check this group's trips just now — try again in a moment." };
  }
  const planIds = (plans ?? []).map(p => String((p as { id: unknown }).id));
  if (!planIds.length) return { ok: true, satOut: 0 };

  const { data: bookings, error: bookingsErr } = await db
    .from('bookings').select('id, plan_id, status, approved_at, updated_at').in('plan_id', planIds);
  if (bookingsErr) {
    console.error('[joining] could not read what the group’s trips hold', { groupId, code: bookingsErr.code });
    return { ok: false, error: "We couldn't check what's already booked — try again in a moment." };
  }

  // Plans somebody has paid into: everything on them stays as it was paid for.
  //
  // And payments started and not finished. Each was made for somebody's share
  // as it stands before this person joins, and a form left open on it would
  // take that old amount afterwards — the whole one-person total on a trip
  // that is now two. So each is cancelled at Stripe first. One that cannot be
  // cancelled may still land, and its plan is treated as paid: the newcomer
  // is kept off it, which is what would have been right had it landed first.
  const { data: paid, error: paidErr } = await db
    .from('contributions').select('id, plan_id, status, stripe_payment_intent')
    .in('plan_id', planIds).in('status', ['succeeded', 'pending']);
  if (paidErr) {
    console.error('[joining] could not read what has been paid', { groupId, code: paidErr.code });
    return { ok: false, error: "We couldn't check what's already been paid — try again in a moment." };
  }
  type Payment = { id?: unknown; plan_id: unknown; status?: unknown; stripe_payment_intent?: unknown };
  const payments = (paid ?? []) as Payment[];
  const paidPlans = new Set(payments.filter(c => c.status === 'succeeded').map(c => String(c.plan_id)));
  for (const c of payments) {
    if (c.status !== 'pending' || typeof c.stripe_payment_intent !== 'string' || !c.stripe_payment_intent) continue;
    const outcome = await cancelIntent(c.stripe_payment_intent);
    if (outcome !== 'canceled') {
      console.error('[joining] an unfinished payment could not be cancelled — treating its plan as paid', { groupId, outcome });
      paidPlans.add(String(c.plan_id));
      continue;
    }
    const { error } = await db.from('contributions')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', String(c.id)).eq('status', 'pending');
    // Cancelled at Stripe either way, so it can never take money; the row
    // reading pending only means the next payment attempt asks Stripe again.
    if (error) console.error('[joining] could not write off a cancelled payment', { groupId, code: error.code });
  }

  const rows = latecomerOptOuts((bookings ?? []) as PriorBooking[], userId, paidPlans);
  if (!rows.length) return { ok: true, satOut: 0 };

  const { error: optErr } = await db
    .from('item_optouts')
    .upsert(rows, { onConflict: 'plan_id,item_ref,user_id', ignoreDuplicates: true });
  if (optErr) {
    if (optErr.code === NO_TABLE) {
      console.error('[joining] item_optouts is missing — a newcomer will share existing bookings; run sql/preferences-v1.sql', { groupId });
      return { ok: true, satOut: 0 };
    }
    console.error('[joining] could not keep the newcomer off existing bookings', { groupId, code: optErr.code });
    return { ok: false, error: "We couldn't add them without changing what's already booked — try again in a moment." };
  }
  return { ok: true, satOut: rows.length };
}

/**
 * After the membership row is written: a group of more than one is not solo,
 * so no plan of theirs may go on saying it is.
 *
 * Not a reason to undo the join if it fails — the person is in, and the
 * readiness check counts members as well as reading the flag, so a stale
 * flag cannot skip them. It is said out loud all the same.
 */
export async function afterJoining(db: SupabaseClient, groupId: string): Promise<{ soloEnded: number }> {
  const { data: members, error: membersErr } = await db
    .from('group_members').select('user_id').eq('group_id', groupId);
  if (membersErr) {
    console.error('[joining] could not count the group after a join', { groupId, code: membersErr.code });
    return { soloEnded: 0 };
  }
  if (isSoloCount((members ?? []).length)) return { soloEnded: 0 };

  const { data: flipped, error: flipErr } = await db
    .from('plans').update({ solo_mode: false })
    .eq('group_id', groupId).eq('solo_mode', true)
    .select('id');
  if (flipErr) {
    console.error('[joining] a trip still says solo after somebody joined', { groupId, code: flipErr.code });
    return { soloEnded: 0 };
  }
  return { soloEnded: (flipped ?? []).length };
}
