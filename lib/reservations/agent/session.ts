// ─── One call, turn by turn ──────────────────────────────────────────────
// The relay (relay/server.ts) feeds this what the restaurant says and speaks
// what it returns. The model is passed in, so the same session runs in the
// mocked-restaurant harness (tests/unit/reservation-agent-harness.test.ts)
// with a scripted model, and on a real call with Claude.
//
// When it ends it hands back what lib/reservations/outcome.ts settle() needs
// — the turns and an extraction — so whether a table was booked is judged
// the same way for every provider: from the staff's own words, never the
// agent's.
import type { CallFacts } from '../script.ts';
import { opening } from '../script.ts';
import type { Extraction, Turn } from '../outcome.ts';
import type { Ending, State, Window } from './machine.ts';
import { CLOSING, LIMITS, start, step } from './machine.ts';
import type { Said } from './prompt.ts';
import { asMessages, readReply, redact, speakable, systemPrompt } from './prompt.ts';

/** Asks the model for one reply's JSON text. Throws on a transport failure. */
export type Model = (system: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;

export interface TurnResult {
  /** Words to speak now ('' = nothing). */
  say: string;
  /** Digits to press on a phone menu. */
  press?: string;
  /** Set when the call is over: hang up after saying `say`. */
  ended?: Ending;
}

export interface Summary {
  ending: Ending;
  why: string;
  turns: Turn[];
  extraction: Extraction;
  askedNotToCall: boolean;
  agreedTime: string | null;
  offeredOutside: string | null;
  depositDollars: number | null;
}

export function createSession(facts: CallFacts, window: Window, model: Model, now: () => number = Date.now) {
  const startedAt = now();
  const turns: Said[] = [];
  let state: State = start();
  let staffTurns = 0;
  let done: { ending: Ending; why: string; askedNotToCall: boolean } | null = null;
  let lastStaffYes: string | null = null;

  const finish = (ending: Ending, why: string, askedNotToCall = false): TurnResult => {
    done = { ending, why, askedNotToCall };
    const say = CLOSING[ending];
    if (say) turns.push({ speaker: 'assistant', text: say });
    return { say, ended: ending };
  };

  return {
    /** The first words, said when they pick up: ours, word for word. */
    greeting(): string {
      const g = opening(facts);
      turns.push({ speaker: 'assistant', text: g });
      return g;
    },

    /** What the restaurant just said; what to say back. */
    async heard(text: string): Promise<TurnResult> {
      if (done) return { say: '', ended: done.ending };
      const said = redact(String(text ?? '').trim());
      if (!said) return { say: '' };
      turns.push({ speaker: 'staff', text: said });
      staffTurns++;
      if (staffTurns > LIMITS.staffTurns || now() - startedAt > LIMITS.millis) return finish('failed', 'too long');

      let raw: string;
      try {
        raw = await model(systemPrompt(facts, window, state.step), asMessages(turns));
      } catch (e) {
        return finish('failed', `model error: ${e instanceof Error ? e.message : String(e)}`);
      }
      const reply = readReply(raw);
      if (!reply) return finish('failed', 'the model did not answer in the agreed shape');

      const prior = state.step;
      const next = step(state, reply.move, reply.heard, window);
      state = next.state;
      if (prior === 'CONFIRM_BACK' && reply.move === 'staff_yes') lastStaffYes = said;
      if (next.kind === 'end') return finish(next.ending, next.why, next.askedNotToCall);

      const say = speakable(reply.say);
      if (say) turns.push({ speaker: 'assistant', text: say });
      return next.press ? { say, press: next.press } : { say };
    },

    /** The line went dead before an ending: a hang-up, a dropped relay. */
    hungUp(): void {
      if (!done) done = { ending: 'failed', why: 'the line closed mid-call', askedNotToCall: false };
    },

    /** Everything settle() and the call row need. */
    summary(): Summary {
      const d = done ?? { ending: 'failed' as Ending, why: 'never ended', askedNotToCall: false };
      const outcome = d.ending === 'confirmed' ? 'confirmed'
        : d.ending === 'declined' && state.offeredOutside ? 'alternative_offered'
        : d.ending === 'declined' ? 'no_availability'
        : d.ending === 'declined_bot' ? (d.askedNotToCall ? 'do_not_call' : 'refused')
        : d.ending === 'needs_card' ? 'needs_guest'
        : d.ending === 'no_answer' ? 'voicemail'
        : 'unclear';
      return {
        ending: d.ending,
        why: d.why,
        turns: turns.map(t => ({ speaker: t.speaker, text: t.text })),
        extraction: {
          outcome,
          staff_quote: d.ending === 'confirmed' ? lastStaffYes : null,
          held_time: d.ending === 'confirmed' ? state.agreedTime : null,
          held_party: d.ending === 'confirmed' ? facts.partySize : null,
          name_on_booking: d.ending === 'confirmed' ? facts.firstName : null,
          offered_time: state.offeredOutside,
          asked_not_to_call: d.askedNotToCall,
        },
        askedNotToCall: d.askedNotToCall,
        agreedTime: state.agreedTime,
        offeredOutside: state.offeredOutside,
        depositDollars: state.depositDollars,
      };
    },
  };
}
