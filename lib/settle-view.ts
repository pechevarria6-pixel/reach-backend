// ─── Settle-up, as the screen says it ────────────────────────────────────
// GET /api/plans/[id]/ledger hands each person their own lines (lib/money.ts
// viewerLines): who they owe, who owes them, and on the lines they pay, the
// ways the other person chose to be paid (lib/settle-links.ts). This file is
// the words for those lines, so the screen and its tests read one copy.
//
// Reach never moves this money. A pay button opens the payer's own app,
// already filled in; "Mark as paid" records that it happened. Nothing here
// says a payment arrived until the person it was paid to says so.

export interface LedgerLine {
  direction: 'you_owe' | 'owed_to_you';
  with: string;
  amountCents: number;
  pending: { id: string; amountCents: number; method: string; createdAt?: string } | null;
  pay: {
    venmo: { app: string; web: string } | null;
    cashApp: string | null;
    zelle: { kind: 'email' | 'phone'; value: string } | null;
  } | null;
}

/** "$42", or "$42.50" when there are cents. */
export function dollars(cents: unknown): string {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const whole = Math.floor(c / 100), rest = c % 100;
  return rest ? `$${whole.toLocaleString('en-US')}.${String(rest).padStart(2, '0')}` : `$${whole.toLocaleString('en-US')}`;
}

const firstOf = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || 'Someone';

export function nameFor(people: Record<string, { name: string | null }> | null | undefined, id: string): string {
  return firstOf(people?.[id]?.name);
}

/** "You owe Sam $42", "Alex owes you $18". */
export function lineWords(line: LedgerLine, name: string): string {
  return line.direction === 'you_owe'
    ? `You owe ${name} ${dollars(line.amountCents)}`
    : `${name} owes you ${dollars(line.amountCents)}`;
}

/** Lines with money still to move. A 0 line is kept only for a claim to answer. */
export function openLines(lines: unknown): LedgerLine[] {
  if (!Array.isArray(lines)) return [];
  return (lines as LedgerLine[]).filter(l => l && (l.amountCents > 0 || l.pending));
}

/** The one-line summary: "You owe Sam $42 · Alex owes you $18". Null when square. */
export function settleHeadline(lines: unknown, people: Record<string, { name: string | null }> | null | undefined): string | null {
  const owed = openLines(lines).filter(l => l.amountCents > 0);
  if (!owed.length) return null;
  const order = [...owed].sort((a, b) =>
    (a.direction === b.direction ? 0 : a.direction === 'you_owe' ? -1 : 1) || b.amountCents - a.amountCents);
  return order.map(l => lineWords(l, nameFor(people, l.with))).join(' · ');
}

const METHOD: Record<string, string> = { venmo: 'Venmo', cashapp: 'Cash App', zelle: 'Zelle', other: '' };

/** A payment somebody said they sent, as each side reads it. */
export function pendingWords(line: LedgerLine, name: string): string | null {
  const p = line.pending;
  if (!p) return null;
  const on = METHOD[p.method] ? ` on ${METHOD[p.method]}` : '';
  return line.direction === 'you_owe'
    ? `You said you sent ${dollars(p.amountCents)}${on} — waiting for ${name} to mark it received.`
    : `${name} says they sent ${dollars(p.amountCents)}${on}. Did it arrive?`;
}

/** The Venmo link for this device: the app on a phone, the website elsewhere. */
export function venmoHref(venmo: { app: string; web: string } | null | undefined, userAgent: string): string | null {
  if (!venmo) return null;
  return /iPhone|iPad|iPod|Android/i.test(userAgent || '') ? venmo.app : venmo.web;
}

/** Whether a line can be paid in any app at all. */
export function hasWayToPay(line: LedgerLine): boolean {
  return !!(line.pay && (line.pay.venmo || line.pay.cashApp || line.pay.zelle));
}

/**
 * The part of a client key that names the line. The same line, the same key,
 * on every tap (the server adds the plan, the caller and the status); a line
 * whose amount moved is a different line.
 */
export function lineKeyPart(line: LedgerLine): string {
  // Short: the server allows 8 to 100 of [A-Za-z0-9_:.-] and adds the status.
  return `${line.direction === 'you_owe' ? 'o' : 'r'}.${line.with}.${Math.round(line.amountCents)}`;
}

/** A refusal from POST/PATCH /settlements, said so the reader knows what to do. */
export function settleRefusal(status: number, body: unknown): string {
  const d = (body ?? {}) as { error?: string; reason?: string };
  if (status === 409 && (d.reason === 'nothing_owed' || d.reason === 'more_than_owed')) {
    return 'That line had already moved — here is where it stands now.';
  }
  return d.error || "Couldn't save that — try again in a moment.";
}

/** The close card's settle-up line, from GET /close's totals. Null when square. */
export function closeSettleLine(settle: { unsettled?: boolean; youOweCents?: number; owedToYouCents?: number; pending?: boolean } | null | undefined): string | null {
  if (!settle || !settle.unsettled) return null;
  const parts = [
    settle.youOweCents ? `You owe ${dollars(settle.youOweCents)}` : null,
    settle.owedToYouCents ? `You're owed ${dollars(settle.owedToYouCents)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** "How was it?" — a 1 to 3 answer, said with a face. */
export const CLOSE_SCORES = [
  { score: 1, emoji: '😞', label: 'Not great' },
  { score: 2, emoji: '😐', label: 'It was fine' },
  { score: 3, emoji: '🤩', label: 'Loved it' },
] as const;

export const SETTLE_FOOTER = 'Payments happen in your own app.';
