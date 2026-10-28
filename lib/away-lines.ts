// ─── Getting there and somewhere to sleep, on every away plan ────────────
// The checkout spec (2026-09-25, Task 6a): an away plan (lib/away.ts) always
// carries a transport line and a lodging line covering every night — on the
// option card's per-person estimate and in the itinerary — and neither is
// ever silently left out.
//
// "Silently" is the whole of it. Both used to go missing without a sound:
// the client built the fixed lines from the option's costs and dropped any
// line priced at 0 (`cents>0&&title`), so a model that wrote flights: 0 for a
// week in Lisbon produced a plan with no way of getting to Lisbon and a
// per-person figure that was a week of dinners. Here a line we cannot price
// is still a line — "not estimated yet, priced live at Lock it in" — and the
// total says it is incomplete rather than reading as everything.
//
// And the three tiers differ in how people travel and sleep, not only in
// what they do. A saver, an on-budget and a stretch that all fly the 6am
// one-stop and sleep in the same three-star are one trip at three prices.
// TIER_TRAVEL is the rule, decided here rather than left to the model: the
// options prompt is told it, the option card carries it, and the live
// preview (app/api/trips/preview) ranks real flights and hotels by it.
//
// Everything priced here is an ESTIMATE (owner decision 9): nobody has rung
// a hotel when the options are built. Live prices come at Lock it in, or
// when somebody taps preview.
import { rentalLine } from './ground.ts';

export type Tier = 'saver' | 'on_budget' | 'stretch';
export const TIERS: Tier[] = ['saver', 'on_budget', 'stretch'];

export interface TierTravel {
  /** The class of stay. */
  stay: 'budget' | 'mid' | 'upscale';
  stayLabel: string;
  /** Least star rating a hotel needs to fit; null is anything. */
  minStars: number | null;
  /** When the flights are. */
  flight: 'cheapest' | 'daytime' | 'best_times';
  flightLabel: string;
  /** Most stops each way that fits; null is any. */
  maxStops: number | null;
  /** Local departure hours that fit, [from, to); null is any time. */
  departs: [number, number] | null;
}

export const TIER_TRAVEL: Record<Tier, TierTravel> = {
  saver: {
    stay: 'budget', minStars: null,
    stayLabel: 'Budget stay — a simple hotel, guesthouse or hostel room',
    flight: 'cheapest', maxStops: null, departs: null,
    flightLabel: 'Cheapest flights — early, late or with a stop',
  },
  on_budget: {
    stay: 'mid', minStars: 3,
    stayLabel: 'Mid-range hotel, three stars or so',
    flight: 'daytime', maxStops: 1, departs: [7, 21],
    flightLabel: 'Daytime flights, one stop at most',
  },
  stretch: {
    stay: 'upscale', minStars: 4,
    stayLabel: 'Upscale hotel, four stars and up',
    flight: 'best_times', maxStops: 0, departs: [8, 19],
    flightLabel: 'Nonstop where there is one, at sociable hours',
  },
};

export function tierOf(v: unknown): Tier | null {
  return v === 'saver' || v === 'on_budget' || v === 'stretch' ? v : null;
}

/** "1 night", "7 nights". */
export function nightsWord(n: number): string {
  return `${n} night${n === 1 ? '' : 's'}`;
}

// ─── A drive, not a flight ───────────────────────────────────────────────
// An away plan needs getting there; it does not need an aeroplane. 80 km
// makes a day trip away (lib/away.ts), and a day in Philadelphia from New
// York was given "Round-trip flights · not estimated yet — priced live at
// Lock it in", a line Reach would then have tried to quote. Somewhere this
// close is a drive or a train, priced in ground_transport, and the plan
// carries no flight.
//
// Great-circle km, measured from both ends as real points. 400 km is about
// 250 miles — four hours or so on the road, which is where most people
// start to fly. Unknown distance is never "near": a drive line on a week in
// Lisbon because a geocoder was slow is the worse mistake.
export const DRIVE_KM = 400;
export function isNear(km: number | null | undefined): boolean {
  return typeof km === 'number' && Number.isFinite(km) && km < DRIVE_KM;
}
const milesOf = (km: number) => Math.round(km / 1.609344);

