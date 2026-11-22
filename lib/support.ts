// ─── "Message us" (REACH-DESTINATION-DIVERSITY-2026-11-22, Part B: support) ──
// What a message to the founder may carry, checked before anything is sent.
// The route (app/api/support/route.ts) says "sent" only when the email
// provider accepted it — a form that shows success over a message nobody
// will read is a promise this app does not make.
//
// No imports, so the route and node's test runner both load it bare.

export const SUPPORT_MAX = 2000;
export const SUPPORT_PER_HOUR = 5;
export const SUPPORT_ACTION = 'support_message_sent';

export const SUPPORT_TOPICS = ['booking', 'payment', 'account', 'idea', 'other'] as const;
export type SupportTopic = typeof SUPPORT_TOPICS[number];

export interface SupportMessage {
  topic: SupportTopic;
  message: string;
  /** The trip it is about, when sent from one. */
  planId: string | null;
  /** A booking reference, when sent from a booking row. */
  bookingRef: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSupport(body: unknown): { ok: true; value: SupportMessage } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message) return { ok: false, error: 'Write a few words about what you need.' };
  if (message.length > SUPPORT_MAX) return { ok: false, error: `Keep it under ${SUPPORT_MAX} characters.` };
  const topic = (SUPPORT_TOPICS as readonly string[]).includes(String(b.topic)) ? (b.topic as SupportTopic) : 'other';
  const planId = typeof b.planId === 'string' && UUID.test(b.planId) ? b.planId : null;
  const ref = typeof b.bookingRef === 'string' ? b.bookingRef.trim().slice(0, 80) : '';
  return { ok: true, value: { topic, message, planId, bookingRef: ref || null } };
}

export const TOPIC_LABEL: Record<SupportTopic, string> = {
  booking: 'A booking',
  payment: 'A payment',
  account: 'My account',
  idea: 'An idea',
  other: 'Something else',
};
