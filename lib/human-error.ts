// REACH-DESTINATION-DIVERSITY-2026-11-22, Part B: human 4xx copy.
//
// The API's refusals were written for whoever was reading the logs:
// "groupId required", "Forbidden", "Booking not found". Shown to a member
// they say nothing about what happened or what to do next. Most routes'
// newer refusals are already sentences ("Somebody is booking this right
// now."), and those pass through untouched.
//
// humanError(text) returns the server's sentence when it reads like one,
// the human version when it is a known developer string, and null when it
// is developer-shaped and unknown — so the caller's own fallback, which knows
// what the member was trying to do, takes over:
//
//     toast(humanError(d.error) || "Couldn't save that — try again")

/** Known developer strings, each with what happened and the next step. */
export const HUMAN: Record<string, string> = {
  'not authorised': 'Please sign in again — your session ended.',
  'not authorized': 'Please sign in again — your session ended.',
  unauthorized: 'Please sign in again — your session ended.',
  forbidden: "That's only open to people on this trip. Ask the organiser to add you.",
  'forbidden — admin only': "That's only open to Reach staff.",
  'booking not found': "That booking isn't there any more. Pull down to refresh the trip.",
  'plan not found': "That trip isn't there any more. Go back to your trips and refresh.",
  'user not found': "We couldn't find your account. Please sign in again.",
  'watch not found': "That watch has already stopped. Nothing is being watched.",
  'group not found': "That group isn't there any more. Go back to your groups and refresh.",
  'invalid request': "Something in that didn't come through. Try again.",
  'payment not confirmed': "The payment hasn't gone through yet. Nothing has been charged — try again.",
  'failed to create group': "That group didn't save. Try again in a moment.",
  'no profile distilled for this person yet': 'Your answers are still being read. Try again in a minute.',
};

/** Developer-shaped: names a field, a key, a status word, or starts lower-case. */
const DEVELOPERISH = [
  /\b\w+Id\b/,            // groupId required, userId must be a uuid
  /\brequired$/i,
  /\bis not set$/i,       // LITEAPI_KEY is not set
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/,
  /^(forbidden|invalid|unauthori[sz]ed|failed to|no signature|webhook)\b/i,
  /\bnot found$/i,
  /\buuid\b/i,
  /^[a-z]/,               // "could not read the contribution", "provider required"
  /^\d{3}$/,              // a bare status code
];

export function humanError(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  const known = HUMAN[t.toLowerCase()];
  if (known) return known;
  if (DEVELOPERISH.some(re => re.test(t))) return null;
  return t;
}