/**
 * What the options prompt is told about getting there and sleeping, for an
 * away trip. The numbers stay the model's estimates; the classes do not.
 */
export function awayPromptBlock(opts: { nights: number; from: string }): string {
  const { nights, from } = opts;
  const stay = nights >= 1;
  return `
THIS TRIP IS AWAY FROM HOME, so every option carries getting there${stay ? ' and somewhere to sleep' : ''}:
- costs.flights.per_person is the round trip from ${from} for one person.
  If the place is close enough that people would drive or take the train —
  about ${milesOf(DRIVE_KM)} miles (${DRIVE_KM} km) or less — put 0 here and price the round trip
  by road or rail in costs.ground_transport, its details saying which.
  Otherwise never 0. If the town has no airport of its own, price the
  flight to the nearest airport that has one and put a rental car from
  there in ground_transport.
${stay ? `- costs.accommodation.per_person covers all ${nightsWord(nights)} for one person. Never 0,
  and its details says the class of stay and "${nightsWord(nights)}".
- accommodation.example is the neighbourhood or area to stay in — never a
  named hotel. Hotels are priced live from what is actually on sale when they
  choose, and a hotel named here is one nobody has checked.
` : ''}
The three tiers differ in how they travel and sleep, not only in what they do:
${TIERS.map(t => `- "${t}": ${stay ? `${TIER_TRAVEL[t].stayLabel}; ` : ''}${TIER_TRAVEL[t].flightLabel}.`).join('\n')}
costs.flights.details says which flights the tier means, in a few words.
Every figure here is shown to them as an estimate.`;
}

type CostLineLike = { per_person?: number | null; details?: string | null; example?: string | null } | undefined;
export interface AwayTripLike {
  destination?: string;
  city?: string | null;
  tier?: string;
  total_per_person?: number;
  costs?: Record<string, CostLineLike>;
}

const priced = (c: CostLineLike) => typeof c?.per_person === 'number' && Number.isFinite(c.per_person) && c.per_person > 0;

export type AwayPart = 'transport' | 'lodging';
export interface AwayGap { destination: string; tier: string; missing: AwayPart[]; near: boolean }

/**
 * The options that left out getting there or a bed. Empty when every
 * option prices both (or the trip has no night, and so needs no bed).
 *
 * Getting there is the flight, or — for an option `near` says is a drive
 * away (isNear on its measured km) — the road or rail in ground_transport.
 * An option that rightly put flights at 0 for a drive is not a gap.
 */
export function awayGaps(trips: AwayTripLike[], nights: number, near: (t: AwayTripLike) => boolean = () => false): AwayGap[] {
  const gaps: AwayGap[] = [];
  for (const t of trips ?? []) {
    const missing: AwayPart[] = [];
    const close = near(t);
    if (!priced(close ? t.costs?.ground_transport : t.costs?.flights)) missing.push('transport');
    if (nights >= 1 && !priced(t.costs?.accommodation)) missing.push('lodging');
    if (missing.length) gaps.push({ destination: String(t.destination ?? ''), tier: String(t.tier ?? ''), missing, near: close });
  }
  return gaps;
}

/** The note a retry is sent with, naming exactly what was left out. */
export function awayCorrection(gaps: AwayGap[], nights: number): string {
  if (!gaps.length) return '';
  const lines = gaps.map(g => `- ${g.destination || 'an option'} (${g.tier || 'no tier'}): ${g.missing
    .map(m => m === 'transport'
      ? (g.near ? 'it is a drive away and costs.ground_transport.per_person was 0' : 'costs.flights.per_person was 0')
      : `costs.accommodation.per_person was 0 for ${nightsWord(nights)}`)
    .join('; ')}`);
  return `IMPORTANT — your last answer left getting there or somewhere to sleep out of an away trip:\n${lines.join('\n')}\nEvery option needs both, priced, as described above.`;
}

/** An airport near a town that has none of its own. */
export interface Gateway { iata: string; name: string; miles: number }

