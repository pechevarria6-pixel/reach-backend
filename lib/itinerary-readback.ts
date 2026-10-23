// ─── Generated days, read back against the menu ──────────────────────────
// What the generator may let out of the door, in one place: the whole
// itinerary (app/api/trips/generate) and "Something else…" on a single slot
// both go through readBackDays, so a stop rewritten on its own is held to
// exactly what the full generator is held to — only verified places named,
// no stay nobody booked, no claim we cannot keep, nothing broken, nothing
// vetoed, one dinner an evening and one part of town.
//
// Lifted out of the route unchanged in what it does; the comments that
// explain each rule came with it.
import type { z } from 'zod';
import { SlotSchema, type ItineraryDaySchema, type SlotPart } from './trip-schema.ts';
import {
  withoutUnverified, unverifiedNames, citedPlace, cleanRef, bookingFor, wouldMangle,
  readBackCoherence, type RealPlace, type CoherenceNote,
} from './discovery/real-places.ts';
import { realPlacesAmong } from './discovery/is-place.ts';
import { locate } from './discovery/geocode.ts';
import { normalise } from './discovery/verify.ts';
import type { RealEvent } from './discovery/find-event.ts';
import { withoutStayClaim } from './stay-claims.ts';
import { isFiller, fillerClaim, corruptionAt, beforeCorruption } from './filler.ts';
import { oneMealPerEvening } from './generation-rules.ts';
import { withoutVetoed } from './vetoes.ts';
import { within } from './deadline.ts';

/**
 * A slot as the day holds it, whatever shape it arrived in: a saved idea's
 * slot, a bare string from an older generation, or nothing. Read for
 * context only — a stop on either side of the one being changed.
 */
export function asGenSlot(v: unknown): GenSlot {
  const o: Record<string, unknown> = typeof v === 'string' ? { plan: v } : v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {};
  const base = {
    plan: typeof o.plan === 'string' ? o.plan : '',
    cost: typeof o.cost === 'number' && Number.isFinite(o.cost) ? o.cost : 0,
    booking: o.booking === 'reach' || o.booking === 'ahead' || o.booking === 'walk_in' ? o.booking : 'walk_in',
  };
  const full = SlotSchema.safeParse({ ...o, ...base });
  return full.success ? full.data : SlotSchema.parse(base);
}

// ─── Reading generated days back against the menu ────────────────────────
// One read-back, used by the whole itinerary and by "Something else…" on a
// single slot, so a slot rewritten on its own is held to exactly what the
// full generator is held to. Lifted out of the itinerary branch unchanged
// in what it does; the comments that explain each rule stayed with it.

export type GenDay = z.infer<typeof ItineraryDaySchema>;
export type GenSlot = z.infer<typeof SlotSchema>;

export function slotsOf(day: GenDay): GenSlot[] {
  return [day.morning, day.afternoon, day.evening, ...(day.daytime ?? [])].filter(Boolean) as GenSlot[];
}

/** A picture is attached from a row or a listing, never taken from the model. */
export function clearPhotos(days: GenDay[]): void {
  for (const day of days) {
    for (const slot of slotsOf(day)) {
      if (slot) { slot.place_photo = null; slot.place_photo_credit = null; slot.place_photo_of = null; slot.place_photo_link = null; }
    }
  }
}

/**
 * The ticket, carried through to something you can press.
 *
 * The listing gave us a venue, a date and the page that sells the tickets,
 * and until now only the first two survived: the URL was read as a boolean
 * and thrown away. So the evening said "See The Milk Carton Kids live at
 * 9:30 CLUB" above a button reading "Reserve ahead", which is not a thing
 * anybody can do. Reach cannot sell a ticket; it can hand somebody straight
 * to the page that does, and that is a complete answer rather than a dead
 * end.
 *
 * Attached to the slot that actually names the event rather than to a fixed
 * position, because which slot holds it is the model's choice.
 */
