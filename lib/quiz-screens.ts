// ─── The six upfront quiz screens, and how a tap moves through them ──────
// The attention-span rule: six screens, about a minute. Only screen 2 (what
// you're into) and screen 6 (No way, José) take more than one answer and so
// end with a Done tap. Every other screen goes on the moment it is tapped.
//
// Screens 1, 3, 4 and 5 had become "pick any that fit" with a Done button,
// which turned a six-tap quiz into a twelve-tap one. A blended answer is
// still worth something — somebody who eats first and then wanders is both —
// so it is kept, but never in the way of a single tap: holding an option
// starts a blend, and every tap within BLEND_WINDOW_MS of the last one adds
// to it; the screen goes on once the taps stop. The scorer takes one answer
// or several (lib/traveler-profile.ts scoreQuiz), so a blend already saved
// still scores.
//
// Screen 4's Scout answers say what Discover can show. A place is named only
// when it has its own website, so a food truck never appears, and nothing we
// hold says when a place opened — "Food truck someone mentioned once" and
// "Opened last month" promised both. The stored values ("truck", "new") and
// their scores are unchanged, so answers already given still score.
//
// "The spot only locals know" then sat under "Locals' favorite": two answers
// a person cannot tell apart, one worth nothing and the other the most Scout
// points on the screen. The middle answer is the neighborhood favorite, so
// "locals" belongs to one option only, and the truck's 🚚 went with its words.
//
// The screen shape and the tap rules live here rather than in the component
// so a scripted run can be tested without a browser.

export interface QuizOption { v: string; e: string; l: string }
export interface QuizScreen {
  id: string;
  field?: string;
  title: string;
  sub?: string;
  /** Takes several answers and ends with Done (screen 2). */
  multi?: boolean;
  /** Shown as a row of five rather than a column. */
  scale?: boolean;
  /** One tap answers; holding starts a blend (see top). */
  blend?: boolean;
  options?: QuizOption[];
}

export const QUIZ_SCREENS: QuizScreen[] = [
  {id:"first_move",field:"first_move",blend:true,title:"You just landed. First move?",sub:"Tap one. Hold to pick more.",options:[
    {v:"eat",e:"🍜",l:"Find the best local spot to eat"},
    {v:"wander",e:"🚶",l:"Walk until something looks interesting"},
    {v:"famous",e:"🗽",l:"Straight to the famous thing"},
    {v:"slow",e:"🛁",l:"Check in, shower, slow down"},
    {v:"group",e:"💬",l:"Text the group: “who's out tonight?”"},
  ]},
  {id:"interests",field:"interests",multi:true,title:"What are you into?",sub:"Pick as many as you like."},
  {id:"plan",field:"plan",scale:true,blend:true,title:"How much plan do you like?",sub:"Tap one. Hold to pick more.",options:[
    {v:"wing",e:"🎲",l:"Wing it"},
    {v:"loose",e:"🗺️",l:"Loose outline"},
    {v:"daily",e:"📋",l:"Daily plan"},
    {v:"full",e:"🌅",l:"Morning to night"},
    {v:"hourly",e:"⏱️",l:"Every hour"},
  ]},
  {id:"restaurant",field:"restaurant",blend:true,title:"Pick the restaurant.",sub:"Tap one. Hold to pick more.",options:[
    {v:"famous",e:"⭐",l:"5,000 reviews, can't miss"},
    {v:"locals",e:"🏠",l:"The neighborhood favorite"},
    {v:"new",e:"✨",l:"Somewhere I've never heard of"},
    {v:"truck",e:"🤫",l:"The spot only locals know"},
  ]},
  {id:"late",field:"late",blend:true,title:"It's 11pm on the trip. You're…",sub:"Tap one. Hold to pick more.",options:[
    {v:"asleep",e:"😴",l:"Asleep"},
    {v:"one_more",e:"🍷",l:"One more, then bed"},
    {v:"next_spot",e:"🕺",l:"Where's the next spot?"},
    {v:"sunrise",e:"🌄",l:"Watching the sunrise somewhere questionable"},
  ]},
  {id:"no_way",title:"No way, José.",sub:"Just for us. Your group never sees this."},
];

/** How long a press has to be held to start a blend rather than answer. */
export const HOLD_MS = 450;
/** A tap within this long of the last one adds to a blend; then it goes on. */
export const BLEND_WINDOW_MS = 1500;

/** Only screen 2 and screen 6 end with a Done tap. */
export function needsDone(s: Pick<QuizScreen, 'id' | 'multi'>): boolean {
  return !!s.multi || s.id === 'no_way';
}

export interface TapState {
  /** The picks so far on this screen's field. */
  picked: string[];
  /** A blend is running and will go on when the window lapses. */
  blending: boolean;
}

export type TapResult =
  /** Answer with these and go on after the short beat that shows the tap. */
  | { picked: string[]; advance: 'now' }
  /** Keep the screen, and go on once BLEND_WINDOW_MS passes with no tap. */
  | { picked: string[]; advance: 'after-window' };

/**
 * What a tap or a hold on a single-answer screen does.
 *
 * A plain tap with no blend running is the answer: that option alone, and
 * on. A hold starts (or adds to) a blend. A tap while a blend is running
 * adds or takes away, and restarts the window; the screen goes on once the
 * taps stop.
 */
export function onOptionPress(state: TapState, v: string, how: 'tap' | 'hold'): TapResult {
  if (how === 'tap' && !state.blending) return { picked: [v], advance: 'now' };
  const base = state.blending ? state.picked : [];
  const picked = how === 'tap' && base.includes(v) ? base.filter(x => x !== v) : base.includes(v) ? base : [...base, v];
  return { picked, advance: 'after-window' };
}

/**
 * Where a pending advance goes: the screen after the one it was armed on,
 * "finish" after the last, or nowhere when the person has already left that
 * screen. A blend arms a 1.5 s timer; Skip or Back inside that window used to
 * leave it running, and when it fired it added one to wherever they had got
 * to — a screen jumped over, or, from screen 5, a step past the last screen
 * and a crash. Skip and Back cancel the timer, and this is the second lock:
 * a timer that outlived its screen does nothing.
 */
export function stepAfter(armedOn: number, current: number, total: number): number | 'finish' | null {
  if (armedOn !== current) return null;
  if (current < 0 || current >= total) return null;
  return current < total - 1 ? current + 1 : 'finish';
}