export interface AwayEstimate {
  away: true;
  nights: number;
  /** Shown on the card as an estimate, always. */
  estimate: true;
  tier: Tier | null;
  travel: TierTravel | null;
  /** Great-circle km from home, when both ends were placed. */
  km: number | null;
  transport: {
    /** 'ground': close enough to drive or take the train (isNear) — no flight. */
    kind: 'flight' | 'flight_and_car' | 'ground';
    /** Round trip, one person; null when nobody estimated it. */
    per_person: number | null;
    label: string;
    /** The nearest airport, when the town has none of its own. */
    airport: Gateway | null;
  };
  /** The rental car from that airport; null when the town has its own. */
  car: { per_person: number | null; from: Gateway } | null;
  lodging: {
    /** Every night, one person; null when nobody estimated it. */
    per_person: number | null;
    nights: number;
    per_night: number | null;
    stay: TierTravel['stay'] | null;
    label: string;
    /** The area to stay in, as the option suggested it. Not a booking. */
    area: string | null;
  } | null;
  /** Getting about once there (transfers, a car), one person; null when not estimated. */
  ground: number | null;
  /** The headline estimate, flight and bed included. */
  per_person: number;
  /** The same for somebody who drives or already has a flight. */
  per_person_if_driving: number;
  /** Parts on the card that carry no figure yet, said rather than dropped. */
  unpriced: Array<AwayPart | 'car'>;
}

/**
 * What an away option's card says about getting there and sleeping, with
 * the figures it can stand behind and the ones it cannot named as such.
 */
export function awayEstimate(trip: AwayTripLike, opts: { nights: number; gateway?: Gateway | null; km?: number | null }): AwayEstimate {
  const nights = Math.max(0, Math.round(opts.nights));
  const tier = tierOf(trip.tier);
  const travel = tier ? TIER_TRAVEL[tier] : null;
  const c = trip.costs ?? {};
  const km = typeof opts.km === 'number' && Number.isFinite(opts.km) ? Math.round(opts.km) : null;
  const near = isNear(km);
  // A drive away has no airport to land at, whatever the town has.
  const gateway = near ? null : opts.gateway ?? null;
  const unpriced: AwayEstimate['unpriced'] = [];

  // A flight the model priced for somewhere it is a drive to is not on the
  // plan, so it is not in the figure either.
  const modelFlight = priced(c.flights) ? Math.round(c.flights!.per_person as number) : null;
  const flight = near ? null : modelFlight;
  const ground = priced(c.ground_transport) ? Math.round(c.ground_transport!.per_person as number) : null;
  if (near ? ground === null : flight === null) unpriced.push('transport');
  if (gateway && ground === null) unpriced.push('car');

  let lodging: AwayEstimate['lodging'] = null;
  if (nights >= 1) {
    const stay = priced(c.accommodation) ? Math.round(c.accommodation!.per_person as number) : null;
    if (stay === null) unpriced.push('lodging');
    const area = typeof c.accommodation?.example === 'string' && c.accommodation.example.trim() ? c.accommodation.example.trim() : null;
    lodging = {
      per_person: stay, nights,
      per_night: stay === null ? null : Math.round(stay / nights),
      stay: travel?.stay ?? null,
      label: `${travel ? travel.stayLabel : 'Somewhere to stay'} · ${nightsWord(nights)}`,
      area,
    };
  }

  const stated = typeof trip.total_per_person === 'number' && Number.isFinite(trip.total_per_person) ? Math.round(trip.total_per_person) : 0;
  const total = Math.max(0, stated - (near ? modelFlight ?? 0 : 0));
  return {
    away: true, nights, estimate: true, tier, travel, km,
    transport: {
      kind: near ? 'ground' : gateway ? 'flight_and_car' : 'flight',
      per_person: near ? ground : flight,
      label: near
        ? `By road or rail — about ${milesOf(km!)} miles`
        : gateway
          ? `Flights to ${gateway.name} (${gateway.iata}), then a rental car`
          : (travel ? travel.flightLabel : 'Round-trip flights'),
      airport: gateway,
    },
    car: gateway ? { per_person: ground, from: gateway } : null,
    lodging,
    ground,
    per_person: total,
    per_person_if_driving: Math.max(0, total - (flight ?? 0)),
    unpriced,
  };
}