export function attachTicket(days: GenDay[], realEvent: RealEvent | null): boolean {
  if (!realEvent?.url) return false;
  const marks = [realEvent.venue, realEvent.title].filter(Boolean).map(v => normalise(String(v)));
  let attached = false;
  for (const day of days) {
    for (const slot of [day.evening, day.afternoon, day.morning, ...(day.daytime ?? [])]) {
      if (!slot || attached) continue;
      const here = normalise(slot.plan);
      if (!marks.some(m => m && here.includes(m))) continue;
      slot.ticket_url = realEvent.url;
      slot.venue = realEvent.venue ?? null;
      // The act's picture, from the same listing that sold the ticket.
      // And what it is of: the line names the venue, the picture is
      // usually the band.
      if (realEvent.photo) { slot.place_photo = realEvent.photo.url; slot.place_photo_credit = realEvent.photo.credit; slot.place_photo_of = realEvent.photo.of ?? null; }
      attached = true;
    }
  }
  return attached;
}

/**
 * Geography is real even when we hold no record of it.
 *
 * A beach, a river and a neighbourhood are not businesses, so they are
 * never in a venue table built from business tags. Softening them turned
 * "Sunset from Playa Los Muertos" into "Sunset from a local spot", which is
 * not an improvement on anything.
 *
 * The same map that lists the restaurants lists the beach, so the names
 * nothing else vouches for are asked about before they are softened.
 * Strictly time-boxed: Overpass taught this lesson at seventy-two seconds,
 * and a check that cannot answer in time must cost the traveller nothing.
 * Falling back means softening, which is what happened before this existed.
 */
export async function vouchedGeography(
  days: GenDay[], realPlaces: RealPlace[], vouchers: string[],
  where: { place: string; country: string | null },
): Promise<string[]> {
  const candidates = [...new Set(days.flatMap(day => slotsOf(day)
    .flatMap(slot => [...unverifiedNames(slot.plan, realPlaces, vouchers), ...unverifiedNames(slot.tip ?? '', realPlaces, vouchers)])))];
  if (!candidates.length) return [];
  let geography = new Set<string>();
  const at = await locate(where.place, where.country).catch(() => null);
  if (at) {
    // Scaled to the plan. Ten names in eight seconds is enough for an
    // evening and not for a fortnight: a thirteen-day Moab itinerary ran
    // out of budget and a street name was softened to "a local spot",
    // leaving "walk the length of a local spot" on the screen. Still
    // bounded — a check that cannot answer in time costs the traveller
    // nothing and the fallback is what we did before.
    const room = Math.min(40, Math.max(10, days.length * 3));
    geography = await within(
      realPlacesAmong(candidates.slice(0, room), { lat: at.lat, lng: at.lng }),
      Math.min(25000, 6000 + room * 700), 'checking the landmarks',
    ).catch(() => new Set<string>());
  }
  console.log('[trips itinerary] names nothing held vouched for', {
    asked: candidates.length, real_places: [...geography],
  });
  return [...geography];
}

export interface ReadBackEnv {
  realPlaces: RealPlace[];
  /** Names that are real without being on the menu, geography included. */
  vouchers: string[];
  destination: unknown;
  isNightPlan: boolean;
  realEvent: RealEvent | null;
  nightPrefs: Record<string, any>;
  vetoes: string[];
  planForLog: string | null;
  /** A dry run: the same rules, nothing logged or tracked. */
  quiet?: boolean;
  onDroppedLocation?: (note: Extract<CoherenceNote, { what: 'dropped_location' }>) => void;
}

/**
 * Nothing goes out that we cannot stand behind.
 *
 * The prompt asks the model to name only verified places. Asking has a good
 * success rate, and a good success rate is not the standard: one invented
 * restaurant in fifty is still somebody standing outside a laundrette at
 * eight in the evening.
 *
 * So the output is read back against the same list the prompt was given. A
 * name nothing vouches for is softened to what we can actually support —
 * the claim goes, the shape of the evening stays. Returns the days, some of
 * which are replaced rather than edited in place (a dropped meal, a veto).
 */
