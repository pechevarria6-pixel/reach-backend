// ─── The six upfront quiz screens, and how a tap moves through them ──────
// Six screens, about a minute. Every screen that asks about you takes as
// many answers as fit — people are more than one thing — and ends with Done.
// The owner, 2026-09-25: "make it multiple choice availablity dont just have
// people have the option to only do 1". An earlier version answered on one
// tap and hid multiple picks behind press-and-hold, which nobody would find.
// The scorer blends several answers (lib/traveler-profile.ts scoreQuiz): a
// screen's weight is shared across its picks and a dial is their average.
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
  {id:"first_move",field:"first_move",blend:true,title:"You just landed. First move?",sub:"Pick all that fit.",options:[
    {v:"eat",e:"🍜",l:"Find the best local spot to eat"},
    {v:"wander",e:"🚶",l:"Walk until something looks interesting"},
    {v:"famous",e:"🗽",l:"Straight to the famous thing"},
    {v:"slow",e:"🛁",l:"Check in, shower, slow down"},
    {v:"group",e:"💬",l:"Text the group: “who's out tonight?”"},
  ]},
  {id:"interests",field:"interests",multi:true,title:"What are you into?",sub:"Pick as many as you like."},
  {id:"plan",field:"plan",scale:true,blend:true,title:"How much plan do you like?",sub:"Pick all that fit.",options:[
    {v:"wing",e:"🎲",l:"Wing it"},
    {v:"loose",e:"🗺️",l:"Loose outline"},
    {v:"daily",e:"📋",l:"Daily plan"},
    {v:"full",e:"🌅",l:"Morning to night"},
    {v:"hourly",e:"⏱️",l:"Every hour"},
  ]},
  {id:"restaurant",field:"restaurant",blend:true,title:"Pick the restaurant.",sub:"Pick all that fit.",options:[
    {v:"famous",e:"⭐",l:"5,000 reviews, can't miss"},
    {v:"locals",e:"🏠",l:"The neighborhood favorite"},
    {v:"new",e:"✨",l:"Somewhere I've never heard of"},
    {v:"truck",e:"🤫",l:"The spot only locals know"},
  ]},
  {id:"late",field:"late",blend:true,title:"It's 11pm on the trip. You're…",sub:"Pick all that fit.",options:[
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

/**
 * Which screens end with Done: every screen that takes more than one
 * answer. The owner, 2026-09-25: "make it multiple choice availablity dont
 * just have people have the option to only do 1". Screens 1, 3, 4 and 5 are
 * pick-all-that-fit again; a hidden press-and-hold to blend was not
 * something anybody would find.
 */
export function needsDone(s: Pick<QuizScreen, 'id' | 'multi' | 'blend'>): boolean {
  return !!s.multi || !!s.blend || s.id === 'no_way';
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
  | { picked: string[]; advance: 'after-window' }
  /** Keep the screen; Done moves on. */
  | { picked: string[]; advance: 'stay' };

/**
 * What a tap or a hold on a single-answer screen does.
 *
 * A plain tap with no blend running is the answer: that option alone, and
 * on. A hold starts (or adds to) a blend. A tap while a blend is running
 * adds or takes away, and restarts the window; the screen goes on once the
 * taps stop.
 */
export function onOptionPress(state: TapState, v: string, _how: 'tap' | 'hold' = 'tap'): TapResult {
  // Every tap adds or takes away; Done moves on. Nothing advances by itself.
  const picked = state.picked.includes(v) ? state.picked.filter(x => x !== v) : [...state.picked, v];
  return { picked, advance: 'stay' };
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