/** A line of the plan the itinerary is saved with (itinerary_items' shape). */
export interface FixedLine {
  scheduled_time: 'Before you go';
  type: 'flight' | 'hotel' | 'transport';
  title: string;
  subtitle: string;
  /** Per person, as the client's fixed lines always were; null is not priced yet. */
  cost_cents: number | null;
  /**
   * The flight's whole party figure: per person times those flying. The
   * client's per-person sum is right for somebody flying; a group total is
   * this, not cost_cents times everyone, once somebody drives.
   */
  party_cents?: number | null;
  /** Null: nothing to book (everyone driving) — bookingTracker counts none. */
  booking_mode: 'reach' | 'ahead' | null;
  payment_note: string | null;
  venue_website?: string | null;
  venue_name?: string | null;
  /** Every figure here is an estimate until Lock it in. */
  estimate: true;
  /** For the stay: the nights it covers, check-in to check-out. */
  checkin?: string | null;
  checkout?: string | null;
  nights?: number | null;
  /** For the flight: how many are flying, when somebody drives. */
  flying?: number | null;
  driving?: number | null;
}

// For what Reach books and quotes at Lock it in: the flight and the stay
// (app/api/plans/[planId]/bookable quotes hotel, flight and activity).
const ESTIMATE = 'Estimate — live prices at Lock it in.';
const NOT_YET = 'Not estimated yet — priced live at Lock it in.';
// For what Reach neither books nor quotes — a rental car, transfers, the
// drive. Nothing prices these at Lock it in, so the line must not say so.
const OWN_ESTIMATE = 'Estimate — yours to book, so Reach never prices it live.';
const OWN_NOT_YET = 'Not estimated — yours to book, and Reach does not price it.';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Getting there when nobody is flying: everyone driving or holding their own
 * seat. Also what the participation route writes over the flight's line when
 * the last person comes off it (lib/participation.ts lastOut).
 *
 * "Everyone is driving" only when everyone said so: somebody who joined
 * after the flight came off never did, and is told nobody is flying with
 * the group instead — with the way to put a flight back.
 */
export function nobodyFlyingLine(solo: boolean, everyoneSaid = true): FixedLine {
  return {
    scheduled_time: 'Before you go', type: 'transport',
    title: solo ? "You're driving or already have a flight"
      : everyoneSaid ? 'Everyone is driving or already has a flight' : 'Nobody is flying with the group',
    subtitle: solo ? 'No flights to book for this trip.'
      : 'No flights to book for this trip. Until anybody pays, \u201cI\u2019m flying\u201d under What you\u2019re in for puts the flight back.',
    cost_cents: 0, party_cents: 0, booking_mode: null, payment_note: null, estimate: true,
  };
}

/**
 * The lines that exist only because somebody flies: the rental car from the
 * arrival airport, and the transfers from an airport in town. Nobody flying,
 * nobody lands there — so they come off with the flight (and back with it).
 */
export function flightOnlyLine(row: { type?: unknown; title?: unknown; scheduled_time?: unknown }): boolean {
  if (row.type !== 'transport') return false;
  const title = String(row.title ?? '');
  return /^Rental car from /.test(title) || title === 'Airport transfers';
}

/**
 * The lines an away plan's itinerary opens with: getting there, the car
 * from the airport when the town has none, and a bed for every night.
 *
 * Built on the server so the client cannot drop one for being unpriced —
 * which is how they went before. A drive opt-out (lib/participation.ts,
 * decision 8) takes the driver off the flight, never the flight off the plan;
 * with nobody left flying, the line stays to say so and is no longer a
 * flight anybody could be charged or quoted for. Somewhere a drive away
 * (isNear) gets no flight at all: getting there is the road or the rail.
 */