export function readBackDays(input: GenDay[], env: ReadBackEnv): GenDay[] {
  const days = input;
  const { realPlaces, vouchers, destination, isNightPlan, realEvent, nightPrefs } = env;
  const log: (...a: unknown[]) => void = env.quiet ? () => {} : (...a) => console.error(...a);
  let softened = 0;
  // Nothing generated here books a bed. A slot is a plan, a cost, a
  // booking mode and a payment note — there is no accommodation in the
  // schema at all, and the accommodation figure on a trip option is a
  // budget line, a number to plan against, not a reservation. So the rule
  // needs no condition: a generated day may never write somebody into a
  // room, because at this point nobody has one.
  const invented = new Set<string>();
  const stripped = new Set<string>();
  for (const day of days) {
    for (const slot of slotsOf(day)) {
      // What this slot actually points at, if anything we handed over.
      const cited = citedPlace(slot.place_ref, realPlaces);

      // "Reach will book this" has to be something Reach can do. The
      // prompt forbids claiming it for a table and the screen guessed
      // from the slot's type; a resolved place answers it outright.
      // hasTicket is about THIS slot, not the plan.
      //
      // It was `!!realEvent?.url`, so once a plan had a real gig in it
      // every slot claiming "reach" kept the claim — and "Reach will
      // book this" appeared over a restaurant table, which is the exact
      // promise the whole check exists to stop. The ticket is attached
      // above, so the slot can simply be asked.
      // The place's own site, so somebody can actually go and book it.
      //
      // Every one of the 386 verified venues carries a website and not
      // one of them reached a screen: a trip's itinerary named real
      // restaurants and gave no way to reserve any of them. The row we
      // matched has the address; it just was never passed on.
      if (cited?.url && !slot.ticket_url) {
        slot.place_url = cited.url;
        slot.venue = slot.venue ?? cited.name;
      }
      // A picture of the place this line names — from the row it cited,
      // with its credit, and only that row. A slot that cites nothing
      // gets no picture, however confidently it names somewhere.
      if (cited?.photo && !slot.ticket_url) {
        slot.place_photo = cited.photo.url;
        slot.place_photo_credit = cited.photo.credit;
        slot.place_photo_of = cited.name ?? null;
        slot.place_photo_link = cited.photo.link ?? null;
      }
      // What is on there, read off the venue's own page. Carried on the
      // slot rather than left to the model to mention, because it is the
      // most useful thing we hold about a place and it must not depend
      // on whether the sentence happened to include it. If we do not
      // tell somebody there is a quiz on Wednesday, they do not know.
      if (cited?.whatsOn?.length) slot.whats_on = cited.whatsOn.slice(0, 2).join(' · ');

      const honest = bookingFor(slot.booking, cited, !!slot.ticket_url);
      // A table to book gets the way to book it: the venue's own booking
      // page when it names one, and its number either way. Both were
      // held and neither reached the line (audit #50).
      if (cited && honest === 'ahead' && !slot.ticket_url) {
        if (cited.reserveUrl) { slot.place_url = cited.reserveUrl; slot.venue = slot.venue ?? cited.name; }
        if (cited.phone) slot.place_phone = cited.phone;
      }
      if (honest !== slot.booking) {
        log('[trips itinerary] downgraded a booking claim we cannot keep', {
          destination, claimed: slot.booking, kept: honest, place: cited?.name ?? null,
        });
        slot.booking = honest;
      }

      // Nobody is written into a room nobody booked. The prompt says so
      // now; this is the half that does not depend on the prompt being
      // obeyed. A whole Moab plan shipped opening with "check into the
      // hotel" on a trip with no hotel item and no hotel booking.
      // A line that describes the slot instead of filling it. Two of
      // these reached real plans — "This is the slot for the thing Peter
      // already has in mind" — sitting where the gig should be. Unlike a
      // stay claim there is nothing in it to rescue: it is about the
      // form all the way through, and writing the evening ourselves is
      // the thing we do not do. The slot goes.
      if (isFiller(slot.plan)) {
        log('[trips itinerary] dropped a slot that described itself', {
          destination, phrase: fillerClaim(slot.plan), slot: String(slot.plan).slice(0, 80),
        });
        invented.add(String(fillerClaim(slot.plan)));
        slot.plan = '';
      }

      const stay = withoutStayClaim(String(slot.plan ?? ''));
      if (stay.removed) {
        log('[trips itinerary] removed a stay nobody booked', {
          destination, claim: stay.removed, kept: stay.text === null ? '(whole slot)' : 'clause',
        });
        invented.add(stay.removed);
        // Null means nothing true was left. Rather than invent a
        // replacement — which is how the hotel got here in the first
        // place — the slot loses the sentence that was not true.
        slot.plan = stay.text ?? '';
      }

      const clean = withoutUnverified(slot.plan, realPlaces, vouchers);
      if (clean.removed.length) {
        softened++;
        clean.removed.forEach(n => stripped.add(n));
        // Softening works when the name is the object of the sentence,
        // not its subject: "Dusk session at Wine & Design…" became "a
        // local spot at Dusk session at Wine & Design…" on a real row.
        // The tip already had this check; the line itself did not. A
        // line that would read as nonsense goes, like a filler slot.
        if (wouldMangle(slot.plan, clean.removed)) {
          log('[trips itinerary] dropped a line softening would have mangled', {
            destination, removed: clean.removed.slice(0, 3), slot: String(slot.plan).slice(0, 80),
          });
          slot.plan = '';
        } else {
          slot.plan = clean.text;
        }
        // A reference to a place we just removed is not a reference.
        slot.place_ref = null;
      }
      // Text that came back broken — "…near the pub.morplinsert1" —
      // is cut back to its last whole sentence, or dropped.
      if (slot.plan) {
        const whole = beforeCorruption(String(slot.plan));
        if (whole !== slot.plan) {
          log('[trips itinerary] cut a line that came back broken', {
            destination, at: corruptionAt(slot.plan), slot: String(slot.plan).slice(0, 80),
          });
          slot.plan = whole ?? '';
        }
      }
      // A live run returned "http://null" here. It resolves to nothing,
      // so it was harmless, and it is still not a citation — it must not
      // travel on as though it might be one.
      if (slot.place_ref && !cleanRef(slot.place_ref)) {
        log('[trips itinerary] discarded a place_ref that is not one', { got: String(slot.place_ref).slice(0, 40) });
        slot.place_ref = null;
      }
      // The slot's own tip, read back like its line. A slot whose line
      // went has nothing for a tip to be about, so the tip goes too.
      if (!slot.plan) slot.tip = '';
      const tip = withoutUnverified(String(slot.tip ?? ''), realPlaces, vouchers);
      if (tip.removed.length) {
        tip.removed.forEach(n => stripped.add(n));
        // Softening works when the name is the object of the sentence.
        // When it is the subject it does not: a live run produced "a local
        // spot stays lively after evening shows let out", which is not a
        // sentence anybody wrote. A tip is flavour, so it is dropped rather
        // than mangled — and a tip naming a business was already against
        // the rule that a tip describes a place, not what a business does.
        slot.tip = wouldMangle(String(slot.tip ?? ''), tip.removed) ? '' : tip.text;
      }
      // A tip is flavour: broken, it goes.
      if (slot.tip && corruptionAt(slot.tip) >= 0) {
        log('[trips itinerary] dropped a tip that came back broken', {
          destination, tip: String(slot.tip).slice(0, 80),
        });
        slot.tip = '';
      }
    }
  }

  // ── Does each line describe the place it names, where it is ─────
  // The names above are all real by now; this reads what the lines say
  // ABOUT them. Plan f979c880 named SPIN, a cocktail bar on F Street,
  // and said it was good for dancing, under a tip about the monuments
  // on the Mall — every name vouched for, and the evening described a
  // different place. See readBackCoherence (lib/discovery/real-places).
  // "Make a day of it" is for an evening somebody might stretch. The prompt
  // says a person who only wanted a drink is never shown it; this is the
  // half that does not depend on the prompt being obeyed. Cleared before
  // the read-back below, so offers about to be thrown away have no say in
  // which of the evening's own stops survive.
  if (isNightPlan) {
    const kinds = ((nightPrefs.kind || []) as unknown[]).map(k => String(k).toLowerCase());
    const drinksOnly = kinds.length > 0 && kinds.every(k => /drink|bar|pub|cocktail|wine|beer/.test(k));
    const quiet = /chill|low|quiet|easy|mellow/i.test(String(nightPrefs.energy || ''));
    if (drinksOnly || quiet) for (const d of days) (d as { daytime?: unknown[] }).daytime = [];
  }
  // The listing vouches for the gig: the slot holding it (ticket_url,
  // attached above) is read against the event as well as the row, keeps
  // the act if it is rewritten, and anchors the evening's geography.
  const coherence = readBackCoherence(days, realPlaces, {
    night: isNightPlan,
    event: realEvent?.url ? { title: realEvent.title, venue: realEvent.venue } : null,
  });
  for (const note of coherence) {
    if (note.what === 'dropped_location') {
      log('[trips itinerary] dropped a stop nowhere near the rest', {
        destination, plan: env.planForLog, day: note.day, slot: note.slot,
        place: note.place, km: note.km, reason: note.reason,
      });
      if (!env.quiet) env.onDroppedLocation?.(note);
    } else {
      log(note.what === 'rewritten'
        ? '[trips itinerary] replaced a line that described another kind of place'
        : '[trips itinerary] dropped a tip about another kind of place', {
        destination, day: note.day, slot: note.slot, place: note.place, topics: note.topics,
      });
    }
  }
  if (softened || stripped.size) {
    // Worth shouting about. A high count here means the menu was thin or
    // the rule is not landing, and both are fixable — but only if the
    // log says so rather than the traveller finding out.
    log('[trips itinerary] removed names nothing vouches for', {
      destination, slots: softened, verified_places: realPlaces.length,
      names: [...stripped].slice(0, 12),
    });
  }

  if (invented.size) {
    // Separate from the venue count above, because it is a different
    // failure with a different fix. A stripped venue name means the menu
    // was thin. This means the model was told, in the prompt, not to put
    // anybody in a room, and did it anyway — so if this keeps appearing,
    // the instruction is the thing to change, not the venue table.
    log('[trips itinerary] removed stays nobody booked', {
      destination, claims: [...invented].slice(0, 8),
    });
  }

  // One sit-down meal an evening. The prompt says so; this is the half
  // that does not depend on it being obeyed (lib/generation-rules.ts).
  if (isNightPlan) {
    for (let i = 0; i < days.length; i++) {
      const { day, dropped } = oneMealPerEvening(days[i]);
      if (dropped.length) {
        log('[trips itinerary] dropped a second meal in one evening', {
          destination, plan: env.planForLog, dropped: dropped.map(d => d.slice(0, 60)),
        });
        days[i] = day;
      }
    }
  }
  // A veto is absolute, and the prompt saying so is only half of it
  // (lib/vetoes.ts): whatever came back is read against what anybody
  // going said they will not do, and a line that breaks it goes.
  if (env.vetoes.length) {
    for (let i = 0; i < days.length; i++) {
      const { day, dropped } = withoutVetoed(days[i] as Parameters<typeof withoutVetoed>[0], env.vetoes);
      if (dropped.length) {
        log('[trips itinerary] dropped lines that broke a veto', {
          destination, plan: env.planForLog, dropped: dropped.map(d => `${d.veto}: ${d.text.slice(0, 60)}`),
        });
        days[i] = day as typeof days[number];
      }
    }
  }
  return days;
}

