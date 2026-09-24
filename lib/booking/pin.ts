// ─── What was priced is what gets bought ─────────────────────────────────
// A quote names one hotel and one fare. Approval prices it again and book()
// buys it, and both used to start from the request as first asked — a city,
// a route and a date — so they bought whatever came back first at that
// moment: another hotel, or the cheapest fare on the route, whose terms the
// group had never been shown.
//
// The hotel was pinned first (its hotelId, at /api/bookings). This pins the
// flight the same way: the exact flights (offerKey, every flight number both
// ways) and the fare terms the screen showed for them (fareTerms, Duffel's
// change and refund conditions in words). Duffel's quote then prices those
// flights on that fare or says they are no longer on sale — never a
// different fare on the same flights, whose terms nobody agreed to.
//
// Pure, so every place a quote is stored — a new quote, a choice from the
// options, a quote priced again for a new headcount — pins the same way.

type Payload = Record<string, unknown>;
const obj = (v: unknown): Payload | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Payload : null);

/** The fare terms a flight quote stored, in words, or null when the airline said nothing. */
export function fareTermsOf(raw: unknown): string[] | null {
  const said = obj(raw)?.conditions;
  if (!Array.isArray(said)) return null;
  const terms = said.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  return terms.length ? terms : null;
}

/**
 * The request as stored, pinned to what `raw` (the provider's answer) priced:
 * a flight's offerKey and fare terms, a hotel's hotelId. Anything the quote
 * does not say is left as it was. A new flight choice carries new terms, so
 * terms from an earlier fare are dropped rather than kept beside new flights.
 */
export function pinQuoted<T extends Payload>(request: T, vertical: unknown, raw: unknown): T {
  const r = obj(raw);
  if (!r) return request;
  if (vertical === 'flight') {
    const flight = obj(request.flight);
    const key = typeof r.offerKey === 'string' && r.offerKey ? r.offerKey : null;
    if (!flight || !key) return request;
    const terms = fareTermsOf(r);
    const { fareTerms: _old, ...rest } = flight;
    void _old;
    return { ...request, flight: { ...rest, offerKey: key, ...(terms ? { fareTerms: terms } : {}) } };
  }
  if (vertical === 'hotel') {
    const hotel = obj(request.hotel);
    const id = typeof r.hotelId === 'string' && r.hotelId ? r.hotelId : null;
    if (!hotel || !id || hotel.hotelId) return request;
    return { ...request, hotel: { ...hotel, hotelId: id } };
  }
  return request;
}

/**
 * The terms approval holds a fresh quote to: what the screen showed before
 * anybody paid. A flight's are its conditions in words; a hotel's is the
 * rate's own refundable flag (RFN / NRFN). Null when nothing was shown, and
 * then nothing is compared.
 */
export function shownTerms(vertical: unknown, raw: unknown): string | null {
  const r = obj(raw);
  if (!r) return null;
  if (vertical === 'flight') {
    const terms = fareTermsOf(r);
    return terms ? terms.join(' | ') : null;
  }
  if (vertical === 'hotel') {
    const tag = obj(r.cancellationPolicies)?.refundableTag;
    return typeof tag === 'string' && tag ? tag : null;
  }
  return null;
}