export function awayLines(est: AwayEstimate, opts: {
  town: string; start?: string | null; end?: string | null;
  party: number; driving?: number; solo: boolean;
  /**
   * Members kept off the flight because they joined after its seats were
   * booked or paid for (lib/joining.ts latecomerOptOuts). Not flying with the
   * group, and not driving either — nobody asked them — so they are counted
   * apart, never in `driving`.
   */
  joinedLate?: number;
  /**
   * The flight was taken off because nobody was on it (lib/participation.ts
   * droppedFlight): nobody flies, whoever has joined since.
   */
  nobodyFlying?: boolean;
  /** Off the flight for a reason that could not be read: counted off, said of nobody. */
  offUnsaid?: number;
}): FixedLine[] {
  const lines: FixedLine[] = [];
  const party = Math.max(1, Math.round(opts.party));
  const driving = Math.max(0, Math.min(party, Math.round(opts.driving ?? 0)));
  const late = Math.max(0, Math.min(party - driving, Math.round(opts.joinedLate ?? 0)));
  const unsaid = Math.max(0, Math.min(party - driving - late, Math.round(opts.offUnsaid ?? 0)));
  const flying = opts.nobodyFlying ? 0 : party - driving - late - unsaid;
  // Nobody lands anywhere: no car from the airport, no transfers from it.
  const lands = est.transport.kind === 'ground' || flying > 0;
  const funds = opts.solo ? 'Booked through Reach when you pay for the trip' : 'Booked through Reach when the group funds the trip';
  const cents = (n: number | null) => n === null ? null : Math.round(n * 100);

  if (est.transport.kind === 'ground') {
    // A drive or a train: getting there is on the plan, and it is the
    // traveller's to arrange — Reach books neither.
    lines.push({
      scheduled_time: 'Before you go', type: 'transport',
      title: 'Getting there and back',
      subtitle: `${opts.town} is about ${est.km === null ? 'a drive' : `${milesOf(est.km)} miles`} from home as the crow flies — a drive or a train, not a flight. ${est.transport.per_person === null ? OWN_NOT_YET : OWN_ESTIMATE}`,
      cost_cents: cents(est.transport.per_person), booking_mode: 'ahead',
      payment_note: 'You arrange this yourself', estimate: true,
    });
  } else if (flying === 0) {
    // Nobody is flying: the line stays to say so, but it is not a flight
    // any more — type 'flight' is what the bookable route quotes, and a
    // priced "Booked through Reach" flight nobody takes is a promise
    // Reach would keep by buying a seat nobody sits in.
    lines.push({ ...nobodyFlyingLine(opts.solo, driving === party), flying: 0, driving });
  } else {
    const who = driving > 0 || late > 0 || unsaid > 0
      ? ` ${[`${flying} flying`, driving > 0 ? `${driving} driving or already booked` : null,
        late > 0 ? `${late} joined after the seats were booked` : null,
        unsaid > 0 ? `${unsaid} not flying` : null].filter(Boolean).join(', ')}.`
      : '';
    const per = cents(est.transport.per_person);
    lines.push({
      scheduled_time: 'Before you go', type: 'flight',
      title: est.transport.airport ? `Round-trip flights to ${est.transport.airport.iata}` : 'Round-trip flights',
      subtitle: `${est.travel?.flightLabel ?? 'Flights'}. ${est.transport.per_person === null ? NOT_YET : ESTIMATE}${who}`,
      cost_cents: per, party_cents: per === null ? null : per * flying,
      booking_mode: 'reach', payment_note: funds, estimate: true,
      flying, driving,
    });
  }

  if (est.car && lands) {
    const line = opts.start && opts.end && DAY.test(opts.start) && DAY.test(opts.end)
      ? rentalLine(est.car.from, opts.town, opts.start, opts.end) : null;
    lines.push({
      scheduled_time: 'Before you go', type: 'transport',
      title: line?.title ?? `Rental car from ${est.car.from.name} (${est.car.from.iata})`,
      subtitle: `${line?.subtitle ?? `${opts.town} is about ${est.car.from.miles} miles away as the crow flies — the drive is longer.`} ${est.car.per_person === null ? OWN_NOT_YET : OWN_ESTIMATE}`,
      cost_cents: cents(est.car.per_person),
      // Reach has no car provider: the search, opened at the airport and the
      // dates, is the traveller's to book.
      booking_mode: 'ahead',
      payment_note: 'You book this on your own card — the rental search opens at the airport and dates',
      venue_website: line?.venue_website ?? null, venue_name: line ? 'Kayak' : null,
      estimate: true,
    });
  }

  // Getting from the airport in a town that has one: the line the client
  // always wrote when the option priced it, kept as it was — the
  // traveller's to arrange, never one Reach books.
  const ground = est.ground;
  if (!est.car && est.transport.kind !== 'ground' && flying > 0 && ground !== null) {
    lines.push({
      scheduled_time: 'Before you go', type: 'transport',
      title: 'Airport transfers', subtitle: OWN_ESTIMATE,
      cost_cents: cents(ground), booking_mode: 'ahead',
      payment_note: 'You arrange this yourself', estimate: true,
    });
  }

  if (est.lodging) {
    const dated = !!(opts.start && opts.end && DAY.test(opts.start) && DAY.test(opts.end));
    lines.push({
      scheduled_time: 'Before you go', type: 'hotel',
      title: `Somewhere to stay · ${nightsWord(est.lodging.nights)}`,
      subtitle: [
        est.lodging.area ? `${est.travel?.stayLabel ?? 'A place to stay'}, around ${est.lodging.area}.` : `${est.travel?.stayLabel ?? 'A place to stay'}.`,
        dated ? `Check in ${opts.start}, check out ${opts.end}.` : null,
        est.lodging.per_person === null ? NOT_YET : ESTIMATE,
      ].filter(Boolean).join(' '),
      cost_cents: cents(est.lodging.per_person),
      booking_mode: 'reach', payment_note: funds, estimate: true,
      checkin: dated ? opts.start : null, checkout: dated ? opts.end : null, nights: est.lodging.nights,
    });
  }
  return lines;
}