// ─── One slot, read back as part of its day ──────────────────────────────
// "Something else…" rewrites one stop. Read on its own, a new stop could
// pass every rule and still break the day: a second dinner (which the
// evening rule settles by dropping the later meal — possibly the real one),
// or a bar across town (which the cluster rule settles by dropping the
// stray — possibly a stop that was there first). Neither is this request's
// to change. So the day is read back twice, as it stands and with the new
// stop in it, by the same readBackDays; if anything but the new stop comes
// out differently, the new stop is what goes.

/**
 *   moved_another  it would have changed another stop
 *   clashes        it stands on its own, and the day will not have it
 *   nothing_fits   nothing verified came back (or what came back broke a rule)
 *   same_place     it is the stop it replaces, or one the day already has
 */
export type SlotRefusal = 'moved_another' | 'clashes' | 'nothing_fits' | 'same_place';

export function oneSlotReadBack(input: {
  day: GenDay; part: SlotPart; index: number | null; fresh: GenSlot; env: ReadBackEnv;
}): { slot: GenSlot } | { refused: SlotRefusal } {
  const { part, index, env } = input;
  if (part === 'daytime' && (index === null || !input.day.daytime?.[index])) return { refused: 'nothing_fits' };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const put = (day: GenDay, slot: GenSlot) => {
    if (part === 'daytime') day.daytime[index!] = slot; else day[part] = slot;
  };
  const take = (day: GenDay): GenSlot | undefined => (part === 'daytime' ? day.daytime?.[index!] : day[part]);
  const current = take(input.day);

  const fresh = clone(input.fresh);
  // Only rows and listings attach these; nothing the model wrote into
  // them survives.
  fresh.ticket_url = null; fresh.place_url = null; fresh.whats_on = null; fresh.place_phone = null; fresh.venue = null; fresh.kind = null;
  fresh.place_photo = null; fresh.place_photo_credit = null; fresh.place_photo_of = null; fresh.place_photo_link = null;
  const before = clone(input.day);
  const withNew = clone(input.day);
  put(withNew, fresh);
  attachTicket([before], env.realEvent);
  attachTicket([withNew], env.realEvent);

  const [baseline] = readBackDays([before], { ...env, vouchers: [...env.vouchers], quiet: true });
  const [after] = readBackDays([withNew], env);

  const rest = (d: GenDay) => [
    ...(['morning', 'afternoon', 'evening'] as const).filter(k => k !== part).map(k => d[k]?.plan ?? ''),
    ...(d.daytime ?? []).filter((_, i) => !(part === 'daytime' && i === index)).map(s => s?.plan ?? ''),
  ];
  if (JSON.stringify(rest(baseline)) !== JSON.stringify(rest(after))) return { refused: 'moved_another' };

  const got = take(after);
  if (!got?.plan) {
    // Gone. Either it never stood (an invented name, a veto), or it stood
    // on its own and the day would not have it — a second dinner, a stop
    // across town. Those are different things to tell somebody.
    const alone: GenDay = { ...clone(input.day), morning: asGenSlot(null), afternoon: asGenSlot(null), evening: asGenSlot(null), daytime: [] };
    if (part === 'daytime') alone.daytime = [clone(fresh)]; else alone[part] = clone(fresh);
    const [solo] = readBackDays([alone], { ...env, vouchers: [...env.vouchers], quiet: true });
    const stood = part === 'daytime' ? solo.daytime?.[0] : solo[part];
    return { refused: stood?.plan ? 'clashes' : 'nothing_fits' };
  }
  // Something else means somewhere else: not the stop it replaces, and not
  // another stop the same day already goes to.
  const ref = got.place_ref ? cleanRef(got.place_ref) : null;
  const others = [
    ...(['morning', 'afternoon', 'evening'] as const).filter(k => k !== part).map(k => input.day[k]),
    ...(input.day.daytime ?? []).filter((_, i) => !(part === 'daytime' && i === index)),
  ];
  const same = (ref && current?.place_ref && ref === cleanRef(current.place_ref))
    || normalise(got.plan) === normalise(current?.plan ?? '')
    || (ref && others.some(o => o?.place_ref && cleanRef(o.place_ref) === ref));
  if (same) return { refused: 'same_place' };
  return { slot: got };
}
