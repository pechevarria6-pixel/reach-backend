// ─── Paying a friend back, in their own app ──────────────────────────────
// Reach never moves money between members. Settle-up works out who owes whom
// (lib/money.ts settleUp) and then hands each line to the payer's own app,
// already filled in: the handle, the amount, what it was for. Nothing here
// talks to Venmo or Cash App — these are links, and the payment happens
// there, between the two people, where Reach cannot see it or hold it.
//
// Every builder returns null rather than a link that goes nowhere. A handle
// we cannot read is a missing handle, and the screen asks for one ("Add your
// Venmo so friends can pay you back") instead of opening the app on a
// stranger's profile or a blank form. Zelle has no link at all, so it gets
// the recipient's contact and a copy button, and nothing that pretends to be
// more.
//
// The shapes are the checkout spec's (2026-09-25):
//   venmo://paycharge?txn=pay&recipients=<handle>&amount=42.00&note=Cabo%20trip
//   https://venmo.com/<handle>?txn=pay&amount=42.00&note=Cabo%20trip  (fallback)
//   https://cash.app/$<cashtag>/42.00

/**
 * Whole dollars and cents from cents, the way both apps read an amount.
 * Positive integers only: a zero or a negative line is not somebody owing.
 */
export function amountOf(cents: unknown): string | null {
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * A Venmo username as people type it — with or without the @ — or null.
 * Venmo's are 5 to 30 letters, digits, hyphens and underscores.
 */
export function venmoHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const h = raw.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_-]{5,30}$/.test(h) ? h : null;
}

/**
 * A $cashtag, with or without the $, or null. Cash App's are up to 20
 * characters and must hold at least one letter.
 */
export function cashtag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/^\$/, '');
  return /^[A-Za-z0-9_]{1,20}$/.test(t) && /[A-Za-z]/.test(t) ? t : null;
}

/** What the payment was for, short enough for either app's note field. */
function noteOf(note: unknown): string {
  const n = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
  return [...n].slice(0, 60).join('');
}

export interface VenmoLinks {
  /** Opens the app when it is installed. */
  app: string;
  /** Where the app link cannot go: the same payment on Venmo's site. */
  web: string;
}

export function venmoLinks(input: { handle: unknown; amountCents: unknown; note?: unknown }): VenmoLinks | null {
  const handle = venmoHandle(input.handle);
  const amount = amountOf(input.amountCents);
  if (!handle || !amount) return null;
  const note = noteOf(input.note);
  const noteParam = note ? `&note=${encodeURIComponent(note)}` : '';
  return {
    app: `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(handle)}&amount=${amount}${noteParam}`,
    web: `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${amount}${noteParam}`,
  };
}

export function cashAppLink(input: { cashtag: unknown; amountCents: unknown }): string | null {
  const tag = cashtag(input.cashtag);
  const amount = amountOf(input.amountCents);
  if (!tag || !amount) return null;
  return `https://cash.app/$${tag}/${amount}`;
}

export interface ZelleContact {
  kind: 'email' | 'phone';
  /** What the copy button copies, as the person typed it for Zelle. */
  value: string;
}

/**
 * The contact somebody gave for Zelle — an email or a US phone number — or
 * null. Zelle has no link, so this is shown with a copy button and nothing
 * else. It is only ever the contact typed for Zelle: a phone number held for
 * something else is not somebody's consent to be paid on it.
 */
export function zelleContact(raw: unknown): ZelleContact | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return { kind: 'email', value: v };
  const digits = v.replace(/[\s().-]/g, '').replace(/^\+?1(?=\d{10}$)/, '');
  if (/^\d{10}$/.test(digits)) return { kind: 'phone', value: v };
  return null;
}

export interface SettleOptions {
  venmo: VenmoLinks | null;
  cashApp: string | null;
  zelle: ZelleContact | null;
}

/**
 * Every way to pay one person one line, from the handles they chose to give.
 * All three null means they have given none we can use — the screen says so
 * and still offers "Mark as paid", because people also settle in cash.
 */
export function settleOptions(input: {
  amountCents: unknown;
  note?: unknown;
  venmo?: unknown;
  cashtag?: unknown;
  zelle?: unknown;
}): SettleOptions {
  return {
    venmo: venmoLinks({ handle: input.venmo, amountCents: input.amountCents, note: input.note }),
    cashApp: cashAppLink({ cashtag: input.cashtag, amountCents: input.amountCents }),
    zelle: amountOf(input.amountCents) ? zelleContact(input.zelle) : null,
  };
}