// ─── The option card's rows ──────────────────────────────────────────────
// What AwayLinesCard shows, worked out here so a test can hold it to the
// total. Every part awayEstimate puts into per_person has a row: the card
// dropped the airport transfers once, and its rows came to less than the
// "Total per person" printed under them with nothing saying why.
export interface AwayCardRow {
  icon: string;
  label: string;
  detail: string | null;
  /** Per person, whole dollars; null is not estimated. */
  cost: number | null;
}
const dollars = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
const usdWord = (n: number) => `$${n.toLocaleString('en-US')}`;

export function awayCardRows(away: AwayEstimate, opts: { solo?: boolean } = {}): AwayCardRow[] {
  const t = away.transport;
  const rows: AwayCardRow[] = [];
  if (t.kind === 'ground') {
    rows.push({ icon: '🚗', label: 'Getting there and back', detail: t.label, cost: dollars(t.per_person) });
  } else {
    rows.push({
      icon: '✈️', label: t.kind === 'flight_and_car' && t.airport ? `Flights to ${t.airport.iata}` : 'Round-trip flights',
      detail: t.label, cost: dollars(t.per_person),
    });
    if (away.car) {
      rows.push({
        icon: '🚗', label: `Rental car from ${away.car.from?.iata || 'the airport'}`,
        detail: away.car.from ? `${away.car.from.name}, about ${away.car.from.miles} miles away as the crow flies — yours to book` : 'Yours to book',
        cost: dollars(away.car.per_person),
      });
    } else if (dollars(away.ground) !== null) {
      // The town has its own airport: ground_transport is getting from it,
      // the same "Airport transfers" line awayLines puts on the plan.
      rows.push({ icon: '🚕', label: 'Airport transfers', detail: 'Yours to arrange', cost: dollars(away.ground) });
    }
  }
  if (away.lodging) {
    const l = away.lodging;
    const night = dollars(l.per_night);
    rows.push({
      icon: '🏨', label: `Somewhere to stay · ${nightsWord(l.nights)}`,
      detail: [l.label ? String(l.label).split(' · ')[0] : null, l.area ? `around ${l.area}` : null,
        night !== null ? `about ${usdWord(night)} a night${opts.solo ? '' : ' each'}` : null].filter(Boolean).join(', ') || null,
      cost: dollars(l.per_person),
    });
  }
  return rows;
}

// ─── An idea saved before away estimates existed ─────────────────────────
// It carries its costs and no distance, so nothing can say whether it is a
// flight or a drive. A flight it priced is a flight. One it priced at 0 may
// be a drive — the prompt asks for 0 then — or a model that left it out,
// and naming it "Round-trip flights · Booked through Reach" turned a cabin
// 150 miles away into a flight checkout went off to quote. So that line
// says what we know: getting there is not worked out, and it is theirs to
// arrange. ground_transport is said as what it is, getting about, since it
// may be the drive or transfers from an airport.
export function savedIdeaLines(trip: AwayTripLike, opts: {
  nights: number; town: string; start?: string | null; end?: string | null;
  party: number; solo: boolean;
}): FixedLine[] {
  const est = awayEstimate(trip, { nights: opts.nights });
  const lines = awayLines(est, opts);
  if (est.transport.per_person !== null) return lines;
  const ground = est.ground;
  const kept = lines.filter(l => l.type !== 'flight' && l.title !== 'Airport transfers');
  const front: FixedLine[] = [{
    scheduled_time: 'Before you go', type: 'transport',
    title: 'Getting there and back',
    subtitle: `This idea was saved without a flight or a drive worked out, so how you get to ${opts.town} is yours to arrange. ${OWN_NOT_YET}`,
    cost_cents: null, booking_mode: 'ahead', payment_note: 'You arrange this yourself', estimate: true,
  }];
  if (ground !== null) {
    front.push({
      scheduled_time: 'Before you go', type: 'transport',
      title: 'Getting about', subtitle: OWN_ESTIMATE,
      cost_cents: Math.round(ground * 100), booking_mode: 'ahead',
      payment_note: 'You arrange this yourself', estimate: true,
    });
  }
  return [...front, ...kept];
}

/**
 * An idea saved before away estimates, with the distance measured now.
 *
 * savedIdeaLines cannot tell a flight from a drive, so a cabin 150 miles
 * away whose model priced a flight anyway still came back "Round-trip
 * flights · Booked through Reach" — a flight checkout would go and quote for
 * somewhere you drive to. With the distance from home (lib/away.ts), the
 * server's own drive rule decides it (isNear, DRIVE_KM): a drive gets the
 * road and no flight line at all; a long way gets the flight.
 *
 * On a drive, the road carries no price. The only figure the idea has for
 * the ground, ground_transport, was written by a model pricing the trip as
 * a flight — shuttles from an airport nobody will land at — so calling it
 * the drive is an estimate nobody made. It is kept as what savedIdeaLines
 * calls it, "Getting about", since nobody can say what it covers.
 *
 * Without a distance — no home saved, or the lookup slow or empty — nothing
 * is known that the saved idea did not already say, so it is said exactly as
 * savedIdeaLines says it: a flight it priced stays the flight Reach books
 * (a failed lookup must never take a transatlantic flight off a plan), and
 * one it priced at 0 is said to be theirs to arrange.
 */
export function oldIdeaLines(trip: AwayTripLike, opts: {
  nights: number; town: string; start?: string | null; end?: string | null;
  party: number; solo: boolean; km: number | null;
}): FixedLine[] {
  const { km, ...rest } = opts;
  if (typeof km !== 'number' || !Number.isFinite(km)) return savedIdeaLines(trip, rest);
  if (!isNear(km)) return awayLines(awayEstimate(trip, { nights: opts.nights, km }), rest);
  const c = trip.costs ?? {};
  const { ground_transport: _modelGround, ...noGround } = c;
  const lines = awayLines(awayEstimate({ ...trip, costs: noGround }, { nights: opts.nights, km }), rest);
  const ground = priced(c.ground_transport) ? Math.round(c.ground_transport!.per_person as number) : null;
  if (ground === null) return lines;
  const road = lines.findIndex(l => l.title === 'Getting there and back');
  lines.splice(road + 1, 0, {
    scheduled_time: 'Before you go', type: 'transport',
    title: 'Getting about', subtitle: OWN_ESTIMATE,
    cost_cents: Math.round(ground * 100), booking_mode: 'ahead',
    payment_note: 'You arrange this yourself', estimate: true,
  });
  return lines;
}

/**
 * How many of the seats the preview should look for on a flight. A drive
 * away (the road) has nobody flying, so no flight is searched for and the
 * screen is never shown fares for a trip nobody flies to; otherwise the
 * people the plan's own flight line counts as flying when it has one, else
 * everybody.
 */
export function previewFlying(away: Partial<AwayEstimate> | null | undefined, seats: number, lineFlying?: number | null): number {
  const all = Math.max(1, Math.round(seats) || 1);
  if (away?.transport?.kind === 'ground') return 0;
  if (typeof lineFlying === 'number' && Number.isFinite(lineFlying)) return Math.max(0, Math.min(all, Math.round(lineFlying)));
  return all;
}

/**
 * A fixed line as the client's itinerary rows are shaped (`time`, `sub`) —
 * the shape afterRebuild and the itinerary PUT already take — so the screen
 * uses the server's lines instead of building its own from the costs.
 */
export function rowOf(line: FixedLine) {
  return {
    time: line.scheduled_time, title: line.title, sub: line.subtitle, type: line.type,
    conf: null, filled: false,
    cost_cents: line.cost_cents, booking_mode: line.booking_mode, payment_note: line.payment_note,
    estimate: true,
    // Who is on the flight, carried to the screen: dropped here, the client
    // went on totalling a flight for everyone after somebody drove.
    ...(line.flying != null ? { flying: line.flying, driving: line.driving ?? 0, party_cents: line.party_cents ?? null } : {}),
    ...(line.venue_website ? { venue_website: line.venue_website, venue_name: line.venue_name ?? null } : {}),
  };
}

// ─── Live offers, ranked by the tier ─────────────────────────────────────
// The preview asks the providers what is on sale. A saver and a stretch
// shown the same cheapest red-eye are not two tiers, so what comes back is
// ranked by the tier's own rule, each offer saying whether it fits.

export interface FlightLeg { departs?: string | null; stops?: number | null }
export interface FlightOffer { priceCents: number | null; out?: FlightLeg | null; back?: FlightLeg | null }

function hourOf(at: string | null | undefined): number | null {
  // Duffel gives local times, "2026-11-02T07:15:00": the hour is the clock
  // at the airport, which is the one anybody means by "early".
  const m = /T(\d{2}):/.exec(String(at ?? ''));
  return m ? Number(m[1]) : null;
}

export function flightFits(o: FlightOffer, tier: Tier): boolean {
  const rule = TIER_TRAVEL[tier];
  for (const leg of [o.out, o.back]) {
    if (!leg) continue;
    if (rule.maxStops !== null && (leg.stops ?? 99) > rule.maxStops) return false;
    if (rule.departs) {
      const h = hourOf(leg.departs);
      if (h === null || h < rule.departs[0] || h >= rule.departs[1]) return false;
    }
  }
  return !!o.out;
}

const stopsOf = (o: FlightOffer) => (o.out?.stops ?? 9) + (o.back?.stops ?? 0);
const price = (p: number | null | undefined) => (typeof p === 'number' && Number.isFinite(p) ? p : Infinity);
/** Legs leaving inside the tier's hours — a near miss beats a red-eye. */
function legsInHours(o: FlightOffer, tier: Tier): number {
  const w = TIER_TRAVEL[tier].departs;
  if (!w) return 0;
  return [o.out, o.back].filter(l => {
    const h = hourOf(l?.departs);
    return h !== null && h >= w[0] && h < w[1];
  }).length;
}

/**
 * The offers, those that fit the tier first; then, past a saver, fewest
 * stops and the most legs at sociable hours; then price.
 */
export function flightsForTier<O extends FlightOffer>(offers: O[], tier: Tier, limit = 3): Array<O & { fitsTier: boolean }> {
  return [...(offers ?? [])]
    .map(o => ({ ...o, fitsTier: flightFits(o, tier) }))
    .sort((a, b) => Number(b.fitsTier) - Number(a.fitsTier)
      || (tier === 'saver' ? 0 : stopsOf(a) - stopsOf(b))
      || (tier === 'saver' ? 0 : legsInHours(b, tier) - legsInHours(a, tier))
      || price(a.priceCents) - price(b.priceCents))
    .slice(0, limit);
}

export interface HotelOffer { priceCents: number | null; stars?: number | null }

export function hotelFits(h: HotelOffer, tier: Tier): boolean {
  const min = TIER_TRAVEL[tier].minStars;
  if (min === null) return true;
  return typeof h.stars === 'number' && h.stars >= min;
}

/** The hotels, those of the tier's class first, then by price. */
export function hotelsForTier<H extends HotelOffer>(hotels: H[], tier: Tier, limit = 3): Array<H & { fitsTier: boolean }> {
  return [...(hotels ?? [])]
    .map(h => ({ ...h, fitsTier: hotelFits(h, tier) }))
    .sort((a, b) => Number(b.fitsTier) - Number(a.fitsTier) || price(a.priceCents) - price(b.priceCents))
    .slice(0, limit);
}
