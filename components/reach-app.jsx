import { useState, useEffect, useRef } from "react";
import { formatDates, nightsBetween, toDateOrNull } from "@/lib/dates";
import { itineraryDays } from "@/lib/itinerary";
import { itemsFromRows } from "@/lib/contracts/itinerary-item";
import { planSections, daysAway, today, countdown, groupSchedule, byName, monthGrid, monthLabel, monthOf, addMonths, weekBars, nextAfter, tripTiming } from "@/lib/calendar";
// The two page colours the browser chrome is tinted with, shared with the
// shell so the toggle and the no-flash script cannot disagree.
import { SURFACE } from "@/lib/brand";
import { checkoutState, itemTitle, bookedClaim, bookedWording } from "@/lib/checkout";
import { bookingFactsFrom } from "@/lib/contracts/booking";
import { afterRebuild } from "@/lib/itinerary-rebuild";
import { fetchWithin, isTimeout, stalled } from "@/lib/deadline";
import { visibleCategories } from "@/lib/discovery/category";
import { answersFromGoal, summarise, modeFromGoal } from "@/lib/goal";
import { stepsFor } from "@/lib/quiz-steps";
import { departureFrom, airportMismatch, airportForCity } from "@/lib/airports";

// ─── Design tokens ───────────────────────────────────────────────────────
// The single source of truth for colour. Anything hardcoded in a style block
// is a bug: the file used to carry three different golds (#D4A843, #D4AF37,
// #C49A38) plus leftovers from an earlier indigo palette, so the same element
// changed shade depending on which screen drew it.
//
// Every name below resolves to a CSS custom property rather than a hex value,
// so the ~1,000 call sites never need to know which theme is showing. The real
// values live in PALETTE and are swapped by setting data-theme on <html>,
// which repaints the whole app without a re-render.
//
// Contrast is measured against `bg` for body surfaces and `s2` for cards.
// Every text pairing below clears 4.5:1 in BOTH themes.
const TOKENS = [
  "page", "bg", "s1", "s2", "s3", "border", "borderLight",
  "accent", "accentDeep", "accentHover", "accentDim", "accentBorder",
  // `accent` is the gold FILL and stays bright in both themes so buttons keep
  // their identity. `accentText` is gold used AS TEXT, and has to darken in
  // the light theme: #D4A843 on white is 2.0:1 and unreadable.
  "accentText", "onAccent", "onGreen",
  "green", "greenDim", "amber", "amberDim", "red", "redDim", "blue", "blueDim",
  "t1", "t2", "t3", "t4",
  // Surfaces that are translucent or shadowed, and so cannot be a flat token.
  "navBg", "overlay", "cardShadow", "cardShadowHover", "accentGlow",
  // Texture: a paper grain on the ground, and the hairline highlight along
  // the top edge of anything raised. Both sit behind content, so neither
  // can change how readable a word is.
  "grain", "edgeHi",
  "accentGlowHover", "focusRing", "frameShadow", "frameGlow",
];

const C = Object.fromEntries(
  TOKENS.map(t => [t, `var(--c-${t.replace(/[A-Z]/g, m => "-" + m.toLowerCase())})`])
);

const PALETTE = {
  // ── Light — off-white and deep green, sampled from REF4. ───────────────
  // Ground #EBEFEC, cards #E4EAE6, ink #142119, the green #2B583B. The muted
  // green was sampled at #617A6C and measured 4.01:1 on the ground — under
  // the body-text bar — so it is deepened to #576E61, which clears it at
  // 4.75:1 without touching the brand green.
  light: {
    page: "#DFE5E0",
    bg: "#EBEFEC", s1: "#F4F7F5", s2: "#E4EAE6", s3: "#DAE2DC",
    border: "#D8DED4", borderLight: "#C3CCC5",

    // Orange stays the action colour in both themes; as TEXT on the pale
    // ground it is only 3.2:1, so the green carries text and links.
    accent: "#EC6032", accentDeep: "#D24E24", accentHover: "#F2764D",
    accentDim: "rgba(236,96,50,0.12)", accentBorder: "rgba(236,96,50,0.30)",
    accentText: "#2B583B",
    onAccent: "#2A1D06", onGreen: "#FFFFFF",

    green: "#2F7D43", greenDim: "rgba(47,125,67,0.12)",
    amber: "#6F4B00", amberDim: "rgba(111,75,0,0.12)",
    red: "#C0392B", redDim: "rgba(192,57,43,0.10)",
    blue: "#1E62C4", blueDim: "rgba(30,98,196,0.10)",

    t1: "#142119", t2: "#576E61", t3: "#5E766A", t4: "#6E8577",

    navBg: "rgba(235,239,236,0.94)",
    overlay: "rgba(20,33,25,0.45)",
    cardShadow: "0 2px 8px rgba(30,50,38,0.07)",
    cardShadowHover: "0 10px 28px rgba(30,50,38,0.14)",
    accentGlow: "0 4px 16px rgba(236,96,50,0.22)",
    accentGlowHover: "0 8px 24px rgba(236,96,50,0.30)",
    focusRing: "rgba(236,96,50,0.28)",
    grain: "url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22140%22%20height=%22140%22%3E%3Cfilter%20id=%22n%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%22.85%22%20numOctaves=%222%22/%3E%3CfeColorMatrix%20type=%22saturate%22%20values=%220%22/%3E%3C/filter%3E%3Crect%20width=%22140%22%20height=%22140%22%20filter=%22url(%23n)%22%20opacity=%22.16%22/%3E%3C/svg%3E')",
    edgeHi: "rgba(255,255,255,0.75)",
    frameShadow: "0 60px 140px rgba(30,50,38,0.24)",
    frameGlow: "rgba(236,96,50,0.10)",
  },

  // ── Dark — maroon and gold, sampled from REF6. The default. ────────────
  // Every value here was read off the reference screens rather than guessed:
  // the ground is #2C0E18, cards #3F1619, the wordmark gold #C3A342, headings
  // cream #FEF7D9 and the accent word orange #EC6032.
  dark: {
    page: "#1F080F",
    bg: "#2C0E18", s1: "#36121B", s2: "#3F1619", s3: "#4A1B20",
    border: "#5A2430", borderLight: "#6B2C39",

    // Gold stays the fill in both themes; on maroon it is also readable as
    // text at 7.3:1, so accentText is the same value here.
    accent: "#C3A342", accentDeep: "#A8892F", accentHover: "#D8BC63",
    accentDim: "rgba(195,163,66,0.14)", accentBorder: "rgba(195,163,66,0.32)",
    accentText: "#C3A342",
    // The orange from REF6, used for the one accent word and for primary
    // actions. White on it is 3.34:1, so anything sitting ON it uses ink.
    onAccent: "#2A1D06", onGreen: "#0C2A17",

    green: "#7FB58A", greenDim: "rgba(127,181,138,0.12)",
    amber: "#E8A33D", amberDim: "rgba(232,163,61,0.12)",
    red: "#E85D5D", redDim: "rgba(232,93,93,0.12)",
    blue: "#7FA8D9", blueDim: "rgba(127,168,217,0.12)",

    t1: "#FEF7D9", t2: "#CFC182", t3: "#B89A6A", t4: "#9C815A",

    navBg: "rgba(44,14,24,0.95)",
    overlay: "rgba(20,5,10,0.78)",
    cardShadow: "0 2px 10px rgba(0,0,0,0.35)",
    cardShadowHover: "0 8px 30px rgba(0,0,0,0.45)",
    accentGlow: "0 4px 20px rgba(195,163,66,0.22)",
    accentGlowHover: "0 6px 24px rgba(195,163,66,0.32)",
    focusRing: "rgba(236,96,50,0.35)",
    grain: "url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22140%22%20height=%22140%22%3E%3Cfilter%20id=%22n%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%22.85%22%20numOctaves=%222%22/%3E%3CfeColorMatrix%20type=%22saturate%22%20values=%220%22/%3E%3C/filter%3E%3Crect%20width=%22140%22%20height=%22140%22%20filter=%22url(%23n)%22%20opacity=%22.18%22/%3E%3C/svg%3E')",
    edgeHi: "rgba(255,255,255,0.10)",
    frameShadow: "0 80px 200px rgba(0,0,0,.95)",
    frameGlow: "rgba(195,163,66,0.10)",
  },
};

const THEMES = Object.keys(PALETTE);
// REF6 is the app's face: maroon and gold. Light is the alternative, not the
// starting point.
const DEFAULT_THEME = "dark";
// Must match the key the no-flash script in app/layout.tsx reads.
const THEME_KEY = "reach-theme";

// One of these opens Home each day, the accent word carrying the colour.
// Each asks about a person, not a feature: the app exists to get somebody in
// front of somebody else. Nothing here promises what the app cannot do.
const GREETING_QUESTIONS = [
  { before: "Who's on your ", word: "mind", after: " today?" },
  { before: "Who are you ", word: "showing up", after: " for today?" },
  { before: "Who's overdue for a good ", word: "night out", after: "?" },
  { before: "Who have you been ", word: "meaning", after: " to see?" },
  { before: "Who would make this week ", word: "better", after: "?" },
];

// Days since the epoch. The same for everybody on the same day, and it cannot
// drift between two renders the way a random pick would.
const dayIndex = (now = new Date()) =>
  Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);

// kebab-cases the token names to match the var() references built above.
const paletteVars = theme =>
  Object.entries(PALETTE[theme])
    .map(([k, v]) => `--c-${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}:${v};`)
    .join("");

const THEME_CSS = `
:root{color-scheme:light;${paletteVars("light")}}
:root[data-theme="dark"]{color-scheme:dark;${paletteVars("dark")}}
`;

const CSS = `
${THEME_CSS}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
body{background:${C.page};background-image:${C.grain};display:flex;justify-content:center;min-height:100vh;font-family:var(--font-body);color:${C.t1};-webkit-font-smoothing:antialiased;}
/* Inline styles don't inherit a font, which is why the family string was
   repeated dozens of times across the file. Set it once for every control. */
button,input,textarea,select{font-family:inherit;font-size:inherit;color:inherit;}
button{min-height:44px;}
/* Small pill buttons and icon-only controls opt out of the 44px floor but
   keep a generous tap area via padding. */
.bsm,.nb-btn,.cb{min-height:0;}
/* The app used to be a fixed 393x852 bezel with no media queries at all, so
   on an actual phone the frame was wider than the viewport and taller than
   the screen: it overflowed sideways and got clipped at the bottom. Phones
   now get the real viewport; the decorative frame is a desktop affordance. */
.aw{width:100%;max-width:520px;min-height:100dvh;background:${C.bg};background-image:${C.grain};position:relative;display:flex;flex-direction:column;overflow:hidden;
  padding-top:env(safe-area-inset-top);}
@media (min-width:560px) and (min-height:900px){
  body{padding:20px 0 40px;}
  .aw{width:393px;max-width:393px;height:852px;min-height:0;border-radius:50px;padding-top:0;
    border:1.5px solid ${C.accentBorder};
    box-shadow:${C.frameShadow},0 0 80px ${C.frameGlow};}
}
.sb{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;min-height:64px;flex-shrink:0;font-size:12px;font-weight:600;color:${C.t2};letter-spacing:.02em;background:${C.bg};}
.sb-fake{display:none;}
@media (min-width:560px) and (min-height:900px){.sb-fake{display:inline;}}
@media (max-width:559px){.sb{justify-content:center;}}
.sb-logo{font-family:var(--font-display);font-size:22px;color:${C.accentText};letter-spacing:-.01em;line-height:1;}
/* The white circle holding the reaching hands, exactly as REF6 has it. White
   in both themes: it is the logo's own ground, not a surface. */
.sb-mark{width:40px;height:40px;border-radius:50%;background:var(--logo-circle);border:1px solid ${C.border};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}
.sb-mark img{width:70%;height:auto;display:block;}
.sb-left{display:flex;align-items:center;gap:10px;}
.sb-right{display:flex;align-items:center;gap:4px;}
/* 44px targets on a 64px bar, per the accessibility rule. */
.sb-act{width:44px;height:44px;min-height:44px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:${C.accentText};border-radius:12px;transition:background .15s;}
.sb-act:hover{background:${C.accentDim};}
.ma{flex:1;overflow:hidden;position:relative;}
.sc{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;padding-bottom:calc(90px + env(safe-area-inset-bottom));}
.sc::-webkit-scrollbar{display:none;}
.nb{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;background:${C.navBg};backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid ${C.accentBorder};padding:10px 0 max(24px,env(safe-area-inset-bottom));z-index:100;}
.nb-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;cursor:pointer;font-family:var(--font-body);font-size:10px;font-weight:500;color:${C.t3};transition:color .15s;padding:4px 0;}
.nb-btn.active{color:${C.accentText};}
.nb-btn svg{width:22px;height:22px;transition:transform .15s;}
.nb-btn.active svg{transform:translateY(-1px);}
.nb-dot{width:4px;height:4px;border-radius:50%;background:${C.accent};margin:0 auto;opacity:0;transition:opacity .15s;}
.nb-btn.active .nb-dot{opacity:1;}
.pt{font-family:var(--font-display);font-size:30px;color:${C.t1};line-height:1.1;}
.hd{padding:8px 20px 16px;flex-shrink:0;}
.hd-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;}
.hd-back{display:inline-flex;align-items:center;gap:4px;background:none;border:none;cursor:pointer;color:${C.t2};font-size:13px;font-weight:500;padding:10px 14px 10px 0;margin-left:-2px;transition:color .15s;flex-shrink:0;}
.hd-back:hover{color:${C.t1};}
.hd-back:active{opacity:.6;}
.hd-back svg{width:18px;height:18px;}
.hd-ov{position:absolute;top:calc(16px + env(safe-area-inset-top));left:16px;width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;z-index:10;}
.hd-ov:active{transform:scale(.94);}
.sl{font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;color:${C.t2};}
.card{background:linear-gradient(145deg,${C.s1},${C.s2});border:1px solid ${C.border};border-radius:24px;overflow:hidden;transition:all .2s;cursor:pointer;box-shadow:${C.cardShadow},inset 0 1px 0 ${C.edgeHi};}
.card:hover{border-color:${C.accentBorder};transform:translateY(-2px);box-shadow:${C.cardShadowHover};}
.card:active{transform:scale(.98);}
.pill{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:20px;font-size:11.5px;font-weight:600;}
.pill-g{background:${C.greenDim};color:${C.green};}
.pill-a{background:${C.amberDim};color:${C.amber};}
.pill-r{background:${C.redDim};color:${C.red};}
.pill-p{background:${C.accentDim};color:${C.accentText};}
.pill-m{background:${C.s3};color:${C.t2};}
.bp{width:100%;min-height:52px;padding:16px 20px;background:linear-gradient(135deg,${C.accentDeep},${C.accent});color:${C.onAccent};border:none;border-radius:18px;font-family:var(--font-body);font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;letter-spacing:.01em;box-shadow:${C.accentGlow},inset 0 1px 0 rgba(255,255,255,.32);}
.bp:hover{transform:translateY(-1px);box-shadow:${C.accentGlowHover};}
.bp:active{transform:scale(.98);}
.bp:disabled{opacity:.35;cursor:not-allowed;}
.bs{width:100%;padding:15px 20px;background:${C.s2};color:${C.t1};border:1px solid ${C.border};border-radius:18px;font-family:var(--font-body);font-size:15px;font-weight:500;cursor:pointer;transition:border-color .15s;}
.bs:hover{border-color:${C.borderLight};}
.bsm{padding:7px 14px;border-radius:10px;font-family:var(--font-body);font-size:12px;font-weight:600;cursor:pointer;border:none;transition:opacity .15s;}
.bsm:hover{opacity:.85;}
.bsm-p{background:${C.accent};color:${C.onAccent};}
.bsm-g{background:${C.s3};color:${C.t2};}
.bsm-r{background:${C.redDim};color:${C.red};}
.bsm-gr{background:${C.greenDim};color:${C.green};}
.inp{width:100%;padding:15px 16px;background:${C.s2};border:1.5px solid ${C.border};border-radius:16px;color:${C.t1};font-family:var(--font-body);font-size:14px;outline:none;transition:all .2s;}
.inp:focus{border-color:${C.accentText};box-shadow:0 0 0 3px ${C.focusRing};background:${C.s1};}
/* Keyboard focus was visible on text inputs and nowhere else: not on buttons,
   cards, nav or the two bare inputs that set outline:none with no replacement.
   Anyone navigating by keyboard had no idea where they were. :focus-visible
   keeps it off mouse clicks. */
:focus-visible{outline:2px solid ${C.accentText};outline-offset:2px;border-radius:6px;}
button:focus-visible,.card:focus-visible,[role="button"]:focus-visible{outline:2px solid ${C.accentText};outline-offset:3px;}
.inp:focus-visible{outline:none;}
/* Respect someone who has asked their system for less movement. Spinners,
   slide-ups and the progress bar all animate by default. */
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;
    transition-duration:.01ms!important;scroll-behavior:auto!important;}
}
.inp::placeholder{color:${C.t3};}
.ov{position:absolute;inset:0;background:${C.overlay};backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);z-index:200;display:flex;align-items:flex-end;animation:fi .2s ease;}
.sh{width:100%;max-height:90%;background:${C.s1};background-image:${C.grain};border-radius:28px 28px 0 0;border-top:1px solid ${C.border};box-shadow:inset 0 1px 0 ${C.edgeHi};overflow-y:auto;scrollbar-width:none;animation:su .25s cubic-bezier(.32,.72,0,1);padding-bottom:30px;}
.sh::-webkit-scrollbar{display:none;}
.sh-hdl{width:36px;height:4px;border-radius:2px;background:${C.border};margin:12px auto 0;}
.sh-hdr{padding:20px 20px 16px;border-bottom:1px solid ${C.border};display:flex;align-items:center;justify-content:space-between;}
.sh-ttl{font-size:17px;font-weight:600;color:${C.t1};}
.toast{position:absolute;top:70px;left:16px;right:16px;background:${C.green};color:${C.onGreen};border-radius:14px;padding:12px 16px;font-size:13px;font-weight:600;z-index:500;text-align:center;animation:ti .3s ease,to .3s ease 2.2s forwards;}
.ri{display:flex;align-items:center;gap:13px;padding:15px 20px;cursor:pointer;transition:background .1s;}
.ri:hover{background:${C.s2};}
.ri-ic{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
.ri-inf{flex:1;}
.ri-t{font-size:14px;font-weight:500;color:${C.t1};}
.ri-s{font-size:12px;color:${C.t2};margin-top:1px;}
.av-cl{display:flex;}
.av{width:26px;height:26px;border-radius:50%;border:2px solid ${C.bg};margin-left:-6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;color:white;}
.av:first-child{margin-left:0;}
.av-lg{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;color:white;}
.cb-row{display:flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer;transition:background .1s;}
.cb-row:hover{background:${C.s2};}
.cb{width:22px;height:22px;border-radius:7px;border:2px solid ${C.border};flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.cb.ck{background:${C.accent};border-color:${C.accentText};color:${C.onAccent};}
.pb-t{height:3px;background:${C.s3};border-radius:2px;}
.pb-f{height:100%;border-radius:2px;background:${C.accent};transition:width .3s;}
.sd{display:flex;gap:6px;}
.sd-d{height:3px;border-radius:2px;flex:1;background:${C.s3};transition:background .3s;}
.sd-d.active{background:${C.accent};}
.it-item{display:flex;gap:14px;padding:12px 20px;}
.it-time{font-size:11px;color:${C.t2};width:42px;flex-shrink:0;padding-top:2px;text-align:right;}
.it-lc{display:flex;flex-direction:column;align-items:center;width:20px;flex-shrink:0;}
.it-dot{width:10px;height:10px;border-radius:50%;border:2px solid ${C.accentText};background:${C.bg};flex-shrink:0;margin-top:3px;}
.it-dot.fi{background:${C.accent};}
.it-cn{flex:1;width:2px;background:${C.border};margin:4px 0;min-height:20px;}
.it-cont{flex:1;}
.it-tt{font-size:14px;font-weight:500;color:${C.t1};}
.it-sb{font-size:12px;color:${C.t2};margin-top:2px;}
.it-cf{font-size:10px;color:${C.green};margin-top:3px;font-weight:500;}
.bk-row{display:flex;justify-content:space-between;align-items:flex-start;padding:11px 20px;border-bottom:1px solid ${C.border};}
.bk-k{font-size:13px;color:${C.t2};}
.bk-v{font-size:13px;color:${C.t1};font-weight:500;text-align:right;max-width:200px;}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes ti{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
@keyframes to{to{opacity:0;transform:translateY(-10px)}}
`;

const ALL_CONTACTS = [];

// Avatars need { id, name, handle, color, initials }. The API returns raw
// `users` rows, so adapt them here. Without this every member avatar rendered
// blank, because the user map was built only from ALL_CONTACTS — which is empty.
// Eight hues held at a similar, deliberately muted luminance so no single
// avatar shouts louder than the others, and all dark enough that the white
// initials clear 4.5:1. The previous set was bright and fully saturated,
// every one of them failing contrast and fighting the warm noir surface.
const AVATAR_COLORS = ["#8C6D1F","#9E4B57","#3F7D63","#8A5A2B","#3D6389","#6B4A80","#A0563C","#4A7A52"];
function initialsFor(name,email){
  const src=(name||"").trim()||(email||"").split("@")[0]||"";
  const parts=src.split(/[\s._-]+/).filter(Boolean);
  if(parts.length===0)return "??";
  if(parts.length===1)return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}
function colorFor(id){
  const key=String(id||"");
  let h=0;
  for(let i=0;i<key.length;i++)h=(h*31+key.charCodeAt(i))>>>0;
  return AVATAR_COLORS[h%AVATAR_COLORS.length];
}
// The one place that decides what to call somebody. `name` can legitimately
// be a full name, a bare first name, or — when Clerk knows nothing about the
// account — an email address, and an address must never reach the screen.
function firstNameOf(u,fallback="there"){
  const first=(u?.firstName||"").trim();
  if(first)return first;
  const name=(u?.name||"").trim();
  if(!name||name.includes("@"))return fallback;
  // With no real name the server falls back to the address's local part,
  // which for Apple private relay is "ntzc6jh94w". That is not a name either.
  const local=(u?.email||"").split("@")[0].trim();
  if(local&&name.toLowerCase()===local.toLowerCase())return fallback;
  return name.split(/\s+/)[0];
}

function toContact(u){
  if(!u||!u.id)return null;
  const name=u.name||u.email?.split("@")[0]||"Member";
  return {
    id:u.id,
    name,
    // No address means no handle to show. It used to read "@member" for
    // everybody, which is a label that identifies nobody — and search answers
    // carry no address at all now.
    handle:u.email?"@"+u.email.split("@")[0]:"",
    email:u.email||"",
    avatar:u.avatar_url||u.avatar||null,
    color:colorFor(u.id),
    initials:initialsFor(u.name,u.email),
  };
}

const INIT_GROUPS = [];


// Icons
const Ic = {
  // The header's three: the theme in each direction, and the way out. Sized
  // here because they sit in a 44px button rather than a nav column.
  Sun:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>,
  Moon:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>,
  SignOut:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Home:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Compass:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  Users:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  User:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  ChevL:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>,
  ChevR:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>,
  X:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Check:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>,
  Trash:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  Edit:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Plus:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

// ─── Screen chrome ───────────────────────────────────────────────────────
// Every screen used to hand-roll its own back button. There were six different
// implementations across twelve call sites, with four different bottom
// paddings, three different labels and tap targets as small as 24px. One
// component means one behaviour, and a 44px target everywhere.
function ScreenHeader({onBack,label="Back",title,right,overlay=false}){
  // Overlay: floats on a hero image, so it carries its own scrim.
  if(overlay){
    return(
      <button onClick={onBack} aria-label={label} className="hd-ov">
        <Ic.ChevL/>
      </button>
    );
  }
  // With a title, the component owns the whole header block including its
  // padding. Without one it is just the button, which is a drop-in for the
  // bare buttons that used to sit inside each screen's own padded wrapper.
  const back=(
    <button onClick={onBack} className="hd-back" aria-label={label}>
      <Ic.ChevL/>{label?<span>{label}</span>:null}
    </button>
  );
  if(!title)return back;
  return(
    <div className="hd">
      <div className="hd-row">{back}{right}</div>
      <div className="pt" style={{fontSize:24}}>{title}</div>
    </div>
  );
}

function Av({u,lg}){return <div className={lg?"av-lg":"av"} style={{background:u.color}}>{u.initials}</div>;}
function AvCluster({ids,um,max=4}){const shown=ids.slice(0,max);const extra=ids.length-max;return <div className="av-cl">{shown.map(id=>{const u=um[id];return u?<div key={id} className="av" style={{background:u.color}}>{u.initials}</div>:null;})}{extra>0&&<div className="av" style={{background:C.s3,color:C.t2}}>+{extra}</div>}</div>;}
function Toast({msg,onDone}){useEffect(()=>{const t=setTimeout(onDone,2500);return()=>clearTimeout(t);},[]);return <div className="toast">✓ {msg}</div>;}

// The big fixed costs are events too: a flight is a thing that happens on a
// day and has a price. Making them itinerary items means the budget screen
// reads from one place, and they survive a reload — trip.costs lives only in
// memory, because the plans table has no column for it.
function fixedCostRows(trip){
  const c=trip?.costs||{};
  // Name the actual thing. This wrote "Flights", "Accommodation" and "Airport
  // transfers" onto the itinerary while the real detail — the airline, the
  // hotel — sat unused one field away, so three placeholder lines sat at the
  // top of a plan that was otherwise specific throughout.
  const row=(title,detail,cents,type)=>cents>0&&title?{
    time:"Before you go",title,sub:detail||"",type,conf:null,filled:false,
    cost_cents:Math.round(cents*100),booking_mode:"reach",
    payment_note:"Paid through Reach when the group funds the trip",
  }:null;
  return [
    row(c.flights?.details||"Round-trip flights",c.flights?.airlines,c.flights?.per_person,"flight"),
    // example is the hotel or neighbourhood; details is "7 nights, hotel".
    row(c.accommodation?.example||c.accommodation?.details,c.accommodation?.details,c.accommodation?.per_person,"hotel"),
    row(c.ground_transport?.details||"Airport transfers",null,c.ground_transport?.per_person,"transport"),
  ].filter(Boolean);
}

// "1 people" and "1 travelers" both reached a screen somebody was about to
// pay on. One helper, used everywhere a count meets a noun.
function plural(n,one,many){return `${n} ${n===1?one:(many||one+"s")}`;}

// Travelling alone is a different product, not a group with one person in it.
// Members, wallets, shares, voting and "nothing books until everyone is in"
// are all meaningless on your own, and leaving them on screen made a solo
// trip feel like a group trip nobody else had joined yet.
function isSoloGroup(g){return (g?.memberIds||[]).length<=1;}

// ─── Itinerary rows ───────────────────────────────────────────────────────
// Turns generated days into the rows the itinerary tab and the API both use.
// Written once because two screens had their own copy and they disagreed: one
// read day.tips, which the model never returns — the field is insider_tip — so
// every second-visit tip was silently dropped.
/** The day around an evening, offered rather than assumed. */
function daytimeRows(days){
  const slot=(v)=>typeof v==="string"?{plan:v,booking:null,payment:null,cost:null}:(v||{});
  return (days||[]).flatMap(day=>(day.daytime||[]).map((raw,i)=>{
    const d=slot(raw);
    return {time:i===0?"Earlier that day":"Then",title:d.plan,sub:"",type:"activity",conf:null,filled:false,
      cost_cents:d.cost!=null?Math.round(d.cost*100):0,booking_mode:d.booking||null,
      payment_note:d.payment||null,because:d.because||null};
  })).filter(r=>r.title);
}

function itineraryRows(days,nightOut=false){
  // A night out is one evening, not a day with an evening in it.
  //
  // The three slots are the shape the model answers in, and for a night out
  // the prompt already asks it to use them as the parts of an evening:
  // where you meet, the main event, what follows. This labelled them
  // "Morning", "Afternoon" and "Evening" regardless, so somebody who asked
  // for a night out with a friend was handed a full day and told the first
  // thing happened in the morning.
  const SLOTS=nightOut
    ?["To start","The main event","After"]
    :["Morning","Afternoon","Evening"];
  const label=(day,i)=>nightOut?SLOTS[i]:`Day ${day.day} · ${SLOTS[i]}`;

  return (days||[]).flatMap(day=>{
    const cost=Math.round((day.cost_today||0)*100);
    // A slot is an object now: what it is, how you get in, and what they take.
    // Older generations sent a bare string, so read both.
    const slot=(v)=>typeof v==="string"?{plan:v,booking:null,payment:null,cost:null}:(v||{});
    const m=slot(day.morning), a=slot(day.afternoon), e=slot(day.evening);
    // Each event carries its own cost so the budget screen can itemise rather
    // than split a total by fixed percentages. Falls back to the day's figure
    // spread across its slots for anything generated before per-event costs.
    const each=(sl)=>sl.cost!=null?Math.round(sl.cost*100):Math.round(cost/3);
    // A slot carrying a ticket link IS the event, whichever part of the
    // evening it landed in. Typed as one so it stops being filed as a
    // restaurant, and carrying the page that actually sells the ticket —
    // Reach cannot sell it, and handing somebody straight to who can is a
    // complete answer rather than a "Reserve ahead" with nothing behind it.
    const kind=(sl,fallback)=>sl.ticket_url?"event":fallback;
    // A ticket page for an event; the place's own site for everything
    // else. Both land in venue_website, because from the screen's point
    // of view they are the same thing: where you go to sort this out.
    const ticket=(sl)=>({
      ...(sl.ticket_url
        ?{venue_website:sl.ticket_url,venue_name:sl.venue||null}
        :(sl.place_url?{venue_website:sl.place_url,venue_name:sl.venue||null}:{})),
      // What is on there, from the venue's own page. Always carried, never
      // left to whether the sentence mentioned it.
      ...(sl.whats_on?{venue_note:sl.whats_on}:{}),
    });
    return [
      // The day's own title sits under its first slot, which reads as a
      // theme on a trip and as an echo on an evening: "An Evening with The
      // Milk Carton Kids" appeared beneath the dinner while the same words
      // were already the plan's name at the top of the screen.
      {time:label(day,0),title:m.plan,sub:nightOut?"":(day.title||""),type:kind(m,nightOut?"restaurant":"activity"),conf:null,filled:false,
        cost_cents:each(m),booking_mode:m.booking||null,payment_note:m.payment||null,because:m.because||null,...ticket(m)},
      {time:label(day,1),title:a.plan,sub:"",type:kind(a,"activity"),conf:null,filled:false,
        cost_cents:each(a),booking_mode:a.booking||null,payment_note:a.payment||null,because:a.because||null,...ticket(a)},
      // The tip belongs to the day and is printed under the last slot of
      // it, so it read as a description of that slot: "the gallery is small
      // enough to see properly in under an hour" sat beneath dinner at a
      // restaurant. Marked, so it reads as a note about the day wherever
      // it lands.
      {time:label(day,2),title:e.plan,sub:day.insider_tip?`💡 ${day.insider_tip}`:"",type:kind(e,"restaurant"),conf:null,filled:false,
        cost_cents:each(e),booking_mode:e.booking||null,payment_note:e.payment||null,because:e.because||null,...ticket(e)},
    ].filter(r=>r.title);
  });
}

// Returning null from a screen paints nothing — no header, no way back, just
// an empty app. A group or plan can legitimately be missing for a moment while
// it saves or refreshes, so every screen that can hit that case shows this
// instead of a blank.
function NotLoaded({what="This",onBack}){
  return(
    <div className="sc">
      <ScreenHeader onBack={onBack} label="Back"/>
      <div style={{padding:"48px 28px",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>🧭</div>
        <div style={{fontSize:16,fontWeight:600,color:C.t1,marginBottom:6}}>{what} isn't loaded yet</div>
        <div style={{fontSize:13,color:C.t2,lineHeight:1.5,marginBottom:20}}>
          It may still be saving. Go back and open it again.
        </div>
        <button className="bs" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

// Cards, rows and text links that behave as buttons but are not buttons. The
// stylesheet has drawn a focus ring for [role="button"] since the keyboard
// audit, and nothing could ever show it: none of these was reachable by
// keyboard at all. Enter and space press the element itself, so the click
// handler beside this stays the only description of what the control does.
const pressable={
  role:"button",tabIndex:0,
  onKeyDown:e=>{
    if(e.key==="Enter"||e.key===" "){e.preventDefault();e.currentTarget.click();}
  },
};

// Every sheet in the app closes by tapping the dark area behind it, and that
// was the only way out: on a keyboard there was none at all. The handler is
// read through a ref so the listener is attached once per opening rather than
// on every render.
function useEscape(open,onClose){
  const latest=useRef(onClose);
  latest.current=onClose;
  useEffect(()=>{
    if(!open)return;
    const onKey=e=>{ if(e.key==="Escape")latest.current(); };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[open]);
}

// "2026-10-09" as somebody would say it out loud. Anything that is not a
// date renders nothing at all rather than the words "Invalid Date".
function dayLabel(iso){
  const t=Date.parse(`${iso}T12:00:00`);
  if(!Number.isFinite(t))return null;
  return new Date(t).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
}

// A client-made id that the server has never seen. Hitting an API with one of
// these is always a 404, so the callers that can hold one check first.
function isTempId(id){
  return typeof id==="string"&&(/^g_local_/.test(id)||/^p\d{10,}$/.test(id));
}

// ─── HOME ────────────────────────────────────────────────────────────────────
function HomeScreen({groups,um,push,toast,loading,user,setTab}){
  // The server has no idea what time it is where you are. Anything that reads
  // the clock waits for the browser rather than guessing and being corrected.
  const [mounted,setMounted]=useState(false);
  const [hour,setHour]=useState(12);
  useEffect(()=>{ setHour(new Date().getHours()); setMounted(true); },[]);
  // These were three San Francisco events hardcoded as the default, shown to
  // everyone everywhere until the API answered — and left standing forever if
  // it never did. An empty list that says so is more honest than a fixture.
  const [nearbyEvents,setNearbyEvents]=useState([]);
  const [nearbyState,setNearbyState]=useState("loading"); // loading|ready|denied|none
  const [nearbyReason,setNearbyReason]=useState(null);
  useEffect(()=>{
    // Every exit from here has to move the state off "loading". A swallowed
    // throw left the strip reading "Looking for events near you…" forever,
    // which is indistinguishable from a hung app.
    try{
      if(typeof navigator==="undefined"||!navigator.geolocation){
        setNearbyState("denied");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async function(pos){
          try{
            const lat=pos.coords.latitude;
            const lng=pos.coords.longitude;
            const res=await fetch("/api/nearby?lat="+lat+"&lng="+lng);
            if(res.ok){
              const data=await res.json();
              setNearbyEvents(data.events||[]);
              setNearbyReason(data.reason||null);
              setNearbyState(data.events?.length?"ready":"none");
            }else{
              console.error("[home] nearby returned",res.status);
              setNearbyReason("provider_error");
              setNearbyState("none");
            }
          }catch(e){
            console.error("[home] nearby failed",e);
            setNearbyReason("provider_error");
            setNearbyState("none");
          }
        },
        function(err){ setNearbyState("denied"); },
        {timeout:8000,enableHighAccuracy:false,maximumAge:300000}
      );
    }catch(e){
      console.error("[home] geolocation unavailable",e);
      setNearbyState("denied");
    }
  },[]);
  const allPlans=groups.flatMap(g=>g.plans.map(p=>({...p,group:g})));
  // What is ahead, by date. This used to be chosen by status — booked, voting
  // or approved — so a plan still being planned, which is every plan when it
  // is first made, never appeared here, while a trip booked for last month
  // stayed forever. Soonest first; a plan nobody has dated yet follows,
  // because it is still coming even if nobody knows when.
  const todayISO=today();
  const upcoming=[
    ...groupSchedule(groups,todayISO,500).map(r=>({...r.plan,group:r.group})),
    ...allPlans.filter(p=>!p.startDate&&p.status!=="completed"&&p.status!=="cancelled"),
  ].filter(p=>p.status!=="completed"&&p.status!=="cancelled");
  // Everything waiting on somebody, not only votes. Ordered by how close the
  // trip is to finished rather than by age: the one nearly done pulls hardest,
  // and a list sorted by urgency means the top item is always the right one.
  // The wording is what is waiting rather than what is missing — "waiting on
  // you" is a thing to rescue, "you haven't paid" is an accusation.
  const solo=g=>(g?.memberIds||[]).length<=1;
  const actions=[
    // Home said "Moab, Utah, USA is ready to book" five days into its own
    // dates, next to a plan screen that had just learned to say the opposite:
    // two screens disagreeing about the same trip, which is how this app's
    // bugs usually look.
    //
    // A trip that has started is not dropped from this list. There may still
    // be a table to ring about, and hiding the trip hides that too — it just
    // stops being described as something to book ahead.
    ...allPlans.filter(p=>p.status==="approved"
      &&tripTiming({startDate:p.startDate,endDate:p.endDate},todayISO)!=="over").map(p=>({
      // "This is the last step" is a promise the next screen cannot always
      // keep: a trip can be approved and still have nothing priced to
      // charge for, in which case checkout correctly refuses and the person
      // has been walked into a dead end by their own home screen. What is
      // certainly true is that this is where booking happens.
      // Solo-aware, like the "waiting on everyone's share" action four lines
      // down already is. `solo()` was defined directly above and used there
      // and not here, so a trip somebody is taking on their own was told
      // "Everyone's in" by their own home screen — a sentence about other
      // people, on a plan that has none.
      type:"book",rank:0,
      text:tripTiming({startDate:p.startDate,endDate:p.endDate},todayISO)==="on_now"
        ?`${p.title} is on now`
        :`${p.title} is ready to book`,
      sub:tripTiming({startDate:p.startDate,endDate:p.endDate},todayISO)==="on_now"
        ?"Anything still open is on the trip"
        :solo(p.group)?"You're all set — let's see what we can get booked":"Everyone's in — let's see what we can get booked",
      plan:p,
      cta:tripTiming({startDate:p.startDate,endDate:p.endDate},todayISO)==="on_now"?"Open →":"Book →"})),
    ...allPlans.filter(p=>p.status==="voting"&&p.options?.length>0).map(p=>({
      type:"vote",rank:1,text:`${p.group.name} is deciding on ${p.title}`,
      sub:p.options.slice(0,3).join(" · "),plan:p,cta:"Vote →"})),
    ...allPlans.filter(p=>p.status==="planning"&&(p.itinerary?.length||0)>0&&!solo(p.group)).map(p=>({
      type:"pay",rank:2,text:`${p.title} is waiting on everyone's share`,
      sub:`$${p.budget?.toLocaleString?.()||p.budget} each`,plan:p,cta:"Pay →"})),
    ...allPlans.filter(p=>p.status==="planning"&&(p.itinerary?.length||0)===0).map(p=>({
      type:"plan",rank:3,text:`${p.title} has no days yet`,
      sub:"We can write the whole thing in about 20 seconds",plan:p,cta:"Plan →"})),
  ].sort((a,b)=>a.rank-b.rank).slice(0,4);
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"14px 20px 12px"}}>
        {/* Rendered after mount, and empty before it. The hour and the day are
            the browser's, not the server's: rendering them server-side meant
            "Good afternoon" from a machine in UTC against "Good morning" in
            the browser, which is a text mismatch, which fails hydration —
            React then replaced the document on every single load. The space is
            held so nothing jumps when it arrives. */}
        <div style={{fontSize:13.5,color:C.t2,marginBottom:5,fontWeight:500,minHeight:18}}>
          {mounted?(<>
            {hour<12?"Good morning":hour<17?"Good afternoon":"Good evening"}
            {firstNameOf(user,"")&&`, ${firstNameOf(user)}`}
          </>):null}
        </div>
        {/* A question rather than a greeting, because the answer is the whole
            point of the app. One word carries the accent, and the question
            changes by the day so opening Reach on Tuesday does not feel like
            Monday. The date decides it, so it cannot flicker between renders
            or disagree with what was on screen a second ago. */}
        {(()=>{
          // Same reason: which day it is depends on where you are standing.
          const q=GREETING_QUESTIONS[(mounted?dayIndex():0)%GREETING_QUESTIONS.length];
          return(
            <div className="display" style={{fontSize:34,color:C.t1,lineHeight:1.15,fontWeight:600,letterSpacing:"-.01em"}}>
              {q.before}<span style={{color:C.accent}}>{q.word}</span>{q.after}
            </div>
          );
        })()}
        <div style={{fontSize:13.5,color:C.t2,marginTop:8,lineHeight:1.55}}>
          The best plans start with one person saying when.
        </div>
        {/* Nothing to call them by. Say where to fix it rather than greeting
            "there" forever. Waits for /api/me so it cannot flash on load. */}
        {user?.id&&firstNameOf(user,"")===""&&(
          <div {...pressable} onClick={()=>setTab("profile")}
            style={{fontSize:12.5,color:C.accentText,marginTop:6,fontWeight:600,cursor:"pointer"}}>
            What should we call you? Add your name →
          </div>
        )}
      </div>

      {/* Draft resume banner */}
      {(()=>{
        try{
          if(typeof window==="undefined")return null;
          const d=window.localStorage.getItem("reach_plan_draft");
          if(!d)return null;
          const dr=JSON.parse(d);
          if(!dr?.planType&&!dr?.gid)return null;
          const typeLabel=dr.planType==="restaurant"?"dinner out":dr.planType==="concert"?"concert night":dr.planType==="weekend"?"weekend away":"trip";
          const totalSteps=dr.planType==="restaurant"||dr.planType==="concert"?4:dr.planType==="weekend"?5:6;
          return(
            <div style={{margin:"0 20px 14px",background:`linear-gradient(135deg,${C.accentDim},rgba(108,99,255,.05))`,border:`1px solid ${C.accentBorder}`,borderRadius:16,padding:"12px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>push("createPlan",{})}>
              <div style={{fontSize:26,flexShrink:0}}>{dr.planType==="restaurant"?"🍽️":dr.planType==="concert"?"🎵":dr.planType==="weekend"?"🏡":"✈️"}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.t1}}>Resume your draft</div>
                <div style={{fontSize:12,color:C.t2,marginTop:2}}>
                  {dr.planName||`New ${typeLabel}`} · Step {(dr.step||0)+1} of {totalSteps}
                </div>
                <div style={{marginTop:6,display:"flex",gap:3}}>
                  {Array.from({length:totalSteps}).map((_,i)=>(
                    <div key={i} style={{flex:1,height:2,borderRadius:1,background:i<=(dr.step||0)?C.accent:C.s3}}/>
                  ))}
                </div>
              </div>
              <div style={{fontSize:18,color:C.accentText,fontWeight:600}}>→</div>
            </div>
          );
        }catch{return null;}
      })()}

      {actions.length>0&&(
        <div style={{margin:"0 20px 18px",background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:20,padding:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:C.accent}}/>
            <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:C.accentText}}>
              {actions.length===1?"Waiting on you":`${actions.length} things waiting on you`}
            </span>
          </div>
          {actions.map((a,i)=>(
            <div key={i} {...pressable} onClick={()=>{if(a.plan&&a.plan.id&&a.plan.group?.id)push("planDetail",{planId:a.plan.id,groupId:a.plan.group.id});}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderTop:i?"1px solid "+C.accentBorder:"none",cursor:"pointer"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,color:C.t1,fontWeight:500}}>{a.text}</div>
                <div style={{fontSize:11,color:C.t2,marginTop:2}}>{a.sub}</div>
              </div>
              <button className="bsm bsm-p" onClick={e=>{e.stopPropagation();a.plan&&push("planDetail",{planId:a.plan.id,groupId:a.plan.group?.id});}}>{a.cta}</button>
            </div>
          ))}
        </div>
      )}
      {(upcoming.length>0||groups.length>0)&&(
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 20px 10px"}}>
        <span className="sl">Upcoming trips</span>
        <span style={{fontSize:12,color:C.accentText,cursor:"pointer"}} onClick={()=>setTab("groups")}>See all →</span>
      </div>
      )}
      {(upcoming.length>0||groups.length>0)&&(
      <div style={{display:"flex",gap:12,padding:"0 20px 18px",overflowX:"auto",scrollbarWidth:"none"}}>
        {upcoming.map(plan=>(
          <div key={plan.id} {...pressable} onClick={()=>push("planDetail",{planId:plan.id,groupId:plan.group.id})}
            style={{minWidth:200,background:`linear-gradient(145deg,#1a1060,${C.accent})`,borderRadius:20,border:`1px solid ${C.border}`,cursor:"pointer",flexShrink:0,transition:"transform .15s",
              // A picture of the place they are actually going. The gradient
              // stays underneath, so a photo that fails to load leaves the
              // card as it always looked rather than a white rectangle.
              ...(plan.imageUrl?{backgroundImage:`url(${JSON.stringify(plan.imageUrl).slice(1,-1)})`,
                backgroundSize:"cover",backgroundPosition:"center"}:{}),
              position:"relative",overflow:"hidden"}}>
            {/* Dark enough to read white text on any photograph. */}
            {plan.imageUrl&&(
              <div style={{position:"absolute",inset:0,
                background:"linear-gradient(160deg,rgba(0,0,0,.28),rgba(0,0,0,.78))"}}/>
            )}
            <div style={{padding:16,position:"relative"}}>
              <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`} style={{marginBottom:10,display:"inline-flex"}}>
                {plan.status==="booked"?"✓ Booked":plan.status==="voting"?"⏳ Voting":plan.status==="approved"?"👍 Ready to book":"📋 Planning"}
              </span>
              <div style={{fontFamily:"var(--font-display)",fontSize:20,color:"white",marginBottom:4}}>{plan.title}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.65)",marginBottom:10}}>{plan.startDate?plan.dates:"No date yet"} · {plan.group.name}</div>
              {/* How long until it. Counted between calendar days rather
                  than between instants, so a trip on Friday reads "In 2
                  days" all Wednesday instead of ticking over at eight in the
                  evening when UTC rolls. A plan with no real date carries no
                  countdown — a number for a date nobody set would be one the
                  app invented. */}
              {countdown(plan)&&(
                <div style={{display:"inline-flex",alignItems:"center",gap:5,marginBottom:10,
                  padding:"3px 9px",borderRadius:20,background:"rgba(255,255,255,.16)",
                  fontSize:11,fontWeight:700,color:"white",letterSpacing:".01em"}}>
                  {countdown(plan)}
                </div>
              )}
              <AvCluster ids={plan.participants} um={um} max={4}/>
              {/* Whose photograph it is. A picture is somebody's work, and
                  the licence it is free under asks for the credit — so it
                  travels with the picture or the picture is not shown. */}
              {plan.imageUrl&&plan.imageCredit&&(
                <div style={{fontSize:9.5,color:"rgba(255,255,255,.55)",marginTop:8,lineHeight:1.3}}>
                  📷 {plan.imageCredit}
                </div>
              )}
            </div>
          </div>
        ))}
        <div {...pressable} onClick={()=>push("createPlan",{fresh:true})} style={{minWidth:130,background:"transparent",border:`2px dashed ${C.border}`,borderRadius:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,padding:20,cursor:"pointer",flexShrink:0}}>
          <div style={{fontSize:24,color:C.t3}}>＋</div>
          <div style={{fontSize:12,color:C.t2,fontWeight:500,textAlign:"center"}}>New plan</div>
        </div>
      </div>
      )}
      {/* Answering this makes every other screen better, so it sits above
          the ways in rather than buried in a settings list. It goes away the
          moment it is answered. */}
      {user&&user.quizComplete===false&&(
        <div {...pressable} onClick={()=>push("taste")}
          style={{margin:"0 20px 14px",background:C.accentDim,border:`1px solid ${C.accentBorder}`,
            borderRadius:18,padding:16,display:"flex",gap:12,cursor:"pointer",alignItems:"center"}}>
          <span style={{fontSize:28}}>✨</span>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:600,color:C.t1,marginBottom:3}}>
              Tell us what you're into
            </div>
            <div style={{fontSize:12.5,color:C.t2,lineHeight:1.55}}>
              Pottery, cooking, live music, whatever it is. Two minutes, and every
              suggestion after it is aimed at you rather than at everybody.
            </div>
            <div style={{fontSize:12,color:C.accentText,marginTop:6,fontWeight:600}}>Start →</div>
          </div>
        </div>
      )}
      <div style={{padding:"0 20px 10px"}}>
        <span className="sl">{groups.length>0?"Jump back in":"Three ways to start"}</span>
      </div>
      {(groups.length>0?[
        {emoji:"✈️",text:groups[0].name+" · "+(groups[0].plans?.length||0)+" plan"+(((groups[0].plans?.length||0)!==1)?"s":""),cta:"Open →",action:()=>push("groupDetail",{groupId:groups[0].id})},
        // Always "plan another", never "see all".
        //
        // With more than one group this used to read "3 trips on the go. See
        // all →" and switch to the Groups tab — which the bottom nav already
        // does from every screen, and which the "Upcoming trips · See all →"
        // header eighty lines up already does with the same words. Three ways
        // to the same tab on one screen, two of them labelled identically.
        //
        // A card is the most expensive slot on this screen. Spending it on a
        // journey the nav bar makes in one tap leaves the person who has come
        // back with nothing here they could not already do.
        {emoji:"➕",text:"Plan another — on your own or with people.",cta:"Start one →",action:()=>push("createGroup")},
      ]:[
        // A first visit used to offer exactly one thing, and it was the most
        // committing thing in the app: name a group, pick people, start a
        // plan. Nobody's first move should cost that much. These are ordered
        // by what they ask of you — look at something real, book one evening,
        // then plan the whole thing.
        {emoji:"🧭",text:"Have a look at what's on near you tonight. Costs nothing to browse.",cta:"Open Discover →",action:()=>setTab("discover")},
        {emoji:"🍽️",text:"Just booking one dinner or one gig? That counts as a plan.",cta:"Sort one evening →",action:()=>push("createPlan",{})},
        {emoji:"✈️",text:"Or do the whole thing — solo, or with everyone.",cta:"Plan a trip →",action:()=>push("createGroup")},
      ]).filter(Boolean).map((ins,i)=>(
        <div key={i} {...pressable} onClick={ins.action} style={{margin:"0 20px 10px",background:C.s1,border:"1px solid "+C.border,borderRadius:16,padding:14,display:"flex",gap:12,cursor:"pointer"}}>
          <span style={{fontSize:24}}>{ins.emoji}</span>
          <div>
            <div style={{fontSize:13,color:C.t1,lineHeight:1.5}}>{ins.text}</div>
            <div style={{fontSize:12,color:C.accentText,marginTop:4,fontWeight:500}}>{ins.cta}</div>
          </div>
        </div>
      ))}
      <div style={{padding:"14px 20px 6px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span className="sl">Near you</span>
        {user?.location&&<span style={{fontSize:11,color:C.t3}}>📍 {user.location}</span>}
      </div>
      {nearbyEvents.map((n,i)=>(
        <div key={i}
          onClick={()=>{ if(n.url)window.open(n.url,"_blank","noopener,noreferrer"); }}
          style={{margin:"0 20px 8px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:14,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,cursor:n.url?"pointer":"default"}}>
          <span style={{fontSize:26,flexShrink:0}}>{n.emoji}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:500,color:C.t1}}>{n.title}</div>
            <div style={{fontSize:11,color:C.t2,marginTop:2}}>{n.meta}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            {n.price&&<div style={{fontSize:12,color:C.accentText,fontWeight:600}}>{n.price}</div>}
            {n.dist&&<div style={{fontSize:11,color:C.t3,marginTop:1}}>{n.dist}</div>}
          </div>
        </div>
      ))}
      {nearbyState!=="ready"&&(
        <div style={{margin:"0 20px",padding:"14px 16px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:14,fontSize:12.5,color:C.t2,lineHeight:1.5}}>
          {nearbyState==="loading"?"Looking for things to do near you…"
            :nearbyState==="denied"?"Allow location in your browser and reload to see events near you."
            :nearbyReason==="no_key"?"Event listings aren't switched on for this deployment yet."
            :nearbyReason==="provider_error"?"Couldn't reach the listings just now. Try again shortly."
            :"Nothing close by just yet. Reach looks again every night."}
        </div>
      )}
      <div style={{height:20}}/>
    </div>
  );
}


// ─── Waiting for an itinerary ─────────────────────────────────────────────
// Building a week of real places takes about 25 seconds. The whole wait used
// to be a button reading "Building… ✨", which gives someone no idea whether
// it is working, how long is left, or whether to walk away.
//
// Every line below describes something the request is genuinely doing, paced
// against the measured runtime. No invented steps and no fake percentage that
// sticks at 90.
// Not rendered anywhere today — grep says this component has no call site.
// Left in place rather than deleted because it is somebody's work and the
// simpler "Building your days…" button is what ships instead; but its copy is
// written to be true whether one person is travelling or eight, so that
// wiring it up later cannot quietly ship group copy to a solo trip.
function BuildingItinerary({destination,nights,onCancel}){
  // Still describes exactly what the request is doing — the warmth is in the
  // wording, not in inventing steps that are not happening.
  const steps=[
    {at:0,  t:"Reading the room — what you told us you wanted"},
    {at:4,  t:`Working out where to put you in ${destination||"your destination"}`},
    {at:9,  t:"Finding dinners worth the trip"},
    {at:15, t:`Writing all ${nights||7} days, breakfast to last orders`},
    {at:22, t:"Arguing with ourselves about the second evening"},
    {at:28, t:"Adding the bits you'd only know the second time round"},
    {at:36, t:"Checking nothing has you in two places at once"},
  ];
  const [secs,setSecs]=useState(0);
  useEffect(()=>{
    const id=setInterval(()=>setSecs(s=>s+1),1000);
    return ()=>clearInterval(id);
  },[]);
  const current=steps.filter(s=>s.at<=secs).slice(-1)[0]||steps[0];
  // Eases toward 95% over ~35s and waits there rather than claiming completion.
  const pct=Math.min(95,Math.round((1-Math.exp(-secs/12))*100));
  const over=secs>45;

  return(
    <div style={{position:"absolute",inset:0,background:C.bg,zIndex:300,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 32px"}}>
      <div style={{fontSize:44,marginBottom:18}}>🗺️</div>
      <div style={{fontFamily:"var(--font-display)",fontSize:26,color:C.t1,textAlign:"center",lineHeight:1.2,marginBottom:8}}>
        Building your {destination||"trip"}
      </div>
      <div style={{fontSize:13.5,color:C.t2,textAlign:"center",marginBottom:26,minHeight:38,lineHeight:1.5}}>
        {over
          ? "Taking its time. Still going — a few more seconds."
          : current.t}
      </div>
      <div style={{width:"100%",maxWidth:280,height:6,background:C.s3,borderRadius:3,overflow:"hidden",marginBottom:10}}>
        <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${C.accentDeep},${C.accent})`,
          borderRadius:3,transition:"width 1s linear"}}/>
      </div>
      <div style={{fontSize:11.5,color:C.t3,marginBottom:28}}>
        {secs}s · usually about 25
      </div>
      {onCancel&&(
        <button onClick={onCancel}
          style={{background:"none",border:"none",color:C.t2,fontSize:13,cursor:"pointer",padding:"8px 0"}}>
          Cancel
        </button>
      )}
    </div>
  );
}

// ─── DISCOVER ────────────────────────────────────────────────────────────────
// ─── Saying where you actually are ──────────────────────────────────────
// The app being wrong about somebody's location has happened twice —
// Aberdeen shown Pittsburgh, and before that San Francisco — so every screen
// that plans around a place has to let the person correct it, and the
// correction has to stick. Detection can be wrong; this is how you say so.
//
// Shared by Discover and by the night out, which are the two screens whose
// whole answer depends on where you are standing. A trip is different: it
// departs from where you live, which is a profile setting and not a GPS
// reading.
function PlaceLine({userLocation,setPlaceOverride,toast,prefix,fallback,hint}){
  const [picking,setPicking]=useState(false);
  const [query,setQuery]=useState("");
  const [hits,setHits]=useState([]);
  const [searching,setSearching]=useState(false);

  const city=userLocation?.city||userLocation?.formatted;

  const search=async(q)=>{
    const term=(q||"").trim();
    if(term.length<3){setHits([]);return;}
    setSearching(true);
    try{
      // Through our own server: a browser cannot set the User-Agent the
      // map's usage policy requires, and calling it from the page was
      // blocked by CORS in production — so this search never worked at all.
      const r=await fetch("/api/geo?limit=6&q="+encodeURIComponent(term));
      if(!r.ok)throw new Error(String(r.status));
      const found=await r.json();
      setHits((found.hits||[]).map(h=>({
        label:h.label, lat:h.lat, lng:h.lng,
      })).filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lng)));
    }catch(e){
      console.error("[place] search failed",e);
      toast&&toast("Couldn't search for that just now — try again in a moment");
    }
    setSearching(false);
  };

  return(
    <>
      <div {...pressable} onClick={()=>setPicking(true)}
        style={{fontSize:13,color:C.t2,marginTop:2,cursor:setPlaceOverride?"pointer":"default"}}>
        {city?prefix+" "+city:fallback}
        {setPlaceOverride?<span style={{color:C.accentText,marginLeft:6,fontWeight:600,whiteSpace:"nowrap"}}>{" · change ▾"}</span>:null}
      </div>
      {picking&&setPlaceOverride&&(
        <div style={{marginTop:10,padding:"12px 14px",background:C.s2,
          border:`1px solid ${C.border}`,borderRadius:14,textAlign:"left"}}>
          <div style={{fontSize:12.5,color:C.t2,marginBottom:8,lineHeight:1.5}}>
            {hint||"Where should we look? This sticks until you clear it."}
          </div>
          <input className="inp" autoFocus value={query} placeholder="Aberdeen, Scotland"
            onChange={e=>{setQuery(e.target.value);search(e.target.value);}}/>
          {searching&&<div style={{fontSize:12,color:C.t3,marginTop:8}}>Looking…</div>}
          {hits.map((h,i)=>(
            <div key={i} {...pressable}
              onClick={()=>{
                const label=h.label.split(",")[0].trim();
                setPlaceOverride({lat:h.lat,lng:h.lng,city:label,formatted:label});
                setPicking(false);setQuery("");setHits([]);
                toast&&toast("Showing "+label);
              }}
              style={{padding:"9px 2px",borderTop:`1px solid ${C.border}`,fontSize:13,
                color:C.t1,cursor:"pointer",lineHeight:1.4}}>
              {h.label}
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:10}}>
            {userLocation?.source==="override"&&(
              <button className="bs" style={{flex:1}}
                onClick={()=>{setPlaceOverride(null);setPicking(false);toast&&toast("Back to where you are");}}>
                Use my location
              </button>
            )}
            <button className="bs" style={{flex:1}} onClick={()=>{setPicking(false);setHits([]);}}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function DiscoverScreen({push,groups,toast,user,userLocation,setPlaceOverride}){
  // Whether the browser has actually been refused, or has simply never
  // answered. Both leave us without a location and they are not the same
  // thing: only one of them is the person's to fix, and telling somebody to
  // allow a permission they have already allowed is the app being wrong
  // about them in a way they cannot act on.
  //
  // Measured on production: with permission granted, getCurrentPosition
  // returned neither callback for over twenty seconds, past its own timeout.
  // That person was being told to allow location.
  const [geoAllowed,setGeoAllowed]=useState(null);   // null = not yet known
  useEffect(()=>{
    let live=true;
    navigator?.permissions?.query?.({name:"geolocation"})
      .then(p=>{ if(live)setGeoAllowed(p.state==="granted"); })
      .catch(()=>{});                                 // Safari, older browsers
    return ()=>{ live=false; };
  },[]);
  const [filter,setFilter]=useState("All");
  const [localRecs,setLocalRecs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [reason,setReason]=useState(null);
  const [thin,setThin]=useState(false);
  const [sources,setSources]=useState([]);
  // Whether anything here was found because of what they told us. When not,
  // the screen is a bit of everything and says so, once, quietly.
  const [personal,setPersonal]=useState(true);

  useEffect(()=>{
    if(loaded)return;
    // Show cached results instantly, refresh in background
    const hasCached=loadFromCache();
    if(!hasCached){
      loadLocalRecs();
    } else {
      // Refresh in background after showing cached
      setTimeout(loadLocalRecs, 100);
    }
  },[]);
  
  // Reload when location becomes available
  useEffect(()=>{
    if(userLocation&&!loaded)loadLocalRecs();
    if(userLocation&&loaded){
      // Location just became available, refresh
      setLoaded(false);
      setLocalRecs([]);
      loadLocalRecs();
    }
  },[userLocation?.lat]);

  const loadLocalRecs=async()=>{
    setLoading(true);
    try{
      const lat=userLocation?.lat;
      const lng=userLocation?.lng;
      const city=encodeURIComponent(userLocation?.city||userLocation?.formatted||"");
      let url="/api/nearby";
      if(lat&&lng)url+=`?lat=${lat}&lng=${lng}&city=${city}`;
      else if(city)url+=`?city=${city}`;

      const res=await fetch(url);
      if(res.ok){
        const data=await res.json();
        setReason(data.reason||null);
        // Which providers answered. A screen that cannot tell a quiet week
        // from a dead key tells everybody their city is boring.
        setSources(data.sources||[]);
        setPersonal(data.personal!==false);
        // How much there is here at all. A thin list shuffled daily is still
        // a thin list, and saying so beats implying a deep catalogue.
        setThin(!!data.thin);
        if(data.events?.length){
          setLocalRecs(data.events);
          // Cache in sessionStorage so reload is instant
          try{sessionStorage.setItem("reach_nearby",JSON.stringify({events:data.events,city:data.city,ts:Date.now()}));}catch(e){}
        }
      }else{
        console.error("[discover] nearby returned",res.status);
        setReason("provider_error");
      }
    }catch(e){
      console.error("[discover] nearby failed",e);
      setReason("provider_error");
    }
    setLoaded(true);
    setLoading(false);
  };

  // Load from cache immediately, then refresh in background
  const loadFromCache=()=>{
    try{
      const cached=sessionStorage.getItem("reach_nearby");
      if(!cached)return false;
      const {events,ts}=JSON.parse(cached);
      // Use cache if less than 2 hours old
      if(Date.now()-ts<7200000&&events?.length){
        setLocalRecs(events);
        setLoaded(true);
        return true;
      }
    }catch(e){}
    return false;
  };

  // Real inventory only. This used to append six hardcoded experiences —
  // Northern Lights, Nobu Malibu, a Beyoncé date in 2026 — which were the same
  // six for everyone, everywhere, and could not be bought. It also dropped the
  // booking url the API had already returned for every real event.
  // Places this person has ruled on. Loaded once; the server decides what
  // stays hidden, so Discover and trip generation hide the same things
  // rather than each having its own opinion.
  const [hidden,setHidden]=useState(()=>new Set());
  // Places they have been. Shown, not hidden — "already done it" is keeping
  // track, and a studio somebody liked is somewhere to go back to.
  const [visited,setVisited]=useState(()=>new Set());
  const [asking,setAsking]=useState(null);     // the card whose × is open
  const [undo,setUndo]=useState(null);         // {ref,title} for the toast

  useEffect(()=>{(async()=>{
    try{
      const r=await fetch("/api/recommendations/feedback");
      if(!r.ok)return;                         // nothing hidden is the old behaviour
      const d=await r.json();
      setHidden(new Set(d.hidden||[]));
      setVisited(new Set(d.visited||[]));
    }catch(e){ console.error("[discover] could not read what you've ruled out",e); }
  })();},[]);

  /** The stable name for a card, whichever source found it. */
  const refOfExp=(exp)=>`${String(exp.source||"unknown").toLowerCase()}:${exp.id}`;

  const rule=async(exp,verdict)=>{
    const ref=refOfExp(exp);
    // Gone from the screen straight away. A dismissal that waits for a round
    // trip reads as a button that did not work.
    // Only a refusal takes it off the screen. Done is a note on the card.
    if(verdict==="not_interested")setHidden(h=>new Set([...h,ref]));
    else setVisited(v=>new Set([...v,ref]));
    setAsking(null);
    setUndo({ref,title:exp.title,verdict});
    try{
      const r=await fetch("/api/recommendations/feedback",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({itemRef:ref,verdict,vertical:exp.category||"unknown",title:exp.title}),
      });
      void fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:"recommendation_dismissed",
          props:{reason:verdict==="done"?"done":"not_for_me",kind:String(exp.category||"unknown").slice(0,40)}})}).catch(()=>{});
      if(!r.ok){
        const d=await r.json().catch(()=>({}));
        // Put it back rather than leave the screen saying something the
        // server does not know.
        setHidden(h=>{const n=new Set(h);n.delete(ref);return n;});
        setVisited(v=>{const n=new Set(v);n.delete(ref);return n;});
        setUndo(null);
        toast(d.error||"Couldn't save that");
      }
    }catch(e){
      console.error("[discover] could not save that",e);
      setHidden(h=>{const n=new Set(h);n.delete(ref);return n;});
      setVisited(v=>{const n=new Set(v);n.delete(ref);return n;});
      setUndo(null);
      toast("Couldn't save that — try again in a moment");
    }
  };

  const undoRule=async()=>{
    if(!undo)return;
    const {ref}=undo;
    setHidden(h=>{const n=new Set(h);n.delete(ref);return n;});
    setVisited(v=>{const n=new Set(v);n.delete(ref);return n;});
    setUndo(null);
    try{
      const r=await fetch(`/api/recommendations/feedback?itemRef=${encodeURIComponent(ref)}`,{method:"DELETE"});
      if(!r.ok)toast("Couldn't undo that — it should still be where you left it");
    }catch(e){ console.error("[discover] could not undo",e); toast("Couldn't undo that — it should still be where you left it"); }
  };

  const allItems=localRecs.map(e=>({
    id:"local_"+e.id,
    // Which source found it. Dropped here, so every place somebody ruled on
    // was filed under "unknown:" — the prefix exists to tell two sources'
    // ids apart and cannot do that if nothing sets it.
    source:e.source||null,
    // The venue's own picture, when they publish one. Null keeps the
    // gradient — better than somebody else's photograph of somewhere else.
    image:e.image||null,
    title:e.title,
    sub:e.meta,
    emoji:e.emoji,
    price:e.price||null,
    dist:e.dist,
    category:e.category||"Event",
    // The link that actually sells the ticket.
    url:e.url||null,
    // The event's own date and venue. Dropping these is what made the detail
    // screen ask for a date it had already been given.
    date:e.date||null,
    venue:e.venue||null,
    tags:[e.category||"Event"],
    // Why this one. A suggestion that says it came from something you told
    // us reads as the app paying attention; the same card without it reads
    // as an advert.
    because:e.because||null,
    provider:e.source||null,
    bg:`linear-gradient(135deg,${C.accentDeep},${C.accent})`,
    isLocal:true,
  }));

  // Filters come from what actually came back, so a filter can never be empty.
  // filter(Boolean) kept the string "undefined", because a non-empty string
  // is truthy — which is how a pill reading "Undefined" reached Discover
  // between "Sports" and "Wine tasting". Ticketmaster sends that word for an
  // unclassified event. Guarded at the source too; guarded here as well
  // because any provider can send one and a nameless tab is a dead end.
  // Filtered before anything counts it, so "23 places nearby" is the number
  // of places you would actually be shown rather than the number we found.
  // Hiding at render time only would have left the count, the filters and
  // the "still learning your area" note all describing a different screen.
  const visible=allItems.filter(e=>!hidden.has(`${String(e.source||"unknown").toLowerCase()}:${e.id}`));

  const categories=visibleCategories(visible);
  const filters=["All",...categories];

  const shown=filter==="All"?visible:visible.filter(e=>e.category===filter);
  // Null while loading, not a second message. The spinner below already says
  // "Finding things near you…", and this box said "Finding what's on near
  // you…" directly underneath it — two ways of saying the same thing, at the
  // same time, in slightly different words.
  const emptyNote=loading?null
    :reason==="no_key"?"Event listings aren't switched on for this deployment yet."
    :reason==="no_location"?(geoAllowed
        ? "Your device hasn't said where it is. Pick a place above and we'll look there."
        : "Allow location in your browser to see what's on near you.")
    :reason==="provider_error"?"Couldn't reach the listings just now. Try again shortly."
    :visible.length===0?"Nothing close by just yet. Reach looks again every night."
    :null;

  const city=userLocation?.city||userLocation?.formatted;
  // Where this came from, because on a trip they are different places and
  // "near you" would be a claim we cannot make.
  // Choosing a place by name. Geocoded through the same service the app
  // already uses to name the place you are in, so the two agree.
  const [pickingPlace,setPickingPlace]=useState(false);
  const [placeQuery,setPlaceQuery]=useState("");
  const [placeHits,setPlaceHits]=useState([]);
  const [searchingPlace,setSearchingPlace]=useState(false);

  const searchPlaces=async(q)=>{
    const term=(q||"").trim();
    if(term.length<3){setPlaceHits([]);return;}
    setSearchingPlace(true);
    try{
      // Through our own server — see /api/geo. Called from the page this was
      // blocked by CORS in production, so Discover's place search never
      // returned anything at all.
      const r=await fetch("/api/geo?limit=6&q="+encodeURIComponent(term));
      if(!r.ok)throw new Error(String(r.status));
      const hits=(await r.json()).hits||[];
      setPlaceHits(hits.map(h=>({
        label:h.label,
        lat:h.lat, lng:h.lng,
      })).filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lng)));
    }catch(e){
      console.error("[discover] place search failed",e);
      toast("Couldn't search for that just now — try again in a moment");
    }
    setSearchingPlace(false);
  };

  const placePrefix=userLocation?.source==="override"?"Showing"
    :userLocation?.source==="home"?"Based on your home city,"
    :"Based on your location in";
  // Said once, under the filters, only when there is genuinely little here.
  // Not an error and not an apology: the sweep runs nightly and this fills in.
  const learningNote=!loading&&thin&&visible.length>0
    ?`We're still learning ${city||"your area"} — ${visible.length} ${visible.length===1?"place":"places"} so far, and more each night.`
    :null;

  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 10px"}}>
        <div className="pt">Discover</div>
        <PlaceLine userLocation={userLocation} setPlaceOverride={setPlaceOverride}
          toast={toast} prefix={placePrefix} fallback="Curated for you"/>
        {!userLocation&&(
          <div style={{fontSize:12,color:C.accentText,marginTop:4,cursor:"pointer"}}
            onClick={()=>toast(geoAllowed
              ? "Your device hasn't answered. Tap \u201cchange\u201d to pick a place."
              : "Enable location in your browser for local picks")}>
            📍 {geoAllowed?"Your device hasn't said where it is — pick a place":"Enable location for local recommendations"}
          </div>
        )}
        {/* An invitation, not a gate. Everything below works without it. */}
        {loaded&&!personal&&(
          <div style={{fontSize:12,color:C.accentText,marginTop:4,cursor:"pointer"}}
            onClick={()=>push("taste")}>
            A bit of everything near you. Tell us what you're into and it gets personal →
          </div>
        )}
      </div>

      {/* Filter pills */}
      <div style={{display:"flex",gap:8,padding:"0 20px 14px",overflowX:"auto",scrollbarWidth:"none"}}>
        {filters.map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            style={{padding:"6px 14px",borderRadius:20,
              border:"1px solid "+(filter===f?C.accentText:C.border),
              background:filter===f?C.accentDim:C.s1,
              color:filter===f?C.accentText:C.t2,
              fontSize:12,fontWeight:600,cursor:"pointer",
              whiteSpace:"nowrap",flexShrink:0}}>
            {f==="Nearby"&&userLocation?"📍 "+f:f}
          </button>
        ))}
      </div>

      {/* Nearby events strip (when location available) */}
      {userLocation&&localRecs.length>0&&filter==="All"&&(
        <div style={{marginBottom:16}}>
          <div style={{padding:"0 20px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:600,color:C.t3,textTransform:"uppercase",letterSpacing:".08em"}}>
              📍 Near you in {city}
            </span>
            <button onClick={()=>setFilter("Nearby")}
              style={{fontSize:12,color:C.accentText,background:"none",border:"none",cursor:"pointer"}}>
              See all →
            </button>
          </div>
          <div style={{display:"flex",gap:12,padding:"0 20px",overflowX:"auto",scrollbarWidth:"none",paddingBottom:4}}>
            {localRecs.slice(0,5).map((n,i)=>(
              <div key={i} style={{minWidth:160,background:C.s2,border:"1px solid "+C.border,
                borderRadius:16,padding:14,flexShrink:0,cursor:"pointer"}}
                onClick={()=>push("expDetail",{exp:{
                  id:"local_"+n.id,title:n.title,sub:n.meta,emoji:n.emoji,
                  price:n.price||null,category:n.category||"Event",tags:["Nearby"],
                  url:n.url||null,date:n.date||null,venue:n.venue||null,
                  bg:`linear-gradient(135deg,${C.accentDeep},${C.accent})`,
                  isLocal:true,
                },groups})}>
                <div style={{fontSize:28,marginBottom:6}}>{n.emoji}</div>
                <div style={{fontSize:13,fontWeight:600,color:C.t1,marginBottom:2,lineHeight:1.3}}>{n.title}</div>
                <div style={{fontSize:11,color:C.t2,lineHeight:1.4}}>{n.meta}</div>
                {n.dist&&<div style={{fontSize:11,color:C.accentText,marginTop:4}}>📍 {n.dist}</div>}
                {n.price&&<div style={{fontSize:12,fontWeight:600,color:C.t1,marginTop:4}}>{n.price}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading&&(
        <div style={{textAlign:"center",padding:"20px",color:C.t3,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <div style={{width:16,height:16,border:"2px solid "+C.accentText,borderTopColor:"transparent",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
          Finding things near you…
        </div>
      )}

      {learningNote&&(
        <div style={{margin:"0 20px 12px",padding:"11px 14px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:14,fontSize:12.5,color:C.t2,lineHeight:1.55}}>
          {learningNote}
        </div>
      )}
      {emptyNote&&shown.length===0&&(
        <div style={{margin:"0 20px",padding:"18px 16px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,fontSize:13,color:C.t2,lineHeight:1.6}}>
          <div>{emptyNote}</div>
          {!loading&&(
            <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
              {reason!=="no_key"&&(
                <button className="bsm" onClick={()=>{setLoaded(false);setLocalRecs([]);loadLocalRecs();}}>
                  Look again
                </button>
              )}
              <button className="bsm bsm-p" onClick={()=>push("createPlan",{})}>
                Plan something instead →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main cards */}
      {/* Undo, because a dismissal is only as safe as the way back from a
          mistap. The row is deleted rather than reversed, so the place is
          offered again exactly as though nothing had been said. */}
      {undo&&(
        <div style={{margin:"0 20px 12px",padding:"11px 14px",background:C.s2,
          border:`1px solid ${C.border}`,borderRadius:14,display:"flex",
          alignItems:"center",gap:10}}>
          <div style={{flex:1,fontSize:12.5,color:C.t2,lineHeight:1.4}}>
            {undo.verdict==="done"
              ?`${undo.title} is marked as one you've done.`
              :`We won't suggest ${undo.title} again.`}
          </div>
          <button onClick={undoRule}
            style={{border:"none",background:"none",fontSize:12.5,fontWeight:700,
              color:C.accentText,cursor:"pointer",whiteSpace:"nowrap"}}>
            Undo
          </button>
        </div>
      )}
      {shown.map(exp=>(
        /* Named, so it can be found. These were anonymous divs, which is why
           the end-to-end test for "clicking a card opens the detail view"
           matched nothing and passed without ever clicking one. */
        <div key={exp.id} className="exp-card" style={{margin:"0 20px 14px",borderRadius:20,overflow:"hidden",
          border:"1px solid "+C.border,cursor:"pointer",position:"relative"}}
          onClick={()=>push("expDetail",{exp,groups})}>
          {/* A real picture of the actual place where there is one. The
              gradient stays underneath, so a photo that fails to load leaves
              the card as it always looked rather than a white gap, and the
              dark overlay above keeps the title readable on any image. */}
          <div style={{height:175,background:exp.bg,position:"relative",
            ...(exp.image?{backgroundImage:`url(${JSON.stringify(exp.image).slice(1,-1)})`,
              backgroundSize:"cover",backgroundPosition:"center"}:{})}}>
            <div style={{position:"absolute",inset:0,
              background:"linear-gradient(to bottom,transparent 30%,rgba(0,0,0,.85))",
              display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:16}}>
              <div style={{fontFamily:"var(--font-display)",fontSize:22,color:"white",marginBottom:3}}>
                {exp.title}
              </div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.65)"}}>{exp.sub}</div>
            </div>
            <div style={{position:"absolute",top:12,right:14,fontSize:34}}>{exp.emoji}</div>
            {/* Bottom-right, over the dark end of the gradient. It used to
                sit at top-right, exactly where the emoji is, so the control
                covered the one picture the card had. The corners are spoken
                for: chips top-left, emoji top-right, title bottom-left. */}
            <button aria-label={`Hide ${exp.title}`}
              onClick={e=>{e.stopPropagation();setAsking(a=>a===exp.id?null:exp.id);}}
              style={{position:"absolute",bottom:12,right:12,zIndex:3,width:28,height:28,
                borderRadius:14,border:"1px solid rgba(255,255,255,.28)",
                background:"rgba(0,0,0,.42)",backdropFilter:"blur(6px)",color:"rgba(255,255,255,.92)",
                fontSize:14,lineHeight:1,cursor:"pointer",display:"flex",
                alignItems:"center",justifyContent:"center",padding:0}}>×</button>
            {asking===exp.id&&(
              <div onClick={e=>e.stopPropagation()}
                style={{position:"absolute",bottom:46,right:12,zIndex:4,background:C.s1,
                  border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden",
                  minWidth:168,boxShadow:"0 10px 28px rgba(0,0,0,.22)"}}>
                <button onClick={()=>rule(exp,"done")}
                  style={{display:"block",width:"100%",textAlign:"left",padding:"11px 14px",
                    border:"none",background:"none",fontSize:13,color:C.t1,cursor:"pointer"}}>
                  Already done it
                </button>
                <button onClick={()=>rule(exp,"not_interested")}
                  style={{display:"block",width:"100%",textAlign:"left",padding:"11px 14px",
                    borderTop:`1px solid ${C.border}`,border:"none",background:"none",
                    fontSize:13,color:C.t1,cursor:"pointer"}}>
                  Not for me
                </button>
              </div>
            )}
            {/* What is happening says which day. What is simply open says
                where it is and nothing about hours, because nobody has
                checked them and "open any time" would be a promise. */}
            <div style={{position:"absolute",top:12,left:14,display:"flex",gap:6,flexWrap:"wrap",maxWidth:"72%"}}>
              {/* A chip among the other chips rather than a badge floating
                  over them. Marked, not removed: somewhere you have been
                  stays on the screen saying so. */}
              {visited.has(`${String(exp.source||"unknown").toLowerCase()}:${exp.id}`)&&(
                <span style={{background:"rgba(0,0,0,.72)",borderRadius:20,padding:"3px 10px",
                  fontSize:11,color:"white",fontWeight:600}}>
                  ✓ You've been
                </span>
              )}
              {dayLabel(exp.date)&&(
                <span style={{background:"rgba(0,0,0,.72)",borderRadius:20,padding:"3px 10px",
                  fontSize:11,color:"white",fontWeight:600}}>
                  {dayLabel(exp.date)}
                </span>
              )}
              {exp.isLocal&&exp.dist&&(
                <span style={{background:"rgba(0,0,0,.6)",borderRadius:20,padding:"3px 10px",
                  fontSize:11,color:"white"}}>
                  📍 {exp.dist}
                </span>
              )}
            </div>
          </div>
          <div style={{background:C.s1,padding:"12px 16px",display:"flex",
            justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontFamily:"var(--font-display)",fontSize:20,color:exp.price?C.t1:C.t2}}>
                {/* Ticketmaster is no longer the only place this came from,
                    so the card stopped naming it as though it were. */}
                {exp.price||(exp.provider==="ticketmaster"?"Price on Ticketmaster":"Price at the door")}
              </div>
              <div style={{fontSize:11,color:C.t2}}>
                {exp.because?`Because you like ${String(exp.because).toLowerCase()}`
                  :exp.isLocal?"Near you":"per person, all-in"}
              </div>
            </div>
            {/* This used to be a "Share with group" button whose entire
                handler was a toast saying it had been shared. The screen
                that actually shares is one tap away and always has been. */}
            <button className="bsm bsm-p"
              onClick={e=>{e.stopPropagation();push("expDetail",{exp,groups});}}>
              Take a look →
            </button>
          </div>
        </div>
      ))}

      {!loading&&sources.some(s=>s.status==="error")&&shown.length>0&&(
        <div style={{margin:"0 20px 14px",padding:"10px 14px",background:C.s2,
          border:`1px solid ${C.border}`,borderRadius:14,fontSize:12,color:C.t3,lineHeight:1.5}}>
          One of our sources isn't answering, so there may be more on than this.
        </div>
      )}

      {shown.length===0&&!loading&&!emptyNote&&(
        <div style={{textAlign:"center",padding:"40px 20px",color:C.t3,fontSize:14}}>
          Nothing under {filter}. Try another one.
        </div>
      )}

      <div style={{height:20}}/>
    </div>
  );
}

// ─── EXPERIENCE DETAIL ───────────────────────────────────────────────────────
function ExpDetailScreen({onBack,exp,groups,push,toast,updateGroup,savePlanToServer}){
  const [planPicker,setPlanPicker]=useState(false);
  const [saving,setSaving]=useState(false);
  const [quizDone,setQuizDone]=useState(false);
  const [booking,setBooking]=useState(false);
  const [bookStep,setBookStep]=useState(0); // 0=details 1=confirm 2=done
  const [bookDate,setBookDate]=useState("");
  const [bookTime,setBookTime]=useState("");
  const [bookGuests,setBookGuests]=useState("2");
  const [bookNotes,setBookNotes]=useState("");
  // Handing someone to Ticketmaster is where a one-stop shop stops being one.
  // We cannot take that payment, but we can close the loop: when they come
  // back, ask whether it happened and put it where the rest of their plans
  // live, so nobody is keeping half their trip in a confirmation email.
  const [bookedPlan,setBookedPlan]=useState(null);
  const [sentOff,setSentOff]=useState(false);
  const [askIfBooked,setAskIfBooked]=useState(false);
  useEscape(planPicker,()=>setPlanPicker(false));
  useEscape(booking,()=>{setBooking(false);setBookStep(0);});
  useEscape(askIfBooked,()=>setAskIfBooked(false));
  useEffect(()=>{
    if(!sentOff)return;
    const onBack2=()=>{if(!document.hidden)setAskIfBooked(true);};
    document.addEventListener("visibilitychange",onBack2);
    return()=>document.removeEventListener("visibilitychange",onBack2);
  },[sentOff]);

  // Detect what type of experience this is
  const isLocal=exp.isLocal||exp.tags?.includes("Nearby");
  // A real event knows when it happens. Asking for a date, and then storing
  // today's instead, was the bug: exp.date is the ISO date the API returns.
  const fixedDate=exp.date||null;
  const isRestaurant=exp.category==="Restaurant"||exp.title?.toLowerCase().includes("restaurant")||exp.title?.toLowerCase().includes("dinner")||exp.title?.toLowerCase().includes("brunch");
  const isConcert=exp.category==="Concert"||exp.category==="Music"||exp.tags?.includes("Concerts");
  const isBar=exp.category==="Bar"||exp.title?.toLowerCase().includes("bar")||exp.title?.toLowerCase().includes("rooftop");

  const getType=()=>{
    if(isRestaurant)return"restaurant";
    if(isConcert)return"concert";
    return"restaurant"; // default for local experiences
  };

  const getIncludes=()=>{
    if(isRestaurant)return["🍽️ Dinner & drinks","👥 Group reservation","📍 "+exp.sub?.split("·").pop()?.trim()];
    if(isConcert)return["🎵 Live music","🎫 Tickets","📍 "+exp.sub?.split("·").pop()?.trim()];
    if(isBar)return["🍹 Drinks & vibes","📍 "+exp.sub?.split("·").pop()?.trim(),"🌙 Evening out"];
    return["🎯 Full experience","👥 Group booking","📍 "+exp.sub?.split("·").pop()?.trim()];
  };

  // Add this experience directly to a group as a plan
  const addToGroup=async(group)=>{
    setSaving(true);
    const today=new Date();
    const eventDateStr=fixedDate?formatDates(fixedDate):(exp.meta?.split("·")[0]?.trim()||"");
    const np={
      id:"p"+Date.now(),
      title:exp.title,
      status:"planning",
      dates:eventDateStr||(bookDate||today.toISOString().split("T")[0])+(bookTime?" at "+bookTime:""),
      startDate:fixedDate||bookDate||today.toISOString().split("T")[0],
      endDate:null,
      budget:parseInt((exp.price||"0").replace(/[^0-9]/g,""))||0,
      type:getType(),
      participants:group.memberIds||[],
      itinerary:[{
        time:exp.meta?.split("·")[0]?.trim()||"",
        title:exp.title,
        sub:exp.sub||"",
        type:isRestaurant?"restaurant":isConcert?"activity":"activity",
        conf:null,filled:false,
      }],
      votes:{},options:[],
      fromDiscover:true,
      expData:exp,
    };
    updateGroup(group.id,g=>({...g,plans:[...g.plans,np]}));
    const _sp1=savePlanToServer?savePlanToServer(group.id,np):Promise.resolve(null);
    setSaving(false);
    setPlanPicker(false);
    toast(exp.title+" added to "+group.name+" 🎉");
    _sp1.then(_rid=>push("planDetail",{planId:_rid||np.id,groupId:group.id})).catch(()=>push("planDetail",{planId:np.id,groupId:group.id}));
  };

  // "Confirm Booking Request" used to call setBookStep(2) and a toast. That
  // was the whole implementation. The screen then told the traveller their
  // request had been sent to the venue, that a card would be charged on
  // confirmation, that it was in their calendar and that the group had been
  // told — none of which had happened or could happen. Somebody could have
  // turned up at a restaurant on the strength of it.
  //
  // It now does what it says: the reservation becomes a real plan they can
  // open, and a concierge booking record the team can act on.
  const [submitting,setSubmitting]=useState(false);
  const submitBooking=async(group)=>{
    if(submitting)return;
    setSubmitting(true);
    const when=fixedDate||bookDate||new Date().toISOString().split("T")[0];
    const np={
      id:"p"+Date.now(),
      title:exp.title,
      status:"planning",
      dates:formatDates(when)+(bookTime?" at "+bookTime:""),
      startDate:when,endDate:null,
      budget:parseInt((exp.price||"0").replace(/[^0-9]/g,""))||0,
      type:getType(),
      participants:group.memberIds||[],
      itinerary:[{
        time:bookTime||exp.meta?.split("·")[0]?.trim()||"",
        title:exp.title,sub:exp.sub||"",
        type:isRestaurant?"restaurant":"activity",
        conf:null,filled:false,
        booking_mode:"reach",
        payment_note:bookNotes||"",
      }],
      votes:{},options:[],fromDiscover:true,expData:exp,
    };
    updateGroup(group.id,g=>({...g,plans:[...g.plans,np]}));
    let planId=np.id;
    try{
      planId=(savePlanToServer?await savePlanToServer(group.id,np):null)||np.id;
      if(!isTempId(planId)){
        const r=await fetch("/api/bookings",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({planId,items:[{vertical:"restaurant",restaurant:{
            name:exp.title,city:exp.city||exp.sub||"",date:when,
            time:bookTime||"19:00",
            partySize:bookGuests==="8+"?8:(parseInt(bookGuests)||2),
            notes:bookNotes||undefined,externalUrl:exp.url||undefined,
          }}]}),
        });
        if(!r.ok)console.error("[expDetail] booking request failed",r.status,await r.text().catch(()=>""));
      }
    }catch(e){console.error("[expDetail] booking request failed",e);}
    setBookedPlan({planId,groupId:group.id,groupName:group.name});
    setSubmitting(false);
    setBookStep(2);
  };

  return(
    <div className="sc" style={{paddingBottom:0}}>
      {/* Header */}
      <div style={{height:200,background:exp.bg||`linear-gradient(135deg,#1a1060,${C.accent})`,position:"relative",flexShrink:0}}>
        <ScreenHeader onBack={onBack} overlay/>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.9))",display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:20}}>
          <div style={{fontSize:40,marginBottom:8}}>{exp.emoji||"🎯"}</div>
          <div style={{fontFamily:"var(--font-display)",fontSize:24,color:"white",lineHeight:1.2}}>{exp.title}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginTop:4}}>{exp.sub}</div>
        </div>
        {exp.dist&&(
          <div style={{position:"absolute",top:16,right:16,background:"rgba(0,0,0,.5)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"white"}}>
            📍 {exp.dist}
          </div>
        )}
      </div>

      <div style={{padding:20,overflowY:"auto",flex:1}}>
        {/* Price + type */}
        <div style={{display:"flex",gap:10,marginBottom:20}}>
          <div style={{flex:1,background:C.s2,borderRadius:14,padding:14,border:"1px solid "+C.border}}>
            <div style={{fontSize:11,color:C.t3,marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>Price</div>
            <div style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1}}>{exp.price||"—"}</div>
            <div style={{fontSize:11,color:C.t2}}>per person</div>
          </div>
          <div style={{flex:1,background:C.s2,borderRadius:14,padding:14,border:"1px solid "+C.border}}>
            <div style={{fontSize:11,color:C.t3,marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>Type</div>
            <div style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1}}>{exp.category||exp.tags?.[0]||"Experience"}</div>
            <div style={{fontSize:11,color:C.t2}}>{exp.sub?.split("·")[0]?.trim()}</div>
          </div>
        </div>

        {/* What to expect */}
        <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>What to expect</div>
        {getIncludes().map((it,i)=>(
          <div key={i} style={{fontSize:13,color:C.t2,padding:"6px 0",borderBottom:i<getIncludes().length-1?"1px solid "+C.border:"none"}}>
            {it}
          </div>
        ))}

        <div style={{height:1,background:C.border,margin:"20px 0"}}/>

        {/* A real event carries the link that actually sells the ticket.
            Ticketmaster's booking API is invite-only, so the purchase and the
            confirmation happen on their site — the button says so rather than
            implying Reach takes the payment. The in-app form below is for
            restaurants, which Reach does handle. */}
        {exp?.url?(()=>{
          // Whose link this is, said correctly. The condition used to be
          // "has a url", so a wine bar found on Yelp — a place you walk into
          // — was offered as "Get tickets", with "Tickets are sold by
          // Ticketmaster" underneath. Nobody sells tickets to a wine bar,
          // and sending somebody off expecting a checkout that does not
          // exist is worse than saying nothing.
          const ticketed=exp.provider==="ticketmaster";
          const seller=ticketed?"Ticketmaster":null;
          return(
          <>
            <button className="bp" style={{marginBottom:8,width:"100%",background:`linear-gradient(135deg,${C.accentDeep},${C.accent})`}}
              onClick={()=>{
                window.open(exp.url,"_blank","noopener,noreferrer");
                setSentOff(true);
                toast(seller?`Handing you over to ${seller}`:"Opening their page");
              }}>
              {ticketed?"🎟️ Get tickets":"🔗 See their page"}
            </button>
            <div style={{fontSize:11.5,color:C.t3,marginBottom:12,lineHeight:1.5,textAlign:"center"}}>
              {ticketed
                ?"Tickets are sold by Ticketmaster. You'll pay and get your confirmation there."
                :"Opens their own page. Hours and prices are theirs, not ours."}
            </div>
          </>
          );
        })():(
          <button className="bp" style={{marginBottom:10,width:"100%",background:`linear-gradient(135deg,${C.accentDeep},${C.accent})`}}
            onClick={()=>setBooking(true)}>
            🎯 Book Now
          </button>
        )}
        {/* The one real way to put this in front of people: it becomes a
            plan in the group, which everybody can open. The button beside
            it used to say "Share with a Group" and only showed a toast. */}
        <button className="bs" style={{marginBottom:10,width:"100%"}}
          onClick={()=>setPlanPicker(true)}>
          ➕ Put this in front of a group
        </button>

      </div>

      {/* Welcome back — did that actually happen? */}
      {askIfBooked&&!planPicker&&(
        <div className="ov" onClick={()=>setAskIfBooked(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div style={{padding:"18px 20px 24px",textAlign:"center"}}>
              <div style={{fontSize:30,marginBottom:10}}>🎟️</div>
              <div style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1,marginBottom:6}}>
                Did you get them?
              </div>
              <div style={{fontSize:13.5,color:C.t2,lineHeight:1.6,marginBottom:18}}>
                If you did, we'll put {exp.title} alongside everything else you
                have planned, so it isn't living in an email on its own.
              </div>
              <button className="bp" style={{width:"100%",marginBottom:8}}
                onClick={()=>{setAskIfBooked(false);setSentOff(false);setPlanPicker(true);}}>
                Got them — add to a plan
              </button>
              <button className="bs" style={{width:"100%"}}
                onClick={()=>{setAskIfBooked(false);setSentOff(false);}}>
                Not yet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to group picker */}
      {planPicker&&(
        <div className="ov" onClick={()=>setPlanPicker(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div className="sh-hdr">
              <span className="sh-ttl">Add to which group?</span>
              <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2}} onClick={()=>setPlanPicker(false)}><Ic.X/></button>
            </div>
            <div style={{padding:"0 0 12px",fontSize:13,color:C.t2}}>
              This creates a plan in the group so everyone can see it and RSVP.
            </div>
            {groups.length===0&&(
              <div style={{textAlign:"center",padding:"20px 0",color:C.t3,fontSize:13}}>
                No groups yet. Create a group first.
              </div>
            )}
            {groups.map(g=>(
              <div key={g.id} className="ri" {...pressable} onClick={()=>!saving&&addToGroup(g)}
                style={{opacity:saving?.6:1,cursor:saving?"not-allowed":"pointer"}}>
                <div className="ri-ic" style={{background:C.s3,fontSize:20}}>{g.emoji}</div>
                <div className="ri-inf">
                  <div className="ri-t">{g.name}</div>
                  <div className="ri-s">{g.memberIds?.length||0} members</div>
                </div>
                {saving?<div style={{fontSize:12,color:C.t3}}>Adding…</div>:<Ic.ChevR/>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Book Now sheet */}
      {booking&&(
        <div className="ov" onClick={()=>{setBooking(false);setBookStep(0);}}>
          <div className="sh" onClick={e=>e.stopPropagation()} style={{maxHeight:"85vh",overflowY:"auto"}}>
            <div className="sh-hdl"/>
            {bookStep===0&&(
              <>
                <div className="sh-hdr">
                  <span className="sh-ttl">Book {exp.title}</span>
                  <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2}} onClick={()=>{setBooking(false);setBookStep(0);}}><Ic.X/></button>
                </div>
                <div style={{padding:"0 0 8px"}}>
                  <div style={{background:C.accentDim,border:"1px solid "+C.accentBorder,borderRadius:14,padding:14,marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:28}}>{exp.emoji||"🎯"}</span>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:C.t1}}>{exp.title}</div>
                      <div style={{fontSize:12,color:C.t2}}>{exp.sub}</div>
                      {exp.price&&<div style={{fontSize:13,color:C.accentText,fontWeight:600,marginTop:2}}>{exp.price} per person</div>}
                    </div>
                  </div>

                  {fixedDate?(
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>When</div>
                      <div style={{padding:"14px 16px",background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,fontSize:14,color:C.t1}}>
                        {formatDates(fixedDate)}
                      </div>
                    </div>
                  ):(
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Date</div>
                      <input aria-label="Date you booked" type="date" className="inp" value={bookDate}
                        min={new Date().toISOString().split("T")[0]}
                        onChange={e=>setBookDate(e.target.value)} style={{color:C.t1}}/>
                    </div>
                  )}

                  {(isRestaurant||isBar)&&(
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Time</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {["6:00 PM","6:30 PM","7:00 PM","7:30 PM","8:00 PM","8:30 PM","9:00 PM"].map(t=>(
                          <button key={t} onClick={()=>setBookTime(t)}
                            style={{padding:"8px 14px",borderRadius:20,border:"1px solid "+(bookTime===t?C.accentText:C.border),
                              background:bookTime===t?C.accentDim:C.s2,color:bookTime===t?C.accentText:C.t2,
                              fontSize:13,cursor:"pointer"}}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Party size</div>
                    <div style={{display:"flex",gap:8}}>
                      {["1","2","3","4","5","6","7","8+"].map(n=>(
                        <button key={n} onClick={()=>setBookGuests(n)}
                          style={{width:40,height:40,borderRadius:10,border:"1px solid "+(bookGuests===n?C.accentText:C.border),
                            background:bookGuests===n?C.accentDim:C.s2,color:bookGuests===n?C.accentText:C.t2,
                            fontSize:14,fontWeight:600,cursor:"pointer"}}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Special requests (optional)</div>
                    <input aria-label="Anything worth remembering" className="inp" value={bookNotes} onChange={e=>setBookNotes(e.target.value)}
                      placeholder="Allergies, celebrations, seating preferences..."/>
                  </div>

                  <button className="bp" style={{width:"100%",marginBottom:8}}
                    disabled={(!fixedDate&&!bookDate)||(isRestaurant&&!bookTime)}
                    onClick={()=>setBookStep(1)}>
                    Continue →
                  </button>
                </div>
              </>
            )}

            {bookStep===1&&(
              <>
                <div className="sh-hdr">
                  <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2,fontSize:13}} onClick={()=>setBookStep(0)}>← Back</button>
                  <span className="sh-ttl">Confirm booking</span>
                  <div style={{width:48}}/>
                </div>
                <div style={{padding:"0 0 8px"}}>
                  {/* Booking summary */}
                  <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:14,padding:16,marginBottom:16}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.t1,marginBottom:12}}>{exp.title}</div>
                    {[
                      {l:"📅 Date",v:bookDate?new Date(bookDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}):"—"},
                      bookTime?{l:"🕐 Time",v:bookTime}:null,
                      {l:"👥 Party",v:bookGuests==="8+"?"8+ people":plural(parseInt(bookGuests)||2,"person","people")},
                      {l:"💰 Total est.",v:exp.price&&bookGuests?((parseInt(exp.price.replace(/[^0-9]/g,""))||0)*(parseInt(bookGuests)||2))>0?"$"+((parseInt(exp.price.replace(/[^0-9]/g,""))||0)*(parseInt(bookGuests)||2))+" est.":"—":"—"},
                      bookNotes?{l:"📝 Notes",v:bookNotes}:null,
                    ].filter(Boolean).map((row,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:i?"1px solid "+C.border:"none"}}>
                        <div style={{fontSize:13,color:C.t2}}>{row.l}</div>
                        <div style={{fontSize:13,color:C.t1,fontWeight:500,textAlign:"right",maxWidth:"55%"}}>{row.v}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{background:"rgba(108,99,255,.08)",border:"1px solid "+C.accentBorder,borderRadius:12,padding:12,marginBottom:16,fontSize:12,color:C.t2,lineHeight:1.6}}>
                    💡 Reach takes it from here and confirms with {exp.title}. It lands in your plans straight away, so you can see it whatever happens. Nothing is charged until it's confirmed.
                  </div>

                  {groups.length===0?(
                    <>
                      <div style={{fontSize:12.5,color:C.t2,lineHeight:1.6,marginBottom:12,textAlign:"center"}}>
                        Your bookings live inside a plan. Make one first — it takes a moment, and you can go solo.
                      </div>
                      <button className="bp" style={{width:"100%",marginBottom:8}}
                        onClick={()=>{setBooking(false);setBookStep(0);push("createGroup");}}>
                        Set that up →
                      </button>
                    </>
                  ):groups.length===1?(
                    <button className="bp" style={{width:"100%",marginBottom:8}} disabled={submitting}
                      onClick={()=>submitBooking(groups[0])}>
                      {submitting?"Sending…":"✓ Send this to Reach"}
                    </button>
                  ):(
                    <>
                      <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Put it with</div>
                      {groups.map(g=>(
                        <button key={g.id} className="bp" disabled={submitting}
                          style={{width:"100%",marginBottom:8,display:"flex",alignItems:"center",gap:10,justifyContent:"center"}}
                          onClick={()=>submitBooking(g)}>
                          <span>{g.emoji}</span>{submitting?"Sending…":g.name}
                        </button>
                      ))}
                    </>
                  )}
                  <button className="bs" style={{width:"100%"}} onClick={()=>setBookStep(0)}>Edit details</button>
                </div>
              </>
            )}

            {bookStep===2&&(
              <div style={{padding:"20px 0 30px",textAlign:"center"}}>
                <div style={{fontSize:60,marginBottom:16}}>🎉</div>
                {/* "We're on it" said Reach was doing something. Reach is
                    not: there is no confirmation path in this codebase and
                    nobody rings a venue. What actually happened is that it
                    was saved, which is worth saying plainly and is not the
                    same claim. */}
                <div style={{fontFamily:"var(--font-display)",fontSize:26,color:C.t1,marginBottom:8}}>Saved to your plans</div>
                <div style={{fontSize:14,color:C.t2,lineHeight:1.7,marginBottom:24}}>
                  {exp.title}, {formatDates(fixedDate||bookDate)}{bookTime?" at "+bookTime:""}, {bookGuests==="8+"?"8+ people":plural(parseInt(bookGuests)||2,"person","people")}. It's saved in {bookedPlan?.groupName||"your plans"} — open it whenever you like.
                </div>
                <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:14,padding:14,marginBottom:20,textAlign:"left"}}>
                  {/* Only things that actually happen. This list used to
                      promise a calendar entry and an automatic group
                      notification, neither of which exists. */}
                  <div style={{fontSize:12,color:C.t3,marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>What happens next</div>
                  {/* The middle line used to read "Someone at Reach confirms
                      it with the venue". Nobody does. There is no
                      confirmation path in this codebase — the request is
                      written as a pending row and sits there — so it
                      promised a person who does not exist, on the screen
                      somebody reads before walking away satisfied.
                      The link below is the thing that actually books it. */}
                  {["📋 It's in your plans already — nothing to keep track of",
                    "🤙 The booking itself is yours to make — the link is below",
                    "💳 Reach charges you nothing for this"].map((s,i)=>(
                    <div key={i} style={{fontSize:13,color:C.t2,padding:"4px 0"}}>{s}</div>
                  ))}
                </div>
                {/* Where it is actually booked. Every venue we hold carries
                    its own address, and until now not one of them reached a
                    screen — so somebody was told it was handled, and given
                    nothing to handle it with. */}
                {exp?.url&&(
                  <a href={exp.url} target="_blank" rel="noopener noreferrer"
                    className="bp" style={{width:"100%",marginBottom:8,display:"block",textAlign:"center",textDecoration:"none"}}>
                    Book it{exp.venue?` at ${exp.venue}`:""} →
                  </a>
                )}
                {bookedPlan&&(
                  <button className="bp" style={{width:"100%",marginBottom:8,background:"none",border:`1px solid ${C.border}`,color:C.t1}}
                    onClick={()=>{setBooking(false);setBookStep(0);push("planDetail",{planId:bookedPlan.planId,groupId:bookedPlan.groupId});}}>
                    Open the plan →
                  </button>
                )}
                <button className="bs" style={{width:"100%"}} onClick={()=>{setBooking(false);setBookStep(0);onBack();}}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── GROUPS LIST ─────────────────────────────────────────────────────────────
/**
 * A group row you can swipe to delete.
 *
 * Deleting a group takes its trips with it, so it asks twice: the swipe
 * reveals the word, and the word has to be pressed before anything happens.
 * The confirmation is in the row rather than a dialog over the screen —
 * a sheet that covers what you are deleting is a sheet you can agree to
 * without looking at it.
 *
 * Touch only for the gesture, with a visible control once it is open, so it
 * works on a trackpad and to a screen reader as well as to a thumb.
 */
function SwipeToDelete({group,onDelete,children}){
  const [dx,setDx]=useState(0);
  const [asking,setAsking]=useState(false);
  const [busy,setBusy]=useState(false);
  const start=useRef(null);
  const WIDTH=96;                       // how far it opens

  const onTouchStart=e=>{ start.current=e.touches[0].clientX; };
  const onTouchMove=e=>{
    if(start.current==null)return;
    const moved=e.touches[0].clientX-start.current;
    // Left only. A right-swipe on a list is the browser's back gesture on
    // some platforms and not ours to take.
    setDx(Math.max(-WIDTH,Math.min(0,moved)));
  };
  const onTouchEnd=()=>{
    // Past a third of the way opens it; anything less snaps shut, so a
    // scroll that drifted sideways does not leave a delete button sitting
    // open under somebody's thumb.
    setDx(d=>d<-WIDTH/3?-WIDTH:0);
    start.current=null;
  };

  const confirm=async()=>{
    setBusy(true);
    const gone=await onDelete(group.id);
    // On failure the row comes back rather than vanishing optimistically:
    // the server refuses when a trip is holding a booking, and a row that
    // disappeared and returned would read as a bug rather than a refusal.
    setBusy(false);
    if(!gone){ setAsking(false); setDx(0); }
  };

  return(
    <div style={{position:"relative",margin:"0 20px 12px",overflow:"hidden",borderRadius:20}}>
      {/* Behind the card. Only reachable once the row is open. */}
      <div style={{position:"absolute",inset:0,display:"flex",justifyContent:"flex-end",alignItems:"stretch"}}>
        {asking
          ?<div style={{display:"flex",alignItems:"center",gap:8,padding:"0 14px",background:C.s1,width:"100%",justifyContent:"flex-end"}}>
            <span style={{fontSize:12.5,color:C.t2,marginRight:"auto"}}>Delete {group.name} and its trips?</span>
            <button onClick={()=>{setAsking(false);setDx(0);}} disabled={busy}
              style={{background:"none",border:`1px solid ${C.border}`,color:C.t2,fontSize:12.5,fontWeight:600,padding:"7px 12px",borderRadius:999}}>
              Keep it</button>
            <button onClick={confirm} disabled={busy}
              style={{background:C.red,border:"none",color:"#fff",fontSize:12.5,fontWeight:700,padding:"7px 12px",borderRadius:999,opacity:busy?.6:1}}>
              {busy?"…":"Delete"}</button>
          </div>
          :<button aria-label={`Delete ${group.name}`} onClick={()=>setAsking(true)}
            style={{width:WIDTH,background:C.red,border:"none",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Delete</button>}
      </div>
      <div style={{transform:`translateX(${asking?-9999:dx}px)`,transition:start.current==null?"transform .18s ease":"none",
        visibility:asking?"hidden":"visible"}}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {children}
      </div>
    </div>
  );
}

function GroupsScreen({groups,um,push,loading,onDeleteGroup}){
  // Two different questions, and they want two different orders. "What is
  // next" is a date, and it belongs at the top where it can be answered at a
  // glance. "Which group was that" is a name, and a list you search by name
  // has to be in name order to be searchable at all.
  const todayISO=today();
  const [month,setMonth]=useState(monthOf(todayISO));
  // The calendar pages backwards as well as forwards, so it draws every dated
  // plan rather than only what is ahead — a month you cannot see last week in
  // is not a month. A day before all of them lets the same helper gather and
  // order them.
  const dated=groupSchedule(groups,"0000-01-01",500);
  const weeks=monthGrid(month,todayISO);
  // The grid opens on this month. A trip in October drew nothing in
  // September, and a blank month read as "you have nothing planned" to
  // somebody with a trip three weeks out. So a month with nothing on it says
  // what is next, and takes you there.
  const monthEmpty=weeks.every(w=>weekBars(dated,w).length===0);
  const next=monthEmpty?nextAfter(dated,weeks,todayISO):null;
  const named=[...groups].sort(byName);
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div><div className="pt">Your trips</div><div style={{fontSize:13,color:C.t2,marginTop:2}}>Solo and together</div></div>
        <button className="bsm bsm-p" onClick={()=>push("createGroup")}>+ New</button>
      </div>
      {/* With no groups this screen rendered a heading and nothing else — a
          blank page on the tab a new person opens first. */}
      {loading&&groups.length===0&&(
        <div style={{padding:"20px",display:"flex",alignItems:"center",gap:10,color:C.t2,fontSize:13}}>
          <div style={{width:16,height:16,border:`2px solid ${C.accentText}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
          Loading your groups…
        </div>
      )}
      {!loading&&groups.length===0&&(
        <div style={{margin:"0 20px",padding:"32px 24px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:20,textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>👋</div>
          <div style={{fontSize:16,fontWeight:600,color:C.t1,marginBottom:6}}>No groups yet</div>
          <div style={{fontSize:13,color:C.t2,lineHeight:1.6,marginBottom:20}}>
            A group is whoever you travel with — family, the usual suspects, or just you.
            Reach plans around what everybody actually wants, not the loudest voice.
          </div>
          <button className="bp" onClick={()=>push("createGroup")}>Start a group</button>
          <div style={{fontSize:12,color:C.t3,marginTop:14,lineHeight:1.5}}>
            Going solo? Make one anyway. Nobody has to vote against you.
          </div>
        </div>
      )}
      {/* A month at a glance. A list says what is next; a calendar says what
          the month looks like — that two trips overlap, that the weekend after
          next is still free. Those are shapes, and a list cannot show one. */}
      {groups.length>0&&(
        <div style={{margin:"0 20px 18px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <span className="sl">Coming up</span>
            <div style={{display:"flex",alignItems:"center",gap:2}}>
              <button aria-label="Previous month" onClick={()=>setMonth(m=>addMonths(m,-1))}
                style={{background:"none",border:"none",color:C.t2,fontSize:17,lineHeight:1,cursor:"pointer",padding:"5px 9px",borderRadius:8}}>‹</button>
              <span style={{fontSize:12.5,color:C.t1,minWidth:108,textAlign:"center"}}>{monthLabel(month)}</span>
              <button aria-label="Next month" onClick={()=>setMonth(m=>addMonths(m,1))}
                style={{background:"none",border:"none",color:C.t2,fontSize:17,lineHeight:1,cursor:"pointer",padding:"5px 9px",borderRadius:8}}>›</button>
            </div>
          </div>
          <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",padding:"9px 0 5px"}}>
              {["S","M","T","W","T","F","S"].map((d,i)=>(
                <div key={i} style={{fontSize:10,color:C.t3,textAlign:"center",letterSpacing:".05em"}}>{d}</div>
              ))}
            </div>
            {weeks.map(week=>{
              const bars=weekBars(dated,week);
              const lanes=bars.length?Math.max(...bars.map(b=>b.lane))+1:0;
              return(
                <div key={week[0].day} style={{borderTop:`1px solid ${C.border}`,padding:"5px 0 7px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
                    {week.map(d=>(
                      <div key={d.day} style={{textAlign:"center",fontSize:11,padding:"1px 0",
                        color:d.isToday?C.accentText:d.inMonth?C.t2:C.t3,fontWeight:d.isToday?700:400}}>
                        {Number(d.day.slice(8))}
                      </div>
                    ))}
                  </div>
                  {/* Blocks sit over the week rather than inside a day, so a
                      trip runs across the days it actually covers. */}
                  <div style={{position:"relative",height:lanes?lanes*16:2,marginTop:3}}>
                    {bars.map(b=>(
                      <div key={b.plan.id} {...pressable}
                        onClick={()=>push("planDetail",{planId:b.plan.id,groupId:b.group.id})}
                        title={`${b.plan.title} — ${b.group.name}`}
                        style={{position:"absolute",top:b.lane*16,
                          left:`calc(${(b.col/7)*100}% + 2px)`,width:`calc(${(b.span/7)*100}% - 4px)`,
                          height:14,lineHeight:"14px",cursor:"pointer",
                          background:C.accentDim,color:C.accentText,
                          borderRadius:4,
                          borderTopLeftRadius:b.fromEarlier?0:4,borderBottomLeftRadius:b.fromEarlier?0:4,
                          borderTopRightRadius:b.toLater?0:4,borderBottomRightRadius:b.toLater?0:4,
                          fontSize:9.5,padding:"0 4px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {b.group.emoji} {b.plan.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {/* The one part of the app that could turn up unexplained: a new
                group means an empty grid, and an empty grid says nothing about
                what it is for. It needs no dismissing and no remembering —
                the first plan takes it away. */}
            {next&&(
              <div {...pressable} onClick={()=>setMonth(monthOf(next.day))}
                style={{borderTop:`1px solid ${C.border}`,padding:"12px 18px",textAlign:"center",fontSize:12.5,color:C.t2,lineHeight:1.55,cursor:"pointer"}}>
                Nothing this month. Next up: <span style={{color:C.t1,fontWeight:600}}>{next.group.emoji} {next.plan.title}</span>, {formatDates(next.day)}{" "}
                <span style={{color:C.accentText,fontWeight:600}}>Show →</span>
              </div>
            )}
            {dated.length===0&&(
              <div style={{borderTop:`1px solid ${C.border}`,padding:"13px 18px",textAlign:"center",fontSize:12,color:C.t3,lineHeight:1.55}}>
                Plans you make show up here, so you can see your month at a glance.
              </div>
            )}
          </div>
        </div>
      )}
      {groups.length>0&&(
        <div style={{padding:"0 20px 8px"}}><span className="sl">All groups</span></div>
      )}
      {named.map(g=>{
        const active=g.plans.filter(p=>p.status!=="completed");
        return(
          <SwipeToDelete key={g.id} group={g} onDelete={onDeleteGroup}>
          <div className="card" style={{cursor:"pointer"}} {...pressable} onClick={()=>push("groupDetail",{groupId:g.id})}>
            <div style={{padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:28}}>{g.emoji}</div>
                  <div>
                    <div style={{fontFamily:"var(--font-display)",fontSize:20,color:C.t1}}>{g.name}</div>
                    <div style={{fontSize:12,color:C.t2}}>{isSoloGroup(g)?"Just you":plural(g.memberIds.length,"person","people")}</div>
                  </div>
                </div>
                {!isSoloGroup(g)&&<span className="pill pill-g">💰 ${g.wallet.toLocaleString()}</span>}
              </div>
              {!isSoloGroup(g)&&<AvCluster ids={g.memberIds} um={um} max={5}/>}
              {/* Who is in the group is already said under its name, and what
                  is happening is said by the calendar above. What is left worth
                  saying here is whether anything is live, so that is all this
                  says — and when nothing is, the rule goes too rather than
                  ruling off an empty line. */}
              {active.length>0&&(
                <>
                  <div style={{height:1,background:C.border,margin:"12px 0"}}/>
                  <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center"}}>
                    <span className="pill pill-p">{plural(active.length,"plan")} on</span>
                  </div>
                </>
              )}
            </div>
          </div>
          </SwipeToDelete>
        );
      })}
      <div style={{height:20}}/>
    </div>
  );
}

// ─── GROUP DETAIL ────────────────────────────────────────────────────────────
function GroupDetailScreen({onBack,groupId,groups,um,updateGroup,push,toast,setGroups,refreshGroup,removeGroupMember,leaveGroup,me}){
  const group=groups.find(g=>g.id===groupId);
  const [tab,setTab]=useState("plans");
  const [refreshing,setRefreshing]=useState(false);
  const [busyId,setBusyId]=useState(null);
  // Removing somebody, or walking out yourself, is a one-tap change to other
  // people's plans that nothing could undo. Deleting a group makes you type
  // its name; these asked nothing at all.
  const [confirming,setConfirming]=useState(null);
  const isAdmin=group?.role==="admin";
  const isAlone=isSoloGroup(group);
  // Read off this person's clock, not Greenwich's, and read once — so the
  // section a plan sits under and the chip on it cannot disagree.
  const todayISO=today();

  const doRemove=async(uid,name)=>{
    if(busyId)return;setBusyId(uid);
    try{ await removeGroupMember(groupId,uid); toast(`${name} removed`); }
    catch(e){ toast(e.message); }
    finally{ setBusyId(null); }
  };
  const doLeave=async()=>{
    if(busyId)return;setBusyId(me);
    try{ await leaveGroup(groupId); toast(`You left ${group.name}`); }
    catch(e){ toast(e.message); setBusyId(null); }
  };

  useEffect(()=>{
    if(!groupId||!refreshGroup)return;
    setRefreshing(true);
    refreshGroup(groupId).finally(()=>setRefreshing(false));
  },[groupId]);

  if(!group)return <NotLoaded what="This group" onBack={onBack}/>;
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 0"}}>
        <ScreenHeader onBack={onBack} label="Groups"/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:32,marginBottom:4}}>{group.emoji}</div>
            <div className="pt">{group.name}</div>
            <div style={{fontSize:13,color:C.t2,marginTop:2}}>
              {isAlone?"Travelling on your own":`${plural(group.memberIds.length,"person","people")} · $${group.wallet.toLocaleString()} wallet`}
            </div>
          </div>
          {isAdmin&&<button className="bsm bsm-g" onClick={()=>push("editGroup",{groupId})}>Edit</button>}
        </div>
        <div style={{display:"flex",gap:0,marginTop:16,borderBottom:`1px solid ${C.border}`}}>
          {(isAlone?["plans"]:["plans","members","wallet"]).map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px 0",background:"none",border:"none",borderBottom:`2px solid ${tab===t?C.accentText:"transparent"}`,color:tab===t?C.accentText:C.t2,fontSize:13,fontWeight:600,cursor:"pointer",textTransform:"capitalize",transition:"all .15s"}}>{t}</button>
          ))}
        </div>
      </div>
      {tab==="plans"&&(
        <div style={{padding:"14px 0"}}>
          {group.plans.length===0&&(
            <div style={{padding:"40px 20px",textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:12}}>🗺️</div>
              <div style={{fontSize:16,fontWeight:600,color:C.t1,marginBottom:6}}>Nothing planned yet</div>
              <div style={{fontSize:13,color:C.t2,marginBottom:20}}>Pick a night out or somewhere to go. We'll work out the plan, the costs and who owes what.</div>
              <button className="bp" onClick={()=>push("groupTrip",{groupId})}>✨ Plan a Trip Together</button>
              <button style={{background:"none",border:"none",color:C.t2,fontSize:13,cursor:"pointer",marginTop:10,padding:"8px 0"}} onClick={()=>push("createPlan",{defaultGroupId:groupId})}>+ Add plan manually</button>
            </div>
          )}
          {planSections(group.plans,todayISO).map(section=>(
          <div key={section.key}>
            <div style={{padding:"6px 20px 10px",display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
              <span className="sl">{section.label}</span>
              <span style={{fontSize:11.5,color:C.t3}}>{plural(section.plans.length,"plan")}</span>
            </div>
          {section.plans.map(plan=>(
            <div key={plan.id} className="card" style={{margin:"0 20px 12px"}} {...pressable} onClick={()=>push("planDetail",{planId:plan.id,groupId})}>
              <div style={{padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{fontFamily:"var(--font-display)",fontSize:20,color:C.t1}}>{plan.title}</div>
                  <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`}>
                    {plan.status==="booked"?"✓ Booked":plan.status==="voting"?"Voting":plan.status==="approved"?"Approved":"Planning"}
                  </span>
                </div>
                <div style={{fontSize:13,color:C.t2,marginBottom:10,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span>{plan.dates} · ${plan.budget}/person</span>
                  {/* How near it is, only while that is worth saying. */}
                  {daysAway(plan,todayISO)&&(
                    <span className="pill pill-p" style={{fontSize:10.5}}>
                      {daysAway(plan,todayISO)}
                    </span>
                  )}
                </div>
                {plan.status==="voting"&&plan.options.length>0&&(
                  <div style={{background:C.s2,borderRadius:12,padding:10,marginBottom:10}}>
                    <div style={{fontSize:11,color:C.t3,marginBottom:8,textTransform:"uppercase",letterSpacing:".06em"}}>Vote in progress</div>
                    {plan.options.map(opt=>(
                      <div key={opt} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                        <div style={{fontSize:12,color:C.t1,width:60}}>{opt}</div>
                        <div style={{flex:1,height:5,background:C.s3,borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",background:C.accent,width:`${((plan.votes[opt]||0)/group.memberIds.length)*100}%`,borderRadius:3}}/>
                        </div>
                        <div style={{fontSize:11,color:C.t2}}>{plan.votes[opt]||0}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <AvCluster ids={plan.participants} um={um} max={4}/>
                  <div style={{fontSize:12,color:C.accentText,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>View <span style={{fontSize:16}}>→</span></div>
                </div>
              </div>
            </div>
          ))}
          </div>
          ))}
          <div style={{padding:"4px 20px 20px"}}>
            <button className="bs" onClick={()=>push("createPlan",{defaultGroupId:groupId})}>+ Add plan manually</button>
          </div>
        </div>
      )}
      {tab==="members"&&(
        <div style={{padding:"14px 0"}}>
          <div style={{padding:"0 20px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span className="sl">{group.memberIds.length} Members</span>
            {isAdmin&&<button className="bsm bsm-p" onClick={()=>push("editGroup",{groupId})}>Add Member</button>}
          </div>
          {group.memberIds.map(uid=>{
            const u=um[uid];if(!u)return null;
            return(
              <div key={uid} className="ri">
                <Av u={u} lg/>
                <div className="ri-inf"><div className="ri-t">{u.name}</div><div className="ri-s">{u.handle}</div></div>
                {uid===me
                  ? (confirming==="leave"
                      ? <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:11.5,color:C.t2}}>Leave {group.name}?</span>
                          <button className="bsm" disabled={!!busyId} onClick={()=>setConfirming(null)}>Stay</button>
                          <button className="bsm bsm-r" disabled={!!busyId} onClick={doLeave}>{busyId===me?"Leaving…":"Leave"}</button>
                        </div>
                      : <button className="bsm bsm-r" disabled={!!busyId} onClick={()=>setConfirming("leave")}>Leave</button>)
                  : isAdmin
                    ? (confirming===uid
                        ? <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontSize:11.5,color:C.t2}}>Remove {u.name}?</span>
                            <button className="bsm" disabled={!!busyId} onClick={()=>setConfirming(null)}>Keep</button>
                            <button className="bsm bsm-r" disabled={!!busyId} onClick={()=>doRemove(uid,u.name)}>{busyId===uid?"Removing…":"Remove"}</button>
                          </div>
                        : <button className="bsm bsm-r" disabled={!!busyId} onClick={()=>setConfirming(uid)}>Remove</button>)
                    : null}
              </div>
            );
          })}
          {isAdmin&&<div style={{padding:"12px 20px"}}><button className="bs" onClick={()=>push("editGroup",{groupId})}>+ Invite Someone</button></div>}
          {!isAdmin&&(
            <div style={{padding:"12px 20px"}}>
              {confirming==="leave"
                ? (<>
                    <div style={{fontSize:12,color:C.t2,marginBottom:8,lineHeight:1.5}}>
                      You'll lose access to {group.name}'s plans. Someone can add you back.
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button className="bs" style={{flex:1}} disabled={!!busyId} onClick={()=>setConfirming(null)}>Stay</button>
                      <button className="bs" style={{flex:1,color:C.red,borderColor:C.redDim}} disabled={!!busyId} onClick={doLeave}>
                        {busyId===me?"Leaving…":"Leave"}
                      </button>
                    </div>
                  </>)
                : <button className="bs" disabled={!!busyId} onClick={()=>setConfirming("leave")}
                    style={{color:C.red,borderColor:C.redDim}}>
                    {`Leave ${group.name}`}
                  </button>}
            </div>
          )}
        </div>
      )}
      {tab==="wallet"&&(
        <div style={{padding:"18px 20px"}}>
          <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:20,padding:20,marginBottom:18,textAlign:"center"}}>
            <div style={{fontSize:12,color:C.accentText,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Group Wallet</div>
            <div style={{fontFamily:"var(--font-display)",fontSize:44,color:C.t1}}>${group.wallet.toLocaleString()}</div>
            <div style={{fontSize:12,color:C.t2,marginTop:4}}>Shared · {group.memberIds.length} members</div>
          </div>
          <div style={{marginBottom:18,padding:"12px 14px",background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,fontSize:12.5,color:C.t2,lineHeight:1.5}}>
            The wallet fills from what members contribute at checkout. Paying into it
            directly isn't built yet, so there is nothing here that would take your money.
          </div>
          {/* This mapped over a literal empty array, so the heading was
              permanent and what sat under it never was. A heading over
              nothing reads as a section that failed to load. */}
          <div className="sl" style={{marginBottom:12}}>Recent transactions</div>
          <div style={{padding:"18px 0",textAlign:"center",fontSize:13,color:C.t3,lineHeight:1.6}}>
            Nothing yet. Shares paid at checkout show up here.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EDIT GROUP ───────────────────────────────────────────────────────────────
function EditGroupScreen({onBack,groupId,groups,um,updateGroup,toast,refreshGroup,leaveGroup,deleteGroup,saveGroupToServer,me}){
  const group=groups.find(g=>g.id===groupId);
  const [name,setName]=useState(group?.name||"");

  const members=group?.memberIds||[];
  const [invites,setInvites]=useState([]);
  const [q,setQ]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [searchFailed,setSearchFailed]=useState(false);
  const [busy,setBusy]=useState(false);
  // One tap used to remove somebody from the group with nothing in between.
  const [confirmingRemove,setConfirmingRemove]=useState(null);

  const isEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v||"").trim());

  const loadInvites=async()=>{
    try{
      const r=await fetch(`/api/groups/${groupId}/invites`);
      if(r.ok){const d=await r.json();setInvites(d.invites||[]);}
      else console.error("[editGroup] invites returned",r.status);
    }catch(e){console.error("[editGroup] invites failed",e);}
  };
  useEffect(()=>{loadInvites();},[groupId]);

  const search=async v=>{
    setQ(v);
    if(!v||v.length<2){setResults([]);return;}
    setSearching(true);
    try{
      const r=await fetch("/api/users/search?q="+encodeURIComponent(v));
      if(!r.ok)throw new Error(`search returned ${r.status}`);
      const d=await r.json();
      setResults((d.users||[]).filter(u=>!members.includes(u.id)));
      setSearchFailed(false);
    }catch(e){
      // An empty list read as "they are not on Reach", so people invited by
      // email somebody who already had an account.
      console.error("[editGroup] user search failed",e);
      setResults([]);setSearchFailed(true);
    }
    finally{setSearching(false);}
  };

  // Membership changes hit the server immediately. They used to be collected
  // in local state and dropped on Save, which only ever sent name and emoji.
  const addMember=async payload=>{
    if(busy)return;
    if(isTempId(groupId)){toast("This group is still saving — try again in a moment");return;}
    setBusy(true);
    try{
      const r=await fetch(`/api/groups/${groupId}/members`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Couldn't add them");
      if(d.invited){
        toast(d.emailed?`Invite sent to ${d.email}`:`Invite ready for ${d.email}`);
        if(!d.emailed&&d.acceptUrl){try{await navigator.clipboard?.writeText(d.acceptUrl);toast("Link copied — go on, paste it somewhere");}catch(e){}}
        loadInvites();
      }else{
        toast("They're in 🎉");
        if(refreshGroup)refreshGroup(groupId);
      }
      setQ("");setResults([]);
    }catch(e){toast(e.message);}
    finally{setBusy(false);}
  };

  const removeMember=async uid=>{
    if(busy)return;
    if(isTempId(groupId)){toast("This group is still saving — try again in a moment");return;}
    setBusy(true);
    try{
      const r=await fetch(`/api/groups/${groupId}/members`,{
        method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({userId:uid}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Couldn't remove them");
      toast("Removed from the group");
      if(refreshGroup)refreshGroup(groupId);
    }catch(e){toast(e.message);}
    finally{setBusy(false);}
  };

  const revokeInvite=async id=>{
    if(isTempId(groupId)){toast("This group is still saving — try again in a moment");return;}
    try{
      const r=await fetch(`/api/groups/${groupId}/invites`,{
        method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id}),
      });
      // Said "Invite withdrawn" whatever came back, so a refused withdrawal
      // left a live invite that the person believed was cancelled.
      if(!r.ok){
        const err=await r.json().catch(()=>({}));
        console.error("[invites] withdraw refused",r.status,err);
        toast(err.error||"Couldn't withdraw that invite");
        return;
      }
      toast("Invite pulled back");loadInvites();
    }catch(e){console.error("[invites] withdraw failed",e);toast("Couldn't withdraw that invite — try again, it is still active");}
  };

  const [savingName,setSavingName]=useState(false);
  const save=async()=>{
    if(savingName)return;
    setSavingName(true);
    const renamed={...group,name,emoji:inferGroupEmoji(name)};
    updateGroup(groupId,()=>renamed);
    // updateGroup's sync branch fires and forgets, so "Saved — looking good"
    // appeared whether or not the rename reached the server, sometimes right
    // before the failure did. Wait for the answer before giving one.
    const saved=saveGroupToServer?await saveGroupToServer(renamed):true;
    setSavingName(false);
    if(saved)toast("Saved — looking good");
    onBack();
  };

  // ── Leaving and deleting ───────────────────────────────────────────────
  // Deleting cascades in the database: the group's plans, members and pending
  // invites all go with it, and nothing restores them. That is why it asks the
  // name to be typed rather than showing a single confirm button.
  const [danger,setDanger]=useState(null); // null | "leave" | "delete"
  const [typed,setTyped]=useState("");
  const [working,setWorking]=useState(false);
  const isAdmin=group?.role==="admin";
  const nameMatches=typed.trim().toLowerCase()===(group?.name||"").trim().toLowerCase();
  // Every hook above runs on every render; the guard belongs here, below them.
  if(!group)return <NotLoaded what="This group" onBack={onBack}/>;

  const doLeave=async()=>{
    if(working)return;setWorking(true);
    try{ await leaveGroup(groupId); toast(`You left ${group.name}`); }
    catch(e){ toast(e.message); setWorking(false); }
  };
  const doDelete=async()=>{
    if(working||!nameMatches)return;setWorking(true);
    try{ await deleteGroup(groupId); toast(`${group.name} deleted`); }
    catch(e){ toast(e.message); setWorking(false); }
  };

  return(
    <div className="sc">
      <ScreenHeader onBack={onBack} label="Back" title="Edit Group"/>
      <div style={{padding:"0 20px",display:"flex",gap:12,alignItems:"center",marginBottom:18}}>
        <div style={{fontSize:44,minWidth:52,textAlign:"center"}}>{inferGroupEmoji(name)}</div>
        <input aria-label="Group name" className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="Group name" style={{flex:1}}/>
      </div>
      <div style={{padding:"0 20px 14px",fontSize:12,color:C.t3,lineHeight:1.5}}>
        The icon follows the name.
      </div>

      <div style={{height:1,background:C.border,margin:"6px 0 14px"}}/>

      <div style={{padding:"0 20px 10px"}}>
        <span className="sl">Add someone</span>
        <input aria-label="Search people by name or email" className="inp" value={q} onChange={e=>search(e.target.value)}
          placeholder="Search by name, or type an email to invite"
          style={{width:"100%",marginTop:8}}/>
        {searching&&<div style={{fontSize:12,color:C.t2,marginTop:8}}>Searching…</div>}
        {!searching&&results.length===0&&isEmail(q)&&(
          <button className="bsm bsm-p" style={{marginTop:10}} disabled={busy}
            onClick={()=>addMember({email:q.trim()})}>
            {busy?"Sending…":`Invite ${q.trim()}`}
          </button>
        )}
        {!searching&&results.length===0&&q.length>=2&&!isEmail(q)&&(
          <div style={{fontSize:12,color:searchFailed?C.red:C.t2,marginTop:8,lineHeight:1.5}}>
            {searchFailed
              ? "Couldn't search just now. Check your connection — they may well have an account."
              : "Nobody found. Type their full email address to invite them."}
          </div>
        )}
      </div>

      {results.map(u=>{
        const c=toContact(u);
        return(
          <div key={u.id} className="ri" {...pressable} onClick={()=>addMember({userId:u.id})}>
            <Av u={c} lg/>
            <div className="ri-inf"><div className="ri-t">{c.name}</div><div className="ri-s">{c.handle}</div></div>
            <button className="bsm bsm-p">+ Add</button>
          </div>
        );
      })}

      <div style={{padding:"14px 20px 10px"}}>
        <span className="sl">{members.length<=1?"Bring someone along":`Members (${members.length})`}</span>
      </div>
      {members.map(uid=>{
        const u=um[uid];if(!u)return null;
        return(
          <div key={uid} className="ri">
            <Av u={u} lg/>
            <div className="ri-inf"><div className="ri-t">{u.name}</div><div className="ri-s">{u.handle}</div></div>
            {uid===me
              ? <span style={{fontSize:11,color:C.t3,fontWeight:600}}>You</span>
              : confirmingRemove===uid
                ? <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{fontSize:11.5,color:C.t2}}>Remove {u.name}?</span>
                    <button className="bsm" disabled={busy} onClick={()=>setConfirmingRemove(null)}>Keep</button>
                    <button className="bsm bsm-r" disabled={busy} onClick={()=>{setConfirmingRemove(null);removeMember(uid);}}>Remove</button>
                  </div>
                : <button className="bsm bsm-r" disabled={busy} onClick={()=>setConfirmingRemove(uid)}>Remove</button>}
          </div>
        );
      })}

      {invites.length>0&&(
        <>
          <div style={{padding:"14px 20px 10px"}}>
            <span className="sl">Invited ({invites.length})</span>
          </div>
          {invites.map(inv=>(
            <div key={inv.id} className="ri">
              <div className="av-lg" style={{background:C.s3,color:C.t2,fontSize:18}}>✉️</div>
              <div className="ri-inf">
                <div className="ri-t">{inv.email}</div>
                <div className="ri-s">Waiting for them to sign in</div>
              </div>
              <button className="bsm bsm-r" onClick={()=>revokeInvite(inv.id)}>Withdraw</button>
            </div>
          ))}
        </>
      )}

      <div style={{padding:"18px 20px 10px"}}>
        <button className="bp" onClick={save}>Save Changes</button>
      </div>

      <div style={{height:1,background:C.border,margin:"10px 20px 16px"}}/>
      <div style={{padding:"0 20px 6px"}}><span className="sl" style={{color:C.red}}>Danger zone</span></div>

      <div style={{margin:"0 20px 30px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden"}}>
        {/* Leaving */}
        <div style={{padding:16}}>
          <div style={{fontSize:14,fontWeight:600,color:C.t1,marginBottom:3}}>Leave this group</div>
          <div style={{fontSize:12,color:C.t2,lineHeight:1.5,marginBottom:12}}>
            You stop seeing its plans. Everything else stays, and an admin can add you back.
          </div>
          {danger!=="leave"
            ? <button className="bs" onClick={()=>{setDanger("leave");setTyped("");}}
                style={{color:C.red,borderColor:C.redDim}}>Leave {group.name}</button>
            : (
              <div style={{display:"flex",gap:8}}>
                <button className="bs" style={{flex:1}} disabled={working} onClick={()=>setDanger(null)}>Cancel</button>
                <button className="bs" style={{flex:1,color:C.red,borderColor:C.red}} disabled={working} onClick={doLeave}>
                  {working?"Leaving…":"Yes, leave"}
                </button>
              </div>
            )}
          {isAdmin&&(
            <div style={{fontSize:11,color:C.t3,marginTop:8,lineHeight:1.5}}>
              You are an admin. If you are the only one, promote someone else first — a group cannot be left without one.
            </div>
          )}
        </div>

        {/* Deleting — admins only, and the server enforces that too. */}
        {isAdmin&&(
          <>
            <div style={{height:1,background:C.border}}/>
            <div style={{padding:16}}>
              <div style={{fontSize:14,fontWeight:600,color:C.t1,marginBottom:3}}>Delete this group</div>
              <div style={{fontSize:12,color:C.t2,lineHeight:1.5,marginBottom:12}}>
                Deletes the group for everyone, along with its {group.plans?.length||0} plan{(group.plans?.length||0)===1?"":"s"}, its members and any pending invites. This cannot be undone.
              </div>
              {danger!=="delete"
                ? <button className="bs" onClick={()=>{setDanger("delete");setTyped("");}}
                    style={{color:C.red,borderColor:C.redDim}}>Delete {group.name}</button>
                : (
                  <>
                    <div style={{fontSize:12,color:C.t2,marginBottom:8}}>
                      Type <strong style={{color:C.t1}}>{group.name}</strong> to confirm.
                    </div>
                    <input aria-label="Type the group name to confirm" className="inp" value={typed} onChange={e=>setTyped(e.target.value)}
                      placeholder={group.name} autoFocus style={{marginBottom:10}}/>
                    <div style={{display:"flex",gap:8}}>
                      <button className="bs" style={{flex:1}} disabled={working} onClick={()=>{setDanger(null);setTyped("");}}>Cancel</button>
                      <button className="bs" style={{flex:1,
                        color:nameMatches?C.onAccent:C.t3,
                        background:nameMatches?C.red:C.s2,
                        borderColor:nameMatches?C.red:C.border,
                        cursor:nameMatches?"pointer":"not-allowed"}}
                        disabled={working||!nameMatches} onClick={doDelete}>
                        {working?"Deleting…":"Delete forever"}
                      </button>
                    </div>
                  </>
                )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── CREATE GROUP ─────────────────────────────────────────────────────────────
const DEFAULT_GROUP_EMOJI="🎉";

// ─── What a booking's status is allowed to say ───────────────────────────
// Both checkout screens used to end their status ternary with a reassuring
// default, so every state nobody had thought about — failed, cancelled,
// redirected — rendered as "Booked ✓" in green, or as "We're on it". That is
// the worst sentence in the app to get wrong: it sits on the screen shown
// immediately after a real card has been charged.
//
// One map, read by both screens, so they cannot drift apart again. Only a
// confirmed booking is green, and anything unrecognised says it is not booked
// rather than inventing comfort — an unknown state is not good news.
// What a provider is called on a screen. The column holds our own short name
// for it, which is not what anybody would recognise on a button.
const PROVIDER_NAME={
  ticketmaster:"Ticketmaster",
  viator:"Viator",
  liteapi:"the hotel",
  kiwi:"Kiwi",
  duffel:"the airline",
  resy:"Resy",
  opentable:"OpenTable",
  tock:"Tock",
  concierge:"Reach",
};

// Why the member books the table rather than Reach: their card's dining
// benefits only apply to a reservation made on their own account. Advisory,
// from a fixed list — nobody's card is read to decide this.
const PLATFORM_PERK={
  resy:"American Express cards unlock Resy tables at some restaurants.",
  opentable:"Chase Sapphire cards unlock OpenTable Exclusive Tables at some restaurants.",
};

// How a booking happens, in words. Nothing here is an enum somebody reads:
// `mode` and `provider` are how this codebase talks to itself.
const BOOKING_MODE={
  native:"We book this for you",
  redirect:"You book it — takes two taps",
  concierge:"We'll sort this one out",
};

const BOOKING_STATE={
  confirmed:{label:"Booked ✓",tone:"green"},
  // Not "We're on it". Nobody at Reach is on it: a pending row is a table
  // the trip knows is wanted and that nobody has taken yet, and the person
  // who takes it is the one reading this. Saying we were working on it was a
  // promise with no path behind it in this codebase — and it survived every
  // run of the guard that bans exactly that phrase, because the guard could
  // not see a string with an apostrophe in it.
  pending:{label:"Yours to book",tone:"gold"},
  awaiting_approval:{label:"Waiting for the group",tone:"plain"},
  redirected:{label:"Finish on their site",tone:"gold"},
  failed:{label:"Couldn't book",tone:"red"},
  cancelled:{label:"Cancelled",tone:"red"},
};
function inferGroupEmoji(n){const s=(n||"").toLowerCase();const rules=[[/birthday|bday/,"🎂"],[/ski|snow|tahoe|aspen/,"🎿"],[/beach|cabo|cancun|island|bahamas|miami|playa|lake/,"🏝️"],[/concert|show|festival|music|tour/,"🎸"],[/dinner|food|restaurant|brunch|taco|pizza|omakase/,"🍕"],[/camp|hike|hiking|trail|mountain|yosemite|zion/,"🏕️"],[/vegas|party|bachelor|bachelorette/,"🎉"],[/golf/,"⛳"],[/wedding/,"💍"],[/road ?trip|drive/,"🚗"],[/europe|paris|tokyo|london|flight|abroad|trip|travel/,"✈️"]];for(const r of rules){if(r[0].test(s))return r[1];}return DEFAULT_GROUP_EMOJI;}
function CreateGroupScreen({onBack,setGroups,toast,um,saveGroupToServer,me,replace}){
  // Solo is a choice made here, before anything else, because everything
  // downstream changes: no inviting, no voting, and recommendations written
  // for one person rather than a committee. It used to be inferred from a
  // group that happened to have one member, which is why a solo trip still
  // got asked to put itself to a vote.
  const [mode,setMode]=useState(null);   // null | "solo" | "group"
  const [step,setStep]=useState(0);
  const [name,setName]=useState("");
  const [members,setMembers]=useState([]);
  const [inviteEmails,setInviteEmails]=useState([]);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  // Distinguishes "nobody by that name" from "the search itself failed".
  const [searchFailed,setSearchFailed]=useState(false);
  const [searching,setSearching]=useState(false);
  const isEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v||"").trim());
  const searchUsers=async(q)=>{
    setSearchQuery(q);
    if(!q||q.length<2){setSearchResults([]);return;}
    setSearching(true);
    try{
      const res=await fetch("/api/users/search?q="+encodeURIComponent(q));
      if(!res.ok)throw new Error(`search returned ${res.status}`);
      const d=await res.json();
      setSearchResults(d.users||[]);setSearchFailed(false);
    }catch(e){
      console.error("[createGroup] user search failed",e);
      setSearchResults([]);setSearchFailed(true);
    }
    finally{setSearching(false);}
  };
  const addInviteEmail=()=>{
    const e=searchQuery.trim().toLowerCase();
    if(!isEmail(e))return;
    setInviteEmails(list=>list.includes(e)?list:[...list,e]);
    setSearchQuery("");setSearchResults([]);
  };
  // A double-tap before navigation made two groups. Every create path now
  // refuses re-entry rather than relying on the person tapping once.
  const [creating,setCreating]=useState(false);
  const create=()=>{
    if(creating)return;
    setCreating(true);
    const tempId="g_local_"+Date.now();
    // A solo group is you and nobody else, and carries no pending invites —
    // everything downstream keys off a member count of one.
    const finalMembers=mode==="solo"?(me?[me]:[]):members;
    const finalInvites=mode==="solo"?[]:inviteEmails;
    const finalEmoji=mode==="solo"?"🧍":inferGroupEmoji(name);
    const newGroup={id:tempId,name,emoji:finalEmoji,memberIds:finalMembers,inviteEmails:finalInvites,wallet:0,tags:[],plans:[]};
    setGroups(gs=>[...gs,newGroup]);
    toast(mode==="solo"?`${name} — just you 🧍`:`${name} created!`);
    // Straight into planning rather than back to a list. Creating a group was
    // never the thing somebody came to do: it dropped them on the Groups tab
    // to find what they had just made and press another button. Nine screens
    // stood between opening the app and seeing a single suggestion, and most
    // of them were navigation.
    const goPlan=(id)=>replace&&replace("groupTrip",{groupId:id});
    if(typeof saveGroupToServer==="function"){
      Promise.resolve(saveGroupToServer(newGroup))
        .then(realId=>goPlan(realId||tempId))
        .catch(()=>goPlan(tempId));
    }else{
      goPlan(tempId);
    }
    // The screen normally unmounts on onBack, so this rarely runs — but if it
    // ever does not, a flag that is never cleared leaves the button dead.
    setTimeout(()=>setCreating(false),1500);
  };
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 18px"}}>
        <ScreenHeader onBack={onBack} label="Cancel"/>
        <div className="pt">
          {!mode?"Who's going?":mode==="solo"?"Name your trip":step===0?"Name your group":"Add people"}
        </div>
        {mode&&mode!=="solo"&&(
          <div className="sd" style={{marginTop:14}}>{[0,1].map(i=><div key={i} className={`sd-d ${i<=step?"active":""}`}/>)}</div>
        )}
      </div>

      {!mode&&(
        <div style={{padding:"0 20px"}}>
          <div style={{fontSize:13.5,color:C.t2,marginBottom:18,lineHeight:1.6}}>
            This changes everything after it, so it is worth getting right.
          </div>
          <button onClick={()=>{setMode("solo");setName("");}}
            style={{width:"100%",textAlign:"left",display:"flex",gap:14,alignItems:"flex-start",
              padding:16,borderRadius:16,border:`2px solid ${C.border}`,background:C.s2,
              cursor:"pointer",marginBottom:10}}>
            <span style={{fontSize:28,lineHeight:1}}>🧍</span>
            <span>
              <span style={{display:"block",fontSize:15,fontWeight:600,color:C.t1,marginBottom:3}}>Just me</span>
              <span style={{display:"block",fontSize:12.5,color:C.t2,lineHeight:1.5}}>
                Solo travel. Nobody to invite, nothing to vote on, and every suggestion
                written for one person travelling alone.
              </span>
            </span>
          </button>
          <button onClick={()=>setMode("group")}
            style={{width:"100%",textAlign:"left",display:"flex",gap:14,alignItems:"flex-start",
              padding:16,borderRadius:16,border:`2px solid ${C.border}`,background:C.s2,
              cursor:"pointer"}}>
            <span style={{fontSize:28,lineHeight:1}}>👥</span>
            <span>
              <span style={{display:"block",fontSize:15,fontWeight:600,color:C.t1,marginBottom:3}}>With other people</span>
              <span style={{display:"block",fontSize:12.5,color:C.t2,lineHeight:1.5}}>
                Family, friends, whoever. Everyone gets a say and the costs split themselves.
              </span>
            </span>
          </button>
        </div>
      )}

      {mode==="solo"&&(
        <div style={{padding:"0 20px"}}>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:44,minWidth:52,textAlign:"center"}}>{inferGroupEmoji(name)}</div>
            <input aria-label="Group name" className="inp" value={name} onChange={e=>setName(e.target.value)}
              placeholder="e.g., Japan on my own" style={{flex:1}} autoFocus/>
          </div>
          <div style={{fontSize:12,color:C.t3,marginBottom:24,lineHeight:1.55}}>
            Give it a name so you can find it later. We pick the icon from what you type.
          </div>
          <button className="bp" disabled={!name.trim()||creating} onClick={create}>
            {creating?"Setting it up…":"Start planning →"}
          </button>
        </div>
      )}

      {mode==="group"&&step===0&&(
        <div style={{padding:"0 20px"}}>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
            {/* The emoji is inferred from the name as you type — one fewer
                decision, and it updates live so it never feels imposed. */}
            <div style={{fontSize:44,minWidth:52,textAlign:"center"}}>{inferGroupEmoji(name)}</div>
            <input aria-label="Group name" className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Ski Trip Crew" style={{flex:1}} autoFocus/>
          </div>
          <div style={{fontSize:12,color:C.t3,marginBottom:24,lineHeight:1.5}}>
            We pick an icon from the name. Call it a ski trip and you get a ski trip.
          </div>
          <button className="bp" disabled={!name.trim()} onClick={()=>setStep(1)}>Continue →</button>
        </div>
      )}
      {mode==="group"&&step===1&&(
        <div>
          <div style={{padding:"0 20px 12px",fontSize:13,color:C.t2}}>Invite people to {name||"your group"}</div>
          <div style={{padding:"0 20px 12px"}}>
            <input aria-label="Search people by name or email" className="inp" value={searchQuery||""} onChange={e=>searchUsers(e.target.value)} placeholder="Search by name or email..." style={{marginBottom:8}}/>
            {searching&&<div style={{fontSize:12,color:C.t3,padding:"4px 0"}}>Searching...</div>}
            {(searchQuery||"").length>=2&&searchResults.length===0&&!searching&&isEmail(searchQuery)&&(
              <>
                <button className="bsm bsm-p" onClick={addInviteEmail}>Add {searchQuery.trim()}</button>
                <div style={{fontSize:11.5,color:C.t3,padding:"6px 0 0",lineHeight:1.5}}>
                  They get their invitation when you create the group.
                </div>
              </>
            )}
            {(searchQuery||"").length>=2&&searchResults.length===0&&!searching&&!isEmail(searchQuery)&&(
              <div style={{fontSize:12,color:searchFailed?C.red:C.t3,padding:"8px 0",lineHeight:1.5}}>
                {searchFailed
                  ? "Couldn't search just now. Check your connection — they may well have an account."
                  : "Nobody found. Type their full email address to invite them."}
              </div>
            )}
            {(searchQuery||"").length<2&&(
              <div style={{fontSize:12,color:C.t3,padding:"4px 0"}}>Search people you already share a group with, or type an email address to invite somebody new.</div>
            )}
          </div>
          {searchResults.map(u=>{
            const sel=members.includes(u.id);
            // Search answers carry no address any more, and this row used to
            // print one under every name.
            const initials=(u.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
            return(
              <div key={u.id} className="cb-row" {...pressable} onClick={()=>setMembers(m=>sel?m.filter(id=>id!==u.id):[...m,u.id])}>
                <div className={"cb "+(sel?"ck":"")}>{sel&&<Ic.Check/>}</div>
                <div style={{width:36,height:36,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",color:C.onAccent,fontWeight:700,fontSize:14,flexShrink:0,overflow:"hidden"}}>
                  {u.avatar_url?<img src={u.avatar_url} style={{width:36,height:36,objectFit:"cover"}} alt=""/>:initials}
                </div>
                <div><div style={{fontSize:14,fontWeight:500,color:C.t1}}>{u.name||"Member"}</div><div style={{fontSize:12,color:C.t2}}>Already on Reach</div></div>
              </div>
            );
          })}
          {inviteEmails.map(e=>(
            <div key={e} className="ri">
              <div className="av-lg" style={{background:C.s3,color:C.t2,fontSize:18}}>✉️</div>
              <div className="ri-inf"><div className="ri-t">{e}</div><div className="ri-s">Will be invited by email</div></div>
              <button className="bsm bsm-r" onClick={()=>setInviteEmails(l=>l.filter(x=>x!==e))}>Remove</button>
            </div>
          ))}
          {(members.length>0||inviteEmails.length>0)&&(
            <div style={{padding:"0 20px 12px"}}>
              <div style={{fontSize:12,color:C.accentText,fontWeight:500,marginBottom:8}}>
                {members.length} member{members.length!==1?"s":""} selected
                {inviteEmails.length>0?` · ${inviteEmails.length} to invite`:""}
              </div>
            </div>
          )}
          <div style={{padding:"18px 20px 30px"}}>
            <button className="bp" disabled={creating} onClick={create}>Create {name||"group"}{members.length>0?" ("+members.length+" member"+(members.length!==1?"s":"")+"":""}{members.length>0?")":""}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CREATE PLAN FLOW ─────────────────────────────────────────────────────────

// ─── YOUR TASTE ───────────────────────────────────────────────────────────
// The preference quiz. Every one of these columns already existed, the API
// already accepted them, trip generation already read them and the group
// screen already reported who had finished — and nothing anywhere in the app
// ever asked. So every group read "0 of N ready" forever, and the button
// offering to remind your crew to complete their quiz sent them to an app
// with nowhere to do it.
//
// It leads with what you are into rather than where you want to fly, because
// Reach is as much a Thursday evening as a fortnight away. "Pottery" and
// "cooking" are the answers that make a recommendation feel like it knows
// you, and no fixed list of six chips can hold what people are into — so
// every question that deserves one takes your own words too.
const TASTE_QUESTIONS=[
  {
    id:"favoriteActivities",icon:"✨",multi:true,
    title:"What are you into?",
    sub:"However you'd finish \"I've always fancied…\". Pick as many as you like.",
    customPlaceholder:"Something else you love? Type it",
    options:[
      {id:"cooking",e:"🍳",l:"Cooking"},
      {id:"pottery",e:"🏺",l:"Pottery & crafts"},
      {id:"livemusic",e:"🎸",l:"Live music"},
      {id:"art",e:"🎨",l:"Art & galleries"},
      {id:"outdoors",e:"🥾",l:"Outdoors"},
      {id:"sport",e:"⚽",l:"Sport"},
      {id:"comedy",e:"🎤",l:"Comedy"},
      {id:"film",e:"🎬",l:"Film & theatre"},
      {id:"dancing",e:"💃",l:"Dancing"},
      {id:"wellness",e:"🧘",l:"Wellness"},
      {id:"books",e:"📚",l:"Books & talks"},
      {id:"photography",e:"📷",l:"Photography"},
      {id:"markets",e:"🧺",l:"Markets & food halls"},
      {id:"museums",e:"🏛️",l:"Museums & history"},
      {id:"wine",e:"🍷",l:"Wine tasting"},
      {id:"breweries",e:"🍺",l:"Breweries"},
      {id:"games",e:"🎲",l:"Trivia & board games"},
      {id:"gardens",e:"🌳",l:"Gardens & parks"},
    ],
  },
  {
    id:"cuisines",icon:"🍽️",multi:true,
    title:"What do you like to eat?",
    sub:"We'll aim dinner at this, wherever you are.",
    customPlaceholder:"A cuisine we've missed?",
    options:[
      {id:"italian",e:"🍝",l:"Italian"},
      {id:"japanese",e:"🍣",l:"Japanese"},
      {id:"mexican",e:"🌮",l:"Mexican"},
      {id:"indian",e:"🍛",l:"Indian"},
      {id:"thai",e:"🍜",l:"Thai"},
      {id:"seafood",e:"🦞",l:"Seafood"},
      {id:"steak",e:"🥩",l:"Steak"},
      {id:"vegetarian",e:"🥗",l:"Veggie"},
      {id:"bbq",e:"🔥",l:"Barbecue"},
    ],
  },
  {
    id:"musicGenres",icon:"🎧",multi:true,optional:true,
    title:"What's on when you're getting ready?",
    sub:"Shapes the gigs and the bars we put in front of you.",
    customPlaceholder:"Anything else on heavy rotation?",
    options:[
      {id:"pop",e:"🎤",l:"Pop & R&B"},
      {id:"rock",e:"🎸",l:"Rock & indie"},
      {id:"hiphop",e:"🎧",l:"Hip-hop"},
      {id:"edm",e:"🎛️",l:"Dance"},
      {id:"jazz",e:"🎷",l:"Jazz & soul"},
      {id:"country",e:"🤠",l:"Country"},
      {id:"latin",e:"💃",l:"Latin"},
      {id:"classical",e:"🎻",l:"Classical"},
      {id:"metal",e:"🤘",l:"Metal"},
    ],
  },
  {
    id:"nightlifeStyle",icon:"🌙",
    title:"How does a good night out end?",
    sub:"There's no wrong answer and home by ten is a real one.",
    options:[
      {id:"dinner",e:"🍷",l:"A long dinner"},
      {id:"pub",e:"🍺",l:"A proper pub"},
      {id:"livemusic",e:"🎶",l:"Something live"},
      {id:"dancing",e:"🕺",l:"Dancing"},
      {id:"lowkey",e:"🛋️",l:"Home by ten"},
      {id:"whatever",e:"🎲",l:"Wherever it goes"},
    ],
  },
  {
    id:"diningVibe",icon:"🪑",
    title:"Where would you rather sit?",
    options:[
      {id:"hole",e:"🥟",l:"A tiny place locals queue for"},
      {id:"buzzy",e:"🥂",l:"Somewhere buzzy"},
      {id:"tasting",e:"👨‍🍳",l:"A proper tasting menu"},
      {id:"outside",e:"🌤️",l:"Outside, always"},
      {id:"quiet",e:"🕯️",l:"Quiet enough to talk"},
      {id:"any",e:"🤷",l:"Wherever's good"},
    ],
  },
  {
    id:"drinkStyle",icon:"🥂",
    title:"And to drink?",
    options:[
      {id:"cocktails",e:"🍸",l:"Cocktails"},
      {id:"wine",e:"🍷",l:"Wine"},
      {id:"beer",e:"🍺",l:"Beer"},
      {id:"none",e:"🚫",l:"Not drinking"},
      {id:"coffee",e:"☕",l:"Coffee, honestly"},
      {id:"any",e:"🎲",l:"Whatever's good"},
    ],
  },
  {
    id:"budgetRange",icon:"💷",
    title:"A normal night out costs you about…",
    sub:"Per person, all in. Nothing is held to this — it just stops us suggesting silly things.",
    options:[
      {id:"under50",e:"🪙",l:"Under $50"},
      {id:"50to100",e:"💵",l:"$50 – $100"},
      {id:"100to200",e:"💳",l:"$100 – $200"},
      {id:"200to400",e:"✨",l:"$200 – $400"},
      {id:"over400",e:"💎",l:"$400+"},
      {id:"varies",e:"🎲",l:"Depends entirely"},
    ],
  },
  {
    id:"dietary",icon:"🌱",free:true,optional:true,
    title:"Anything you can't eat?",
    sub:"Allergies, intolerances, what you don't touch. We'll never suggest around it.",
    placeholder:"Coeliac, no shellfish, vegetarian…",
  },
  {
    id:"noWayJose",icon:"🚫",multi:true,optional:true,noWay:true,
    title:"No Way José",
    sub:"Absolute nos. We will never suggest these, however good they look.",
    customPlaceholder:"Anything else that's a hard no?",
    options:[
      {id:"crowds",e:"👥",l:"Big crowds"},
      {id:"loud",e:"🔊",l:"Loud rooms"},
      {id:"earlyMornings",e:"⏰",l:"Early mornings"},
      {id:"heights",e:"🧗",l:"Heights"},
      {id:"clubs",e:"🪩",l:"Clubs"},
      {id:"spicy",e:"🌶️",l:"Very spicy food"},
      {id:"coldWeather",e:"🥶",l:"Cold weather"},
      {id:"camping",e:"⛺",l:"Camping"},
      {id:"karaoke",e:"🎤",l:"Karaoke"},
    ],
  },
  {
    // Last, and open. Everything above is a list somebody picks from, which
    // is quick and never says the one thing they actually want. This is where
    // "my sister is turning forty" and "I want to eat hot dogs" go, and both
    // are read: generation quotes every member's answer back attributed, so
    // the model hears the whole group rather than whoever pressed the button,
    // and Discover matches the words against what is on.
    id:"tripSummary",icon:"💭",free:true,optional:true,
    title:"What's this trip about?",
    sub:"Anything you're hoping happens. Skip it if nothing comes to mind.",
    placeholder:"Somewhere warm with my sister for her fortieth…",
  },
];

// The API takes snake_case columns; the quiz and /api/me speak camelCase.
const TASTE_COLUMN={
  favoriteActivities:"favorite_activities", cuisines:"cuisines",
  musicGenres:"music_genres", nightlifeStyle:"nightlife_style",
  diningVibe:"dining_vibe", drinkStyle:"drink_style",
  budgetRange:"budget_range", dietary:"dietary_needs", noWayJose:"no_way_jose",
  // Free text, in their own words. Read by trip generation — where every
  // member's is quoted back attributed, so the model hears the group and not
  // only whoever pressed the button — and by Discover, where "hot dogs"
  // should find National Hot Dog Day.
  tripSummary:"trip_summary",
};

// `required` is the first run: the account has answered nothing and nothing
// the app does works well without answers. There is no way back out of it —
// no header, no exit — because a half-set-up account is the state every empty
// screen and every bad suggestion comes from.
/** Set when the quiz has been worked through, whatever was answered. */
const QUIZ_DONE="reach_quiz_done";

// ─── WHAT I WANT FROM THIS TRIP ──────────────────────────────────────────
// The taste quiz is a standing profile and it is the right input for
// Discover, which answers "what is on near you" and has no trip to be about.
// It is the wrong input for a trip: what somebody wants from a week with
// their family in March is not what they want from a weekend with friends in
// October, and a profile cannot tell the two apart.
//
// So every trip asks its own members. Short on purpose — three questions,
// two of them skippable — because this is asked once per trip per person and
// a long form is one nobody fills in.
function PlanPreferencesScreen({onBack,planId,toast}){
  const [summary,setSummary]=useState("");
  const [mustDo,setMustDo]=useState("");
  const [noWay,setNoWay]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [loadErr,setLoadErr]=useState(false);

  // Editing what you said starts from what you said.
  useEffect(()=>{
    let alive=true;
    // A trip that has not reached the server yet has a local id, and asking
    // about it is a guaranteed 404. It cannot have answers stored against it
    // either, so there is nothing to load.
    if(!planId||isTempId(planId)){setLoading(false);return()=>{alive=false;};}
    (async()=>{
      try{
        const r=await fetch(`/api/plans/${planId}/preferences`);
        if(!r.ok)throw new Error(String(r.status));
        const d=await r.json();
        if(!alive)return;
        setSummary(d.summary||"");
        setMustDo(d.answers?.mustDo||"");
        setNoWay(d.answers?.noWay||"");
      }catch(e){
        console.error("[plan preferences] could not load",e);
        if(alive)setLoadErr(true);
      }
      if(alive)setLoading(false);
    })();
    return()=>{alive=false;};
  },[planId]);

  const save=async()=>{
    if(saving)return;
    // Saving against a local id would answer 404 and lose what they wrote.
    // Saying so is better than a generic failure they cannot act on.
    if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
    setSaving(true);
    try{
      const r=await fetch(`/api/plans/${planId}/preferences`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          summary:summary.trim()||null,
          answers:{mustDo:mustDo.trim()||null,noWay:noWay.trim()||null},
        }),
      });
      if(!r.ok){
        const d=await r.json().catch(()=>({}));
        throw new Error(d.error||"Couldn't save that");
      }
      toast("Thanks — that's you in");
      onBack();
    }catch(e){
      console.error("[plan preferences] save failed",e);
      toast(e.message);
    }
    setSaving(false);
  };

  if(loading)return(<div className="sc"><div style={{padding:"60px 20px",textAlign:"center",color:C.t2}}>One moment…</div></div>);

  const field=(label,hint,value,setter,placeholder,rows)=>(
    <div style={{padding:"0 20px 18px"}}>
      <div className="sl" style={{marginBottom:6}}>{label}</div>
      <div style={{fontSize:12,color:C.t3,marginBottom:8,lineHeight:1.5}}>{hint}</div>
      <textarea aria-label={label} value={value} rows={rows}
        onChange={e=>setter(e.target.value)} placeholder={placeholder}
        style={{width:"100%",padding:"14px",borderRadius:14,border:`1px solid ${C.border}`,
          background:C.s2,color:C.t1,fontSize:15,lineHeight:1.5,fontFamily:"inherit",
          resize:"none",outline:"none"}}/>
    </div>
  );

  return(
    <div className="sc">
      <ScreenHeader onBack={onBack} label="This trip" title="What do you want from it?"/>
      <div style={{padding:"0 20px 14px",fontSize:13,color:C.t2,lineHeight:1.55}}>
        Your answers here are about this trip only — they do not change your
        profile. Everyone sees that you have answered, never what you said.
      </div>
      {loadErr&&(
        <div style={{margin:"0 20px 14px",padding:"11px 13px",background:C.amberDim,
          border:`1px solid ${C.amber}`,borderRadius:14,fontSize:12.5,color:C.t1,lineHeight:1.5}}>
          We could not load anything you had already written. Saving now will replace it.
        </div>
      )}
      {field("What's this trip about, for you?",
        "The most useful thing you can tell us. Say what you are hoping happens.",
        summary,setSummary,"A proper rest, and one big night out…",4)}
      {field("Anything you want to make sure we do?",
        "Optional. One thing that would make the trip for you.",
        mustDo,setMustDo,"See the sunrise from somewhere high…",3)}
      {field("Anything you would rather we didn't?",
        "Optional. We will not suggest these.",
        noWay,setNoWay,"Nothing that starts before 9am…",3)}
      <div style={{padding:"0 20px 30px"}}>
        <button className="bp" disabled={saving} onClick={save}>
          {saving?"Saving…":"That's me in"}
        </button>
        <div style={{textAlign:"center",fontSize:11.5,color:C.t3,marginTop:10,lineHeight:1.5}}>
          You can skip anything. Having been through it is what the group is waiting for.
        </div>
      </div>
    </div>
  );
}

function TasteQuizScreen({onBack,toast,onSaved,required}){
  const [step,setStep]=useState(0);
  const [answers,setAnswers]=useState({
    favoriteActivities:[],cuisines:[],musicGenres:[],noWayJose:[],
    nightlifeStyle:null,diningVibe:null,drinkStyle:null,budgetRange:null,dietary:"",
    tripSummary:"",
  });
  const [custom,setCustom]=useState({});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [done,setDone]=useState(false);

  // Editing your answers has to start from your answers. Anything already
  // stored is loaded, so this is a thing you revise rather than redo.
  useEffect(()=>{
    let alive=true;
    (async()=>{
      try{
        const r=await fetch("/api/me");
        if(r.ok){
          const me=await r.json();
          const p=me.preferences||{};
          if(alive)setAnswers(a=>({
            ...a,
            favoriteActivities:p.favoriteActivities||[],
            cuisines:p.cuisines||[],
            musicGenres:p.musicGenres||[],
            noWayJose:p.noWayJose||[],
            nightlifeStyle:p.nightlifeStyle||null,
            diningVibe:p.diningVibe||null,
            drinkStyle:p.drinkStyle||null,
            budgetRange:p.budgetRange||null,
            dietary:p.dietary||"",
            tripSummary:p.tripSummary||"",
          }));
        }else console.error("[taste] could not load your answers",r.status);
      }catch(e){console.error("[taste] could not load your answers",e);}
      if(alive)setLoading(false);
    })();
    return()=>{alive=false;};
  },[]);

  const q=TASTE_QUESTIONS[step];
  const total=TASTE_QUESTIONS.length;
  const isLast=step===total-1;
  // Answers are stored as the words on the chip, not its id. "earlyMornings"
  // and "livemusic" are matched against listing text and read by a model,
  // and neither understands them; "Early mornings" and "Live music" are what
  // a person would write and what everything downstream can actually use.
  const tog=(k,v)=>setAnswers(a=>({...a,[k]:(a[k]||[]).includes(v)?a[k].filter(x=>x!==v):[...(a[k]||[]),v]}));
  const sel=(k,v)=>setAnswers(a=>({...a,[k]:a[k]===v?null:v}));
  const canNext=q.optional||q.free
    ?true
    :(q.multi?(answers[q.id]||[]).length>0:!!answers[q.id]);

  const save=async()=>{
    if(saving)return;
    setSaving(true);
    // Typed answers are real answers. A list of six chips cannot hold
    // "sourdough" or "sea swimming", and dropping what somebody typed is
    // dropping the part that makes a recommendation feel like theirs.
    const merged={...answers};
    for(const [k,v] of Object.entries(custom)){
      const t=(v||"").trim();
      if(t&&Array.isArray(merged[k]))merged[k]=[...merged[k],t];
    }
    const payload={};
    for(const [k,column] of Object.entries(TASTE_COLUMN)){
      const value=merged[k];
      if(Array.isArray(value))payload[column]=value;
      else if(value)payload[column]=value;
    }
    // Everything we just learned about what somebody wants to do also
    // describes the kind of activity they want on a trip, and trip
    // generation reads that column rather than this one.
    payload.activity_vibe=merged.favoriteActivities||[];
    try{
      const r=await fetch("/api/user/data",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
      });
      if(!r.ok){
        const err=await r.json().catch(()=>({}));
        console.error("[taste] save rejected",r.status,err);
        toast(err.error||"Couldn't save that — try again");
        setSaving(false);
        return;
      }
      setSaving(false);
      setDone(true);
      // quizComplete on the server is derived from budget or cuisines, and
      // most of these questions can be skipped — so somebody who answered
      // only the optional ones would be sent back here for ever. Having been
      // through it counts, whatever they chose to say.
      try{ localStorage.setItem(QUIZ_DONE,"1"); }catch(e){}
      // What somebody is into is the thing every recommendation is built
      // from, so finishing it is a funnel step in its own right.
      // Never awaited: instrumentation must not delay or fail a save.
      void fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:"quiz_completed"})}).catch(()=>{});
      if(onSaved)onSaved();
    }catch(e){
      console.error("[taste] save failed",e);
      toast("Couldn't save that — check your connection");
      setSaving(false);
    }
  };

  if(loading)return(
    <div className="sc"><div style={{padding:"60px 20px",textAlign:"center",color:C.t2,fontSize:14}}>
      Getting your answers…
    </div></div>
  );

  if(done){
    const picked=(answers.favoriteActivities||[]).length+((custom.favoriteActivities||"").trim()?1:0);
    return(
      <div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:14}}>🎉</div>
        <div style={{fontFamily:"var(--font-display)",fontSize:28,color:C.t1,marginBottom:10}}>
          Now we know you
        </div>
        <div style={{fontSize:14,color:C.t2,lineHeight:1.7,marginBottom:26}}>
          {picked>0
            ?`${plural(picked,"thing")} you're into, plus how you eat, drink and spend an evening. Every suggestion from here reads all of it.`
            :"Every suggestion from here reads your answers — yours and everyone you're planning with."}
        </div>
        <button className="bp" style={{width:"100%",marginBottom:10}} onClick={onBack}>
          Show me something to do →
        </button>
        <button className="bs" style={{width:"100%"}} onClick={()=>{setDone(false);setStep(0);}}>
          Change an answer
        </button>
      </div></div>
    );
  }

  return(
    <div className="sc" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"12px 20px 10px"}}>
        {required
          ?(<div style={{fontSize:12.5,color:C.t2,fontWeight:600,letterSpacing:".02em"}}>
              Setting up your account
            </div>)
          :<ScreenHeader onBack={onBack} label="Back"/>}
        <div style={{display:"flex",gap:3,margin:"12px 0 8px"}}>
          {TASTE_QUESTIONS.map((_,i)=>(
            <div key={i} style={{flex:1,height:3,borderRadius:2,
              background:i<=step?C.accent:C.s3,transition:"background .3s"}}/>
          ))}
        </div>
        <div style={{fontSize:11,color:C.t3}}>
          {step+1} of {total}{q.optional?" · skip if you like":""}
        </div>
      </div>

      <div style={{padding:"8px 20px 14px",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:8}}>{q.icon}</div>
        <div style={{fontFamily:"var(--font-display)",fontSize:26,
          color:q.noWay?C.red:C.t1,lineHeight:1.2,marginBottom:4}}>{q.title}</div>
        {q.sub&&<div style={{fontSize:13,color:C.t2,lineHeight:1.5}}>{q.sub}</div>}
      </div>

      <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none",padding:"0 20px 8px"}}>
        {q.free?(
          <input aria-label="Your answer" className="inp" value={answers[q.id]||""}
            onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}
            placeholder={q.placeholder}/>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
            {q.options.map(opt=>{
              const value=opt.l;
              const selected=q.multi?(answers[q.id]||[]).includes(value):answers[q.id]===value;
              const isVeto=q.noWay&&selected;
              return(
                <button key={opt.id}
                  onClick={()=>q.multi?tog(q.id,value):sel(q.id,value)}
                  style={{padding:"14px 8px",borderRadius:14,
                    border:"2px solid "+(isVeto?"rgba(239,68,68,.6)":selected?C.accent:C.border),
                    background:isVeto?"rgba(239,68,68,.1)":selected?C.accentDim:C.s2,
                    cursor:"pointer",textAlign:"center",transition:"all .15s"}}>
                  <div style={{fontSize:24,marginBottom:4}}>{opt.e}</div>
                  <div style={{fontSize:11,fontWeight:600,lineHeight:1.2,
                    color:isVeto?C.red:selected?C.accentText:C.t1}}>{opt.l}</div>
                </button>
              );
            })}
          </div>
        )}

        {q.customPlaceholder&&(
          <div style={{marginBottom:8}}>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:18}}>✏️</span>
              <input className="inp" style={{paddingLeft:44,fontSize:13}}
                value={custom[q.id]||""}
                onChange={e=>setCustom(c=>({...c,[q.id]:e.target.value}))}
                placeholder={q.customPlaceholder}/>
            </div>
            {custom[q.id]&&(
              <div style={{fontSize:12,color:C.accentText,marginTop:4,paddingLeft:4}}>
                ✓ Added: {custom[q.id]}
              </div>
            )}
          </div>
        )}

        {q.multi&&(answers[q.id]||[]).length>0&&(
          <div style={{textAlign:"center",fontSize:12,color:C.accentText,fontWeight:500,padding:"4px 0"}}>
            {(answers[q.id]||[]).length} selected
          </div>
        )}
      </div>

      <div style={{padding:"12px 20px 44px",display:"flex",gap:10}}>
        {step>0&&<button className="bs" style={{flex:1}} onClick={()=>setStep(s=>s-1)}>← Back</button>}
        {isLast?(
          <button className="bp" style={{flex:2}} disabled={saving} onClick={save}>
            {saving?"Saving…":"Save my answers"}
          </button>
        ):(
          <button className="bp" style={{flex:2}} disabled={!canNext} onClick={()=>setStep(s=>s+1)}>
            {canNext?"Continue →":"Pick at least one"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── What the plan already told us ────────────────────────────────────────
// Creating a plan asks for dates, a vibe, a destination style, where you are
// sleeping, your hard nos and a budget. The quiz then asked for the same six
// things in different words. Being asked to repeat yourself reads as the app
// not listening, and it is the longest stretch of the flow with nothing to
// show for it — so the quiz now starts from these and only asks what is left.
//
// The two screens use different vocabularies for the same answers, so the
// translation lives here rather than in either of them.
const DEST_TO_TRIP_TYPE={city:"city",beach:"beach",mountains:"nature",nature:"nature"};
const VIBE_TO_PACE={chill:"relaxed",active:"packed",culture:"balanced",mix:"balanced"};
const STAY_TO_STAY={hotel:"hotel",rental:"airbnb",luxury:"resort",boutique:"boutique",hostel:"hostel"};
const DEALBREAKER_TO_NOWAY={
  "cold weather":"coldWeather","extreme heat":"coldWeather","crowds":"crowded",
  "long flights":"longFlights","hiking":"hiking","early starts":"earlyMornings",
  "camping":"camping",
};

function knownFromPlan(plan){
  // Only a trip's own answers carry into a trip quiz. A dinner booked last
  // week has a budget and a date too, and seeding those here would quietly
  // plan a fortnight in Lisbon against a $150 restaurant budget.
  if(!plan||(plan.type&&plan.type!=="trip"&&plan.type!=="weekend"))return null;
  const known={};
  const type=DEST_TO_TRIP_TYPE[plan.destStyle];
  if(type)known.tripType=[type];
  const stay=STAY_TO_STAY[plan.accommodation];
  if(stay)known.accommodation=[stay];
  const pace=VIBE_TO_PACE[plan.vibe];
  if(pace)known.pace=pace;
  // Anything we cannot map is still a real answer — it goes through as free
  // text rather than being quietly dropped, because "no camping" matters
  // whether or not it happens to be one of our six chips.
  const nos=(plan.dealbreakers||[]).map(d=>
    DEALBREAKER_TO_NOWAY[String(d).toLowerCase().trim()]||("custom:"+d));
  if(nos.length)known.noWayJose=nos;
  if(plan.budget>0)known.budget=String(plan.budget);
  if(plan.startDate)known.startDate=plan.startDate;
  if(plan.endDate)known.endDate=plan.endDate;
  return Object.keys(known).length?known:null;
}

// Plain-English recap of what carried over, for the card that shows it.
const KNOWN_LABELS={
  tripType:"the kind of trip",accommodation:"where you're sleeping",
  pace:"the pace",noWayJose:"your hard nos",budget:"your budget",
};

// ─── TRIP PLANNING QUIZ ───────────────────────────────────────────────────────
// Completely separate from the onboarding quiz.
// This fuels the AI trip generator with trip-specific preferences.
// ─── Where you are flying from, changed where you noticed it was wrong ──
// The departure city and airport lived only in Profile, and the trip quiz is
// exactly where somebody sees that it is wrong: they are reading "Departing
// from Pittsburgh (RDU)" while planning a trip. Sending them to Profile to
// fix it threw away every answer they had given, so in practice it stayed
// wrong — this one had said Pittsburgh with a Raleigh airport for months.
//
// The airport follows the city when it is left empty, and overrides it when
// it is not, because living in one place and flying from another is ordinary.
function DepartureLine({departure,saveDeparture}){
  const [editing,setEditing]=useState(false);
  const [city,setCity]=useState("");
  const [air,setAir]=useState("");
  const [busy,setBusy]=useState(false);

  const open=()=>{
    setCity(departure?.city||"");
    setAir(departure?.derived?"":(departure?.airport||""));
    setEditing(true);
  };

  const airValid=!air.trim()||/^[A-Za-z]{3}$/.test(air.trim());
  const willUse=air.trim()?air.trim().toUpperCase():airportForCity(city);

  return editing?(
    <div style={{marginTop:10,padding:"12px 14px",background:C.s2,
      border:`1px solid ${C.border}`,borderRadius:14,textAlign:"left"}}>
      <div style={{fontSize:12.5,color:C.t2,marginBottom:8,lineHeight:1.5}}>
        Where do you fly from? Every flight price on this trip starts here.
      </div>
      <input className="inp" autoFocus value={city} placeholder="Raleigh, North Carolina"
        onChange={e=>setCity(e.target.value)}/>
      <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center"}}>
        <input aria-label="Departure airport" className="inp" value={air} placeholder={airportForCity(city)||"RDU"}
          maxLength={3} style={{width:96,textTransform:"uppercase",fontWeight:600,letterSpacing:".08em"}}
          onChange={e=>setAir(e.target.value)}/>
        <div style={{fontSize:11.5,color:C.t3,lineHeight:1.4,flex:1}}>
          {air.trim()
            ?"Using the airport you typed."
            :airportForCity(city)
              ?`Leave empty and we'll use ${airportForCity(city)}.`
              :"We don't know an airport for that city — type one."}
        </div>
      </div>
      {!airValid&&(
        <div style={{fontSize:12,color:C.red,marginTop:8}}>
          An airport code is three letters, like SFO or JFK.
        </div>
      )}
      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button className="bp" style={{flex:1}} disabled={busy||!airValid||!willUse}
          onClick={async()=>{
            setBusy(true);
            const ok=await saveDeparture?.({city,airport:air});
            setBusy(false);
            if(ok)setEditing(false);
          }}>
          {busy?"Saving…":"Save"}
        </button>
        <button className="bs" style={{flex:1}} onClick={()=>setEditing(false)}>Cancel</button>
      </div>
    </div>
  ):(
    <div {...pressable} onClick={saveDeparture?open:undefined}
      style={{fontSize:14,color:C.t2,cursor:saveDeparture?"pointer":"default"}}>
      {`Departing from ${departure?.city||"your location"}${departure?.airport?" ("+departure.airport+")":""}`}
      {saveDeparture?<span style={{color:C.accentText,marginLeft:6,fontWeight:600,whiteSpace:"nowrap"}}>{" · change ▾"}</span>:null}
    </div>
  );
}

function TripQuiz({group,userLocation,departure,setPlaceOverride,saveDeparture,toast,error,onGenerate,allComplete,completedCount,totalCount,isSolo,known}){
  const [qStep,setQStep]=useState(0);
  const [startDate,setStartDate]=useState(known?.startDate||"");
  const [endDate,setEndDate]=useState(known?.endDate||"");
  // Reach plans experiences, not only travel. A night out is its own thing:
  // one date, one evening, and almost nothing to answer — food, music and
  // drinks are already in the taste quiz.
  const [mode,setMode]=useState(known?.startDate&&known?.endDate?"trip":null);
  const [nightTime,setNightTime]=useState("");
  const isNight=mode==="night";
  const [answers,setAnswers]=useState({
    goalBlurb:known?.goalBlurb||"",
    tripType:known?.tripType||[],accommodation:known?.accommodation||[],
    budget:null,pace:known?.pace||null,noWayJose:known?.noWayJose||[],
    // A night has its own mood. What you fancy this Friday is not your
    // standing taste profile, so these are asked fresh every time and never
    // carried over from a previous plan.
    nightKind:[],nightFood:[],nightEnergy:null,nightWhere:null,
  });
  // Default to trusting what was already said. Anyone who wants the full set
  // of questions back gets one tap to have them — the recap card offers it.
  const [reask,setReask]=useState(false);
  const [customInputs,setCustomInputs]=useState({
    tripType:"",accommodation:"",noWayJose:"",
  });
  // An exact figure beats a bucket: it is the number the model plans against,
  // and the tiers are computed from it.
  const [budgetCustom,setBudgetCustom]=useState(known?.budget||"");
  const tog=(k,v)=>setAnswers(a=>({...a,[k]:a[k].includes(v)?a[k].filter(x=>x!==v):[...a[k],v]}));
  const sel=(k,v)=>setAnswers(a=>({...a,[k]:v}));
  const setCustom=(k,v)=>setCustomInputs(c=>({...c,[k]:v}));

  const nights=startDate&&endDate
    ?Math.round((new Date(endDate)-new Date(startDate))/86400000):0;

  const questions=[
    {
      // First, and open. Every question after it is a list to pick from, and
      // a list cannot say "my sister is turning forty and has never seen
      // snow". Asked before the lists so it can answer some of them: a goal
      // that plainly names the kind of trip means we stop asking what kind.
      id:"goalBlurb",icon:"💭",free:true,optional:true,
      title:"What's this trip about?",
      sub:"The most useful thing you can tell us. Say who it's for, what you want to do and where, if you know — \"ski trip with the boys in Aspen to celebrate Kyle's promotion\". Everything after this is a list; this is the bit that isn't.",
      placeholder:"Ski trip with the boys in Aspen to celebrate Kyle…",
    },
    {
      id:"tripType",icon:"🌍",
      title:"What sort of trip are we doing?",
      sub:"Pick as many as you like — nobody has to choose just one.",
      multi:true,
      customPlaceholder:"Something else? Describe it…",
      options:[
        {id:"beach",e:"🏖️",l:"Beach & sun"},
        {id:"city",e:"🏙️",l:"City break"},
        {id:"nature",e:"🌿",l:"Nature & outdoors"},
        {id:"party",e:"🎉",l:"Party & nightlife"},
        {id:"wellness",e:"🧘",l:"Wellness & spa"},
        {id:"adventure",e:"🧗",l:"Adventure"},
      ]
    },
    {
      id:"accommodation",icon:"🏨",
      title:"Where are you sleeping?",
      sub:"Anything that works. We will not book you into a hostel if you say no.",
      multi:true,
      customPlaceholder:"Something specific in mind?",
      options:[
        {id:"hotel",e:"🏨",l:"Hotel"},
        {id:"resort",e:"🌴",l:"All-inclusive"},
        {id:"airbnb",e:"🏡",l:"Vacation rental"},
        {id:"villa",e:"🏰",l:"Private villa"},
        {id:"boutique",e:"✨",l:"Boutique hotel"},
        {id:"hostel",e:"🛏️",l:"Social hostel"},
      ]
    },
    {
      id:"budget",icon:"💰",
      title:isNight?"What's the night costing each of you?":"What is this costing each of you?",
      sub:isNight
        ?"Dinner, drinks, tickets — what one person spends on the night."
        :"Everything in — flights, beds, dinners, the lot. One honest number.",
      isbudget:true,
      // Exact amounts, not ranges: the label now says what actually gets sent.
      // "No limit" is gone — it was not a number, so it parsed to nothing.
      // A night out is not a fortnight. Asking somebody whether their Tuesday
      // dinner costs $8,000 is how the whole evening comes back absurd.
      options:isNight?[
        {id:"50",e:"🍺",l:"$50"},
        {id:"80",e:"🍝",l:"$80"},
        {id:"120",e:"🍷",l:"$120"},
        {id:"180",e:"✨",l:"$180"},
        {id:"250",e:"🎟️",l:"$250"},
        {id:"400",e:"👑",l:"$400"},
      ]:[
        {id:"1000",e:"💵",l:"$1,000"},
        {id:"2000",e:"💳",l:"$2,000"},
        {id:"3500",e:"✨",l:"$3,500"},
        {id:"5000",e:"💎",l:"$5,000"},
        {id:"8000",e:"🚀",l:"$8,000"},
        {id:"15000",e:"👑",l:"$15,000"},
      ]
    },
    {
      id:"pace",icon:"⏱️",
      title:"What kind of days are these?",
      options:[
        {id:"relaxed",e:"😌",l:"Relaxed"},
        {id:"balanced",e:"⚖️",l:"Balanced"},
        {id:"packed",e:"🔥",l:"See everything"},
        {id:"spontaneous",e:"🎲",l:"Spontaneous"},
        {id:"romantic",e:"💕",l:"Romantic"},
        {id:"wild",e:"🤪",l:"Go wild"},
      ]
    },
    {
      id:"noWayJose",icon:"🚫",
      title:"No Way José",
      sub:"Absolute nos. We will never suggest these, however good they look.",
      noWay:true,
      multi:true,
      optional:true,
      customPlaceholder:"Anything else that's a hard no?",
      options:[
        {id:"camping",e:"⛺",l:"Camping"},
        {id:"longFlights",e:"✈️",l:"10+ hr flights"},
        {id:"coldWeather",e:"🥶",l:"Cold weather"},
        {id:"crowded",e:"👥",l:"Touristy traps"},
        {id:"earlyMornings",e:"⏰",l:"Early mornings"},
        {id:"hiking",e:"🥾",l:"Hiking"},
      ]
    },
  ];

  // A question you have already answered is not asked again. The answer is
  // still in `answers`, so the model receives exactly what it would have.
  const isCarried=(q)=>{
    if(reask)return false;
    const v=known?known[q.id]:null;
    return Array.isArray(v)?v.length>0:!!v;
  };
  // A night out needs different answers from a fortnight away, and it needs
  // them every time: who is coming and what everyone fancies changes from one
  // Friday to the next. Nothing here is carried over from a previous plan.
  const nightQuestions=[
    {
      // The same open question the trip flow opens with, and for the same
      // reason: everything after it is a list, and a list cannot say "Tim's
      // fortieth, he hates clubs, somewhere we can actually talk".
      //
      // It is here as much for the step arithmetic as for the answer. The
      // date step sits straight after the blurb, so a question set without
      // one puts the dates at index 0 instead of index 1 — and choosing "A
      // night out" while standing on the date step then moved that step out
      // from under the person and dropped them on the next question, past
      // the date fields they had not filled in yet. Both sets open the same
      // way, so switching between them changes nothing underfoot.
      id:"goalBlurb",icon:"💭",free:true,optional:true,
      title:"What's this night about?",
      sub:"The most useful thing you can tell us. Who it's for and what you're after — \"Tim's 40th, he hates clubs, somewhere we can actually talk\". Everything after this is a list; this is the bit that isn't.",
      placeholder:"Tim's 40th, somewhere we can actually hear each other…",
    },
    // "Where should it be?" used to sit here — by the water, in the city,
    // local and low-key. It is gone, because it was asking somebody to
    // describe a place we already know: they are standing in it, or they
    // named it in the first sentence, and what sort of room they want is
    // what the energy and kind questions are for. Four options that mostly
    // meant "you pick" is a tap that buys nothing.
    //
    // Still read from the blurb when somebody volunteers it — "drinks by the
    // water" is a real preference — just never asked for.
    {
      id:"nightKind",icon:"🌃",
      title:"What kind of night?",
      sub:"Pick as many as you like — we'll build the evening around them.",
      multi:true,
      customPlaceholder:"Something else? Type it",
      options:[
        {id:"dinner",e:"🍽️",l:"Dinner"},
        {id:"drinks",e:"🍸",l:"Drinks"},
        {id:"livemusic",e:"🎸",l:"Live music"},
        {id:"game",e:"🏟️",l:"A game"},
        {id:"show",e:"🎭",l:"A show"},
        {id:"new",e:"✨",l:"Something new"},
      ],
    },
    {
      id:"nightFood",icon:"🍜",
      title:"Hungry for anything in particular?",
      sub:"Tonight's craving, not your usual. Skip it and we'll use your taste answers.",
      multi:true,optional:true,
      customPlaceholder:"Something else you fancy?",
      options:[
        {id:"italian",e:"🍝",l:"Italian"},
        {id:"japanese",e:"🍣",l:"Japanese"},
        {id:"mexican",e:"🌮",l:"Mexican"},
        {id:"steak",e:"🥩",l:"Steak"},
        {id:"seafood",e:"🦞",l:"Seafood"},
        {id:"smallplates",e:"🫒",l:"Small plates"},
      ],
    },
    {
      id:"nightEnergy",icon:"🔋",
      title:"How big is this night?",
      sub:"There is no wrong answer and home by ten is a real one.",
      options:[
        {id:"chilled",e:"🛋️",l:"Chilled"},
        {id:"lively",e:"🥂",l:"Lively"},
        {id:"big",e:"🔥",l:"A big one"},
        {id:"seewhere",e:"🎲",l:"See where it goes"},
      ],
    },
    questions.find(q=>q.id==="budget"),
    {
      // The trip version of this asks about ten-hour flights, cold weather and
      // early mornings, none of which decide where anybody eats on a Friday.
      // The ids are the words themselves, because they are read by a model
      // rather than looked up in a table.
      id:"noWayJose",icon:"🚫",
      title:"No Way José",
      sub:"Absolute nos for tonight. We will never suggest these.",
      noWay:true,multi:true,optional:true,
      customPlaceholder:"Anything else that's a hard no tonight?",
      options:[
        {id:"big crowds",e:"👥",l:"Big crowds"},
        {id:"loud rooms",e:"🔊",l:"Loud rooms"},
        {id:"clubs",e:"🪩",l:"Clubs"},
        {id:"long queues",e:"🚶",l:"Long queues"},
        {id:"standing all night",e:"🧍",l:"Standing all night"},
        {id:"dressing up",e:"👔",l:"Dressing up"},
      ],
    },
  ].filter(Boolean);

  const carried=isNight?[]:questions.filter(isCarried);
  // Somebody who has just written "a week skiing in Aspen" should not be
  // asked next what sort of trip they want. They said. Only an unmistakable
  // word counts — a question skipped wrongly is an answer nobody gave, which
  // is worse than one extra tap.
  // Everything the opening answer already settles. Somebody who wrote "no
  // clubs, dinner and live music downtown" has answered three of the lists
  // that follow, and being asked them again reads as not having listened.
  //
  // Questions that take one answer are named so only the first clear match
  // is taken for those: offering somebody two paces would be answering a
  // question nobody asked.
  const fromGoal=answersFromGoal(answers.goalBlurb,["pace","nightWhere","nightEnergy"]);
  const settledByGoal=new Set(Object.keys(fromGoal.answers));

  // Which quiz this is, when they have already said. "night out with my
  // buddy who loves thai food" is somebody telling us it is one evening, and
  // they were still asked to choose between a night out and a trip on the
  // very next screen.
  //
  // Set once, and only while nothing has been picked — tapping the other one
  // afterwards must win, because a person correcting us is right.
  const goalMode=modeFromGoal(answers.goalBlurb);
  useEffect(()=>{
    if(goalMode&&mode===null)setMode(goalMode);
  },[goalMode,mode]);
  // Both sets are filtered the same way, so the two have the same shape and
  // the date step lands at the same index in either. Filtering one and not
  // the other is how choosing "A night out" moved the date step out from
  // under somebody mid-flow.
  // Both sets are filtered the same way, so the two have the same shape and
  // the date step lands at the same index in either. Filtering one and not
  // the other is how choosing "A night out" moved the date step out from
  // under somebody mid-flow.
  //
  // The absolute nos are never skipped, only pre-filled. "No clubs" is one
  // hard no and somebody usually has others, so that list is still offered
  // with what they already said ticked.
  const skip=(q)=>isCarried(q)||(settledByGoal.has(q.id)&&q.id!=="noWayJose");

  /** What an option is called, for saying back what we read. */
  const labelOf=(qid,oid)=>{
    // `custom:thai` is how the quiz stores something somebody typed rather
    // than ticked. It is a storage shape, not a word, and it appeared on
    // screen as "custom:thai" the first time a cuisine outside the six was
    // recognised. Only the part after the colon is the answer.
    const id=String(oid).startsWith("custom:")?String(oid).slice(7):String(oid);
    for(const q of [...questions,...nightQuestions]){
      const o=q.options?.find(x=>x.id===id);
      if(o)return (o.l||id).toLowerCase();
    }
    return id;
  };
  // Said out loud rather than assumed. Skipping a question quietly is how
  // somebody ends up with a plan built on something they never said, and the
  // answer to that is not to skip less but to show what was read.
  const readBack=summarise(fromGoal,labelOf);
  // The mode is named too. It is the one thing we act on before they reach a
  // screen that shows it, so saying it is the difference between the quiz
  // having listened and the quiz having guessed.
  const goalLine=[goalMode?(goalMode==="night"?"a night out":"a trip"):null,readBack]
    .filter(Boolean).join(" · ")||null;

  // A hard no they wrote is ticked on the list rather than only applied
  // behind the scenes, so the screen and the plan agree about what was heard.
  useEffect(()=>{
    if(!fromGoal.noWay.length)return;
    setAnswers(a=>{
      const have=Array.isArray(a.noWayJose)?a.noWayJose:[];
      const add=fromGoal.noWay.filter(n=>!have.includes(n));
      return add.length?{...a,noWayJose:[...have,...add]}:a;
    });
  },[fromGoal.noWay.join("|")]);
  const asked=(isNight?nightQuestions:questions).filter(q=>!skip(q));

  // Where the date step sits: straight after "What's this trip about?".
  //
  // It used to be first, so the first thing anybody was asked for was a
  // fortnight of calendar before they had said a word about what the trip
  // was — and the one open question, the only part that is not a list, came
  // after it. Somebody who knows they want a ski week for Kyle's fortieth
  // should be able to say so before being asked to pin down which Tuesday.
  //
  // Placed relative to the blurb rather than hardcoded to 1, because the
  // blurb is carried over when it is already known, and then it is not
  // asked at all and the dates lead. The arithmetic lives in lib/quiz-steps
  // and is tested there: its failure is showing a question twice or losing
  // one, and nothing throws when it does.
  const steps=stepsFor(asked);
  const isDateStep=steps[qStep]?.kind==="dates";
  const quizQ=steps[qStep]?.question;
  const totalSteps=steps.length;
  const isLast=qStep===totalSteps-1;
  const canNext=isDateStep
    ?(isNight?!!startDate:(startDate&&endDate&&nights>0))
    // `free` as well as `optional`, matching the taste quiz: a question with
    // nothing to pick from cannot be answered by picking, and a free one
    // that was ever made required would otherwise trap somebody on it.
    :(quizQ?.optional||quizQ?.free||(quizQ?.multi?(answers[quizQ?.id]||[]).length>0:!!answers[quizQ?.id]));

  const handleGenerate=()=>{
    // Merge custom inputs into answers
    const merged={...answers};
    Object.entries(customInputs).forEach(([k,v])=>{
      if(v&&v.trim()){
        if(Array.isArray(merged[k]))merged[k]=[...merged[k],"custom:"+v.trim()];
      }
    });
    // This used to send null for both "No limit" AND "$5k–$10k", so the two
    // highest choices reached the server as no budget at all and it fell back
    // to the cheapest bucket among the group's stored ranges. Picking a bigger
    // budget made the trips cheaper.
    // A question skipped because the opening answer settled it still has to
    // arrive answered. Only where nothing was picked, so a question that was
    // asked and answered always wins over what was read from the sentence.
    const read=answersFromGoal(merged.goalBlurb,["pace","nightWhere","nightEnergy"]);
    Object.entries(read.answers).forEach(([id,picked])=>{
      const have=merged[id];
      const empty=Array.isArray(have)?!have.length:!have;
      if(!empty)return;
      // Single-answer questions hold a string; the rest hold a list.
      merged[id]=["pace","nightWhere","nightEnergy"].includes(id)?picked[0]:picked;
    });
    if(read.noWay.length){
      const have=Array.isArray(merged.noWayJose)?merged.noWayJose:[];
      merged.noWayJose=[...new Set([...have,...read.noWay])];
    }
    const typed=parseInt(String(budgetCustom).replace(/[^0-9]/g,""));
    const budgetNum=Number.isFinite(typed)&&typed>0
      ? typed
      : (parseInt(merged.budget)||null);
    // Everything they told us about this trip is in. The properties carry
    // shape only — how long, how many, what kind — never a word of what
    // they wrote. Never awaited: this must not delay generating a trip.
    void fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name:"trip_input_submitted",groupId:group?.id||null,
        props:{nights:isNight?1:nights,kind:isNight?"night":"trip",solo:!!isSolo}})}).catch(()=>{});
    onGenerate(
      {start:startDate,end:isNight?startDate:endDate},
      budgetNum,
      // The goal travels with the answers. It is the one thing here written
      // rather than picked, and the server leads on it.
      {...merged,nights:isNight?1:nights,goalBlurb:(merged.goalBlurb||"").trim()},
      isNight?{mode:"night",nightPrefs:{
        time:nightTime,where:merged.nightWhere||"",
        kind:merged.nightKind||[],food:merged.nightFood||[],energy:merged.nightEnergy||null,
      }}:{mode:"trip"},
    );
  };

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg}}>
      {/* Progress */}
      <div style={{padding:"16px 20px 12px"}}>
        <div style={{display:"flex",gap:3,marginBottom:8}}>
          {Array.from({length:totalSteps}).map((_,i)=>(
            <div key={i} style={{flex:1,height:3,borderRadius:2,
              background:i<=qStep?C.accent:C.s3,transition:"background .3s"}}/>
          ))}
        </div>
        <div style={{fontSize:11,color:C.t3}}>Step {qStep+1} of {totalSteps}</div>
      </div>

      {/* Date step */}
      {isDateStep&&(
        <div style={{flex:1,overflowY:"auto",padding:"8px 20px 20px"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:44,marginBottom:10}}>📅</div>
            <div style={{fontFamily:"var(--font-display)",fontSize:28,color:C.t1,marginBottom:6}}>
              {isNight?"When's the night out?":mode==="trip"?"When are you going?":"What are we planning?"}
            </div>
            {/* A night out is where you are standing tonight, so it reads the
                live location and can be corrected exactly as Discover can —
                the two screens whose whole answer is "near here".
                A trip is not that: it departs from where you live, which is
                a profile setting rather than a GPS reading, and somebody
                planning from a hotel room is still flying home from home. */}
            {isNight?(
              <PlaceLine userLocation={userLocation} setPlaceOverride={setPlaceOverride}
                toast={toast} prefix="Out around" fallback="Out near you"
                hint="Where's the night out? This sticks until you clear it."/>
            ):mode==="trip"?(
              <DepartureLine departure={departure} saveDeparture={saveDeparture}/>
            ):(
              <div style={{fontSize:14,color:C.t2}}>
                A night out is one evening. A trip is days away.
              </div>
            )}
            {/* What the opening answer already settled, named rather than
                taken quietly. The questions it covers are not asked again,
                and somebody should be able to see why one they expected did
                not appear — and that we did not invent it. */}
            {goalLine&&(
              <div style={{marginTop:10,padding:"8px 12px",background:C.s2,
                border:`1px solid ${C.border}`,borderRadius:12,fontSize:12,
                color:C.t2,lineHeight:1.5,textAlign:"left"}}>
                From what you said: {goalLine}. We won't ask again.
              </div>
            )}
          </div>
          {/* Shown on whichever step you land back on, not only the date step,
              and carrying the server's own words. It used to append "check
              your Anthropic API key in Vercel" to every failure regardless of
              cause — which was never the cause, and is not something the
              person reading it can act on. */}
          {error&&(
            <div style={{background:C.redDim,border:`1px solid ${C.red}`,borderRadius:12,padding:12,marginBottom:16,fontSize:13,color:C.t1,display:"flex",alignItems:"flex-start",gap:8}}>
              <span>⚠️</span>
              <div>
                <div style={{fontWeight:600,marginBottom:2,color:C.red}}>Couldn't build your trips</div>
                <div style={{fontSize:12.5,color:C.t2,lineHeight:1.5}}>{error}</div>
              </div>
            </div>
          )}
          {/* One choice before anything else, because a night out and a
              fortnight need completely different answers. */}
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            {[{k:"night",e:"🌃",t:"A night out",s:"Dinner, a game, a gig"},
              {k:"trip",e:"✈️",t:"A trip",s:"Away for a few days"}].map(o=>(
              <button key={o.k} onClick={()=>setMode(o.k)}
                style={{flex:1,textAlign:"left",padding:"14px 14px",borderRadius:16,cursor:"pointer",
                  border:`2px solid ${mode===o.k?C.accentText:C.border}`,
                  background:mode===o.k?C.accentDim:C.s2}}>
                <div style={{fontSize:22,marginBottom:6}}>{o.e}</div>
                <div style={{fontSize:14,fontWeight:600,color:C.t1}}>{o.t}</div>
                <div style={{fontSize:11.5,color:C.t2,marginTop:2}}>{o.s}</div>
              </button>
            ))}
          </div>

          {isNight&&(
            <>
              <div style={{display:"flex",gap:10,marginBottom:12}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Which night</div>
                  <input aria-label="Which night" type="date" className="inp" value={startDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:C.t3,marginBottom:6}}>What time</div>
                  <input aria-label="What time" type="time" className="inp" value={nightTime}
                    onChange={e=>setNightTime(e.target.value)} style={{color:C.t1}}/>
                </div>
              </div>
              {/* Food, music and drinks are already answered. Saying so beats
                  asking again, and the way to change them is one tap. */}
              <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,
                padding:"12px 14px",marginBottom:16,fontSize:12.5,color:C.t2,lineHeight:1.6}}>
                We'll use what {isSolo?"you":"everyone"} said about food, music and drinks in the taste quiz.
              </div>
            </>
          )}

          {mode==="trip"&&(
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Departure</div>
              <input aria-label="First day" type="date" className="inp" value={startDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Return</div>
              <input aria-label="Last day" type="date" className="inp" value={endDate}
                min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
            </div>
          </div>
          )}
          {!isNight&&nights>0&&(
            <div style={{textAlign:"center",padding:"14px",background:C.accentDim,
              border:"1px solid "+C.accentBorder,borderRadius:14,marginBottom:16}}>
              <div style={{fontFamily:"var(--font-display)",fontSize:28,color:C.accentText}}>
                {nights} night{nights!==1?"s":""}
              </div>
              <div style={{fontSize:13,color:C.t2,marginTop:2}}>
                {nights<=2?"Quick getaway":nights<=4?"Weekend trip":nights<=7?"Week adventure":"Extended trip"}
                {" · "}{plural(group.memberIds?.length||2,"person","people")}
              </div>
            </div>
          )}
          {carried.length>0&&(
            <div style={{background:C.accentDim,border:"1px solid "+C.accentBorder,
              borderRadius:14,padding:14,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:600,color:C.t1,marginBottom:4}}>
                👌 Already got {carried.map(q=>KNOWN_LABELS[q.id]||q.id).join(", ")}
              </div>
              <div style={{fontSize:12,color:C.t2,lineHeight:1.6,marginBottom:8}}>
                From when you set this up. {asked.length===1?"One more question":asked.length+" quick questions"} and we're off.
              </div>
              <button onClick={()=>setReask(true)}
                style={{background:"none",border:"none",padding:0,cursor:"pointer",
                  fontSize:12,fontWeight:600,color:C.accentText,textDecoration:"underline"}}>
                Changed your mind? Ask me everything
              </button>
            </div>
          )}
          <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:14,padding:14}}>
            <div style={{fontSize:12,fontWeight:600,color:C.t1,marginBottom:4}}>
              ✨ AI reads everyone's preferences
            </div>
            <div style={{fontSize:12,color:C.t2,lineHeight:1.6}}>
              Combines your quiz answers with all {group.memberIds?.length||0} members' food, music, and activity preferences.
            </div>
          </div>
        </div>
      )}

      {/* Quiz questions */}
      {!isDateStep&&quizQ&&(
        <div style={{flex:1,display:"flex",flexDirection:"column"}}>
          <div style={{padding:"8px 20px 14px",textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:8}}>{quizQ.icon}</div>
            <div style={{fontFamily:"var(--font-display)",fontSize:26,
              color:quizQ.noWay?C.red:C.t1,lineHeight:1.2,marginBottom:4}}>
              {quizQ.title}
            </div>
            {quizQ.sub&&<div style={{fontSize:13,color:C.t2}}>{quizQ.sub}</div>}
            {quizQ.noWay&&(
              <div style={{marginTop:8,padding:"6px 14px",
                background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",
                borderRadius:10,display:"inline-block"}}>
                <div style={{fontSize:12,color:C.red}}>
                  🚫 These will <strong>never</strong> appear in your options
                </div>
              </div>
            )}
          </div>

          <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none",padding:"0 20px 8px"}}>
            {/* A question with nothing to pick from. This grid assumed every
                question had options, so a free-text one would have thrown on
                `.map` of undefined and taken the whole quiz down with it. */}
            {quizQ.free&&(
              <textarea
                aria-label={quizQ.title}
                value={answers[quizQ.id]||""}
                onChange={e=>setAnswers(a=>({...a,[quizQ.id]:e.target.value}))}
                placeholder={quizQ.placeholder||""}
                rows={4}
                style={{width:"100%",padding:"14px",borderRadius:14,border:`1px solid ${C.border}`,
                  background:C.s2,color:C.t1,fontSize:15,lineHeight:1.5,fontFamily:"inherit",
                  resize:"none",outline:"none",marginBottom:12}}/>
            )}
            {/* 6 option grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              {(quizQ.options||[]).map(opt=>{
                const isMulti=quizQ.multi;
                const selected=isMulti
                  ?(answers[quizQ.id]||[]).includes(opt.id)
                  :answers[quizQ.id]===opt.id;
                const isVeto=quizQ.noWay&&selected;
                return(
                  <button key={opt.id}
                    onClick={()=>isMulti?tog(quizQ.id,opt.id):sel(quizQ.id,opt.id)}
                    style={{
                      padding:"14px 8px",borderRadius:14,
                      border:"2px solid "+(isVeto?"rgba(239,68,68,.6)":selected?C.accent:C.border),
                      background:isVeto?"rgba(239,68,68,.1)":selected?C.accentDim:C.s2,
                      cursor:"pointer",textAlign:"center",
                      transition:"all .15s",
                    }}>
                    <div style={{fontSize:24,marginBottom:4}}>{opt.e}</div>
                    <div style={{fontSize:11,fontWeight:600,lineHeight:1.2,
                      color:isVeto?C.red:selected?C.accentText:C.t1}}>{opt.l}</div>
                  </button>
                );
              })}
            </div>

            {quizQ.isbudget&&(
              <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:12}}>
                <div style={{fontSize:12.5,color:C.t2,marginBottom:8}}>Or enter an exact amount per person</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:"var(--font-display)",fontSize:30,color:C.t2}}>$</span>
                  <input
                    inputMode="numeric"
                    value={budgetCustom}
                    onChange={e=>{
                      const digits=e.target.value.replace(/[^0-9]/g,"");
                      setBudgetCustom(digits);
                      // Typing an amount replaces whichever chip was picked.
                      if(digits)sel(quizQ.id,digits);
                    }}
                    placeholder={isNight?"120":"3500"}
                    style={{flex:1,background:"none",border:"none",
                      fontFamily:"var(--font-display)",fontSize:30,color:C.t1,width:"100%"}}/>
                </div>
                <div style={{fontSize:11.5,color:C.t3,marginTop:6,lineHeight:1.5}}>
                  {isNight?"Dinner, drinks and tickets. We plan three nights around it — ":"Everything in: flights, stay, food, activities. We plan three options around it —"}
                  one below, one at it, one a stretch.
                </div>
              </div>
            )}

            {/* 7th option: custom text input */}
            {quizQ.customPlaceholder&&(
              <div style={{marginBottom:8}}>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:18}}>✏️</span>
                  <input
                    className="inp"
                    style={{paddingLeft:44,fontSize:13}}
                    value={customInputs[quizQ.id]||""}
                    onChange={e=>setCustom(quizQ.id,e.target.value)}
                    placeholder={quizQ.customPlaceholder}
                  />
                </div>
                {customInputs[quizQ.id]&&(
                  <div style={{fontSize:12,color:C.accentText,marginTop:4,paddingLeft:4}}>
                    ✓ Added: {customInputs[quizQ.id]}
                  </div>
                )}
              </div>
            )}

            {quizQ.multi&&(answers[quizQ.id]||[]).length>0&&(
              <div style={{textAlign:"center",fontSize:12,color:C.accentText,fontWeight:500,padding:"4px 0"}}>
                {(answers[quizQ.id]||[]).length} selected
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{padding:"12px 20px 44px",display:"flex",gap:10}}>
        {qStep>0&&(
          <button className="bs" style={{flex:1}} onClick={()=>setQStep(s=>s-1)}>← Back</button>
        )}
        {isLast?(
          <button className="bp" style={{flex:2,
            background:!allComplete?`linear-gradient(135deg,${C.amber},${C.red})`:undefined}}
            onClick={handleGenerate}>
            {isNight
              ?(isSolo?"✨ Plan my night out":allComplete?"✨ Plan a night out for "+group.name:"⚠️ Plan anyway ("+completedCount+"/"+totalCount+" ready)")
              :(isSolo?"✨ Build my solo trip":allComplete?"✨ Generate trips for "+group.name:"⚠️ Generate anyway ("+completedCount+"/"+totalCount+" ready)")}
          </button>
        ):(
          <button className="bp" style={{flex:2}} disabled={!canNext}
            onClick={()=>setQStep(s=>s+1)}>
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}


function GroupTripScreen({onBack,groupId,groups,updateGroup,toast,push,userLocation,departure,setPlaceOverride,saveDeparture,savePlanToServer,saveItineraryToServer}){
  const group=groups.find(g=>g.id===groupId);
  // The newest plan on this group is the one whose answers are still live —
  // it is what the person filled in a moment ago on the way here.
  const latestPlan=(group?.plans||[])[(group?.plans||[]).length-1]||null;
  const [step,setStep]=useState(0);
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [budget,setBudget]=useState("");
  const [trips,setTrips]=useState(null);
  const [vetoes,setVetoes]=useState({});
  const [votes,setVotes]=useState({});
  const [myVote,setMyVote]=useState(null);
  const [myVetoes,setMyVetoes]=useState(new Set());
  const [generating,setGenerating]=useState(false);
  const [error,setError]=useState(null);
  const [tripPrefs,setTripPrefs]=useState({});
  const [memberStatus,setMemberStatus]=useState({}); // {userId: {name,quizDone,avatar}}
  const [loadingStatus,setLoadingStatus]=useState(false);

  useEffect(()=>{if(step===0)setError(null);},[step]);

  // Load quiz completion status for all members
  useEffect(()=>{
    if(!group)return;
    loadMemberStatus();
    // Poll every 15 seconds so status updates live
    const interval=setInterval(loadMemberStatus,15000);
    return()=>clearInterval(interval);
  },[groupId]);

  const loadMemberStatus=async()=>{
    setLoadingStatus(true);
    try{
      const res=await fetch("/api/groups/"+groupId+"/quiz-status");
      if(res.ok){
        const data=await res.json();
        setMemberStatus(data.members||{});
      }else console.error("[groupTrip] quiz-status returned",res.status);
    }catch(e){console.error("[groupTrip] quiz-status failed",e);}
    setLoadingStatus(false);
  };

  const membersList=Object.values(memberStatus);
  const completedCount=membersList.filter(m=>m.quizDone).length;
  const rawTotal=membersList.length||group.memberIds?.length||1;
  const isSolo=rawTotal<=1;
  const totalCount=isSolo?1:rawTotal;
  const allComplete=isSolo||(completedCount>=totalCount&&totalCount>0);
  const readyPercent=isSolo?100:totalCount>0?Math.round((completedCount/totalCount)*100):0;

  // Every hook in a component has to run on every render, so these live above
  // the guard below rather than beside the code that uses them.
  const [buildingItinerary,setBuildingItinerary]=useState(null);
  const [enriching,setEnriching]=useState(0);
  // Which shape the group chose on the date page. A night out is saved as one
  // evening, with no flights and no hotel to pay for.
  const [nightOut,setNightOut]=useState(false);
  // The itinerary is a second request. Without the night's own answers it
  // would plan the evening blind — and without the mode it recomputed nights
  // from two identical dates, got zero, and asked for a zero-day itinerary.
  const [nightAnswers,setNightAnswers]=useState({});
  const [enrichFailed,setEnrichFailed]=useState(false);

  if(!group)return <NotLoaded what="This group" onBack={onBack}/>;

  const nights=startDate&&endDate?Math.round((new Date(endDate)-new Date(startDate))/86400000):0;

  // `extra` carries what a night out needs and a trip does not: which shape of
  // plan this is, and the two answers the taste quiz cannot already supply.
  const generate=async(sd,ed,bud,prefs={},extra={},retrying=false)=>{
    setNightOut(extra.mode==="night");
    setNightAnswers(extra.nightPrefs||{});
    setEnrichFailed(false);
    setStep(1);setGenerating(true);setError(null);
    try{
      const res=await fetch("/api/trips/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,
          startDate:sd||startDate,
          endDate:ed||endDate,
          budgetPerPerson:parseInt(bud||budget)||null,
          departureCity:departure?.city||null,
          departureAirport:departure?.airport||null,
          // What they wrote when asked what the trip is about. The server
          // leads on it, including reading a place out of it.
          goalBlurb:prefs?.goalBlurb||null,
          userLat:userLocation?.lat||null,
          userLng:userLocation?.lng||null,
          tripPrefs:prefs,
          mode:extra.mode||"trip",
          nightPrefs:extra.nightPrefs||{},
        }),
      });
      if(res.ok){
        const data=await res.json();
        if(data.trips&&data.trips.length>0){
          setTrips(data.trips);
          setStep(2);
          // People are voting on where to spend a week and a lot of money.
          // Showing three destination names and asking them to choose is not
          // enough information to choose with, so every option arrives with
          // its days already written. Three calls in parallel cost the same
          // wall-clock as one, and picking a winner is then instant rather
          // than another half-minute of waiting.
          enrichWithItineraries(data.trips,sd||startDate,ed||endDate);
        }else{
          setError("No trips returned — try different dates or budget");
          setStep(0);
        }
      }else{
        const err=await res.json().catch(()=>({}));
        const msg=err.error||"Generation failed";
        // Auto-retry once on parse failures
        if(!retrying&&(msg.includes("parsing")||msg.includes("parse"))){
          setGenerating(false);
          setTimeout(()=>generate(sd,ed,bud,prefs,true),1000);
          return;
        }
        setError(msg);
        setStep(0);
      }
    }catch(e){
      setError("Network error — check your connection and try again");
      setStep(0);
    }finally{setGenerating(false);}
  };

  const veto=(tripId)=>{
    setMyVetoes(v=>{
      const next=new Set(v);
      next.has(tripId)?next.delete(tripId):next.add(tripId);
      return next;
    });
  };

  const vote=(tripId)=>{
    if(myVote===tripId){setMyVote(null);setVotes(v=>({...v,[tripId]:Math.max(0,(v[tripId]||1)-1)}));}
    else{
      if(myVote)setVotes(v=>({...v,[myVote]:Math.max(0,(v[myVote]||1)-1)}));
      setMyVote(tripId);
      setVotes(v=>({...v,[tripId]:(v[tripId]||0)+1}));
    }
  };


  // Writes the day-by-day plan for every option, in parallel, and attaches it
  // to the trip it belongs to.
  const enrichWithItineraries=async(list,sd,ed)=>{
    setEnriching(list.length);
    const results=await Promise.all(list.map(async trip=>{
      try{
        const r=await fetch("/api/trips/generate",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            groupId,startDate:sd||null,endDate:ed||null,
            detailTripId:trip.id,
            tripData:{destination:trip.destination,vibe:trip.vibe,costs:trip.costs},
            mode:nightOut?"night":"trip",
            nightPrefs:nightOut?nightAnswers:{},
            departureCity:departure?.city||null,
            departureAirport:departure?.airport||null,
          }),
        });
        if(!r.ok){
          const err=await r.json().catch(()=>({}));
          console.error("[groupTrip] itinerary failed for",trip.destination,err);
          // Three options with nothing behind them is not something to leave
          // somebody to discover by tapping each one.
          setEnrichFailed(true);
          return null;
        }
        const d=await r.json();
        return d.itinerary||null;
      }catch(e){
        console.error("[groupTrip] itinerary failed for",trip.destination,e);
        return null;
      }
    }));
    setTrips(prev=>(prev||[]).map((t,i)=>results[i]?{...t,itinerary:results[i]}:t));
    setEnriching(0);
  };

  const selectTrip=async(trip)=>{
    // Re-entry here cost twice: a duplicate plan and a second itinerary
    // generation, which is a paid model call.
    if(buildingItinerary)return;
    // Save plan immediately with placeholder itinerary
    const np={
      id:"p"+Date.now(),
      title:trip.destination,
      status:"approved",
      dates:nightOut?formatDates(startDate):formatDates(startDate,endDate),
      startDate:startDate||null,
      // One evening starts and ends on the same day. Leaving a return date on
      // it would put "5 nights" on a dinner.
      endDate:nightOut?(startDate||null):(endDate||null),
      budget:trip.total_per_person,
      // The place in the two parts a provider can search on. "Moab, Utah,
      // USA" is for reading; a hotel API wants the city and the country.
      destinationCity:trip.city||null,
      destinationCountry:trip.country_code||null,
      // The database allows trip, restaurant, concert and weekend. A night out
      // is closest to restaurant until a migration adds one of its own.
      type:nightOut?"restaurant":"trip",
      participants:group.memberIds||[],
      itinerary:[],
      votes:{},options:[],
      // Carried onto the plan so it survives the choosing. This is what the
      // readiness gate counts and what a later regeneration should start
      // from — the sentence that explains why this trip exists.
      goalBlurb:tripPrefs?.goalBlurb||null,
      // The organiser's own answers for this trip. They answered the quiz to
      // get here, so they have had their say and should not be asked again.
      tripAnswers:tripPrefs||null,
      soloMode:(group.memberIds||[]).length<=1,
      aiGenerated:true,aiData:trip,
    };
    updateGroup(groupId,g=>({...g,plans:[...g.plans,np]}));
    toast(trip.destination+" saved! Building itinerary… ✨");
    const _sp2=savePlanToServer?savePlanToServer(groupId,np):Promise.resolve(null);

    // Fetch full itinerary in background
    setBuildingItinerary(trip.id);
    // Declared out here because the navigation after the catch needs it.
    let realId=np.id;
    try{
      // Already written while they were deciding, so picking a winner is
      // instant rather than another half-minute of waiting.
      if(trip.itinerary?.length){
        realId=await _sp2.catch(()=>null)||np.id;
        // No airfare and no hotel on an evening out.
        // The evening is the plan. The day around it is an offer, kept off
        // the itinerary until somebody asks for it — "let's make a day of
        // it" — because a night out answered with a whole day is the app
        // deciding how long somebody's evening is.
        const rows=nightOut
          ?itineraryRows(trip.itinerary,true)
          :[...fixedCostRows(trip),...itineraryRows(trip.itinerary)];
        const offeredDay=nightOut?daytimeRows(trip.itinerary):[];
        updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>(p.id===realId||p.id===np.id)?{...p,itinerary:rows,dayOffer:offeredDay}:p)}));
        if(saveItineraryToServer)await saveItineraryToServer(realId,rows);
        setBuildingItinerary(null);
        push("planDetail",{planId:realId,groupId});
        return;
      }
      const res=await fetch("/api/trips/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,
          startDate,endDate,
          detailTripId:trip.id,
          tripData:{destination:trip.destination,vibe:trip.vibe,costs:trip.costs},
          mode:nightOut?"night":"trip",
          nightPrefs:nightOut?nightAnswers:{},
          departureCity:departure?.city||null,
          departureAirport:departure?.airport||null,
        }),
      });
      // The plan's real id has to be in hand before the itinerary can be
      // attached to it. This used to fire and forget, then write the days into
      // local state against the temporary "p1234" id the server had already
      // replaced — so the itinerary belonged to a plan that no longer existed
      // and was never saved anywhere.
      realId=await _sp2.catch(()=>null)||np.id;
      if(res.ok){
        const data=await res.json();
        const itinerary=[...fixedCostRows(trip),...itineraryRows(data.itinerary)];
        if(itinerary.length){
          updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>(p.id===realId||p.id===np.id)?{...p,itinerary}:p)}));
          if(saveItineraryToServer)await saveItineraryToServer(realId,itinerary);
          toast(`${data.itinerary.length} days planned for ${trip.destination} 🗺️`);
        }else{
          console.error("[groupTrip] itinerary came back empty",{planId:realId});
          toast("Couldn't build the day-by-day plan — you can add days yourself");
        }
      }else{
        const err=await res.json().catch(()=>({}));
        console.error("[groupTrip] itinerary request failed",err);
        toast(err.error||"Couldn't build the day-by-day plan");
      }
    }catch(e){console.error("Itinerary generation failed",e);toast("Couldn't build the day-by-day plan — try again, or add days yourself");}
    setBuildingItinerary(null);
    push("planDetail",{planId:realId,groupId});
  };

  const activeTrips=(trips||[]).filter(t=>!myVetoes.has(t.id));
  const vetoedTrips=(trips||[]).filter(t=>myVetoes.has(t.id));

  return(
    <div className="sc">
      {/* Header */}
      <div style={{padding:"12px 20px 16px",display:"flex",alignItems:"center",gap:12}}>
        <ScreenHeader onBack={onBack}/>
        <div style={{flex:1}}>
          <div style={{fontFamily:"var(--font-display)",fontSize:20,color:C.t1}}>
            {group.emoji} {group.name}
          </div>
          <div style={{fontSize:12,color:C.t2}}>
            {step===0
              ?"Tell us about it"
              :step===1
                ?(nightOut?"Finding you a night out…":"Finding your perfect trips…")
                :(nightOut?"Pick your night":"Pick your trip")}
          </div>
        </div>
      </div>

      {/* ── STEP 0: Member readiness + Trip Planning Quiz ── */}
      {step===0&&(
        <>
          {/* Member quiz status - only show for groups, not solo */}
          {!isSolo&&(
          <div style={{padding:"0 20px 16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:600,color:C.t3,textTransform:"uppercase",letterSpacing:".08em"}}>
                Group readiness
              </div>
              <div style={{fontSize:12,color:allComplete?C.green:C.accentText,fontWeight:600}}>
                {completedCount}/{totalCount} ready
              </div>
            </div>

            {/* Progress bar for groups */}
            <div style={{height:5,background:C.s3,borderRadius:3,marginBottom:12,overflow:"hidden"}}>
              <div style={{height:"100%",width:readyPercent+"%",borderRadius:3,
                background:allComplete?`linear-gradient(90deg,${C.green},${C.green})`:`linear-gradient(90deg,${C.accentDeep},${C.accent})`,
                transition:"width .5s ease"}}/>
            </div>

            {/* Member list */}
            {membersList.length>0?(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {membersList.map((m,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                    background:m.quizDone?C.s2:"rgba(239,68,68,.06)",
                    border:"1px solid "+(m.quizDone?C.border:"rgba(239,68,68,.15)"),
                    borderRadius:12}}>
                    <div style={{width:32,height:32,borderRadius:"50%",
                      background:m.quizDone?C.accent:C.s3,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:13,fontWeight:700,color:"white",flexShrink:0,overflow:"hidden"}}>
                      {m.avatar?<img src={m.avatar} style={{width:32,height:32,objectFit:"cover"}} alt=""/>
                        :(m.name||"?")[0].toUpperCase()}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:500,color:C.t1}}>{m.name||"Member"}</div>
                      <div style={{fontSize:11,color:m.quizDone?C.green:C.red,marginTop:1}}>
                        {m.quizDone?"✓ Preferences ready":"⏳ Quiz not complete"}
                      </div>
                    </div>
                    {/* This showed each member's top two answers — what they
                        eat, what they listen to — to everyone else in the
                        group. Readiness is the group's business; the answers
                        are the person's. The server no longer sends them. */}
                  </div>
                ))}
              </div>
            ):(
              <div style={{textAlign:"center",padding:"8px 0",color:C.t3,fontSize:12}}>
                {loadingStatus?"Checking group status…":""}
              </div>
            )}

            {!isSolo&&!allComplete&&(
              <div style={{marginTop:12,background:"linear-gradient(135deg,rgba(212,168,67,0.08),rgba(196,154,56,0.04))",
                border:"1px solid rgba(212,168,67,0.2)",borderRadius:18,padding:"16px"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:12}}>
                  <div style={{width:40,height:40,borderRadius:12,
                    background:"linear-gradient(135deg,rgba(212,168,67,0.22),rgba(212,168,67,0.08))",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>
                    ✨
                  </div>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:C.t1,marginBottom:4}}>
                      Waiting on {totalCount-completedCount} {totalCount-completedCount===1?"member":"members"}
                    </div>
                    <div style={{fontSize:13,color:C.t2,lineHeight:1.6}}>
                      Reach builds better trips when everyone shares what they're into. Nudge whoever hasn't yet.
                    </div>
                  </div>
                </div>
                <button onClick={()=>{
                  // Was hardcoded to a preview deployment that no longer
                  // resolves, so every nudge sent people to a dead link.
                  const where=typeof window!=="undefined"?window.location.origin:"";
                  const msg=`Hey! We're planning a trip on Reach and need your preferences to build the perfect options. Take 2 minutes: ${where}`;
                  if(navigator.share){navigator.share({title:"Complete your Reach quiz",text:msg}).catch(()=>{});}
                  else{navigator.clipboard?.writeText(msg);toast("Copied — paste away");}
                }} style={{width:"100%",padding:"11px 16px",
                  background:`linear-gradient(135deg,${C.accentDeep},${C.accent})`,
                  color:C.onAccent,border:"none",borderRadius:14,
                  fontSize:13,fontWeight:600,cursor:"pointer",
                  boxShadow:"0 4px 16px rgba(212,168,67,0.25)"}}>
                  📲 Nudge them
                </button>
                {/* The person reading this is often one of the people being
                    waited on, and the panel used to offer them everything
                    except the way to sort it. */}
                <button className="bs" style={{width:"100%",marginTop:8}}
                  onClick={()=>push("taste")}>
                  Haven't done yours? Two minutes →
                </button>
              </div>
            )}

            {(allComplete||isSolo)&&(
              <div style={{marginTop:12,background:"linear-gradient(135deg,rgba(52,211,153,0.08),rgba(52,211,153,0.04))",
                border:"1px solid rgba(52,211,153,0.2)",borderRadius:18,padding:"14px 16px",
                display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:36,height:36,borderRadius:10,
                  background:"rgba(52,211,153,0.15)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                  ✅
                </div>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:C.green}}>Everyone's ready!</div>
                  <div style={{fontSize:12,color:C.t2,marginTop:2}}>
                    AI is reading all {totalCount} members' preferences to build your perfect trips.
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Solo banner - only show for solo */}
          {isSolo&&(
            <div style={{padding:"0 20px 16px"}}>
              <div style={{background:"linear-gradient(135deg,rgba(212,168,67,0.1),rgba(196,154,56,0.05))",
                border:"1px solid rgba(212,168,67,0.25)",borderRadius:20,padding:"16px",
                display:"flex",alignItems:"center",gap:14}}>
                <div style={{width:48,height:48,borderRadius:16,
                  background:"linear-gradient(135deg,rgba(212,168,67,0.2),rgba(196,154,56,0.1))",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>
                  🧳
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:600,color:C.t1,marginBottom:3}}>Solo trip</div>
                  <div style={{fontSize:13,color:C.t2,lineHeight:1.5}}>
                    Just for you. Add friends from group settings anytime.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{height:1,background:C.border,margin:"0 20px 16px"}}/>

          <TripQuiz
            departure={departure}
            group={group}
            userLocation={userLocation}
            setPlaceOverride={setPlaceOverride}
            saveDeparture={saveDeparture}
            toast={toast}
            error={error}
            allComplete={allComplete}
            completedCount={completedCount}
            totalCount={totalCount}
            isSolo={isSolo}
            known={knownFromPlan(latestPlan)}
            onGenerate={(dates,tripBudget,prefs,extra)=>{
              setStartDate(dates.start);
              setEndDate(dates.end);
              setBudget(tripBudget);
              setTripPrefs(prefs);
              generate(dates.start,dates.end,tripBudget,prefs,extra);
            }}
          />
        </>
      )}

      {/* ── STEP 1: Generating ── */}
      {step===1&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40,textAlign:"center"}}>
          <div style={{fontSize:60,marginBottom:20}}>✨</div>
          <div style={{fontFamily:"var(--font-display)",fontSize:26,color:C.t1,marginBottom:12}}>
            Building trips for {group.name}
          </div>
          <div style={{fontSize:14,color:C.t2,lineHeight:1.8,marginBottom:30,maxWidth:280}}>
            Reading everyone's food preferences,<br/>
            music taste, and activity vibes...<br/>
            Finding flights from {departure?.airport||departure?.city||"your city"},<br/>
            hotels, restaurants, and experiences...
          </div>
          <div style={{width:240,height:4,background:C.s3,borderRadius:2,overflow:"hidden",marginBottom:20}}>
            <div style={{height:"100%",background:"linear-gradient(90deg,"+C.accent+",#C084FC)",borderRadius:2,animation:"loading 1.5s ease-in-out infinite"}}/>
          </div>
          <div style={{fontSize:12,color:C.t3}}>Usually takes 5-8 seconds</div>
          <style dangerouslySetInnerHTML={{__html:`@keyframes loading{0%{width:0%}50%{width:100%}100%{width:0%;margin-left:100%}}`}}/>
        </div>
      )}

      {/* ── STEP 2: Results ── */}
      {step===2&&trips&&(
        <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none"}}>
          <div style={{padding:"0 20px 12px"}}>
            <div style={{fontSize:14,color:C.t2,lineHeight:1.6}}>
              Three trips built around what {group.name} actually said.{" "}
              <span style={{color:C.red}}>Veto</span> anything you won't do,{" "}
              <span style={{color:C.accentText}}>vote</span> for the one you want.
            </div>
            {/* The days are being written while people read. Say so, rather
                than letting three cards quietly grow a section. */}
            {enrichFailed&&enriching===0&&(
              <div style={{display:"flex",alignItems:"center",gap:9,marginTop:10,fontSize:12.5,color:C.t2}}>
                <span>⚠️</span>
                Couldn't write the details for some of these. Pick one anyway and we'll try again.
              </div>
            )}
            {enriching>0&&(
              <div style={{display:"flex",alignItems:"center",gap:9,marginTop:10,fontSize:12.5,color:C.t2}}>
                <div style={{width:14,height:14,border:`2px solid ${C.accentText}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
                Writing the days for all three, so you can see what you're voting on…
              </div>
            )}
          </div>

          {activeTrips.map((trip,i)=>{
            const voted=myVote===trip.id;
            const voteCount=votes[trip.id]||0;
            return(
              <div key={trip.id} style={{margin:"0 20px 20px"}}>
                <div style={{background:C.s1,border:"2px solid "+(voted?C.accentText:C.border),borderRadius:20,overflow:"hidden",transition:"border-color .2s"}}>

                  {/* Trip header */}
                  <div style={{padding:"18px 18px 14px",background:voted?C.accentDim:C.s2}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:32,marginBottom:6}}>{trip.emoji}</div>
                        <div style={{fontFamily:"var(--font-display)",fontSize:24,color:C.t1,marginBottom:4}}>
                          {trip.destination}
                        </div>
                        <div style={{fontSize:13,color:C.t2,lineHeight:1.5,marginBottom:8}}>
                          {trip.tagline}
                        </div>
                        {trip.why_this_group&&(
                          <div style={{fontSize:12,color:C.accentText,fontWeight:500}}>
                            ✨ {trip.why_this_group}
                          </div>
                        )}
                      </div>
                      <div style={{textAlign:"right",marginLeft:12}}>
                        <div style={{fontFamily:"var(--font-display)",fontSize:28,color:voted?C.accentText:C.t1}}>
                          ${trip.total_per_person?.toLocaleString()}
                        </div>
                        <div style={{fontSize:11,color:C.t3}}>per person, est.</div>
                        <div style={{fontSize:11,color:C.t3}}>{nights} nights</div>
                      </div>
                    </div>
                    <div style={{display:"inline-block",background:C.s3,borderRadius:20,padding:"4px 12px",fontSize:12,color:C.t2,marginTop:8}}>
                      {trip.vibe}
                    </div>
                    {/* What this option does about what somebody actually
                        asked for, by name. The model has been writing these
                        all along and no screen showed them, so the answer to
                        "why is this here" stayed in the database. A person
                        who reads their own words back knows they were
                        listened to; a generic "great for your group" is what
                        every other travel site says. */}
                    {(trip.used_suggestions||[]).length>0&&(
                      <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                        <div style={{fontSize:10.5,color:C.t3,textTransform:"uppercase",
                          letterSpacing:".06em",marginBottom:6}}>Because you said</div>
                        {trip.used_suggestions.slice(0,3).map((line,i)=>(
                          <div key={i} style={{display:"flex",gap:7,marginBottom:4}}>
                            <span style={{color:C.accentText,flexShrink:0,fontSize:12}}>›</span>
                            <span style={{fontSize:12,color:C.t2,lineHeight:1.5}}>{line}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cost breakdown */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>
                      Full cost breakdown per person
                    </div>
                    {[
                      {icon:"✈️",label:"Flights",cost:trip.costs?.flights?.per_person,detail:trip.costs?.flights?.details},
                      {icon:"🏨",label:"Hotel",cost:trip.costs?.accommodation?.per_person,detail:trip.costs?.accommodation?.example},
                      {icon:"🚗",label:"Transport",cost:trip.costs?.ground_transport?.per_person,detail:trip.costs?.ground_transport?.details},
                      {icon:"🍽️",label:"Food & drinks",cost:trip.costs?.food_drink?.per_person,detail:trip.costs?.food_drink?.details},
                      {icon:"🎯",label:"Activities & events",cost:trip.costs?.activities?.per_person,detail:trip.costs?.activities?.details},
                      {icon:"🛡️",label:"Insurance & misc",cost:trip.costs?.misc?.per_person,detail:trip.costs?.misc?.details},
                    ].filter(c=>c.cost).map((c,j)=>(
                      <div key={j} style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:8}}>
                        <span style={{fontSize:16,width:22,flexShrink:0,marginTop:1}}>{c.icon}</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,color:C.t1,fontWeight:500}}>{c.label}</div>
                          <div style={{fontSize:11,color:C.t3,lineHeight:1.4}}>{c.detail}</div>
                        </div>
                        <div style={{fontSize:14,fontWeight:600,color:C.t1,flexShrink:0}}>${c.cost}</div>
                      </div>
                    ))}
                    <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid "+C.border,display:"flex",justifyContent:"space-between"}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.t1}}>Total per person, est.</div>
                      <div style={{fontSize:16,fontWeight:700,color:voted?C.accentText:C.t1}}>${trip.total_per_person?.toLocaleString()}</div>
                    </div>
                    {group.memberIds?.length>1&&(
                      <div style={{fontSize:12,color:C.t3,textAlign:"right",marginTop:2}}>
                        ${(trip.total_per_person*(group.memberIds?.length||2))?.toLocaleString()} total for the group
                      </div>
                    )}
                    {/* Said once, plainly. These are estimates: nobody has
                        priced a room or a seat for this trip, and a number
                        shown without that word reads as one somebody quoted. */}
                    <div style={{fontSize:11,color:C.t3,marginTop:8,lineHeight:1.4}}>
                      Estimates, to plan against — not quotes. Real prices come from
                      the airline and the hotel when you book.
                    </div>
                  </div>

                  {/* Itinerary preview */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>
                      Day-by-day
                    </div>
                    {/* A slot is {plan, booking, payment} now. Rendering it
                        straight would print [object Object]. */}
                    {(trip.itinerary||[]).length===0&&(
                      <div style={{fontSize:12,color:C.t3,lineHeight:1.6}}>
                        {enriching>0?"Writing these days now…":"No day plan for this one — you can build it after you pick it."}
                      </div>
                    )}
                    {(trip.itinerary||[]).slice(0,2).map((day,j)=>{
                      const txt=v=>typeof v==="string"?v:(v?.plan||"");
                      const pay=v=>typeof v==="string"?null:(v?.payment||null);
                      const cashOnly=[day.morning,day.afternoon,day.evening]
                        .map(pay).filter(Boolean).find(x=>/cash only/i.test(x));
                      return(
                      <div key={j} style={{marginBottom:12,paddingBottom:12,borderBottom:j<1?"1px solid "+C.border:"none"}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.accentText,marginBottom:6}}>
                          Day {day.day} · {day.title}
                        </div>
                        <div style={{fontSize:12,color:C.t2,lineHeight:1.7}}>
                          ☀️ {txt(day.morning)}<br/>
                          🌤️ {txt(day.afternoon)}<br/>
                          🌙 {txt(day.evening)}
                        </div>
                        {cashOnly&&(
                          <div style={{fontSize:11,color:C.amber,marginTop:5}}>💵 {cashOnly}</div>
                        )}
                        {day.insider_tip&&(
                          <div style={{fontSize:11,color:C.t3,marginTop:4,fontStyle:"italic",background:C.s2,padding:"6px 10px",borderRadius:8}}>
                            💡 {day.insider_tip}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    {(trip.itinerary||[]).length>2&&(
                      <div style={{fontSize:12,color:C.accentText,fontWeight:500}}>
                        + {trip.itinerary.length-2} more days, all yours the moment you pick this
                      </div>
                    )}
                  </div>

                  {/* Scene info */}
                  {(trip.food_scene||trip.music_scene)&&(
                    <div style={{padding:"12px 18px",borderBottom:"1px solid "+C.border,display:"flex",gap:12}}>
                      {trip.food_scene&&(
                        <div style={{flex:1}}>
                          <div style={{fontSize:11,color:C.t3,marginBottom:3}}>🍽️ Food scene</div>
                          <div style={{fontSize:12,color:C.t2,lineHeight:1.4}}>{trip.food_scene}</div>
                        </div>
                      )}
                      {trip.music_scene&&(
                        <div style={{flex:1}}>
                          <div style={{fontSize:11,color:C.t3,marginBottom:3}}>🎵 Music scene</div>
                          <div style={{fontSize:12,color:C.t2,lineHeight:1.4}}>{trip.music_scene}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{padding:"14px 18px",display:"flex",gap:8}}>
                    <button onClick={()=>veto(trip.id)}
                      style={{flex:1,padding:"12px 8px",borderRadius:12,
                        border:"1px solid rgba(239,68,68,.4)",
                        background:"rgba(239,68,68,.08)",
                        color:C.red,fontSize:13,fontWeight:600,
                        cursor:"pointer"}}>
                      ❌ Veto
                    </button>
                    <button onClick={()=>vote(trip.id)}
                      style={{flex:1,padding:"12px 8px",borderRadius:12,
                        border:"1px solid "+(voted?C.accentText:C.border),
                        background:voted?C.accentDim:"none",
                        color:voted?C.accentText:C.t2,fontSize:13,fontWeight:600,
                        cursor:"pointer"}}>
                      {voted?"❤️ Voted":"🤍 Vote"}
                      {voteCount>0&&" ("+voteCount+")"}
                    </button>
                    <button onClick={()=>selectTrip(trip)}
                      disabled={!!buildingItinerary}
                      style={{flex:1,padding:"12px 8px",borderRadius:12,
                        background:buildingItinerary===trip.id?"rgba(108,99,255,.5)":C.accent,
                        color:"white",border:"none",
                        fontSize:13,fontWeight:600,
                        cursor:buildingItinerary?"not-allowed":"pointer"}}>
                      {buildingItinerary===trip.id?"Building… ✨":"✓ Pick this"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Vetoed trips */}
          {vetoedTrips.length>0&&(
            <div style={{padding:"0 20px 16px"}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:10}}>Vetoed by you</div>
              {vetoedTrips.map(trip=>(
                <div key={trip.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:C.s2,borderRadius:14,marginBottom:8,opacity:.6}}>
                  <span style={{fontSize:24}}>{trip.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,color:C.t2,textDecoration:"line-through"}}>{trip.destination}</div>
                  </div>
                  <button onClick={()=>veto(trip.id)}
                    style={{fontSize:12,color:C.accentText,background:"none",border:"none",cursor:"pointer"}}>
                    Undo
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Regenerate */}
          <div style={{padding:"0 20px 40px"}}>
            <button className="bs" style={{width:"100%"}} onClick={()=>{setStep(0);setTrips(null);setVetoes({});setVotes({});setMyVote(null);setMyVetoes(new Set());}}>
              ↺ Generate different options
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function CreatePlanFlow({onBack,replace,groups,updateGroup,um,toast,defaultGroupId,push,savePlanToServer,saveGroupToServer,setGroups,me,user,departure,fresh}){
  // ── Draft persistence: load saved progress on mount ──────
  const DRAFT_KEY="reach_plan_draft";
  // SSR-safe localStorage helpers — only run in browser
  const isBrowser=typeof window!=="undefined";
  const loadDraft=()=>{if(!isBrowser)return null;try{const d=window.localStorage.getItem(DRAFT_KEY);return d?JSON.parse(d):null;}catch{return null;}};
  const saveDraft=(state)=>{if(!isBrowser)return;try{window.localStorage.setItem(DRAFT_KEY,JSON.stringify(state));}catch{}};
  const clearDraft=()=>{if(!isBrowser)return;try{window.localStorage.removeItem(DRAFT_KEY);}catch{}};

  // Initialize state without calling localStorage at module level
  const [step,setStep]=useState(0);
  const [gid,setGid]=useState(defaultGroupId||null);
  const [planName,setPlanName]=useState("");
  const [planType,setPlanType]=useState(null);
  const [eventDate,setEventDate]=useState("");
  const [eventTime,setEventTime]=useState("");
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [vibe,setVibe]=useState(null);
  const [dest,setDest]=useState(null);
  const [cuisine,setCuisine]=useState(null);
  const [concertGenre,setConcertGenre]=useState(null);
  const [accom,setAccom]=useState(null);
  const [bks,setBks]=useState([]);
  const [budget,setBudget]=useState("");
  const [voting,setVoting]=useState(false);
  const [vopts,setVopts]=useState(["",""]);
  const [draftLoaded,setDraftLoaded]=useState(false);

  // Load draft after mount (browser only)
  //
  // Unless the person asked for a new plan. This restored unconditionally, so
  // the "＋ New plan" tile on the home carousel — which sits a few inches from
  // a separate "Resume your draft" card — handed back the half-finished plan
  // at its saved step, with its saved name, type and dates. Two affordances
  // that read as different things did the same thing, and the one labelled
  // "New" was the one telling the lie.
  //
  // The draft itself is left where it is. Starting a new plan overwrites it at
  // the first step either way, but nothing is thrown away on the strength of a
  // tap that might have been a mistake.
  useEffect(()=>{
    if(draftLoaded)return;
    if(fresh){setDraftLoaded(true);return;}
    const draft=loadDraft();
    if(draft&&(draft.planType||draft.gid)){
      if(draft.step)setStep(draft.step);
      if(draft.gid&&!defaultGroupId)setGid(draft.gid);
      if(draft.planName)setPlanName(draft.planName);
      if(draft.planType)setPlanType(draft.planType);
      if(draft.eventDate)setEventDate(draft.eventDate);
      if(draft.eventTime)setEventTime(draft.eventTime);
      if(draft.startDate)setStartDate(draft.startDate);
      if(draft.endDate)setEndDate(draft.endDate);
      if(draft.vibe)setVibe(draft.vibe);
      if(draft.dest)setDest(draft.dest);
      if(draft.cuisine)setCuisine(draft.cuisine);
      if(draft.concertGenre)setConcertGenre(draft.concertGenre);
      if(draft.accom)setAccom(draft.accom);
      if(draft.bks)setBks(draft.bks);
      if(draft.budget)setBudget(draft.budget);
      if(draft.voting!==undefined)setVoting(draft.voting);
      if(draft.vopts)setVopts(draft.vopts);
    }
    setDraftLoaded(true);
  },[]);
  const [aiRecs,setAiRecs]=useState([]);
  const [loadingRecs,setLoadingRecs]=useState(false);
  const [showExitConfirm,setShowExitConfirm]=useState(false);
  useEscape(showExitConfirm,()=>setShowExitConfirm(false));
  const selGroup=groups.find(g=>g.id===gid);
  // Solo mode is first-class: a group of one gets the same flow with the
  // voting UI absent and enable_voting false.
  const isSoloGroup=(selGroup?.memberIds?.length??1)<=1;

  // "Just me" needs somewhere for the plan to live, because a plan belongs to
  // a group. Reuse the personal group if there is one, otherwise make it once
  // and quietly. Solo was previously only inferrable from a group that
  // happened to have one member — there was no way to ask for it.
  const personalGroup=groups.find(g=>(g.memberIds||[]).length===1&&(g.memberIds||[])[0]===me);
  const [makingSolo,setMakingSolo]=useState(false);
  const chooseSolo=async()=>{
    if(makingSolo)return;
    if(personalGroup){setGid(personalGroup.id);return;}
    setMakingSolo(true);
    try{
      const tempId="g_local_"+Date.now();
      const draft={id:tempId,name:"Just me",emoji:"🧍",memberIds:me?[me]:[],
        inviteEmails:[],wallet:0,tags:[],plans:[]};
      setGroups(gs=>[...gs,draft]);
      const realId=saveGroupToServer?await saveGroupToServer(draft):null;
      if(!realId)throw new Error("Couldn't set up a solo trip — please try again");
      setGid(realId);
    }catch(e){toast(e.message);}
    finally{setMakingSolo(false);}
  };

  // Auto-save draft whenever state changes
  useEffect(()=>{
    if(!planType&&!gid)return; // nothing to save yet
    saveDraft({step,gid,planName,planType,eventDate,eventTime,startDate,endDate,vibe,dest,cuisine,concertGenre,accom,bks,budget,voting,vopts});
  },[step,gid,planName,planType,eventDate,eventTime,startDate,endDate,vibe,dest,cuisine,concertGenre,accom,bks,budget,voting,vopts]);

  const hasDraftProgress=!!(planType||gid);

  const handleBack=()=>{
    if(hasDraftProgress&&step>0){
      setShowExitConfirm(true);
    } else if(hasDraftProgress&&step===0){
      setShowExitConfirm(true);
    } else {
      clearDraft();
      onBack();
    }
  };

  // ── Type config: controls which steps show and what they say ─
  const isEvent=planType==="restaurant"||planType==="concert";
  const isWeekend=planType==="weekend";
  const isTrip=planType==="trip";

  // Steps adapt based on plan type
  const STEPS=planType==="restaurant"
    ? ["Type","When","Cuisine","Budget"]
    : planType==="concert"
    ? ["Type","When","Genre","Budget"]
    : planType==="weekend"
    ? ["Type","When","Vibe","Stay","Budget"]
    : ["Type","When","Vibe","Stay","Rules","Budget"]; // trip

  const nights=()=>{
    if(isEvent)return 0;
    if(!startDate||!endDate)return 0;
    return Math.max(0,(new Date(endDate)-new Date(startDate))/86400000);
  };

  const getDurationLabel=()=>{
    const n=nights();
    if(isEvent)return"Single event";
    if(n===0)return"Select dates";
    if(n===1)return"1 night";
    if(n<=3)return`${n} nights · Weekend`;
    if(n<=7)return`${n} nights · Week trip`;
    return`${n} nights · Extended trip`;
  };

  const getDefaultBudget=()=>{
    if(planType==="restaurant")return"150";
    if(planType==="concert")return"200";
    if(planType==="weekend")return"500";
    if(nights()<=3)return"800";
    if(nights()<=7)return"2000";
    return"3500";
  };

  const getBudgetPresets=()=>{
    if(planType==="restaurant")return["50","100","150","300"];
    if(planType==="concert")return["100","200","350","500"];
    if(planType==="weekend")return["300","500","800","1500"];
    return["1000","2000","3500","5000"];
  };

  const getBudgetLabel=()=>{
    if(planType==="restaurant")return"per person, dinner & drinks";
    if(planType==="concert")return"per person, tickets & transport";
    if(planType==="weekend")return"per person, all-in";
    return"per person, everything included";
  };

  const canContinue=()=>{
    const label=STEPS[step];
    if(label==="Type")return !!(gid&&planType);
    if(label==="When"){
      if(isEvent)return !!(eventDate);
      return !!(startDate&&endDate&&nights()>0);
    }
    if(label==="Cuisine"||label==="Genre"||label==="Vibe"||label==="Details")return true;
    if(label==="Stay")return !!(accom);
    if(label==="Rules")return true;
    if(label==="Budget")return !!(budget);
    return true;
  };

  const DBS=["Cold weather","Extreme heat","Crowds","Long flights","Hiking","Nightlife","Spicy food","Early starts","Camping","Loud venues","Outdoor dining"];

  // Auto-set budget when type is selected
  useEffect(()=>{
    if(planType&&!budget)setBudget(getDefaultBudget());
  },[planType,startDate,endDate]);

  // Load AI recs when vibe+dest+budget are set (trips only)
  useEffect(()=>{
    if(!isTrip||!vibe||!dest||!budget)return;
    const timer=setTimeout(async()=>{
      try{
        setLoadingRecs(true);
        // Where this group actually is. Without it the server refuses rather
        // than letting the model pick a city it has heard of — which is how
        // somebody in Aberdeen was offered San Francisco restaurants.
        const location=user?.homeCity||departure?.city||"";
        const res=await fetch("/api/recommendations",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({vibe,destStyle:dest,accommodation:accom,dealbreakers:bks,budget:parseInt(budget),nights:nights(),travelers:selGroup?.memberIds?.length||2,location}),
        });
        if(res.ok){const {recommendations}=await res.json();setAiRecs(recommendations||[]);setNeedLocation(false);}
        else if(res.status===422){
          // Nothing on file and nothing from the browser. Ask, rather than
          // showing six places in a city nobody is in.
          setNeedLocation(true);setAiRecs([]);
          console.error("[createPlan] recommendations need a location");
        }
        else console.error("[createPlan] recommendations returned",res.status);
      }catch(e){console.error("[createPlan] recommendations failed",e);}
      finally{setLoadingRecs(false);}
    },800);
    return()=>clearTimeout(timer);
  },[vibe,dest,budget,accom]);

  // Set when the server has nothing to place these suggestions near.
  const [needLocation,setNeedLocation]=useState(false);

  const [finishing,setFinishing]=useState(false);
  const finish=()=>{
    if(!gid||finishing)return;
    setFinishing(true);
    const dateRange=isEvent
      ?formatDates(eventDate,null,eventTime)
      :formatDates(startDate,endDate);
    const np={
      id:"p"+Date.now(),
      title:planName||(planType==="restaurant"?"Dinner out":planType==="concert"?"Concert Night":planType==="weekend"?"Weekend Away":selGroup?.name+" Trip"),
      status:(voting&&!isSoloGroup)?"voting":"planning",
      dates:dateRange,
      startDate:(isEvent?eventDate:startDate)||null,
      endDate:isEvent?null:(endDate||null),
      budget:parseInt(budget)||0,
      type:planType||"trip",
      // Carried, not discarded: the quiz reads these and skips what it
      // already knows instead of asking twice.
      vibe:vibe||null,
      destStyle:dest||null,
      accommodation:accom||null,
      dealbreakers:bks||[],
      participants:selGroup?.memberIds||[],
      itinerary:[],
      votes:(voting&&!isSoloGroup)?Object.fromEntries(vopts.filter(Boolean).map(o=>[o,0])):{},
      options:voting?vopts.filter(Boolean):[],
    };
    updateGroup(gid,g=>({...g,plans:[...g.plans,np]}));
    toast("Plan created! 🎉");
    clearDraft();
    // Finishing a plan used to put you back on the list you came from, with
    // the thing you just spent six screens on somewhere in it. The plan opens
    // instead, where the next step — build the days — is waiting. Replace
    // rather than push, so Back goes to the list and not to a finished form.
    const land=(id)=>{
      const go=replace||push;
      go("planDetail",{planId:id||np.id,groupId:gid});
    };
    if(typeof savePlanToServer==="function"){
      Promise.resolve(savePlanToServer(gid,np)).then(land).catch(()=>land(np.id));
    }else{
      land(np.id);
    }
    setTimeout(()=>setFinishing(false),1500);
  };

  // ── Cuisine options for restaurants ─────────────────────────
  const CUISINES=[
    {id:"italian",e:"🍝",l:"Italian"},{id:"japanese",e:"🍣",l:"Japanese"},
    {id:"mexican",e:"🌮",l:"Mexican"},{id:"american",e:"🍔",l:"American"},
    {id:"seafood",e:"🦞",l:"Seafood"},{id:"steakhouse",e:"🥩",l:"Steakhouse"},
    {id:"indian",e:"🍛",l:"Indian"},{id:"any",e:"🍽️",l:"Surprise us"},
  ];

  // ── Concert genres ───────────────────────────────────────────
  const GENRES=[
    {id:"pop",e:"🎤",l:"Pop / R&B"},{id:"rock",e:"🎸",l:"Rock / Indie"},
    {id:"hiphop",e:"🎧",l:"Hip-Hop"},{id:"edm",e:"🎛️",l:"EDM / Dance"},
    {id:"jazz",e:"🎷",l:"Jazz / Soul"},{id:"country",e:"🤠",l:"Country"},
    {id:"classical",e:"🎻",l:"Classical"},{id:"any",e:"🎵",l:"Any genre"},
  ];

  return(
    <div className="sc">
      {/* Exit confirmation sheet */}
      {showExitConfirm&&(
        <div className="ov" onClick={()=>setShowExitConfirm(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div style={{padding:"20px 20px 10px",textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:10}}>💾</div>
              <div style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1,marginBottom:8}}>Save your progress?</div>
              <div style={{fontSize:14,color:C.t2,lineHeight:1.6,marginBottom:20}}>Your plan is saved as a draft. You can pick up exactly where you left off.</div>
              <div style={{display:"flex",flexDirection:"column",gap:10,padding:"0 0 20px"}}>
                <button className="bp" onClick={()=>{setShowExitConfirm(false);toast("Draft saved — pick up where you left off anytime");onBack();}}>Save draft & exit</button>
                <button className="bs" style={{color:C.red,borderColor:C.red}} onClick={()=>{clearDraft();setShowExitConfirm(false);onBack();}}>Discard and exit</button>
                <button style={{background:"none",border:"none",color:C.accentText,fontSize:14,fontWeight:500,cursor:"pointer",padding:"8px 0"}} onClick={()=>setShowExitConfirm(false)}>Keep planning</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{padding:"12px 20px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <ScreenHeader onBack={handleBack}/>
          <div style={{flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em"}}>{STEPS[step]}</div>
              <div style={{fontSize:11,color:C.t3}}>{step+1} / {STEPS.length}</div>
            </div>
            <div style={{display:"flex",gap:3,marginBottom:2}}>
              {STEPS.map((_,i)=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=step?C.accent:C.s3,transition:"background .3s"}}/>)}
            </div>
          </div>
        </div>
        {planType&&(
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0 2px"}}>
            <span style={{fontSize:16}}>{planType==="restaurant"?"🍽️":planType==="concert"?"🎵":planType==="weekend"?"🏡":"✈️"}</span>
            <span style={{fontSize:12,color:C.accentText,fontWeight:600}}>{planType==="restaurant"?"Dinner out":planType==="concert"?"Concert":planType==="weekend"?"Weekend away":"Trip"}</span>
            {!isEvent&&nights()>0&&<span style={{fontSize:12,color:C.t3}}>· {getDurationLabel()}</span>}
            {isEvent&&eventDate&&<span style={{fontSize:12,color:C.t3}}>· {eventDate}</span>}
          </div>
        )}
      </div>
      <div style={{padding:"0 20px"}}>

        {step===0&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>Who's joining?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Select a group and what you're planning.</div>
            <input aria-label="Plan name" className="inp" value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="Plan name (e.g., Summer Beach Trip)" style={{marginBottom:14}}/>
            <div className="sl" style={{marginBottom:10}}>Who is this for?</div>
            <div {...pressable} onClick={chooseSolo}
              style={{display:"flex",alignItems:"center",gap:12,padding:13,borderRadius:14,
                border:`2px solid ${isSoloGroup&&gid?C.accentText:C.border}`,
                background:isSoloGroup&&gid?C.accentDim:C.s2,marginBottom:8,
                cursor:makingSolo?"progress":"pointer",opacity:makingSolo?.6:1}}>
              <span style={{fontSize:22}}>🧍</span>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600,color:C.t1}}>
                  {makingSolo?"Setting up…":"Just me"}
                </div>
                <div style={{fontSize:12,color:C.t2}}>A solo trip — no voting, no splitting</div>
              </div>
              {isSoloGroup&&gid&&<div style={{color:C.accentText}}><Ic.Check/></div>}
            </div>
            {groups.filter(g=>(g.memberIds||[]).length>1).length>0&&(
              <div className="sl" style={{margin:"14px 0 10px"}}>Or with a group</div>
            )}
            {groups.filter(g=>(g.memberIds||[]).length>1).map(g=>(
              <div key={g.id} {...pressable} onClick={()=>setGid(g.id)} style={{display:"flex",alignItems:"center",gap:12,padding:13,borderRadius:14,border:`2px solid ${gid===g.id?C.accentText:C.border}`,background:gid===g.id?C.accentDim:C.s2,marginBottom:8,cursor:"pointer"}}>
                <span style={{fontSize:22}}>{g.emoji}</span>
                <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:C.t1}}>{g.name}</div><div style={{fontSize:12,color:C.t2}}>{g.memberIds.length} members</div></div>
                {gid===g.id&&<div style={{color:C.accentText}}><Ic.Check/></div>}
              </div>
            ))}
            <div className="sl" style={{margin:"14px 0 10px"}}>What are you planning?</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{id:"trip",e:"✈️",l:"Trip"},{id:"restaurant",e:"🍽️",l:"Dinner out"},{id:"concert",e:"🎵",l:"Concert"},{id:"weekend",e:"🏡",l:"Weekend Away"}].map(t=>(
                <button key={t.id} onClick={()=>setPlanType(t.id)} style={{padding:"16px 12px",borderRadius:14,border:`2px solid ${planType===t.id?C.accentText:C.border}`,background:planType===t.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center"}}>
                  <div style={{fontSize:26,marginBottom:6}}>{t.e}</div><div style={{fontSize:13,fontWeight:600,color:C.t1}}>{t.l}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step===1&&(
          <div>
            {isEvent?(
              <>
                <div className="pt" style={{marginBottom:6}}>When is it?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>
                  {planType==="restaurant"?"Pick the date and time for your dinner.":"Pick the date for the concert or event."}
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Date</div>
                  <input aria-label="Date" type="date" className="inp" value={eventDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setEventDate(e.target.value)} style={{color:C.t1}}/>
                </div>
                {planType==="restaurant"&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Reservation time (optional)</div>
                    <input aria-label="Time" type="time" className="inp" value={eventTime} onChange={e=>setEventTime(e.target.value)} style={{color:C.t1}}/>
                  </div>
                )}
                {planType==="concert"&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,color:C.t2,marginBottom:8}}>Do you already have a specific event in mind?</div>
                    <input aria-label="Plan name" className="inp" value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="Artist or event name (optional)" style={{marginBottom:8}}/>
                  </div>
                )}
                {eventDate&&(
                  <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:"12px 16px",textAlign:"center",marginBottom:14}}>
                    <div style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1}}>
                      {new Date(eventDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
                    </div>
                    {eventTime&&<div style={{fontSize:13,color:C.accentText,marginTop:4}}>{eventTime}</div>}
                  </div>
                )}
              </>
            ):(
              <>
                <div className="pt" style={{marginBottom:6}}>When?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>
                  {/* Nothing checks anyone's availability. Saying so was a
                      promise the app had no way to keep, and it is the sort
                      a group finds out about the hard way. */}
                  {isWeekend?"Pick your weekend getaway dates.":"Pick the dates. Everyone gets asked before anything is booked."}
                </div>
                {isWeekend&&(
                  <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                    {["This weekend","Next weekend","In 2 weeks","In a month"].map(preset=>(
                      <button key={preset} onClick={()=>{
                        const d=new Date();
                        const day=d.getDay();
                        const daysToFri=preset.includes("Next")?12-day:5-day<0?5-day+7:5-day;
                        const offset=preset.includes("2 weeks")?12:preset.includes("month")?26:daysToFri;
                        const fri=new Date(d.getTime()+offset*86400000);
                        const sun=new Date(fri.getTime()+2*86400000);
                        setStartDate(fri.toISOString().split("T")[0]);
                        setEndDate(sun.toISOString().split("T")[0]);
                      }} style={{padding:"7px 14px",borderRadius:20,border:`1px solid ${C.border}`,background:C.s2,color:C.t2,fontSize:12,fontWeight:500,cursor:"pointer"}}>
                        {preset}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:10,marginBottom:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{isWeekend?"Friday":"Departure"}</div>
                    <input aria-label="First day" type="date" className="inp" value={startDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{isWeekend?"Sunday":"Return"}</div>
                    <input aria-label="Last day" type="date" className="inp" value={endDate} min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
                  </div>
                </div>
                {nights()>0&&(
                  <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:"12px 16px",marginBottom:14,textAlign:"center"}}>
                    <div style={{fontFamily:"var(--font-display)",fontSize:28,color:C.t1}}>{getDurationLabel()}</div>
                    <div style={{fontSize:12,color:C.t2,marginTop:2}}>{selGroup?.name} · {selGroup?.memberIds?.length||"?"} people</div>
                  </div>
                )}
              </>
            )}
            {selGroup&&(
              <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,color:C.t2,marginBottom:8}}><strong style={{color:C.t1}}>{isEvent?"Going with:":"Traveling with:"}</strong></div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {selGroup.memberIds.map(uid=>{const u=um[uid];return u?(<div key={uid} style={{display:"flex",alignItems:"center",gap:6,background:C.s3,borderRadius:20,padding:"4px 10px"}}><div className="av" style={{background:u.color,width:18,height:18,fontSize:10}}>{u.initials}</div><span style={{fontSize:12,color:C.t1}}>{u.name.split(" ")[0]}</span></div>):null;})}
                </div>
              </div>
            )}
          </div>
        )}

        {step===2&&(
          <div>
            {planType==="restaurant"?(
              <>
                <div className="pt" style={{marginBottom:6}}>What are you in the mood for?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Reach will find the best options for your group.</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                  {CUISINES.map(c=>(
                    <button key={c.id} onClick={()=>setCuisine(c.id)} style={{padding:"14px 10px",borderRadius:14,border:`2px solid ${cuisine===c.id?C.accentText:C.border}`,background:cuisine===c.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center"}}>
                      <div style={{fontSize:24,marginBottom:4}}>{c.e}</div><div style={{fontSize:12,fontWeight:600,color:C.t1}}>{c.l}</div>
                    </button>
                  ))}
                </div>
                <div className="sl" style={{marginBottom:8}}>Atmosphere</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Casual & fun","Date night vibes","Special occasion","Lively & loud","Quiet & intimate"].map(a=>(
                    <button key={a} onClick={()=>setVibe(v=>v===a?null:a)} style={{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${vibe===a?C.accentText:C.border}`,background:vibe===a?C.accentDim:C.s2,color:vibe===a?C.accentText:C.t2,fontSize:13,cursor:"pointer"}}>{a}</button>
                  ))}
                </div>
              </>
            ):planType==="concert"?(
              <>
                <div className="pt" style={{marginBottom:6}}>What kind of show?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>This helps us find events your whole group will love.</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                  {GENRES.map(g=>(
                    <button key={g.id} onClick={()=>setConcertGenre(g.id)} style={{padding:"14px 10px",borderRadius:14,border:`2px solid ${concertGenre===g.id?C.accentText:C.border}`,background:concertGenre===g.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center"}}>
                      <div style={{fontSize:24,marginBottom:4}}>{g.e}</div><div style={{fontSize:12,fontWeight:600,color:C.t1}}>{g.l}</div>
                    </button>
                  ))}
                </div>
                <div className="sl" style={{marginBottom:8}}>Venue type</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Arena","Club / Bar","Outdoor festival","Intimate venue","Theater"].map(v=>(
                    <button key={v} onClick={()=>setDest(d=>d===v?null:v)} style={{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${dest===v?C.accentText:C.border}`,background:dest===v?C.accentDim:C.s2,color:dest===v?C.accentText:C.t2,fontSize:13,cursor:"pointer"}}>{v}</button>
                  ))}
                </div>
              </>
            ):(
              <>
                <div className="pt" style={{marginBottom:6}}>What's the vibe?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>This shapes every AI recommendation.</div>
                <div className="sl" style={{marginBottom:10}}>Energy</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
                  {[{id:"chill",e:"🧘",l:"Chill & Relax"},{id:"active",e:"⚡",l:"High Energy"},{id:"culture",e:"🎭",l:"Culture & Arts"},{id:"mix",e:"🎲",l:"Mix It Up"}].map(v=>(
                    <button key={v.id} onClick={()=>setVibe(v.id)} style={{padding:"16px 12px",borderRadius:14,border:`2px solid ${vibe===v.id?C.accentText:C.border}`,background:vibe===v.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center"}}>
                      <div style={{fontSize:28,marginBottom:6}}>{v.e}</div><div style={{fontSize:13,fontWeight:600,color:C.t1}}>{v.l}</div>
                    </button>
                  ))}
                </div>
                <div className="sl" style={{marginBottom:10}}>Destination style</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[{id:"city",e:"🏙️",l:"City"},{id:"beach",e:"🏖️",l:"Beach"},{id:"mountains",e:"🏔️",l:"Mountains"},{id:"nature",e:"🌿",l:"Nature"}].map(d=>(
                    <button key={d.id} onClick={()=>setDest(d.id)} style={{padding:"16px 12px",borderRadius:14,border:`2px solid ${dest===d.id?C.accentText:C.border}`,background:dest===d.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center"}}>
                      <div style={{fontSize:28,marginBottom:6}}>{d.e}</div><div style={{fontSize:13,fontWeight:600,color:C.t1}}>{d.l}</div>
                    </button>
                  ))}
                </div>
                {/* Nothing on file and nothing from the browser. Say what is
                    missing and where to put it, rather than showing six
                    places in a city nobody is in. */}
                {needLocation&&(
                  <div style={{marginTop:16,background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:14}}>
                    <div style={{fontSize:13.5,color:C.t1,fontWeight:600,marginBottom:5}}>Where are you?</div>
                    <div style={{fontSize:12.5,color:C.t2,lineHeight:1.55,marginBottom:10}}>
                      Suggestions are real places you can get to, so we need the town to look in.
                      Add it once and every suggestion after this reads it.
                    </div>
                    <button className="bsm bsm-p" onClick={()=>{onBack();push("profile");}}>Add your town →</button>
                  </div>
                )}
                {aiRecs.length>0&&(
                  <div style={{marginTop:16}}>
                    <div className="sl" style={{marginBottom:10}}>✨ AI picks for your group</div>
                    <div style={{display:"flex",gap:10,overflowX:"auto",scrollbarWidth:"none",paddingBottom:4}}>
                      {aiRecs.slice(0,3).map((r,i)=>(
                        <div key={i} style={{minWidth:160,background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:12,flexShrink:0}}>
                          <div style={{fontSize:22,marginBottom:4}}>{r.emoji}</div>
                          <div style={{fontSize:13,fontWeight:600,color:C.t1,marginBottom:2}}>{r.title}</div>
                          <div style={{fontSize:11,color:C.t2,marginBottom:4}}>{r.price}</div>
                          <div style={{fontSize:11,color:C.t3,lineHeight:1.4}}>{r.reason}</div>
                        </div>
                      ))}
                      {loadingRecs&&<div style={{minWidth:120,background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><div style={{fontSize:12,color:C.t3}}>Loading AI picks…</div></div>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step===3&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>Where to stay?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Choose your preferred accommodation type.</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[{id:"hotel",e:"🏨",l:"Hotel",s:"Service & convenience"},{id:"rental",e:"🏡",l:"Vacation rental",s:"Space & flexibility"},{id:"luxury",e:"✨",l:"Luxury resort",s:"Premium all-inclusive"},{id:"boutique",e:"🎪",l:"Boutique / Unique",s:"One-of-a-kind stays"},{id:"hostel",e:"🎒",l:"Budget / Hostel",s:"Save money, meet people"}].map(a=>(
                <button key={a.id} onClick={()=>setAccom(a.id)} style={{padding:"14px 16px",borderRadius:14,border:`2px solid ${accom===a.id?C.accentText:C.border}`,background:accom===a.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14}}>
                  <span style={{fontSize:26}}>{a.e}</span>
                  <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:C.t1}}>{a.l}</div><div style={{fontSize:12,color:C.t2}}>{a.s}</div></div>
                  {accom===a.id&&<div style={{color:C.accentText}}><Ic.Check/></div>}
                </button>
              ))}
            </div>
          </div>
        )}

        {step===4&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>Any dealbreakers?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Reach won't recommend anything that crosses these lines.</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:18}}>
              {DBS.map(d=>{const sel=bks.includes(d);return(
                <button key={d} onClick={()=>setBks(b=>sel?b.filter(x=>x!==d):[...b,d])} style={{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${sel?C.red:C.border}`,background:sel?C.redDim:C.s2,color:sel?C.red:C.t2,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                  {sel?"✕ ":""}{d}
                </button>
              );})}
            </div>
            <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,color:C.t2}}><strong style={{color:C.t1}}>AI note:</strong> Reach asks all members for their dealbreakers. Only destinations that work for everyone will be recommended.</div>
            </div>
          </div>
        )}

        {step===5&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>What's the budget?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Per person, everything in. We plan three options around it.</div>
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:16,marginBottom:14}}>
              <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>
                {isEvent?"Typical cost for this":"AI cost estimate"}
              </div>
              <div style={{fontFamily:"var(--font-display)",fontSize:28,color:C.accentText}}>
                {planType==="restaurant"?`$${Math.round(parseInt(budget||0)*.6).toLocaleString()} – $${parseInt(budget||0).toLocaleString()} pp`
                :planType==="concert"?`$${Math.round(parseInt(budget||0)*.5).toLocaleString()} – $${parseInt(budget||0).toLocaleString()} pp`
                :`$${Math.round(parseInt(budget||0)*.7).toLocaleString()} – $${Math.round(parseInt(budget||0)*1.05).toLocaleString()}`}
              </div>
              <div style={{fontSize:12,color:C.t2,marginTop:4}}>
                {isEvent
                  ?`${selGroup?.memberIds?.length||2} people · ${planType==="restaurant"?"dinner & drinks":"tickets & transport"}`
                  :`${plural(selGroup?.memberIds?.length||2,"traveller")} · ${nights()>0?plural(nights(),"night")+" · ":""}${getBudgetLabel()}`
                }
              </div>
            </div>
            <div style={{background:C.s1,border:`2px solid ${C.accentText}`,borderRadius:16,padding:"14px 20px",display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <span style={{fontFamily:"var(--font-display)",fontSize:28,color:C.t3}}>$</span>
              <input aria-label="Budget per person" style={{background:"none",border:"none",fontFamily:"var(--font-display)",fontSize:36,color:C.t1,width:"100%"}} value={budget} onChange={e=>setBudget(e.target.value.replace(/\D/g,""))} inputMode="numeric" placeholder="2500"/>
              <span style={{fontSize:12,color:C.t3}}>max</span>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:18}}>
              {getBudgetPresets().map(v=>(
                <button key={v} onClick={()=>setBudget(v)} style={{flex:1,padding:"8px 4px",borderRadius:10,border:`1px solid ${budget===v?C.accentText:C.border}`,background:budget===v?C.accentDim:C.s2,color:budget===v?C.accentText:C.t2,fontSize:12,fontWeight:600,cursor:"pointer"}}>${parseInt(v).toLocaleString()}</button>
              ))}
            </div>
            {/* Solo mode is first-class: a group of one gets the same flow with
                the voting UI absent, never a toggle asking them to vote
                against themselves. */}
            {!isSoloGroup&&(
              <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:voting?12:0}}>
                  <div><div style={{fontSize:14,fontWeight:500,color:C.t1}}>Enable destination voting</div><div style={{fontSize:12,color:C.t2,marginTop:2}}>Let everyone have a say on where you end up</div></div>
                  <button onClick={()=>setVoting(v=>!v)} aria-pressed={voting} style={{width:44,height:26,borderRadius:13,background:voting?C.accentText:C.s3,border:`1px solid ${voting?C.accentText:C.border}`,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                    <div style={{width:20,height:20,borderRadius:"50%",background:C.s1,position:"absolute",top:2,left:voting?21:2,transition:"left .2s"}}/>
                  </button>
                </div>
                {voting&&vopts.map((opt,i)=>(
                  <input aria-label="Something to vote on" key={i} className="inp" style={{fontSize:13,marginTop:8}} placeholder={`Option ${i+1} (e.g. Lisbon)`} value={opt} onChange={e=>setVopts(v=>v.map((x,j)=>j===i?e.target.value:x))}/>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",gap:10,paddingTop:16,paddingBottom:30}}>
          {step>0&&<button className="bs" style={{flex:1}} onClick={()=>setStep(s=>s-1)}>← Back</button>}
          {step===0&&<button className="bs" style={{flex:1}} onClick={handleBack}>Cancel</button>}
          {step<STEPS.length-1
            ?<button className="bp" style={{flex:2}} disabled={!canContinue()} onClick={()=>setStep(s=>s+1)}>Continue →</button>
            :<button className="bp" style={{flex:2}} disabled={!budget||finishing} onClick={finish}>
              {planType==="restaurant"?"Plan dinner 🍽️"
              :planType==="concert"?"Plan this night 🎵"
              :planType==="weekend"?"Plan this weekend 🏡"
              :"Create trip 🎉"}
            </button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Where this trip is up to ─────────────────────────────────────────────
// A plan moves through the same four stages every time, and until now nothing
// said which one you were in or what to do next. Three things follow from
// showing it:
//
//   People finish what they can see the end of — a visible remaining step
//   pulls harder than an invisible one.
//   "Waiting on two people" reads as something to rescue; "two people haven't
//   paid" reads as an accusation. Same fact, different verb.
//   One obvious next action beats four buttons of equal weight, because
//   choosing between equals is work.
function TripProgress({plan,group,soloTrip,votesIn,onAction,busy}){
  const days=plan.itinerary?.length||0;
  const heads=(group.memberIds||[]).length||1;
  const needVote=!soloTrip&&plan.options?.length>0;

  const stages=[
    {k:"planned", l:"Planned",  done:days>0},
    ...(needVote?[{k:"voted", l:"Agreed", done:votesIn>=heads}]:[]),
    {k:"funded",  l:soloTrip?"Paid":"Funded", done:plan.status==="approved"||plan.status==="booked"},
    {k:"booked",  l:"Booked",   done:plan.status==="booked"},
  ];
  const next=stages.find(s=>!s.done);
  const doneCount=stages.filter(s=>s.done).length;

  // The one thing to do now, said as a thing to do rather than a status.
  const action={
    planned:{label:"✨ Plan the days",  hint:`${plan.title} has no day-by-day plan yet.`},
    voted:  {label:"Give them a nudge", hint:`${votesIn} of ${heads} have voted. The trip is waiting on the rest.`},
    funded: {label:soloTrip?"Pay and book it":"Collect everyone's share",
             hint:soloTrip?"Pay when you're ready and we'll book it.":`Nothing books until all ${heads} are in.`},
    booked: {label:"Book everything",   hint:"Funded and agreed — the booking button is just below."},
  }[next?.k];

  return(
    <div style={{margin:"0 20px 16px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:18,overflow:"hidden"}}>
      <div style={{display:"flex",gap:6,padding:"14px 16px 0"}}>
        {stages.map((s,i)=>(
          <div key={s.k} style={{flex:1}}>
            <div style={{height:4,borderRadius:2,background:s.done?C.accentText:C.s3,transition:"background .3s"}}/>
            <div style={{fontSize:11,marginTop:6,color:s.done?C.accentText:C.t3,
              fontWeight:s.done?600:500,letterSpacing:".02em"}}>{s.l}</div>
          </div>
        ))}
      </div>
      {next?(
        <div style={{padding:"12px 16px 16px"}}>
          <div style={{fontSize:13,color:C.t2,lineHeight:1.55,marginBottom:10}}>{action.hint}</div>
          {/* Every stage but the last offers the one thing to do next. The
              last one does not: the Bookings section below already carries a
              "Book everything" button, and this card carried a second one
              beside it priced off the itinerary's estimate while that one was
              priced off the booking rows — the same trip reading $1,474 here
              and $404 there. Two buttons that do the same thing for different
              money is not a choice anybody can make. */}
          {next.k==="booked"
            ?null
            :(
              <button className="bp" disabled={busy} onClick={()=>onAction(next.k)} style={{width:"100%"}}>
                {busy?"Working…":action.label}
              </button>
            )}
        </div>
      ):(
        <div style={{padding:"12px 16px 16px",display:"flex",alignItems:"center",gap:9}}>
          <span style={{fontSize:20}}>🎉</span>
          <div style={{fontSize:13,color:C.t1,lineHeight:1.5}}>
            That's everything. Nothing left to organise — go and have it.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PLAN DETAIL ──────────────────────────────────────────────────────────────
// ─── How you actually sort one line out ──────────────────────────────────
// The ticket link, the venue's own site, the phone number. Defined once
// because it had already been written once, on the itinerary row, and the
// Budget tab listed the very same items as prices with nothing to tap —
// "Reach will book these" and "You pay on the day", both read-only, both
// naming places whose website and phone number we hold.
//
// That is the fault this codebase makes most often: a fact the app holds
// stopping one layer short. Here it stopped one *tab* short. Anything that
// renders a bookable line renders this, so a second copy cannot drift from
// the first.
function ItemActions({item,markGot,tight}){
  if(!item)return null;
  const ticketed=item.type==="event"&&item.venue_website;
  const site=item.type!=="event"&&item.venue_website;
  const phone=item.type==="restaurant"&&item.venue_phone;
  if(!ticketed&&!site&&!phone)return null;
  // Anything somebody has to arrange can be said to be arranged. Only a
  // ticket could be marked done, so a table you had just rung stayed on the
  // "still needs you" list for the rest of the trip — a checklist that
  // cannot be finished is a screen telling you something untrue, every time
  // you open it.
  const needsDoing=ticketed||item.booking_mode==="ahead";
  if(item.filled&&needsDoing)return(
    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:tight?6:8,
      fontSize:12.5,fontWeight:600,color:C.green}}>
      ✓ {ticketed?"Tickets sorted":"Sorted"}
    </div>
  );
  const gap=tight?6:8;
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:gap}}>
      {/* A ticket is bought from whoever sells it. Reach cannot sell one, and
          the honest complete answer is to hand somebody to the page that can. */}
      {ticketed&&(
        <a href={item.venue_website} target="_blank" rel="noopener noreferrer"
          style={{display:"inline-flex",alignItems:"center",gap:6,background:C.accent,color:C.onAccent,
            fontSize:12.5,fontWeight:700,padding:"8px 14px",borderRadius:999,textDecoration:"none"}}>
          🎟️ Get tickets{item.venue_name?` · ${item.venue_name}`:""} →
        </a>
      )}
      {/* Anything we hold an address for gets a way in — a place's own site
          for a table or a class. Every verified venue has one. */}
      {site&&(
        <a href={item.venue_website} target="_blank" rel="noopener noreferrer"
          style={{display:"inline-flex",alignItems:"center",gap:6,
            border:`1px solid ${C.border}`,color:C.accentText,fontSize:12.5,fontWeight:600,
            padding:"7px 12px",borderRadius:999,textDecoration:"none"}}>
          {item.venue_name||"Their site"} →
        </a>
      )}
      {/* Most restaurants are not on a booking platform. For those the phone
          is the answer, and it is the one we hold most often. */}
      {phone&&(
        <a href={`tel:${String(item.venue_phone).replace(/[^0-9+]/g,"")}`}
          style={{display:"inline-flex",alignItems:"center",gap:6,
            border:`1px solid ${C.border}`,color:C.accentText,fontSize:12.5,fontWeight:600,
            padding:"7px 12px",borderRadius:999,textDecoration:"none"}}>
          📞 {item.venue_phone}
        </a>
      )}
      {/* Reach cannot know somebody bought a ticket on a site it does not run,
          or got through on the phone. So it asks — and once told, stops
          asking, and the line leaves the list. */}
      {/* Only where there is something to sort. A walk-in needs no booking,
          so "I've sorted it" beside one is an action that means nothing —
          and the Budget tab, which lists every priced line, offered it
          against a state park you just drive to. The link stays: opening
          hours and directions are worth having wherever the place appears.
          Marking it done is what has to be earned. */}
      {markGot&&(ticketed||item.booking_mode==="ahead")&&(
        <button onClick={()=>markGot(item)}
          style={{background:"none",border:`1px solid ${C.border}`,color:C.t2,
            fontSize:12.5,fontWeight:600,padding:"7px 12px",borderRadius:999,cursor:"pointer"}}>
          {ticketed?"I've got them":"I've sorted it"}</button>
      )}
    </div>
  );
}

function PlanDetailScreen({onBack,planId,groupId,groups,um,updateGroup,push,toast,updatePlanOnServer,castVoteOnServer,refreshGroup,saveItineraryToServer,me,initialTab}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans.find(p=>p.id===planId);
  // Opens where the caller asked. "See my itinerary" after a payment means
  // the itinerary, not the overview.
  const [atab,setAtab]=useState(initialTab||"overview");
  const [myVote,setMyVote]=useState(null);
  const [loading,setLoading]=useState(false);

  const [loadFailed,setLoadFailed]=useState(false);
  const [building,setBuilding]=useState(false);
  const [nudging,setNudging]=useState(false);
  const [emailing,setEmailing]=useState(false);

  // What this person is in for, and when the group can go. Both come from the
  // server, so the figure here is the figure checkout charges, and both stay
  // hidden until the database has somewhere to keep the answers.
  const [share,setShare]=useState(null);
  const [dates,setDates]=useState(null);
  const [myFrom,setMyFrom]=useState("");
  const [myTo,setMyTo]=useState("");
  const [savingDates,setSavingDates]=useState(false);
  const [skipping,setSkipping]=useState(null);

  const loadShare=async()=>{
    if(!planId||isTempId(planId))return;
    try{
      const r=await fetch(`/api/plans/${planId}/participation`);
      if(r.ok)setShare(await r.json());
      else console.error("[planDetail] participation returned",r.status);
    }catch(e){console.error("[planDetail] could not load who's in for what",e);}
  };
  const loadDates=async()=>{
    if(!planId||isTempId(planId))return;
    try{
      const r=await fetch(`/api/plans/${planId}/availability`);
      if(r.ok)setDates(await r.json());
      else console.error("[planDetail] availability returned",r.status);
    }catch(e){console.error("[planDetail] could not load dates",e);}
  };

  const setSkip=async(item,optOut)=>{
    if(skipping)return;
    if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
    setSkipping(item.ref);
    try{
      const r=await fetch(`/api/plans/${planId}/participation`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({itemRef:item.ref,optOut}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"That didn't save — try again");
      await loadShare();
      toast(optOut?`You're sitting out ${item.title}`:`You're in for ${item.title}`);
    }catch(e){
      console.error("[planDetail] could not change who's in",e);
      toast(e.message);
    }
    setSkipping(null);
  };

  // Submitting a set of ranges, whatever produced them. The append behaviour
  // lives in saveMyDates; this is the plumbing both it and the flexible
  // button share.
  const submitRanges=async(ranges,note)=>{
    if(savingDates)return;
    if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
    setSavingDates(true);
    try{
      const r=await fetch(`/api/plans/${planId}/availability`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ranges}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Those dates didn't save — try again");
      await loadDates();
      if(note)toast(note);
    }catch(e){
      console.error("[planDetail] saving dates failed",e);
      toast(e.message);
    }
    setSavingDates(false);
  };

  // Somebody with no constraints should not have to invent a range to say so.
  // Four months is wide enough to overlap anybody and short enough that the
  // overlap maths stays about this trip.
  const sayImFlexible=async()=>{
    const from=new Date();
    const to=new Date(Date.now()+120*86400000);
    await submitRanges([{start:from.toISOString().slice(0,10),end:to.toISOString().slice(0,10)}],
      "Noted — you're easy either way");
  };

  // Append-only was wrong the moment somebody typed a date wrong: there was
  // no way to take it back, and the overlap kept using it for ever.
  const clearMyDates=async()=>{
    if(!dates?.mine?.length||savingDates)return;
    if(isTempId(planId))return;
    setSavingDates(true);
    try{
      // Its own verb: POST refuses an empty list on purpose, so that an
      // accidental empty submission cannot wipe what somebody entered.
      const r=await fetch(`/api/plans/${planId}/availability`,{method:"DELETE"});
      if(!r.ok){
        const d=await r.json().catch(()=>({}));
        throw new Error(d.error||"Couldn't clear those — try again");
      }
      await loadDates();
      toast("Cleared — tell us again when you know");
    }catch(e){
      console.error("[planDetail] clearing dates failed",e);
      toast(e.message);
    }
    setSavingDates(false);
  };

  const saveMyDates=async()=>{
    if(savingDates||!myFrom||!myTo||myTo<myFrom)return;
    if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
    setSavingDates(true);
    try{
      // Adding to what you said before, not replacing it: most people have
      // more than one weekend that works.
      const seen=new Set();
      const ranges=[...(dates?.mine||[]),{start:myFrom,end:myTo}]
        .filter(x=>{const k=x.start+"|"+x.end;if(seen.has(k))return false;seen.add(k);return true;})
        .slice(-20);
      const r=await fetch(`/api/plans/${planId}/availability`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ranges}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Those dates didn't save — try again");
      setMyFrom("");setMyTo("");
      await loadDates();
      toast("Got it — we'll find the dates that suit most of you");
    }catch(e){
      console.error("[planDetail] could not save dates",e);
      toast(e.message);
    }
    setSavingDates(false);
  };

  // Moving the dates of a trip with bookings on it is not a field edit: a
  // hotel is held for particular nights and a table exists at a particular
  // hour. The server says what would be disturbed and waits; this is where
  // the person reads that and decides.
  const [dateChange,setDateChange]=useState(null);

  const moveDates=async(start,end,{confirmed=false}={})=>{
    if(savingDates)return;
    setSavingDates(true);
    const result=await updatePlanOnServer(planId,{
      start_date:start,end_date:end,
      ...(confirmed?{confirmDateChange:true}:{}),
    });
    setSavingDates(false);
    if(result&&result.needsConfirmation){
      setDateChange({...result,start,end});
      return;
    }
    if(result!==false){
      setDateChange(null);
      if(refreshGroup)await refreshGroup(groupId);
      toast(`Dates set: ${formatDates(start,end)}`);
    }
  };

  const applyBestDates=async()=>{
    const best=dates?.bestWindows?.[0];
    if(!best)return;
    await moveDates(best.start,best.end);
  };

  // Every plan made before the itinerary was persisted has no days, and there
  // was no way to get them: the empty state offered only a manual builder. A
  // trip the model already chose can have its day-by-day plan generated on
  // demand, which is also the repair path for those older plans.
  const buildItinerary=async()=>{
    if(building)return;
    if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
    setBuilding(true);
    try{
      // The group's dates beat the plan's once people have said which work:
      // build the days for the stretch most of them can make, and put those
      // dates on the plan so the days and the plan agree.
      let startDate=plan.startDate||null,endDate=plan.endDate||null;
      const best=dates?.ready?dates.bestWindows?.[0]:null;
      if(best&&(best.start!==startDate||best.end!==endDate)){
        const saved=await updatePlanOnServer(planId,{start_date:best.start,end_date:best.end});
        // The server can answer "these dates would disturb things" instead of
        // saving. That object is truthy, so treating it as success would have
        // built the days for dates the plan does not have — the itinerary and
        // the trip disagreeing from the moment it was written.
        if(saved&&saved.needsConfirmation){
          setDateChange({...saved,start:best.start,end:best.end});
          setBuilding(false);
          return;
        }
        if(saved===false){setBuilding(false);return;}
        startDate=best.start;endDate=best.end;
        if(refreshGroup)refreshGroup(groupId);
      }
      // An evening, or a trip.
      //
      // A plan's type is trip, restaurant, concert or weekend, and only
      // restaurant was checked — so a concert fell through to "trip", ran
      // the full-day prompt, and answered one gig with four days of
      // mornings and afternoons.
      const oneEvening=plan?.type==="restaurant"||plan?.type==="concert";
      // Where it is, separately from what it is called. A concert's title is
      // the act's name, so sending that as the destination asked for a trip
      // to "The Milk Carton Kids" — which is how a Washington gig came back
      // full of Los Angeles.
      const where=plan.destinationCity||null;
      // What this plan is about, in the words somebody used.
      //
      // Nothing was sent, so the server had no act to look up and no reason
      // to think there was one: rebuilding a concert produced a perfectly
      // good evening in the right city with no concert in it. The title is
      // the best thing we hold — for a gig it IS the act's name, which is
      // exactly what the listing search needs.
      const about=plan.goalBlurb||plan.title||null;
      const res=await fetch("/api/trips/generate",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId, startDate, endDate, detailTripId:planId,
          mode:oneEvening?"night":"trip",
          location:where, goalBlurb:about,
          tripData:{
            destination:where||plan.title, city:where,
            country_code:plan.destinationCountry||null,
            vibe:plan.vibe||null, costs:null,
          },
        }),
      });
      const d=await res.json().catch(()=>({}));
      // 409 is not a failure. It is the trip waiting for somebody, and the
      // server says who — "Marco hasn't said what they want from this trip
      // yet". Treating it as an error would put "couldn't build the plan" on
      // screen when nothing is broken and there is something to do about it.
      if(res.status===409){toast(d.error||"Waiting on the rest of the group");setBuilding(false);return;}
      if(!res.ok)throw new Error(d.error||"Couldn't build the day-by-day plan");
      // A restaurant-type plan is the night out. Labelled as an evening
      // rather than a day, same as the generate path.
      // The flights, the stay and the transfers survive a rebuild.
      //
      // This was `itineraryRows(...)` alone, and saving an itinerary replaces
      // it wholesale — so pressing "Plan my days for me" on an existing trip
      // deleted the three lines Reach can actually book and left only the
      // restaurants and walks, which it cannot. The generate path builds
      // `[...fixedCostRows(trip), ...itineraryRows(...)]`; this path had the
      // second half and not the first, and the two quietly disagreed.
      //
      // A real plan in the table shows the damage: Moab, thirteen nights,
      // $1,474 a head, thirty-nine lines and not one of them bookable, with
      // $893 of flights and accommodation missing from its own budget.
      //
      // Rebuilding the days is not a reason to unbook the trip. These belong
      // to the trip, not to the day-by-day plan, so they are carried over
      // exactly as they were.
      const rows=afterRebuild(plan.itinerary,itineraryRows(d.itinerary,oneEvening));
      if(!rows.length)throw new Error("Nothing came back — try again");
      updateGroup(groupId,g=>({...g,plans:g.plans.map(x=>x.id===planId?{...x,itinerary:rows}:x)}));
      const saved=await saveItineraryToServer(planId,rows);
      toast(saved===false?"Built, but couldn't save — try again":`${d.itinerary.length} days planned 🗺️`);
    }catch(e){
      console.error("[planDetail] build itinerary failed",e);
      toast(e.message);
    }
    setBuilding(false);
  };

  // Who on this trip could be put on a flight today. Status only — the API
  // returns names and which fields are outstanding, never anybody's answers.
  // Asked for once with the plan, because a flight line that cannot be booked
  // should say who to go and ask before anyone pays for the rest of the trip.
  const [readiness,setReadiness]=useState(null);
  // What the server would actually charge. The overview used to price the
  // booking button off the itinerary's own estimates while checkout priced it
  // off the booking rows, so the same trip read $1,474 on one screen and $404
  // on the next. There is one answer to "how much", and the server owns it.
  const [funding,setFunding]=useState(null);
  useEffect(()=>{
    if(!planId||isTempId(planId))return;
    let live=true;
    fetch(`/api/plans/${planId}/readiness`)
      .then(r=>r.ok?r.json():null)
      .then(d=>{if(live&&d)setReadiness(d);})
      // A readiness check that fails shows no chips rather than a wrong "Ready".
      .catch(()=>{});
    fetch(`/api/plans/${planId}/funding`)
      .then(r=>r.ok?r.json():null)
      .then(d=>{if(live&&d)setFunding(d);})
      // No answer means the button falls back to the itinerary estimate and
      // says "estimated", rather than showing a confident wrong number.
      .catch(()=>{});
    return()=>{live=false;};
  },[planId]);

  // Fetch latest plan data on mount
  useEffect(()=>{
    // A temp id means the plan has not reached the server yet; asking for it
    // is a guaranteed 404 that silently does nothing.
    if(!planId||!groupId||isTempId(planId))return;
    const fetchPlan=async()=>{
      try{
        const r=await fetch(`/api/plans/${planId}`);
        if(!r.ok){
          console.error("[planDetail] plan fetch returned",r.status);
          setLoadFailed(true);
          return;
        }
        const data=await r.json();
        if(data.participants?.length)updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,participants:data.participants}:p)}));
        // Update vote tally from server
        if(data.votes)updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,votes:data.votes,myVote:data.myVote}:p)}));
        if(data.myVote)setMyVote(data.myVote);
        // Update itinerary
        if(data.itinerary)updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:itemsFromRows(data.itinerary)}:p)}));
        setLoadFailed(false);
      }catch(e){
        // Swallowing this made the itinerary tab say "No itinerary yet" when
        // the truth was "we could not ask" — the same screen for a plan with
        // no days and a plan whose days failed to load.
        console.error("[planDetail] could not load plan",e);
        setLoadFailed(true);
      }
    };
    fetchPlan();
  },[planId]);
  useEffect(()=>{loadShare();loadDates();},[planId]);

  // "Results update in real time" was written on the screen and nothing was
  // refreshing it. Somebody waiting on the last vote watched a static number
  // and concluded Reach was broken. Now the claim is true, and only while the
  // tab is open and a vote is actually outstanding — an idle plan screen has
  // no business polling. It sits above the guard below because a hook that
  // runs only on some renders is a crash waiting for a slow load.
  useEffect(()=>{
    if(atab!=="vote"||!refreshGroup||isTempId(groupId))return;
    const id=setInterval(()=>refreshGroup(groupId),12000);
    return()=>clearInterval(id);
  },[atab,groupId]);

  if(!plan||!group)return <NotLoaded what={group?"This plan":"This group"} onBack={onBack}/>;
  // Travelling alone means there is nobody to ask. Every voting affordance is
  // absent rather than disabled — a greyed-out "put this to the group" is
  // still a reminder that the app thinks you are a committee.
  const soloTrip=(group.memberIds||[]).length<=1;
  // A flight on the itinerary is what makes travel details anybody's business.
  // Without one, nothing on this screen asks for a date of birth.
  const hasFlight=(plan?.itinerary||[]).some(i=>i.type==="flight");
  const usd=c=>"$"+((c||0)/100).toLocaleString(undefined,{minimumFractionDigits:(c||0)%100?2:0,maximumFractionDigits:2});
  // What Reach itself will put on a card, as opposed to what the traveller
  // pays at the door. Only the first belongs on a "book everything" button.
  const reachItems=(plan?.itinerary||[]).filter(i=>i.booking_mode==="reach");
  // Things that have to be got, whether or not Reach is the one getting
  // them. A ticket bought from the seller is still a thing standing between
  // this plan and being ready, and counting only what Reach books meant a
  // concert read "0/0 confirmed" — nothing to do, nothing done, nothing that
  // could ever move. A plan you cannot finish is not a finished plan.
  const ticketed=(plan?.itinerary||[]).filter(i=>i.type==="event"&&i.venue_website);
  const mustGet=[...reachItems,...ticketed];
  const gotAlready=mustGet.filter(i=>i.conf||i.filled).length;
  const reachBookable=reachItems.length;

  /**
   * "I have the tickets."
   *
   * Reach cannot sell a ticket and will not pretend it did. What it can do
   * is stop asking once somebody has one — so this records that, and the
   * plan moves. No confirmation number, because we do not hold one and a
   * made-up reference is worse than none.
   */
  const markGot=async(row)=>{
    const next=(plan.itinerary||[]).map(r=>r===row?{...r,filled:true}:r);
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:next}:p)}));
    const ok=await saveItineraryToServer(planId,next);
    if(ok===false)toast("Couldn't save that — try again in a moment");
  };
  // The lines Reach cannot book, that somebody still has to. A ticket from
  // whoever sells it, a table the restaurant takes by phone. Reach booking it
  // means there is nothing to do; `filled` means somebody has already said
  // they did it; and without a website or a number there is nothing to offer
  // but a sentence, which is what the old screen was.
  const needsYou=(plan.itinerary||[]).filter(i=>
    i.booking_mode!=="reach"&&i.booking_mode!=="walk_in"&&!i.filled
    &&(i.venue_website||i.venue_phone));

  // The itinerary's own estimate, used only until there are real booking rows
  // to price against. Once there are, the server's figure wins: it is the one
  // a card is actually charged for, and two screens disagreeing about the
  // price of the same trip is worse than one screen saying "estimated".
  const estimateTotal=Math.round(reachItems.reduce((a,i)=>a+(i.cost_cents||0),0)/100);
  const quotedPerHead=funding&&funding.targetCents>0?Math.round(funding.myShareCents/100):null;
  const reachTotal=quotedPerHead??estimateTotal;
  const reachTotalIsEstimate=quotedPerHead===null;

  // Where this trip is relative to today. Worked out once, from the dates on
  // the plan, and read by the booking button and the line above it.
  const timing=tripTiming({startDate:plan.startDate,endDate:plan.endDate},today());

  const tIc={flight:"✈️",hotel:"🏨",activity:"🎯",restaurant:"🍽️",transport:"🚗"};
  const totalV=Object.values(plan.votes||{}).reduce((a,b)=>a+b,0);

  // Votes open when everyone's in. The server refuses early votes outright;
  // this stops somebody tapping a card that is about to be refused, and says
  // who the trip is waiting on so there is something to do about it.
  const prefs=readiness?.preferences;
  const votingOpen=!prefs||prefs.solo||prefs.allReady;

  const castVote=async opt=>{
    if(myVote)return;
    if(!votingOpen){toast(prefs?.waiting||"Votes open when everyone's in");return;}
    // Showing the vote immediately is right — waiting on a round trip to tick
    // a box feels broken. Leaving it there when the server refused is not:
    // the screen went on saying "✓ Your vote" and "your vote has been
    // recorded" under a toast explaining it had not been, and the count stayed
    // up by one for as long as the screen was open.
    setMyVote(opt);
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,votes:{...p.votes,[opt]:(p.votes[opt]||0)+1}}:p)}));
    const ok=castVoteOnServer?await castVoteOnServer(planId,opt):true;
    if(ok){
      toast(`Voted for ${opt}!`);
      return;
    }
    // castVoteOnServer has already said what went wrong. Put the screen back
    // the way it was so it agrees with what it just told them.
    setMyVote(null);
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,votes:{...p.votes,[opt]:Math.max(0,(p.votes[opt]||1)-1)}}:p)}));
  };

  // Two of the three status buttons bypassed this and changed local state
  // only. "Send to the group for a vote" moved the pill to Voting, said so,
  // and told the server nothing — so nobody else ever saw a vote open, and
  // the plan was back to Planning on the next load. Same for approving one.
  // Every transition goes through here, and every one can fail.
  const updateStatus=async(newStatus,done)=>{
    if(loading)return false;
    setLoading(true);
    const previous=plan.status;
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:newStatus}:p)}));
    const ok=updatePlanOnServer?await updatePlanOnServer(planId,{status:newStatus}):true;
    setLoading(false);
    if(ok){
      if(done)done();
      return true;
    }
    // updatePlanOnServer has already said what went wrong. Put the pill back.
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:previous}:p)}));
    return false;
  };
  const tabs=["overview","itinerary",(!soloTrip&&plan.options.length>0)?"vote":null,"budget"].filter(Boolean);

  return(
    <div className="sc" style={{paddingBottom:0}}>
      <div style={{background:`linear-gradient(145deg,#1a1060,${C.accent})`,padding:"18px 20px 22px",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
          <ScreenHeader onBack={onBack} overlay/>
          <button className="bsm" style={{background:"rgba(255,255,255,.15)",color:"white",border:"none"}} onClick={()=>push("editItinerary",{planId,groupId})}>Edit plan</button>
        </div>
        <div style={{fontFamily:"var(--font-display)",fontSize:26,color:"white",marginBottom:4}}>{plan.title}</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginBottom:12}}>{plan.dates} · {group.name}</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`}>{plan.status==="booked"?"✓ Booked":plan.status==="voting"?"⏳ Voting":plan.status==="approved"?"✅ Approved":"📋 Planning"}</span>
          <span className="pill" style={{background:"rgba(255,255,255,.15)",color:"white"}}>${plan.budget}/person</span>
        </div>
      </div>
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.s1,flexShrink:0}}>
        {tabs.map(t=>(
          <button key={t} onClick={()=>setAtab(t)} style={{flex:1,padding:"11px 0",background:"none",border:"none",borderBottom:`2px solid ${atab===t?C.accentText:"transparent"}`,color:atab===t?C.accentText:C.t2,fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{t}</button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",paddingBottom:20}}>
        {atab==="overview"&&(
          <div style={{padding:"16px 0"}}>
            <TripProgress
              plan={plan} group={group} soloTrip={soloTrip} votesIn={totalV}
              busy={building||nudging}
              onAction={async(stage)=>{
                if(stage==="planned"){setAtab("itinerary");await buildItinerary();return;}
                if(stage==="voted"){
                  if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
                  setNudging(true);
                  try{
                    const r=await fetch(`/api/plans/${planId}/notify`,{
                      method:"POST",headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({kind:"vote"}),
                    });
                    const d=await r.json().catch(()=>({}));
                    if(!r.ok)throw new Error(d.error||"Couldn't send those reminders");
                    toast(d.notified?`Reminded ${d.notified} ${d.notified===1?"person":"people"} 📬`:(d.message||"Everyone has voted"));
                  }catch(e){console.error("[progress] vote nudge failed",e);toast(e.message);}
                  setNudging(false);return;
                }
                if(stage==="funded"){push("checkout",{planId,groupId});return;}
                if(stage==="booked"){push("checkout",{planId,groupId});return;}
              }}/>
            <div style={{display:"flex",gap:10,padding:"0 20px 14px"}}>
              {[{l:soloTrip?"Traveller":"Travellers",v:soloTrip?"Just you":plan.participants.length,e:soloTrip?"🧍":"👥"},{l:"Budget",v:`$${plan.budget}`,e:"💳"},(plan.startDate&&plan.startDate===plan.endDate)?{l:"When",v:dayLabel(plan.startDate)||"—",e:"🌃"}:{l:"Nights",v:nightsBetween(plan.startDate,plan.endDate)??"—",e:"🌙"}].map((s,i)=>(
                <div key={i} style={{flex:1,background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:12,textAlign:"center"}}>
                  <div style={{fontSize:20}}>{s.e}</div>
                  <div style={{fontFamily:"var(--font-display)",fontSize:18,color:C.t1,marginTop:4}}>{s.v}</div>
                  <div style={{fontSize:10,color:C.t3,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
                </div>
              ))}
            </div>
            {/* Why this trip, in the group's own words. It was on the card
                they chose from and then disappeared the moment they chose —
                so the one screen everybody comes back to said nothing about
                why the trip is what it is. */}
            {(plan.aiData?.used_suggestions||[]).length>0&&(
              <div style={{padding:"0 20px 14px"}}>
                <div className="sl" style={{marginBottom:10}}>Why this trip</div>
                <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14}}>
                  {plan.aiData.used_suggestions.slice(0,4).map((line,i)=>(
                    <div key={i} style={{display:"flex",gap:8,marginBottom:i<Math.min(3,plan.aiData.used_suggestions.length-1)?8:0}}>
                      <span style={{color:C.accentText,flexShrink:0,fontSize:13}}>›</span>
                      <span style={{fontSize:13,color:C.t2,lineHeight:1.55}}>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{padding:"0 20px 14px"}}>
              <div className="sl" style={{marginBottom:10}}>Who's coming</div>
              {plan.participants.map(uid=>{const u=um[uid];return u?(
                <div key={uid} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div className="av-lg" style={{background:u.color}}>{u.initials}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:500,color:C.t1}}>{u.name}</div>
                    <div style={{fontSize:12,color:C.t2}}>{u.handle}</div>
                  </div>
                  {/* Only when a flight is on the table: nobody needs a date of
                      birth for a weekend somebody is driving to. The chip says
                      ready or not and which fields are outstanding — never a
                      value, not even to the person's own group. */}
                  {hasFlight&&(()=>{
                    const r=readiness?.travelers?.find(t=>t.userId===uid);
                    if(!r)return null;
                    return r.ready
                      ?<span className="pill pill-g" style={{fontSize:10}}>✓ Ready to fly</span>
                      :<span className="pill" style={{fontSize:10,background:C.amberDim,color:C.amber,border:`1px solid ${C.amber}`}}
                         title={`Still needed: ${r.missing.join(", ")}`}>Needs details</span>;
                  })()}
                  <span className="pill pill-g" style={{fontSize:10}}>✓ In</span>
                </div>
              ):null;})}
            </div>
            {/* When the group can go. Everybody says which dates work; Reach
                finds the stretch most of them can make, and one tap puts it on
                the plan. */}
            {!soloTrip&&dates?.ready&&plan.status!=="booked"&&(
              <div style={{padding:"0 20px 14px"}}>
                <div className="sl" style={{marginBottom:10}}>When works for you?</div>
                <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14}}>
                  {dates.bestWindows?.[0]&&(
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:14,color:C.t1,fontWeight:600}}>{formatDates(dates.bestWindows[0].start,dates.bestWindows[0].end)}</div>
                        <div style={{fontSize:12,color:C.t2}}>
                          {dates.bestWindows[0].count>=dates.members?"Everyone can make it":`${dates.bestWindows[0].count} of ${dates.members} can make it`}
                        </div>
                      </div>
                      {(plan.startDate!==dates.bestWindows[0].start||plan.endDate!==dates.bestWindows[0].end)&&(
                        <button className="bsm bsm-p" disabled={savingDates} onClick={applyBestDates}>
                          {savingDates?"Saving…":"Use these dates"}
                        </button>
                      )}
                    </div>
                  )}
                  <div style={{display:"flex",gap:8}}>
                    <input aria-label="Dates that work for you, from" type="date" className="inp" value={myFrom} onChange={e=>setMyFrom(e.target.value)} style={{flex:1,minWidth:0,color:C.t1}}/>
                    <input aria-label="Dates that work for you, to" type="date" className="inp" value={myTo} min={myFrom||undefined} onChange={e=>setMyTo(e.target.value)} style={{flex:1,minWidth:0,color:C.t1}}/>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:10}}>
                    <button className="bs" style={{flex:2}} disabled={savingDates||!myFrom||!myTo||myTo<myFrom} onClick={saveMyDates}>
                      {savingDates?"Saving…":"These dates work for me"}
                    </button>
                    {/* Somebody with no constraints should not have to invent
                        a range in order to say so. */}
                    <button className="bs" style={{flex:1}} disabled={savingDates} onClick={sayImFlexible}>
                      I'm flexible
                    </button>
                  </div>
                  <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
                    {dates.mine?.length?`You said ${dates.mine.map(x=>formatDates(x.start,x.end)).join(", ")}. `:""}
                    {`${dates.respondents} of ${dates.members} have answered.`}
                    {dates.mine?.length?(
                      <span {...pressable} onClick={clearMyDates}
                        style={{color:C.accentText,cursor:"pointer",marginLeft:6,fontWeight:600}}>
                        Clear mine
                      </span>
                    ):null}
                  </div>
                  {/* The other stretches that nearly work, and who each one
                      leaves out. A count tells somebody the shape of the
                      problem; a name tells them who to go and ask. */}
                  {(dates.bestWindows||[]).slice(1,3).length>0&&(
                    <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                      <div style={{fontSize:10.5,color:C.t3,textTransform:"uppercase",
                        letterSpacing:".06em",marginBottom:6}}>Also possible</div>
                      {(dates.bestWindows||[]).slice(1,3).map((w,i)=>{
                        const out=(w.missing||[]).map(id=>um[id]?.name?.split(" ")[0]).filter(Boolean);
                        return(
                          <div key={i} style={{fontSize:12.5,color:C.t2,lineHeight:1.55,marginBottom:4}}>
                            {formatDates(w.start,w.end)} — works for {w.count} of {dates.members}
                            {out.length?` · ${out.join(" and ")} can't make it`:""}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* What you're in for. Getting there and somewhere to sleep are the
                trip; a dinner or a day out is yours to sit out, and your share
                moves to the people going. Set once anyone has paid, because
                moving shares after money has moved leaves somebody overpaid. */}
            {!soloTrip&&share?.ready&&share.items?.length>0&&(
              <div style={{padding:"0 20px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
                  <div className="sl">What you're in for</div>
                  <div style={{fontSize:13,color:C.t1,fontWeight:600}}>Your trip: {usd(share.yourShare_cents)}</div>
                </div>
                {share.items.map(it=>(
                  <div key={it.ref} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{fontSize:18}}>{tIc[it.vertical]||"🎟️"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,color:it.imIn?C.t1:C.t3,fontWeight:500}}>{it.title}</div>
                      <div style={{fontSize:12,color:C.t2}}>
                        {it.imIn?`${usd(it.myCents)} for you`:"Sitting this one out"}{` · ${plural(it.inCount,"person","people")} going`}
                      </div>
                    </div>
                    {!share.locked&&(
                      <button className={`bsm ${it.imIn?"bsm-g":"bsm-p"}`} disabled={!!skipping} onClick={()=>setSkip(it,it.imIn)}>
                        {skipping===it.ref?"…":it.imIn?"Skip this one":"I'm in"}
                      </button>
                    )}
                  </div>
                ))}
                {share.locked&&(
                  <div style={{fontSize:11.5,color:C.t3,marginTop:8}}>Someone's already paid, so who's in for what is set now.</div>
                )}
              </div>
            )}
            {/* What is left for a person to do, on the tab they land on.
                Everything Reach cannot book — a ticket somebody else sells, a
                table the restaurant takes by phone — was only actionable on
                the Itinerary tab, several taps away and only if you thought to
                look. The plan told you a table was wanted and left finding it
                to you.
                Each line carries the same ItemActions the itinerary row does,
                so this is a shorter route to the same buttons rather than a
                second set that can disagree with them. It disappears when
                there is nothing outstanding, because a checklist of nothing
                is its own kind of noise. */}
            {needsYou.length>0&&(
              <div style={{padding:"0 20px 14px"}}>
                <div className="sl" style={{marginBottom:10}}>
                  {plural(needsYou.length,"thing","things")} still {needsYou.length===1?"needs":"need"} you
                </div>
                <div style={{background:C.s2,borderRadius:14,padding:"4px 14px",border:`1px solid ${C.border}`}}>
                  {needsYou.map((item,i)=>(
                    <div key={item.id||i} style={{padding:"11px 0",borderTop:i?`1px solid ${C.border}`:"none"}}>
                      <div style={{fontSize:13,color:C.t1,lineHeight:1.4}}>{item.title}</div>
                      {item.time&&<div style={{fontSize:11,color:C.t3,marginTop:1}}>{item.time}</div>}
                      <ItemActions item={item} markGot={markGot} tight/>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:11.5,color:C.t3,lineHeight:1.5,marginTop:8}}>
                  Reach books what it can. These are the ones somebody else sells or takes by phone.
                </div>
              </div>
            )}
            {plan.itinerary.length>0&&(
              <div style={{padding:"0 20px 14px"}}>
                <div className="sl" style={{marginBottom:10}}>Bookings</div>
                <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
                  {/* Against what Reach books, not against every line of the
                      itinerary. This read "0/39" on a 13-night trip — one for
                      every slot, including the walks and the mornings at
                      leisure, none of which can ever be confirmed — while the
                      button underneath said "7 bookings Reach handles". Two
                      counts of the same thing that never agreed, and the one
                      on the progress bar could not reach the end. */}
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{fontSize:13,color:C.t1}}>Confirmed</span>
                    <span style={{fontSize:13,color:C.green,fontWeight:600}}>
                      {gotAlready}/{mustGet.length}
                    </span>
                  </div>
                  <div className="pb-t"><div className="pb-f" style={{width:`${(gotAlready/Math.max(mustGet.length,1))*100}%`,background:C.green}}/></div>
                  {plan.itinerary.length>mustGet.length&&(
                    <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
                      The other {plan.itinerary.length-mustGet.length} things on your days are yours to turn up to.
                    </div>
                  )}
                </div>
              </div>
            )}
            <div style={{padding:"0 20px"}}>
              {plan.status==="planning"&&!soloTrip&&<button className="bp" style={{marginBottom:10}} disabled={loading} onClick={()=>updateStatus("voting",()=>{setAtab("vote");toast("Sent round for a vote");})}>{loading?"Sending…":"Send to the group for a vote"}</button>}
              {plan.status==="planning"&&soloTrip&&<button className="bp" style={{marginBottom:10}} disabled={loading} onClick={()=>updateStatus("approved",()=>toast("Locked in — let's book it"))}>{loading?"Locking in…":"Lock this in"}</button>}
              {plan.status==="voting"&&<button className="bp" style={{marginBottom:10}} disabled={loading} onClick={()=>updateStatus("approved",()=>toast("Approved — let's book it"))}>{loading?"Approving…":"Approve and proceed to booking"}</button>}
              {/* A trip that has started cannot be booked ahead of itself.
                  This offered "Book everything" on a trip five days into its
                  own dates; pressing it reached a hotel provider and came
                  back "No rates available", which is true and is a strange
                  way to find out. The dates are on the plan and nothing in
                  the booking path had ever looked at them. */}
              {plan.status==="approved"&&timing&&timing!=="upcoming"&&(
                <div style={{marginBottom:10,padding:"12px 14px",background:C.s2,
                  border:`1px solid ${C.border}`,borderRadius:14,fontSize:12.5,
                  color:C.t2,lineHeight:1.5}}>
                  {timing==="on_now"
                    ?"This trip is happening now, so there is nothing left to book ahead. Anything still open is on the Itinerary tab."
                    :"This trip has finished."}
                </div>
              )}
              {plan.status==="approved"&&timing!=="over"&&(
                <>
                  <button className="bp" style={{marginBottom:6,background:C.green}} onClick={()=>push("checkout",{planId,groupId})}>
                    {timing==="on_now"?"Open the booking list →":`Book everything${reachTotal>0?` · $${reachTotal.toLocaleString()}${reachTotalIsEstimate?" est.":""} each`:""} →`}
                  </button>
                  {/* The biggest commitment in the app used to be a button
                      with no number on it. People do not press those. Say
                      what it covers and that nothing moves until they say so. */}
                  <div style={{fontSize:11.5,color:C.t3,textAlign:"center",marginBottom:10,lineHeight:1.5}}>
                    {reachBookable>0
                      ?`${plural(reachBookable,"booking","bookings")} Reach handles. You'll see every one before anything is charged.`
                      :"You'll see everything before anything is charged."}
                  </div>
                </>
              )}
              {plan.status==="booked"&&<button className="bp" style={{marginBottom:10}} onClick={()=>setAtab("itinerary")}>View Itinerary</button>}
              <button className="bs" onClick={()=>push("editItinerary",{planId,groupId})}>Edit plan details</button>
            </div>
          </div>
        )}
        {atab==="itinerary"&&(
          <div style={{padding:"12px 0"}}>
            {plan.itinerary.length===0?(
              <div style={{padding:"40px 20px",textAlign:"center"}}>
                <div style={{fontSize:40,marginBottom:12}}>{loadFailed?"⚠️":"📋"}</div>
                <div style={{fontSize:16,fontWeight:600,color:C.t1,marginBottom:6}}>
                  {loadFailed?"Couldn't load this plan":"No itinerary yet"}
                </div>
                <div style={{fontSize:13,color:C.t2,marginBottom:20,lineHeight:1.55}}>
                  {loadFailed
                    ?"Your days may already be saved. Check your connection and reopen this plan."
                    :!votingOpen&&prefs
                      // Promising twenty seconds and then refusing is the
                      // worst version of this screen. The plan is not
                      // written until everyone has said what they want, so
                      // say that here rather than after the tap.
                      ?`${prefs.waiting||"We're waiting on the rest of the group"} We write the days once everyone's in, so nobody's trip is planned around half the answers.`
                      :`Give us twenty seconds and we'll write the whole ${plan.title} plan — where to eat, what it costs, which places only take cash. Or do it yourself, if that's the fun bit for you.`}
                </div>
                {!loadFailed&&(
                  <>
                    <button className="bp" disabled={building||(!votingOpen&&!!prefs)} onClick={buildItinerary} style={{marginBottom:10}}>
                      {building?"Building your days…":(!votingOpen&&prefs)?"Waiting on the group":"✨ Plan my days for me"}
                    </button>
                    <button className="bs" onClick={()=>push("editItinerary",{planId,groupId})}>I'll do it myself</button>
                  </>
                )}
              </div>
            ):(
              <>
                {/* An evening is the plan; the day around it is an offer.
                    Generation returns both and only the evening is on the
                    itinerary, so somebody who wanted a drink with a friend
                    gets a drink with a friend — and somebody who wants more
                    can ask for it. Added once, then the button is gone,
                    because after that it is simply their plan. */}
                {(plan.dayOffer||[]).length>0&&(
                  <div style={{padding:"0 20px 12px"}}>
                    <button className="bs" onClick={()=>{
                      const extra=plan.dayOffer||[];
                      updateGroup(groupId,g=>({...g,plans:g.plans.map(pp=>pp.id===planId
                        ?{...pp,itinerary:[...extra,...(pp.itinerary||[])],dayOffer:[]}:pp)}));
                      if(saveItineraryToServer)saveItineraryToServer(planId,[...extra,...(plan.itinerary||[])]);
                      toast("Added to your day");
                    }}>
                      ☀️ Let's make a day of it
                    </button>
                    <div style={{fontSize:11.5,color:C.t3,marginTop:6,lineHeight:1.5}}>
                      {(plan.dayOffer||[]).length} more{" "}
                      {(plan.dayOffer||[]).length===1?"thing":"things"} nearby, earlier the same day —
                      {" "}{(plan.dayOffer||[]).map(d=>String(d.title).split(/[,.]/)[0]).join(" · ")}
                    </div>
                  </div>
                )}
                {/* On the trip itself, the day you are having should not take
                    a scroll to find. Only shown while the trip is running —
                    there is no "today" on a plan for March. */}
                {itineraryDays(plan.itinerary,plan.startDate).some(d=>d.isToday)&&(
                  <div style={{padding:"0 20px 10px"}}>
                    <button className="bs" onClick={()=>{
                      const day=itineraryDays(plan.itinerary,plan.startDate).find(d=>d.isToday);
                      const el=day&&document.getElementById(`itin-${day.key}`);
                      if(el)el.scrollIntoView({behavior:"smooth",block:"start"});
                    }}>Jump to today ↓</button>
                  </div>
                )}
                {itineraryDays(plan.itinerary,plan.startDate).map(day=>(
                  <div key={day.key} id={`itin-${day.key}`}>
                    <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",
                      padding:"14px 20px 8px",background:day.isToday?C.accentDim:"transparent"}}>
                      <div style={{fontFamily:"var(--font-display)",fontSize:20,
                        color:day.isPast&&!day.isToday?C.t3:C.t1}}>{day.label}</div>
                      {day.dateLabel&&<div style={{fontSize:12,color:C.t3}}>{day.dateLabel}</div>}
                      {day.isToday&&<span className="pill pill-a" style={{fontSize:10}}>Today</span>}
                    </div>
                {day.items.map((item,i)=>(
                  <div key={i} className="it-item">
                    <div className="it-time">{(item.time||"").replace(/^Day \d+ · /,"")}</div>
                    <div className="it-lc">
                      <div className={`it-dot ${item.filled?"fi":""}`}/>
                      {i<day.items.length-1&&<div className="it-cn"/>}
                    </div>
                    <div className="it-cont">
                      <div style={{display:"flex",alignItems:"center",gap:6}}><span>{tIc[item.type]||"📌"}</span><div className="it-tt">{item.title}</div></div>
                      <div className="it-sb">{item.sub}</div>
                      {/* Reach books what it can. For the rest, the practical
                          details belong here rather than at the door. */}
                      {(item.booking_mode||item.payment_note)&&(
                        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:6}}>
                          {/* Reach does not take a table. The member does, on
                              their own account and their own card, because
                              that is where their card's dining benefits live
                              — Amex on Resy, Chase on OpenTable. A row that
                              said "Reach will book this" over a restaurant
                              was promising something the app has never done
                              and cannot do.
                              A flight or a hotel is different: those it
                              genuinely books. */}
                          {/* A ticketed event says what it is, not what to
                              do — the button underneath is what to do, and
                              "Reserve ahead" above a ticket link is two
                              instructions for one action. */}
                          {item.type==="event"&&item.venue_website
                            ?<span className="pill pill-a">Ticketed — buy from the seller</span>
                            :<>
                          {item.booking_mode==="reach"&&(
                            item.type==="restaurant"
                              ?<span className="pill pill-a">You book it — we'll show you how</span>
                              :<span className="pill pill-p">Reach will book this</span>
                          )}
                          {/* Only where there is something to reserve with.
                              Six lines in the table carry "ahead" with no
                              venue, no website and no number — among them
                              "Flight home." and "Head to the airport or next
                              stop" — and each one printed "Reserve ahead"
                              over nothing to press. A plan that tells you to
                              book something and cannot say what or where is
                              the same fault as a table it wanted and gave
                              you no way to get. */}
                          {item.booking_mode==="ahead"&&(item.venue_name||item.venue_website||item.venue_phone)&&(
                            <span className="pill pill-a">Reserve ahead</span>
                          )}
                          </>}
                          {item.booking_mode==="walk_in"&&(
                            <span className="pill pill-m">Just turn up</span>
                          )}
                        </div>
                      )}
                      {/* How they take a table, where we have actually found
                          out. A number is a fact we hold; "call ahead" with no
                          number is our uncertainty handed to somebody to
                          resolve at the door, so it is not said. */}
                      {/* A ticket is bought from whoever sells it. Reach
                          cannot sell one, and the honest complete answer is
                          to hand somebody straight to the page that can —
                          not "Reserve ahead" with nothing behind it, which
                          is what a concert used to get. The price is
                          whatever the seller says; we do not restate it. */}
                      {/* What is actually on there, in the venue's own
                          words, read off their own page. This is the most
                          useful thing we hold about a place — it is a real
                          reason to be somewhere on a particular night — and
                          it is shown rather than left to whether the
                          sentence above happened to mention it. If we do not
                          tell somebody there is a quiz on Wednesday, they
                          do not know, and they cannot invite anybody to it. */}
                      {item.venue_note&&(
                        <div style={{display:"flex",gap:6,marginTop:6,fontSize:12,lineHeight:1.5,color:C.t2}}>
                          <span style={{flexShrink:0}}>🗓️</span>
                          <span>
                            {item.venue_note}
                            {item.venue_note_credit&&(
                              <a href={item.venue_note_credit} target="_blank" rel="noopener noreferrer"
                                style={{color:C.accentText,marginLeft:6,textDecoration:"none"}}>source →</a>
                            )}
                          </span>
                        </div>
                      )}
                      {/* One definition, in ItemActions. The Budget tab
                          lists these same items and had no way to act on any
                          of them; it renders this now, so the two cannot
                          drift apart the way hand-written field lists in this
                          file have three times. */}
                      <ItemActions item={item} markGot={markGot}/>
                      {/* A real payment note runs to a sentence — "cards at the
                          restaurant, cash only for drinks and cover" — so it is
                          a line, not a pill. Cash-only gets the warm colour
                          because it is the one that ruins an evening. */}
                      {item.payment_note&&(
                        <div style={{display:"flex",gap:6,marginTop:6,fontSize:12,lineHeight:1.5,
                          color:/cash only/i.test(item.payment_note)?C.amber:C.t2}}>
                          <span style={{flexShrink:0}}>{/cash only/i.test(item.payment_note)?"💵":"💳"}</span>
                          <span>{item.payment_note}</span>
                        </div>
                      )}
                      {/* Whose wish this answers. The itinerary is written
                          from what each member said about this trip, and
                          without this it could answer somebody and never
                          tell them — the plan reads like a guidebook rather
                          than like their trip. */}
                      {item.because&&(
                        <div style={{display:"flex",gap:6,marginTop:6,fontSize:12,lineHeight:1.5,color:C.accentText}}>
                          <span style={{flexShrink:0}}>›</span>
                          <span>{item.because}</span>
                        </div>
                      )}
                      {item.conf&&<div className="it-cf">✓ Confirmed · {item.conf}</div>}
                    </div>
                  </div>
                ))}
                  </div>
                ))}
                <div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:8}}>
                  {/* A plan is only useful on the day if it is somewhere you
                      can find it without signal. */}
                  <button className="bs" disabled={emailing} onClick={async()=>{
                    if(emailing)return;
                    if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
                    setEmailing(true);
                    try{
                      const r=await fetch(`/api/plans/${planId}/itinerary/email`,{
                        method:"POST",headers:{"Content-Type":"application/json"},
                        body:JSON.stringify({everyone:(group.memberIds||[]).length>1}),
                      });
                      const d=await r.json().catch(()=>({}));
                      if(!r.ok)throw new Error(d.error||"Couldn't send that");
                      toast(d.sent>1?`Sent to all ${d.sent} of you 📬`:"Sent to your inbox 📬");
                    }catch(e){
                      console.error("[planDetail] itinerary email failed",e);
                      toast(e.message);
                    }
                    setEmailing(false);
                  }}>{emailing?"Sending…":(group.memberIds||[]).length>1?"📬 Email this to everyone":"📬 Email this to me"}</button>
                  <button className="bs" onClick={()=>push("editItinerary",{planId,groupId})}>+ Add or edit items</button>
                </div>
              </>
            )}
          </div>
        )}
        {atab==="vote"&&plan.options.length>0&&(
          <div style={{padding:"16px 20px"}}>
            <div className="pt" style={{fontSize:22,marginBottom:6}}>Where should we go?</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:18,flexWrap:"wrap"}}>
              <div style={{fontSize:13,color:C.t2}}>
                {totalV>=plan.participants.length
                  ?(()=>{
                    // Said as the group's decision, not the organiser's, so
                    // nobody has to carry the choice on their own.
                    const ranked=Object.entries(plan.votes||{}).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
                    if(!ranked.length)return "Everyone's voted. Approve it and let's book.";
                    if(ranked[1]&&ranked[1][1]===ranked[0][1]){
                      return `Everyone's voted, and it's a tie between ${ranked.filter(x=>x[1]===ranked[0][1]).map(x=>x[0]).join(" and ")}.`;
                    }
                    return `The group picked ${ranked[0][0]} — ${ranked[0][1]} of ${plan.participants.length}.`;
                  })()
                  :plan.participants.length-totalV===1
                    ?"One vote away."
                    :`${totalV} of ${plan.participants.length} voted.`}
              </div>
              {/* A plan could sit needing one vote for a week with no way to
                  tell anyone. This emails the people who have not voted. */}
              {totalV<plan.participants.length&&(
                <button className="bsm bsm-p" disabled={nudging} onClick={async()=>{
                  if(nudging)return;
                  if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
                  setNudging(true);
                  try{
                    const r=await fetch(`/api/plans/${planId}/notify`,{
                      method:"POST",headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({kind:"vote"}),
                    });
                    const d=await r.json().catch(()=>({}));
                    if(!r.ok)throw new Error(d.error||"Couldn't send those reminders");
                    toast(d.notified
                      ? `Reminded ${d.notified} ${d.notified===1?"person":"people"} 📬`
                      : (d.message||"Everyone has voted"));
                  }catch(e){
                    console.error("[planDetail] vote nudge failed",e);
                    toast(e.message);
                  }
                  setNudging(false);
                }}>{nudging?"Sending…":"Give them a nudge"}</button>
              )}
            </div>
            {/* What moving the dates would disturb, read before it happens
                rather than discovered afterwards. Each line names who has to
                act: a table booked on somebody's own account can only be
                moved by them, on that platform. */}
            {dateChange&&(
              <div style={{margin:"0 0 12px",padding:"14px",background:C.amberDim,
                border:`1px solid ${C.amber}`,borderRadius:14}}>
                <div style={{fontSize:13.5,color:C.t1,fontWeight:600,marginBottom:6}}>
                  Moving to {formatDates(dateChange.start,dateChange.end)}
                </div>
                {dateChange.outOf>0&&(
                  <div style={{fontSize:12.5,color:C.t2,marginBottom:8}}>
                    These dates work for {dateChange.worksFor} of {dateChange.outOf}.
                  </div>
                )}
                {(dateChange.consequences||[]).map((line,i)=>(
                  <div key={i} style={{display:"flex",gap:7,marginBottom:5}}>
                    <span style={{color:C.amber,flexShrink:0,fontSize:12}}>•</span>
                    <span style={{fontSize:12.5,color:C.t2,lineHeight:1.5}}>{line}</span>
                  </div>
                ))}
                <div style={{display:"flex",gap:8,marginTop:10}}>
                  <button className="bp" style={{flex:1}} disabled={savingDates}
                    onClick={()=>moveDates(dateChange.start,dateChange.end,{confirmed:true})}>
                    {savingDates?"Moving…":"Move them anyway"}
                  </button>
                  <button className="bs" style={{flex:1}} disabled={savingDates}
                    onClick={()=>setDateChange(null)}>
                    Leave the dates
                  </button>
                </div>
              </div>
            )}
            {/* The person the group is waiting on sees the way to stop being
                waited on, not just the fact of it. Shown to anybody who has
                not answered for this trip, whether or not voting is open. */}
            {prefs&&!prefs.solo&&prefs.members.some(m=>m.userId===me&&!m.ready)&&(
              <div style={{margin:"0 0 12px",padding:"14px",background:C.accentDim,
                border:`1px solid ${C.accentText}`,borderRadius:14}}>
                <div style={{fontSize:13.5,color:C.t1,fontWeight:600,marginBottom:4}}>
                  The group is waiting on you
                </div>
                <div style={{fontSize:12.5,color:C.t2,lineHeight:1.55,marginBottom:10}}>
                  Three questions about this trip. Your profile stays as it is.
                </div>
                <button className="bp" onClick={()=>push("planPrefs",{planId})}>
                  Say what you want from this trip
                </button>
              </div>
            )}
            {/* Who has had their say. A yes or a no and a name — never what
                anybody answered, which is theirs. */}
            {!votingOpen&&prefs&&(
              <div style={{margin:"0 0 12px",padding:"12px 14px",background:C.amberDim,border:`1px solid ${C.amber}`,borderRadius:14}}>
                <div style={{fontSize:13,color:C.t1,fontWeight:600,marginBottom:8,lineHeight:1.5}}>
                  {prefs.waiting||"Votes open when everyone's in"}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {prefs.members.map(m=>(
                    <span key={m.userId} style={{fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:20,
                      background:m.ready?"rgba(16,185,129,.15)":"rgba(255,255,255,.08)",
                      color:m.ready?C.green:C.t2}}>
                      {m.ready?"✓ ":""}{m.name.trim().split(/\s+/)[0]||"Someone"}{m.ready?"":" · waiting…"}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {plan.options.map(opt=>{
              const v=plan.votes[opt]||0; const pct=totalV>0?(v/totalV)*100:0; const mine=myVote===opt;
              return(
                <div key={opt} {...pressable} onClick={()=>castVote(opt)} style={{background:mine?C.accentDim:C.s2,border:`2px solid ${mine?C.accentText:C.border}`,borderRadius:16,padding:16,marginBottom:10,cursor:(myVote||!votingOpen)?"default":"pointer",opacity:votingOpen?1:.55,transition:"all .15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div style={{fontFamily:"var(--font-display)",fontSize:20,color:C.t1}}>{opt}</div>
                    <div style={{fontSize:13,fontWeight:600,color:mine?C.accentText:C.t2}}>{v} vote{v!==1?"s":""}</div>
                  </div>
                  <div className="pb-t" style={{marginBottom:8}}><div className="pb-f" style={{width:`${pct}%`}}/></div>
                  {!myVote&&<div style={{fontSize:12,color:C.accentText,fontWeight:500}}>Tap to vote →</div>}
                  {mine&&<div style={{fontSize:12,color:C.accentText,fontWeight:500}}>✓ Your vote</div>}
                </div>
              );
            })}
            {myVote&&<div style={{background:C.greenDim,border:`1px solid ${C.green}`,borderRadius:14,padding:14,textAlign:"center",marginTop:8}}><div style={{fontSize:13,color:C.green,fontWeight:500}}>Your vote has been recorded. Results update in real time.</div></div>}
          </div>
        )}
        {atab==="budget"&&(
          <div style={{padding:"16px 20px"}}>
            <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:20,padding:20,marginBottom:18,textAlign:"center"}}>
              <div style={{fontSize:12,color:C.accentText,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Budget per person</div>
              <div style={{fontFamily:"var(--font-display)",fontSize:44,color:C.t1}}>${plan.budget.toLocaleString()}</div>
              <div style={{fontSize:12,color:C.t2,marginTop:4}}>{soloTrip?"Travelling on your own":`${plural(plan.participants.length,"traveller")} total`}</div>
            </div>
            {/* Itemised from the plan itself. This was a percentage split of
                the budget — flights 28%, accommodation 34% — which told you
                nothing about the trip you are actually taking. Fixed costs are
                the ones Reach books and commits to; variable costs are what
                you spend on the day, and are estimates by nature. Keeping them
                apart is the honest way to show a number somebody will budget
                against. */}
            {(()=>{
              const items=plan.itinerary||[];
              const money=c=>`$${Math.round((c||0)/100).toLocaleString()}`;
              // Flights and beds are itinerary items like anything else, so
              // this reads from one place and survives a reload.
              // `sub` is never a description of the item. itineraryRows puts
              // the day's title on the morning slot and the day's insider tip
              // on the evening one, so a seafood dinner was captioned "Mesa
              // Arch at sunrise means a crowd of photographers…" — a tip
              // about a different thing entirely, printed as if it described
              // the line being charged for. When it happens is the useful
              // fact on a cost line anyway.
              // `it` carries the whole item through. This mapped to four
              // fields and dropped the rest, so a tab that lists the places
              // you have to book yourself printed their names and prices and
              // not the website or phone number sitting on the same row.
              const fixed=items.filter(i=>i.booking_mode==="reach"&&i.cost_cents>0)
                .map(i=>({l:i.title,d:i.time,c:i.cost_cents,it:i}));
              // Everything you pay for yourself, as it happens.
              const variable=items.filter(i=>i.booking_mode!=="reach"&&i.cost_cents>0)
                .map(i=>({l:i.title,d:i.time,c:i.cost_cents,pay:i.payment_note,it:i}));
              // Bookable and not yet priced. A hotel line carries no number
              // until a provider quotes one — inventing a price for where
              // somebody sleeps is exactly the thing this app does not do —
              // and a row with no number was simply dropped here, so the
              // screen showed a budget of $1,474 above a list adding to $581
              // and said nothing about the difference.
              const unpriced=items.filter(i=>i.booking_mode==="reach"&&!(i.cost_cents>0))
                .map(i=>({l:i.title,d:i.time,it:i}));
              const sum=a=>a.reduce((t,x)=>t+(x.c||0),0);
              const fixedTotal=sum(fixed), varTotal=sum(variable);
              const heads=plan.participants.length||1;

              if(!fixed.length&&!variable.length&&!unpriced.length)return(
                <div style={{fontSize:13,color:C.t2,lineHeight:1.6,padding:"4px 0 8px"}}>
                  Costs appear here once this trip has a day-by-day plan. Build it on the
                  Itinerary tab and every event gets priced.
                </div>
              );

              const Section=({title,note,rows,total,tone})=>(
                <div style={{marginBottom:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                    <span style={{fontSize:13.5,fontWeight:600,color:C.t1}}>{title}</span>
                    <span style={{fontSize:14,fontWeight:700,color:tone}}>{money(total)}</span>
                  </div>
                  <div style={{fontSize:11.5,color:C.t3,lineHeight:1.5,marginBottom:10}}>{note}</div>
                  {rows.map((r,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",gap:12,
                      padding:"7px 0",borderTop:i?`1px solid ${C.border}`:"none"}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13,color:C.t1,lineHeight:1.35}}>{r.l}</div>
                        {r.d&&<div style={{fontSize:11,color:C.t3,marginTop:1}}>{r.d}</div>}
                        {r.pay&&/cash only/i.test(r.pay)&&(
                          <div style={{fontSize:11,color:C.amber,marginTop:2}}>💵 {r.pay}</div>
                        )}
                        {/* The way to sort it out, on the tab that tells you
                            what it costs. "Cash only" above is a fact that
                            asks somebody to do something; until now this
                            screen stated it and offered nothing to do. */}
                        <ItemActions item={r.it} markGot={markGot} tight/>
                      </div>
                      <div style={{fontSize:13,color:C.t2,flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{money(r.c)}</div>
                    </div>
                  ))}
                </div>
              );

              return(
                <>
                  {fixed.length>0&&(
                    <Section title="Reach will book these" tone={C.accentText}
                      note="Committed once the group funds the trip. You pay this through Reach and it is done."
                      rows={fixed} total={fixedTotal}/>
                  )}
                  {/* Named, with no number, because there is not a true one
                      yet. The old screen dropped these entirely and left the
                      difference between the budget and the list unexplained. */}
                  {unpriced.length>0&&(
                    <div style={{marginBottom:18}}>
                      <div style={{fontSize:13.5,fontWeight:600,color:C.t1,marginBottom:4}}>
                        Reach prices these when you book
                      </div>
                      <div style={{fontSize:11.5,color:C.t3,lineHeight:1.5,marginBottom:10}}>
                        Not in the totals below. The number comes from the provider, so
                        there is not an honest one to show until Reach has asked.
                      </div>
                      {unpriced.map((r,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",gap:12,
                          padding:"7px 0",borderTop:i?`1px solid ${C.border}`:"none"}}>
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:13,color:C.t1,lineHeight:1.35}}>{r.l}</div>
                            {r.d&&<div style={{fontSize:11,color:C.t3,marginTop:1}}>{r.d}</div>}
                          </div>
                          <div style={{fontSize:12,color:C.t3,flexShrink:0}}>priced at booking</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {variable.length>0&&(
                    <Section title="You pay on the day" tone={C.t1}
                      note="Estimates for what you spend as you go. Nobody collects this up front."
                      rows={variable} total={varTotal}/>
                  )}
                  <div style={{height:1,background:C.border,margin:"4px 0 14px"}}/>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:14,color:C.t1,fontWeight:600}}>
                      {unpriced.length>0?"Per person, priced so far":"Per person, all in"}
                    </span>
                    <span style={{fontSize:16,color:C.t1,fontWeight:700}}>{money(fixedTotal+varTotal)}</span>
                  </div>
                  {heads>1&&(
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.t3}}>
                      <span>{heads} of you</span>
                      <span>{money((fixedTotal+varTotal)*heads)} altogether</span>
                    </div>
                  )}
                  {plan.budget>0&&(
                    <div style={{marginTop:12,padding:"10px 12px",borderRadius:12,
                      background:(fixedTotal+varTotal)/100>plan.budget?C.amberDim:C.greenDim,
                      border:`1px solid ${(fixedTotal+varTotal)/100>plan.budget?C.amber:C.green}`,
                      fontSize:12.5,lineHeight:1.5,
                      color:C.t1}}>
                      {(fixedTotal+varTotal)/100>plan.budget
                        ? `About ${money((fixedTotal+varTotal)-plan.budget*100)} over the $${plan.budget.toLocaleString()} you set.`
                        : `About ${money(plan.budget*100-(fixedTotal+varTotal))} under the $${plan.budget.toLocaleString()} you set.`}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EDIT ITINERARY ───────────────────────────────────────────────────────────
function EditItineraryScreen({onBack,planId,groupId,groups,updateGroup,toast,saveItineraryToServer}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans.find(p=>p.id===planId);
  const [items,setItems]=useState(plan?.itinerary||[]);
  const [adding,setAdding]=useState(false);
  const [ni,setNi]=useState({time:"",title:"",sub:"",type:"activity",conf:""});
  const [saving,setSaving]=useState(false);
  // Leaving with unsaved edits used to throw them away without a word. A day
  // somebody typed out by hand is not something to lose on a stray back tap.
  const [dirty,setDirty]=useState(false);
  const [confirmLeave,setConfirmLeave]=useState(false);
  useEscape(confirmLeave,()=>setConfirmLeave(false));
  if(!plan)return <NotLoaded what="This plan" onBack={onBack}/>;
  // Where this trip is relative to today. Worked out once, from the dates on
  // the plan, and read by the booking button and the line above it.
  const timing=tripTiming({startDate:plan.startDate,endDate:plan.endDate},today());

  const tIc={flight:"✈️",hotel:"🏨",activity:"🎯",restaurant:"🍽️",transport:"🚗"};
  const addItem=()=>{if(!ni.title)return;setItems(p=>[...p,{...ni,filled:!!ni.conf}]);setNi({time:"",title:"",sub:"",type:"activity",conf:""});setAdding(false);setDirty(true);};
  const rm=idx=>{setItems(p=>p.filter((_,i)=>i!==idx));setDirty(true);};
  const save=async()=>{
    if(saving)return;
    setSaving(true);
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:items}:p)}));
    // "Your days are saved" used to fire before the request went out, so a
    // rejected save produced a cheerful confirmation followed by a failure —
    // in that order. The answer waits for the answer.
    const ok=saveItineraryToServer?await saveItineraryToServer(planId,items):true;
    setSaving(false);
    if(ok)toast("Your days are saved");
    setDirty(false);
    onBack();
  };

  const leave=()=>{ if(dirty)setConfirmLeave(true); else onBack(); };
  return(
    <div className="sc">
      {confirmLeave&&(
        <div className="ov" onClick={()=>setConfirmLeave(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div style={{padding:"18px 20px 24px",textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:10}}>✍️</div>
              <div style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1,marginBottom:6}}>
                Keep what you wrote?
              </div>
              <div style={{fontSize:13.5,color:C.t2,lineHeight:1.6,marginBottom:18}}>
                You've changed these days and not saved them yet.
              </div>
              <button className="bp" style={{width:"100%",marginBottom:8}} disabled={saving}
                onClick={()=>{setConfirmLeave(false);save();}}>
                {saving?"Saving…":"Save and go back"}
              </button>
              <button className="bs" style={{width:"100%"}}
                onClick={()=>{setConfirmLeave(false);onBack();}}>
                Throw them away
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{padding:"12px 20px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <ScreenHeader onBack={leave} label="Back"/>
          <button className="bsm bsm-p" disabled={saving} onClick={save}>{saving?"Saving…":"Save"}</button>
        </div>
        <div className="pt" style={{fontSize:24,marginTop:12}}>Edit Itinerary</div>
        <div style={{fontSize:13,color:C.t2,marginTop:2}}>{plan.title}</div>
      </div>
      {items.map((item,i)=>(
        <div key={i} style={{margin:"0 20px 8px",background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{display:"flex",gap:10,flex:1}}>
              <span style={{fontSize:20}}>{tIc[item.type]||"📌"}</span>
              <div>
                <div style={{fontSize:14,fontWeight:500,color:C.t1}}>{item.title}</div>
                <div style={{fontSize:12,color:C.t2}}>{item.time}</div>
                {item.conf&&<div style={{fontSize:11,color:C.green,marginTop:2}}>✓ {item.conf}</div>}
              </div>
            </div>
            <button onClick={()=>rm(i)} style={{background:"none",border:"none",cursor:"pointer",color:C.red,padding:4}}><Ic.Trash/></button>
          </div>
        </div>
      ))}
      {adding?(
        <div style={{margin:"0 20px 12px",background:C.s2,borderRadius:16,padding:16,border:`1px solid ${C.accentBorder}`}}>
          <div className="sl" style={{marginBottom:12}}>New item</div>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            {Object.entries(tIc).map(([type,icon])=>(
              <button key={type} onClick={()=>setNi(n=>({...n,type}))} style={{padding:"6px 10px",borderRadius:10,border:`1.5px solid ${ni.type===type?C.accentText:C.border}`,background:ni.type===type?C.accentDim:C.s3,cursor:"pointer",fontSize:12,color:C.t1}}>{icon} {type}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input aria-label="Time or day" className="inp" style={{width:88,fontSize:13}} placeholder="Time / Day" value={ni.time} onChange={e=>setNi(n=>({...n,time:e.target.value}))}/>
            <input aria-label="Title" className="inp" style={{flex:1,fontSize:13}} placeholder="Title (required)" value={ni.title} onChange={e=>setNi(n=>({...n,title:e.target.value}))}/>
          </div>
          <input aria-label="Details or location" className="inp" style={{marginBottom:8,fontSize:13}} placeholder="Details or location" value={ni.sub} onChange={e=>setNi(n=>({...n,sub:e.target.value}))}/>
          <input aria-label="Confirmation number" className="inp" style={{marginBottom:12,fontSize:13}} placeholder="Confirmation number (if booked)" value={ni.conf} onChange={e=>setNi(n=>({...n,conf:e.target.value}))}/>
          <div style={{display:"flex",gap:8}}>
            <button className="bsm bsm-p" style={{flex:1}} onClick={addItem} disabled={!ni.title}>Add item</button>
            <button className="bsm bsm-g" style={{flex:1}} onClick={()=>setAdding(false)}>Cancel</button>
          </div>
        </div>
      ):(
        <div style={{padding:"8px 20px 14px"}}><button className="bs" onClick={()=>setAdding(true)}>+ Add flight, hotel, activity, or restaurant…</button></div>
      )}
      <div style={{padding:"0 20px 30px"}}><button className="bp" onClick={save}>Save Itinerary</button></div>
    </div>
  );
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────

// ============ CHECKOUT V2 — real propose -> fund -> approve ============
// What a booking failure is actually asking for, and where that is fixed.
// "We need the name of whoever the room is under before this can be booked"
// is a true, specific answer and, printed on its own, still leaves somebody
// hunting through Profile for the page that takes it.
const FIX_FOR=[
  {when:/name of whoever|date of birth|gender|passenger|traveller|traveler|essentials/i,
   section:"flying", label:"Add flying details →"},
  {when:/home airport/i, section:"flying", label:"Add your home airport →"},
  {when:/passport|document/i, section:"documents", label:"Add travel documents →"},
];
function fixFor(why){ return FIX_FOR.find(f=>f.when.test(String(why||"")))||null; }

function CheckoutScreenV2({onBack,replace,planId,groupId,groups,updateGroup,toast,returnedIntent,redirectStatus,saveItineraryToServer,goToProfileSection}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans?.find(p=>p.id===planId);
  // phases: loading | review | pay | approving | waiting | priceUp | done | error
  const [phase,setPhase]=useState("loading");
  const [nudging,setNudging]=useState(false);
  const [funding,setFunding]=useState(null);
  const [bookings,setBookings]=useState([]);
  const [clientSecret,setClientSecret]=useState(null);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  // Whether the screen may offer another go. Every error used to, and the
  // ones that follow a card being charged came back to the review screen
  // where "Looks good" started a second payment — the app telling somebody
  // "do not pay again" directly above the button that did.
  const [retryable,setRetryable]=useState(true);
  // Lines of the itinerary that did not become bookings, and why.
  const [unbooked,setUnbooked]=useState([]);
  const [skipBroken,setSkipBroken]=useState(false);

  // Everything on this trip that Reach is not going to book, with the way to
  // book it attached. "Book everything" books what Reach can; the rest is the
  // traveller's to arrange, and until now this screen said so and stopped
  // there — a list of four titles and a reason, no link, no number, nothing
  // to press. A plan you cannot finish from the screen that took your money
  // is not finished.
  // Anything already represented by a booking row is left out. Those rows
  // are listed above with their own "Reserve on Resy" or "Call to reserve",
  // and showing the same dinner twice on one screen under two headings is
  // the duplication rule in CLAUDE.md, committed on the screen where being
  // confusing costs the most.
  const bookedRefs=new Set((bookings||[]).map(b=>b.itinerary_item_id).filter(Boolean));
  const yoursToBook=(plan?.itinerary||[]).filter(i=>
    i.booking_mode!=="reach"&&i.booking_mode!=="walk_in"
    &&(i.venue_website||i.venue_phone)
    &&!bookedRefs.has(i.id));
  const stillOpen=yoursToBook.filter(i=>!i.filled);

  // The same "I've sorted it" the plan screen has, so a thing marked done
  // here is done everywhere. Without this the checklist on the screen at the
  // end of the money path would have been the one place you could not tick
  // anything off.
  const markGot=async(row)=>{
    const next=(plan?.itinerary||[]).map(r=>r===row?{...r,filled:true}:r);
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:next}:p)}));
    const ok=await saveItineraryToServer?.(planId,next);
    if(ok===false)toast("Couldn't save that — try again in a moment");
  };
  // Who has been sent off to a booking platform this visit, so the app can
  // ask how it went without nagging about rows they have not touched.
  const [handedOver,setHandedOver]=useState({});
  const [capturing,setCapturing]=useState(null);

  // Only the member knows whether there was a table. Reach never books it
  // for them — that is the point, their card's benefits only apply to a
  // reservation on their own account — so the answer has to come from them.
  const captureBooking=async(id,status)=>{
    // A booking id always comes from the server — these rows are read back
    // from /api/bookings — so anything that is not one is not a booking, and
    // a local id would PATCH a row that does not exist.
    if(!id||isTempId(id)||capturing)return;
    setCapturing(id);
    try{
      const r=await fetchWithin(`/api/bookings/${id}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({status}),
      });
      if(!r.ok){
        const d=await r.json().catch(()=>({}));
        throw new Error(d.error||"Couldn't save that");
      }
      setBookings(bs=>(bs||[]).map(b=>b.id===id?{...b,status}:b));
      toast(status==="confirmed"?"Nice — that's on the trip":"Noted — we'll leave it open");
    }catch(e){
      console.error("[checkout] could not record the reservation",e);
      toast(e.message);
    }
    setCapturing(null);
  };
  // message, and whether trying again could cost money.
  const fail=(message,{retry=false}={})=>{setMsg(message);setRetryable(retry);setPhase("error");};
  const [payReady,setPayReady]=useState(false);
  const stripeRef=useRef(null); const elementsRef=useRef(null); const payRef=useRef(null);

  const fmt=c=>"$"+((c||0)/100).toLocaleString(undefined,{maximumFractionDigits:0});
  const targetCents=funding?.targetCents||0;
  // The server owns the split. This used to divide by plan.participants.length
  // — a field the API never returns — so it fell back to 1 and every member
  // was asked to pay for the whole trip.
  const participants=funding?.memberCount||1;
  const myShareCents=funding?.myRemainingCents??(
    targetCents>0?Math.ceil(targetCents/participants):Math.round((plan?.budget||0)*100)
  );
  const vIcon={flight:"\u2708\uFE0F",hotel:"\uD83C\uDFE8",activity:"\uD83C\uDFAF",event:"\uD83C\uDFDF\uFE0F",restaurant:"\uD83C\uDF7D\uFE0F"};

  const load=async()=>{
    try{
      // The itinerary becomes bookings here, on the way in. Until this
      // existed, checkout asked for the plan's bookings and got an empty
      // list — people paid their share against a target of nothing, and
      // approval had nothing to approve. Safe to call every time: a line
      // already booked is skipped, so re-opening adds only what is missing.
      //
      // The funding target is read AFTER it, so the amount people are asked
      // for is the sum of the rows they are about to see.
      let bridge=null;
      if(!isTempId(planId)){
        try{
          const br=await fetchWithin(`/api/plans/${planId}/bookable`,{method:"POST"},20000,"pricing your trip");
          bridge=br.ok?await br.json():null;
          if(!br.ok)console.error("[checkout] could not add the itinerary to the booking list",br.status);
        }catch(e){ console.error("[checkout] bridge failed",e); }
      }
      const [fRes,bRes]=await Promise.all([
        fetch(`/api/plans/${planId}/funding`),
        fetch(`/api/bookings?planId=${planId}`)
      ]);
      const f=fRes.ok?await fRes.json():null;
      const bJson=bRes.ok?await bRes.json():null;
      setFunding(f);
      setBookings((bJson&&(bJson.bookings||bJson))||[]);
      // What could not be added. Never silent: these are things somebody
      // believes they are paying for.
      setUnbooked([...(bridge?.failures||[]).map(f=>({title:f.title,why:f.error})),
                   ...(bridge?.skipped||[])]);
      setPhase("review");
    }catch(e){ console.error("[checkout] could not load the trip",{planId},e); fail("Couldn't load your trip \u2014 check your connection and try again.",{retry:true}); }
  };
  useEffect(()=>{ load(); },[]);

  // Back from Klarna, Affirm or Cash App Pay, which take the payer to their own
  // site and send them back here with what happened. Stripe's word in the
  // address is not trusted: the server asks Stripe before recording anything,
  // exactly as it does for a card.
  const handledReturn=useRef(false);
  useEffect(()=>{
    if(!returnedIntent||handledReturn.current||phase!=="review")return;
    handledReturn.current=true;
    if(redirectStatus==="failed"){
      toast("That payment didn't go through. Nothing was taken — you can try again.");
      return;
    }
    if(isTempId(planId)){
      // The payment is real and this id is not, so there is nothing to record
      // it against. Say so with the reference rather than dropping it.
      console.error("[checkout] payment returned against an unsaved plan",{planId,paymentIntentId:returnedIntent});
      fail(`Your payment went through, but this trip hadn't finished saving, so we couldn't attach it. Nothing is lost — quote reference ${returnedIntent} and we'll sort it. Do not pay again.`);
      return;
    }
    (async()=>{
      setBusy(true);
      try{
        const cr=await fetchWithin(`/api/plans/${planId}/funding/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentIntentId:returnedIntent})},15000,"recording your payment");
        if(cr.ok){ setBusy(false); await approveAll(false); return; }
        const err=await cr.json().catch(()=>({}));
        console.error("[checkout] returned payment not recorded",{planId,paymentIntentId:returnedIntent,redirectStatus,status:cr.status,err});
        setBusy(false);
        // Pay-later providers can take a while to settle. Stripe's webhook marks
        // the contribution paid when they do, so the honest message is to wait.
        fail(cr.status===409&&redirectStatus!=="succeeded"
          ?`Your payment is still being processed. We'll mark it paid as soon as it clears — do not pay again. Reference ${returnedIntent}.`
          :`Your payment went through, but we couldn't record it against this trip. Nothing is lost — quote reference ${returnedIntent} and we'll sort it. Do not pay again.`);
      }catch(e){
        console.error("[checkout] could not check returned payment",{planId,paymentIntentId:returnedIntent},e);
        setBusy(false);
        fail(`We couldn't check that payment just now. Do not pay again — quote reference ${returnedIntent} and we'll sort it.`);
      }
    })();
  },[phase,returnedIntent]);

  const startPayment=async()=>{
    if(busy)return;
    // Paying against a plan the server has never seen would take money with
    // nothing to attach it to.
    if(isTempId(planId)){ toast("This trip is still saving — try again in a moment"); return; }
    setBusy(true);
    try{
      const r=await fetchWithin(`/api/plans/${planId}/funding`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})},15000,"setting up your payment");
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.clientSecret)throw new Error(d.error||"Couldn't start the payment \u2014 try again.");
      setClientSecret(d.clientSecret); setPhase("pay");
    }catch(e){ toast(e.message); }
    setBusy(false);
  };

  useEffect(()=>{
    if(phase!=="pay"||!clientSecret)return;
    // The key comes from the server, not from process.env: a bare
    // STRIPE_PUBLISHABLE_KEY is never inlined into browser code, and the
    // NEXT_PUBLIC_ form is blanked at build time when the variable is marked
    // Sensitive in Vercel. /api/config/stripe reads it at runtime instead.
    let cancelled=false;
    const boot=(pk)=>{
      try{
        const stripe=window.Stripe(pk);
        const elements=stripe.elements({clientSecret,appearance:{theme:"night",variables:{colorPrimary:C.accent,borderRadius:"12px"}}});
        const pe=elements.create("payment");
        pe.on("ready",()=>setPayReady(true));
        pe.mount(payRef.current);
        stripeRef.current=stripe; elementsRef.current=elements;
      }catch(e){ console.error("[checkout] Stripe Elements failed to mount",e); fail("Payment form couldn't load \u2014 try again.",{retry:true}); }
    };
    const withStripeJs=(pk)=>{
      if(cancelled)return;
      if(window.Stripe){boot(pk);return;}
      const s=document.createElement("script"); s.src="https://js.stripe.com/v3";
      s.onload=()=>{ if(!cancelled)boot(pk); };
      s.onerror=()=>{ if(cancelled)return; fail("Payment form couldn't load \u2014 check your connection.",{retry:true}); };
      document.head.appendChild(s);
    };
    (async()=>{
      try{
        const r=await fetchWithin("/api/config/stripe",{},8000,"Stripe");
        const d=await r.json().catch(()=>({}));
        if(cancelled)return;
        if(!r.ok||!d.publishableKey){ fail("Payments aren't switched on yet.",{retry:true}); return; }
        withStripeJs(d.publishableKey);
      }catch(e){ console.error("[checkout] Stripe key fetch failed",e); if(!cancelled){ fail("Payment form couldn't load \u2014 check your connection.",{retry:true}); } }
    })();
    return ()=>{ cancelled=true; };
  },[phase,clientSecret]);

  const confirmPay=async()=>{
    if(busy||!stripeRef.current)return;
    // Guarded again here rather than relying on startPayment: this is the call
    // that follows the money leaving someone's account.
    if(isTempId(planId)){ toast("This trip is still saving — try again in a moment"); return; }
    setBusy(true);
    // Whether the money has left their account yet. Everything after Stripe
    // confirms is recording and booking, and a failure past this point must
    // never be worded as "payment didn't go through" — telling somebody that
    // about a card that was charged is how they pay twice.
    let taken=false;
    try{
      // Cards finish here without leaving the page. Klarna, Affirm and Cash App
      // Pay are switched on in Stripe and cannot: they send the payer to their
      // own site and back, and without a return_url Stripe refuses to start
      // them, so choosing one failed on the pay button.
      const back=`${window.location.origin}/home?paid=${encodeURIComponent(planId)}&group=${encodeURIComponent(groupId||"")}`;
      const {error,paymentIntent}=await stripeRef.current.confirmPayment({elements:elementsRef.current,redirect:"if_required",confirmParams:{return_url:back}});
      if(error)throw new Error(error.message||"Payment didn't go through.");
      taken=true;
      // Stripe has taken the money by this point. The response to this call
      // was never checked, so if recording the contribution failed the app
      // still walked on to "done" — card charged, nothing recorded, and the
      // person told they were finished. With live keys that is real money
      // going missing quietly.
      const cr=await fetchWithin(`/api/plans/${planId}/funding/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentIntentId:paymentIntent.id})},15000,"recording your payment");
      if(!cr.ok){
        const err=await cr.json().catch(()=>({}));
        console.error("[checkout] payment taken but not recorded",{planId,paymentIntentId:paymentIntent.id,status:cr.status,err});
        setBusy(false);
        fail(`Your payment went through, but we couldn't record it against this trip. Nothing is lost — quote reference ${paymentIntent.id} and we'll sort it. Do not pay again.`);
        return;
      }
      setBusy(false);
      await approveAll(false);
    }catch(e){
      setBusy(false);
      // A call that never answered is not a payment that failed. Before
      // Stripe confirms, nothing has been charged and saying so is a relief;
      // after it, the money is gone and the only useful sentence names the
      // reference and says not to pay again.
      if(isTimeout(e)){
        console.error("[checkout] a step stalled",{planId,taken,what:e.what});
        fail(stalled(e.what,taken));
        return;
      }
      toast(e.message||(taken?"Your payment went through — we had trouble finishing up.":"Payment didn't go through."));
    }
  };

  const approveAll=async(acceptNewPrice)=>{
    setPhase("approving");
    let fresh=[];
    try{
      const r=await fetchWithin(`/api/bookings?planId=${planId}`,{},12000,"reading your bookings");
      const j=await r.json();
      fresh=(j&&(j.bookings||j))||[];
    }catch(e){
      // Falling back to what is already on screen is right; doing it silently
      // meant an approval run against a stale list left no trace at all.
      console.error("[checkout] could not refresh bookings, using cached",e);
      fresh=bookings;
    }
    const waiting=(fresh||[]).filter(b=>b.status==="awaiting_approval");
    // A failed approval used to be swallowed and the screen still said done,
    // so somebody could believe a hotel was booked when the request had been
    // refused. Failures are counted and reported.
    const failed=[];
    for(const b of waiting){
      try{
        // The one that actually books. A provider that hangs here leaves somebody
        // staring at "approving" with their money already collected, so it gets
        // the longest deadline and still gets one.
        const r=await fetchWithin(`/api/bookings/${b.id}/approve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(acceptNewPrice?{acceptNewPrice:true}:{})},45000,"the booking");
        if(r.status===402){ setPhase("waiting"); return; }
        if(r.status===409){ setPhase("priceUp"); return; }
        if(!r.ok){
          const err=await r.json().catch(()=>({}));
          console.error("[checkout] approval refused",{bookingId:b.id,status:r.status,err});
          failed.push(b);
        }
      }catch(e){
        console.error("[checkout] approval failed",{bookingId:b.id},e);
        failed.push(b);
      }
    }
    // The list fetched before approving says "Quoted" for everything, because
    // that is what it was. Read it again so the screen shows what happened.
    try{
      const after=await fetchWithin(`/api/bookings?planId=${planId}`,{},12000,"reading your bookings");
      const aj=after.ok?await after.json():null;
      setBookings((aj&&(aj.bookings||aj))||fresh);
    }catch(e){ console.error("[checkout] could not re-read the bookings after approving",e); setBookings(fresh); }
    if(failed.length){
      fail(`Your payment is recorded, but ${failed.length} of ${waiting.length} booking${waiting.length===1?"":"s"} couldn't be confirmed. Nothing has been double-charged. We'll follow up — you don't need to do anything.`);
      return;
    }
    setPhase("done");
  };

  const chip=(label,tone)=>(<span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,letterSpacing:.3,
    background:tone==="green"?"rgba(16,185,129,.15)":tone==="gold"?"rgba(212,175,55,.15)":tone==="red"?C.redDim:"rgba(255,255,255,.08)",
    color:tone==="green"?C.green:tone==="gold"?C.accentText:tone==="red"?C.red:C.t2}}>{label}</span>);

  // Whether anything was actually booked, as opposed to paid for or merely
  // quoted. The first end-to-end run put "You're all booked!" above two lines
  // both reading "Quoted", because this counted rows rather than reading
  // them: everything that had a row at all was treated as booked.
  // What this screen is allowed to claim, worked out from the rows in
  // lib/checkout.ts and tested there. `redirected` used to count as booked;
  // it means somebody was handed to Resy and went to get the table
  // themselves, which is the one thing on this screen we are still asking
  // them about.
  const claim=bookedClaim(bookings);
  const said=bookedWording(claim);

  // What may be shown, and whether anybody may pay. A production screenshot
  // had three rows all reading "restaurant" over a total of $0 with the
  // button live: `detail` is a string, so `detail.title` was undefined on
  // every row and each fell through to the enum. Naming them correctly comes
  // first — collapsing on what that screen displayed would have merged three
  // different dinners into one.
  // "Book the rest without these" is a decision, taken once, after reading
  // what failed. It is not remembered: reopening checkout asks again, because
  // the failure may have been fixed in between and skipping it a second time
  // should be as deliberate as the first.
  const checkout=checkoutState(bookings||[],{ignoreBroken:skipBroken});
  // The facts come from the contract; the icons and the wording stay here,
  // because they are presentation and they belong to the screen. The two
  // comments below are both post-mortems of a hand-written field list: a
  // redirect with nowhere to tap, and a table with no way to get it.
  const lines=(checkout.rows.length?bookingFactsFrom(checkout.rows).map(b=>({
    id:b.id, icon:vIcon[b.vertical]||"\u2728", l:itemTitle(b),
    // The provider's own note when it left one. A seat being booked by hand
    // because automatic booking will not carry somebody's passport marker
    // deserves that sentence, not "we'll handle this one for you" — the
    // person it concerns is reading this screen.
    d:b.note||BOOKING_MODE[b.mode]||BOOKING_MODE[b.provider]||"",
    a:b.priceCents, st:b.status,
    // A redirected booking finishes somewhere else, and until now the screen
    // said so with nothing to tap: "Finish on their site" and no site. The
    // provider hands the address back on the booking; this is it.
    href:b.href, provider:b.provider,
    // A number somebody can ring. Most restaurants are not on Resy or
    // OpenTable, and for those the screen offered a status and nothing to
    // do — a table the app said it wanted and gave you no way to get. The
    // phone is the answer for those, and it is the one we have most often.
    phone:b.phone,
  })):[
    // Nothing is priced yet, so there is nothing to itemise. This used to list
    // flights, accommodation and activities at 34, 40 and 26 per cent of the
    // budget — invented figures on the screen where somebody decides to pay.
    {icon:"\uD83D\uDCB0",l:"Trip budget",d:"Nothing is priced yet. Bookings appear here as they're quoted.",a:null}
  ]);

  if(phase==="loading")return(<div className="sc"><div style={{padding:"60px 20px",textAlign:"center",color:C.t2}}>Pulling your trip together…</div></div>);

  if(phase==="error")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:34,marginBottom:12}}>🙈</div>
    <div style={{color:C.t1,fontWeight:600,marginBottom:8,lineHeight:1.5}}>{msg}</div>
    {/* Only offered where trying again cannot take money twice: a trip that
        would not load, a payment form that would not appear. Once a card has
        been charged the way back through this screen is the review screen,
        and "Looks good" there starts a whole new payment. */}
    {retryable
      ?(<>
        <button onClick={()=>{setPhase("loading");load();}} style={{marginTop:12,padding:"12px 24px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700}}>Try again</button>
        <div {...pressable} onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Go back</div>
      </>)
      :(<button onClick={onBack} style={{marginTop:12,padding:"12px 24px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700}}>Go back</button>)}
  </div></div>);

  if(phase==="waiting")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:12}}>🤝</div>
    <div style={{fontFamily:"var(--font-display)",fontSize:24,color:C.t1,marginBottom:8}}>You're in!</div>
    <div style={{color:C.t2,fontSize:14,lineHeight:1.5,marginBottom:16}}>A few people still need to chip in. The moment the last share lands we'll email everyone, and one of you gives the word to book.</div>
    <div style={{margin:"0 auto 20px",maxWidth:260}}>{funding&&(()=>{const pct=Math.min(100,Math.round(((funding.collectedCents+myShareCents)/Math.max(funding.targetCents,1))*100));
      return(<div><div style={{height:8,background:"rgba(255,255,255,.08)",borderRadius:8,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:`linear-gradient(90deg,${C.accent},${C.green})`}}/></div>
      <div style={{fontSize:12,color:C.t2,marginTop:6}}>{pct}% of the trip funded</div></div>);})()}</div>
    <button disabled={nudging} onClick={async()=>{
      // Reach can email now, so this sends rather than handing the person a
      // message to forward themselves.
      if(nudging)return;
      if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
      setNudging(true);
      try{
        const r=await fetch(`/api/plans/${planId}/notify`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({kind:"funding"}),
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||"Couldn't send those reminders");
        toast(d.notified
          ? `Reminded ${d.notified} ${d.notified===1?"person":"people"} 📬`
          : (d.message||"Everyone has already paid"));
      }catch(e){
        console.error("[checkout] nudge failed",e);
        toast(e.message);
      }
      setNudging(false);
    }} style={{padding:"12px 24px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700,cursor:nudging?"progress":"pointer",opacity:nudging?.6:1}}>
      {nudging?"Sending…":"Give them a nudge"}
    </button>
    <div {...pressable} onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Back to trip</div>
  </div></div>);

  if(phase==="priceUp")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:12}}>📈</div>
    <div style={{fontFamily:"var(--font-display)",fontSize:24,color:C.t1,marginBottom:8}}>Price went up a little</div>
    <div style={{color:C.t2,fontSize:14,lineHeight:1.5,marginBottom:20}}>One of your bookings costs a bit more than when we quoted it. Still book it?</div>
    <button disabled={busy} onClick={()=>approveAll(true)} style={{padding:"12px 24px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700,opacity:busy?.6:1}}>Yes, book it</button>
    <div {...pressable} onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Let me think</div>
  </div></div>);

  if(phase==="approving")return(<div className="sc"><div style={{padding:"80px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:14}}>✨</div>
    <div style={{color:C.t1,fontWeight:600}}>Locking it all in…</div>
    <div style={{color:C.t2,fontSize:13,marginTop:6}}>This takes a few seconds</div>
  </div></div>);

  if(phase==="done"){
    const confetti=Array.from({length:36},(_,i)=>i);
    return(<div className="sc" style={{paddingBottom:40,position:"relative",overflow:"hidden"}}>
      <style dangerouslySetInnerHTML={{__html:`@keyframes rfall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(540deg);opacity:0}}`}}/>
      {confetti.map(i=>(<span key={i} style={{position:"absolute",left:(i*137)%100+"%",top:-10,width:8,height:12,borderRadius:2,
        background:[C.accent,C.green,C.blue,"#F472B6"][i%4],animation:`rfall ${2.2+(i%5)*.4}s ${(i%7)*.18}s ease-in forwards`,zIndex:5}}/>))}
      <div style={{background:`linear-gradient(145deg,#064E3B,${C.green})`,padding:"48px 28px 36px",textAlign:"center"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 16px"}}>✓</div>
        {/* Nothing in the app books an itinerary yet, so when no booking rows
            exist this said "You're all booked!" over a line reading "Nothing is
            priced yet" \u2014 contradicting itself on the screen where a real card
            had just been charged. Money in is worth celebrating; it is simply
            not the same claim as a booking. */}
        <div style={{fontFamily:"var(--font-display)",fontSize:30,color:"white",marginBottom:6}}>
          {said.title}
        </div>
        <div style={{fontSize:14,color:"rgba(255,255,255,.75)"}}>
          {said.sub}
        </div>
      </div>
      <div style={{padding:"20px 20px 0"}}>
        <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Amount charged</span>
            <span style={{fontSize:13,color:C.t1,fontWeight:700}}>{fmt(myShareCents)}</span></div>
          <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Security</span>
            <span style={{fontSize:12,color:C.green,fontWeight:600}}>🔒 Secured by Stripe</span></div>
        </div>
        <div style={{marginBottom:16}}>
          <div className="sl" style={{marginBottom:10}}>Your bookings</div>
          {/* Lines of the itinerary that are not on this list. Said here, on
              the screen where somebody is about to pay, because the amount
              below covers what is listed and nothing else. */}
          {unbooked.length>0&&(
            <div style={{margin:"0 0 12px",padding:"11px 13px",background:C.amberDim,border:`1px solid ${C.border}`,borderRadius:14}}>
              <div style={{fontSize:12.5,color:C.t1,fontWeight:600,marginBottom:5}}>
                {unbooked.length===1?"One thing isn't in this total":`${unbooked.length} things aren't in this total`}
              </div>
              {/* All of them. This showed the first four, so a trip with
                  nine things Reach could not book told you about four and
                  left five for you to discover on the day. */}
              {unbooked.map((u,i)=>{
                const fix=fixFor(u.why);
                return(
                  <div key={i} style={{fontSize:12,color:C.t2,lineHeight:1.5,marginBottom:fix?6:0}}>
                    {u.title} — {u.why}
                    {/* The reason names a thing that is missing; this is where
                        that thing is entered. Without it the screen says what
                        is wrong and leaves finding the page to the person it
                        is telling. */}
                    {fix&&goToProfileSection&&(
                      <div><button onClick={()=>goToProfileSection(fix.section)}
                        style={{marginTop:4,background:"none",border:`1px solid ${C.border}`,
                          color:C.accentText,fontSize:12,fontWeight:700,padding:"6px 11px",
                          borderRadius:999,cursor:"pointer"}}>{fix.label}</button></div>
                    )}
                  </div>
                );
              })}
              <div style={{fontSize:11.5,color:C.t3,marginTop:6,lineHeight:1.45}}>
                You are paying for what is listed below.
              </div>
            </div>
          )}
          {lines.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 4px"}}>
            <span style={{fontSize:20}}>{it.icon}</span>
            <div style={{flex:1}}><div style={{fontSize:14,color:C.t1,fontWeight:600}}>{it.l}</div>
              {it.d?<div style={{fontSize:12,color:C.t2}}>{it.d}</div>:null}</div>
            {/* Every status that was not "confirmed" or "pending" used to fall
                through to "Booked \u2713" in green — so a booking that FAILED, or
                was cancelled, told somebody it was booked. On the screen after
                a real card payment, that is the worst thing the app could say.
                Each state now says what it is, and only one of them is green. */}
            {it.st?chip(BOOKING_STATE[it.st]?.label||"Not booked",BOOKING_STATE[it.st]?.tone||"plain"):null}
            {it.href?(
              <a href={it.href} target="_blank" rel="noopener noreferrer"
                style={{fontSize:12,fontWeight:700,color:C.accentText,textDecoration:"none",whiteSpace:"nowrap"}}>
                Finish on {PROVIDER_NAME[it.provider]||"their site"} →
              </a>
            ):null}
          </div>))}
        </div>
        {/* What is left, and how to do it — on the screen that just took the
            money, because this is the moment somebody is willing to finish
            the job. "Book everything" books everything Reach can book; a
            table it is not allowed to take and a ticket somebody else sells
            are the two it cannot, and both of those have a link or a number
            sitting on the row. Naming them without those was the old screen:
            a to-do list with nothing to press.
            The same ItemActions the plan screen and the budget tab use, and
            the same markGot, so ticking one off here ticks it off there. */}
        {stillOpen.length>0&&(
          <div style={{marginBottom:16}}>
            <div className="sl" style={{marginBottom:6}}>
              {plural(stillOpen.length,"thing","things")} left for you
            </div>
            <div style={{fontSize:12.5,color:C.t2,lineHeight:1.5,marginBottom:10}}>
              Reach booked what it could. These are the ones somebody else sells or
              takes by phone — here is where to do each of them.
            </div>
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:"4px 14px"}}>
              {stillOpen.map((item,i)=>(
                <div key={item.id||i} style={{padding:"11px 0",borderTop:i?`1px solid ${C.border}`:"none"}}>
                  <div style={{fontSize:13.5,color:C.t1,lineHeight:1.4}}>{item.title}</div>
                  {item.time&&<div style={{fontSize:11.5,color:C.t3,marginTop:1}}>{item.time}</div>}
                  {item.payment_note&&(
                    <div style={{display:"flex",gap:6,marginTop:4,fontSize:11.5,lineHeight:1.45,
                      color:/cash only/i.test(item.payment_note)?C.amber:C.t3}}>
                      <span style={{flexShrink:0}}>{/cash only/i.test(item.payment_note)?"💵":"💳"}</span>
                      <span>{item.payment_note}</span>
                    </div>
                  )}
                  <ItemActions item={item} markGot={markGot} tight/>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Everything on this trip is arranged — said only when it is true,
            which is when nothing Reach cannot book is still outstanding. */}
        {stillOpen.length===0&&yoursToBook.length>0&&(
          <div style={{marginBottom:16,padding:"12px 14px",background:C.greenDim,
            border:`1px solid ${C.green}`,borderRadius:14,fontSize:12.5,color:C.t1,lineHeight:1.5}}>
            ✓ Every table and ticket on this trip is sorted, and Reach has the rest.
          </div>
        )}
        {/* This was onBack, which is not what it says. Back from here is
            wherever checkout was opened from — usually the plan's overview,
            sometimes the group — so the one button on the screen after a
            payment took people somewhere other than the thing they had just
            paid for. `replace` rather than `push`: going back from the
            itinerary must not land on a checkout screen whose "Looks good"
            would start a second payment. */}
        <button onClick={()=>replace
            ?replace("planDetail",{planId,groupId,initialTab:"itinerary"})
            :onBack()}
          style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700,fontSize:15}}>See my itinerary</button>
      </div>
    </div>);
  }

  if(phase==="pay")return(<div className="sc" style={{paddingBottom:40}}>
    <div style={{padding:"18px 20px 6px",display:"flex",alignItems:"center",gap:10}}>
      <span onClick={()=>setPhase("review")} style={{cursor:"pointer",color:C.t2,fontSize:20}}>←</span>
      <span style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1}}>Your share · {fmt(myShareCents)}</span>
    </div>
    <div style={{padding:"8px 20px 0"}}>
      <div ref={payRef} style={{minHeight:220,background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:14}}/>
      {!payReady&&<div style={{textAlign:"center",color:C.t2,fontSize:13,marginTop:10}}>Loading secure payment…</div>}
      <button disabled={!payReady||busy} onClick={confirmPay}
        style={{width:"100%",marginTop:16,padding:"15px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700,fontSize:15,opacity:(!payReady||busy)?.6:1}}>
        {busy?"Paying\u2026":`Pay ${fmt(myShareCents)}`}</button>
      <div style={{textAlign:"center",fontSize:12,color:C.t2,marginTop:10}}>🔒 Secured by Stripe · you only pay your share</div>
    </div>
  </div>);

  // phase === review
  return(<div className="sc" style={{paddingBottom:40}}>
    <div style={{padding:"18px 20px 6px",display:"flex",alignItems:"center",gap:10}}>
      <span onClick={onBack} style={{cursor:"pointer",color:C.t2,fontSize:20}}>←</span>
      <span style={{fontFamily:"var(--font-display)",fontSize:22,color:C.t1}}>{plan?.destination||plan?.name||"Your trip"}</span>
    </div>
    <div style={{padding:"6px 20px 0"}}>
      <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:"6px 4px",marginBottom:14}}>
        {lines.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderBottom:i<lines.length-1?`1px solid ${C.border}`:"none"}}>
          <span style={{fontSize:20}}>{it.icon}</span>
          <div style={{flex:1}}><div style={{fontSize:14,color:C.t1,fontWeight:600}}>{it.l}</div>
            {it.d?<div style={{fontSize:12,color:C.t2}}>{it.d}</div>:null}</div>
          {/* Same fall-through as the success screen had: anything that was
              not confirmed or awaiting_approval read "We're on it", so a
              booking that had already failed claimed somebody was working on
              it. One map, so the two screens cannot drift apart again. */}
          {it.st?chip(BOOKING_STATE[it.st]?.label||"Not booked",BOOKING_STATE[it.st]?.tone||"plain"):null}
          {it.href?(
            <a href={it.href} target="_blank" rel="noopener noreferrer"
              onClick={()=>setHandedOver(h=>({...h,[it.id]:true}))}
              style={{fontSize:12,fontWeight:700,color:C.accentText,textDecoration:"none",whiteSpace:"nowrap"}}>
              {it.provider==="resy"||it.provider==="opentable"||it.provider==="tock"
                ?`Reserve on ${PROVIDER_NAME[it.provider]} →`
                :`Finish on ${PROVIDER_NAME[it.provider]||"their site"} →`}
            </a>
          ):it.phone?(
            // No platform, but a telephone. Ringing is how most restaurants
            // take a table, and a tap dials it on the device this is on.
            <a href={`tel:${String(it.phone).replace(/[^0-9+]/g,"")}`}
              onClick={()=>setHandedOver(h=>({...h,[it.id]:true}))}
              style={{fontSize:12,fontWeight:700,color:C.accentText,textDecoration:"none",whiteSpace:"nowrap"}}>
              Call to reserve →
            </a>
          ):null}
        </div>))}
      </div>
      {/* Only the person who booked it knows whether there was a table, so
          the app asks them rather than guessing from a click. Shown once
          they have been handed over, and for anything already waiting. */}
      {lines.filter(it=>(it.href||it.phone)&&(handedOver[it.id]||it.st==="redirected")&&it.st!=="confirmed").map(it=>(
        <div key={`cap-${it.id}`} style={{margin:"0 4px 12px",padding:"12px 14px",background:C.s2,
          border:`1px solid ${C.border}`,borderRadius:14}}>
          <div style={{fontSize:13,color:C.t1,fontWeight:600,marginBottom:2}}>{it.l}</div>
          {PLATFORM_PERK[it.provider]&&(
            <div style={{fontSize:11.5,color:C.t3,lineHeight:1.5,marginBottom:8}}>
              {PLATFORM_PERK[it.provider]}
            </div>
          )}
          <div style={{fontSize:12,color:C.t2,lineHeight:1.5,marginBottom:10}}>
            Did you get the table?
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="bs" style={{flex:1,color:C.green,borderColor:C.green}}
              disabled={capturing===it.id} onClick={()=>captureBooking(it.id,"confirmed")}>
              {capturing===it.id?"…":"Booked it ✓"}
            </button>
            <button className="bs" style={{flex:1}}
              disabled={capturing===it.id} onClick={()=>captureBooking(it.id,"failed")}>
              Couldn't book
            </button>
          </div>
        </div>
      ))}
      {/* Before the money, not only after it. The rows above are what Reach
          is booking; these are the lines of the same trip it is not allowed
          to — a table that has to go on the traveller's own card, a ticket
          somebody else sells — and the total below covers none of them.
          Saying so here is the difference between a total that looks like
          the trip and a total somebody understands.
          Anything that already has a booking row above is excluded, so no
          dinner appears twice under two headings. */}
      {stillOpen.length>0&&(
        <div style={{margin:"0 4px 16px",padding:"12px 14px",background:C.s2,
          border:`1px solid ${C.border}`,borderRadius:14}}>
          <div style={{fontSize:13,color:C.t1,fontWeight:600,marginBottom:4}}>
            {plural(stillOpen.length,"thing","things")} you book yourself
          </div>
          <div style={{fontSize:11.5,color:C.t3,lineHeight:1.5,marginBottom:8}}>
            Not in the total below. You can do them now or after paying — a table
            goes on your own card so your card's dining benefits still count.
          </div>
          {stillOpen.map((item,i)=>(
            <div key={item.id||i} style={{padding:"9px 0",borderTop:i?`1px solid ${C.border}`:"none"}}>
              <div style={{fontSize:12.5,color:C.t1,lineHeight:1.4}}>{item.title}</div>
              <ItemActions item={item} markGot={markGot} tight/>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"0 4px",marginBottom:16}}>
        <span style={{fontSize:14,color:C.t2}}>{participants<=1?"Your trip":`Your share of ${plural(participants,"person","people")}`}</span>
        {/* A figure here while the button is disabled is the screen saying
            "you owe $1,474" and "we're still pricing this" at once. The
            server's funding target was zero and this still read $1,474,
            because with nothing quoted the share falls back to the trip's
            budget — an estimate, printed in the place a person reads as a
            bill. Until there is something real to charge, no number. */}
        <span style={{fontFamily:"var(--font-display)",fontSize:28,color:C.t1}}>
          {checkout.canPay?fmt(myShareCents):"—"}
        </span>
      </div>
      {/* Priced separately from the total above, which is this member's
          share: concierge rows are real things being arranged whose cost is
          settled on the phone, so they are named rather than counted as $0. */}
      {checkout.conciergeNote?(
        <div style={{fontSize:12,color:C.t2,marginBottom:10,padding:"0 4px"}}>{checkout.conciergeNote}</div>
      ):null}
      {/* Nothing for Reach to charge, and nothing coming. A concert whose
          ticket is bought from the seller, an evening of walk-ins. This
          button sat disabled for ever under "we're still pricing this", so
          a plan already as finished as it would ever get looked permanently
          unfinished. There is nothing to pay, so say so and let them go. */}
      {checkout.nothingToCharge
        ?<button onClick={()=>replace?replace("planDetail",{planId,groupId}):onBack()}
          style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700,fontSize:16}}>
          Nothing to pay — take me to the plan</button>
        :<button disabled={busy||!checkout.canPay} onClick={startPayment}
          style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.accent,color:C.onAccent,fontWeight:700,fontSize:16,opacity:(busy||!checkout.canPay)?.6:1}}>
          {busy?"One sec\u2026":"Looks good"}</button>}
      <div style={{textAlign:"center",fontSize:12,color:C.t2,marginTop:10}}>
        {/* The button used to be live over a total of $0. Whatever else is
            true, nobody should be invited to pay for a trip we have not
            managed to price. */}
        {/* What failed, why, and the two ways out of it. A booking that could
            not be made used to leave "Trip item (details coming) — Couldn't
            book" on the screen with nothing to do about it, and the pay
            button live above it. */}
        {checkout.broken.length>0&&!skipBroken&&(
          <div style={{margin:"0 0 10px",padding:"12px 14px",background:C.amberDim,
            border:`1px solid ${C.border}`,borderRadius:14,textAlign:"left"}}>
            {checkout.broken.map((b,i)=>(
              <div key={b.id||i} style={{fontSize:12.5,color:C.t1,lineHeight:1.5,marginBottom:6}}>
                <span style={{fontWeight:600}}>{itemTitle(b)}</span>
                {b.error?<span style={{color:C.t2}}> — {b.error}</span>:null}
              </div>
            ))}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
              <button onClick={()=>{setPhase("loading");load();}}
                style={{background:"none",border:`1px solid ${C.border}`,color:C.accentText,
                  fontSize:12.5,fontWeight:700,padding:"7px 12px",borderRadius:999,cursor:"pointer"}}>
                Try these again
              </button>
              {/* Never a trap. Moab's flight cannot be booked at any price —
                  the trip started — so without this the hotel could never be
                  paid for either. */}
              <button onClick={()=>setSkipBroken(true)}
                style={{background:"none",border:`1px solid ${C.border}`,color:C.t2,
                  fontSize:12.5,fontWeight:600,padding:"7px 12px",borderRadius:999,cursor:"pointer"}}>
                {/* "Book the rest without them" was the first wording and
                    check:promises refused it, rightly: this button books
                    nothing. It uncovers the pay button, and the booking
                    happens when that is pressed. */}
                Carry on without {checkout.broken.length===1?"it":"them"}
              </button>
            </div>
          </div>
        )}
        {checkout.blockedCopy
          ?checkout.blockedCopy
          :participants<=1
            ?"Pay when you're ready and we'll book it \uD83C\uDF0D"
            :"Nothing books until the whole group is in \uD83E\uDD1D"}
      </div>
    </div>
  </div>);
}
// ============ END CHECKOUT V2 ============
// ─── PROFILE ──────────────────────────────────────────────────────────────
// Every figure on this screen comes from /api/profile. It used to be literals
// — a passport expiring in 2029, a Visa ending 4242, three signed-in devices,
// "Face ID: Enabled" — with 19 controls and not one server call behind them.
//
// Sections with nothing behind them were removed rather than rebuilt: Reach
// has no PIN, no Face ID enrolment, no SMS second factor and no spending
// limits, so showing them as configured was the worst kind of placeholder.
function ProfileScreen({toast,user,onSignOut,theme,chooseTheme,push,onIdentityChange,openSection}){
  // Openable at a section, so something that needs a detail can send somebody
  // to the exact page that takes it rather than to a menu with seven rows on
  // it. Checkout uses this: "we need the name the room is under" is a real
  // answer, and on its own it is not a way to fix anything.
  const [section,setSection]=useState(openSection||null);
  useEffect(()=>{ if(openSection)setSection(openSection); },[openSection]);
  const [data,setData]=useState(null);
  const [loadErr,setLoadErr]=useState(false);
  const [busy,setBusy]=useState(null);

  const load=async()=>{
    try{
      const r=await fetch("/api/profile");
      if(!r.ok)throw new Error();
      setData(await r.json());setLoadErr(false);
    }catch(e){setLoadErr(true);}
  };
  useEffect(()=>{load();},[]);

  const money=cents=>`$${((cents||0)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const day=iso=>iso?new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"";

  // ── Travel documents ───────────────────────────────────────────────────
  const [docDraft,setDocDraft]=useState({});
  const saveDoc=async(field,value)=>{
    if(busy)return;setBusy(field);
    try{
      const r=await fetch("/api/profile",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({[field]:value||null}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Couldn't save that");
      setDocDraft(x=>({...x,[field]:undefined}));
      toast(value?"Saved":"Removed");
      await load();
    }catch(e){toast(e.message);}
    finally{setBusy(null);}
  };

  // ── Loyalty programmes ─────────────────────────────────────────────────
  const [loyName,setLoyName]=useState("");
  const [loyTier,setLoyTier]=useState("");
  const [loyNum,setLoyNum]=useState("");
  const addLoyalty=async()=>{
    if(busy||!loyName.trim())return;setBusy("loyalty");
    try{
      const r=await fetch("/api/profile/loyalty",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({programName:loyName.trim(),tier:loyTier.trim()||undefined,number:loyNum.trim()||undefined}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Couldn't add that programme");
      setLoyName("");setLoyTier("");setLoyNum("");
      toast("Added — we'll use it when we price things");await load();
    }catch(e){toast(e.message);}
    finally{setBusy(null);}
  };
  const removeLoyalty=async id=>{
    if(busy)return;setBusy(id);
    try{
      const r=await fetch("/api/profile/loyalty",{
        method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id}),
      });
      if(!r.ok)throw new Error("Couldn't remove that programme");
      toast("Gone");await load();
    }catch(e){toast(e.message);}
    finally{setBusy(null);}
  };

  // ── Consent ────────────────────────────────────────────────────────────
  const setConsent=async(key,column,value)=>{
    setData(d=>d?{...d,consent:{...d.consent,[key]:value}}:d);
    try{
      const r=await fetch("/api/user/data",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({[column]:value}),
      });
      if(!r.ok)throw new Error();
      toast("Noted");
    }catch(e){
      setData(d=>d?{...d,consent:{...d.consent,[key]:!value}}:d);
      toast("Couldn't save that — try again");
    }
  };

  // ── Account deletion ───────────────────────────────────────────────────
  const [deleteConfirm,setDeleteConfirm]=useState("");
  const requestDeletion=async()=>{
    if(busy||deleteConfirm!=="DELETE")return;setBusy("delete");
    try{
      const r=await fetch("/api/user/data",{
        method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({confirm:"DELETE"}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Couldn't schedule that");
      toast("Deletion scheduled");setDeleteConfirm("");setSection(null);await load();
    }catch(e){toast(e.message);}
    finally{setBusy(null);}
  };

  const Row=({icon,title,sub,right,onClick})=>(
    <div className="ri" {...(onClick?pressable:{})} onClick={onClick} style={{cursor:onClick?"pointer":"default"}}>
      <div className="ri-ic" style={{background:C.accentDim,color:C.accentText}}>{icon}</div>
      <div className="ri-inf"><div className="ri-t">{title}</div>{sub&&<div className="ri-s">{sub}</div>}</div>
      {right}
    </div>
  );
  const Empty=({children})=>(
    <div style={{padding:"14px 20px",fontSize:13,color:C.t3,lineHeight:1.5}}>{children}</div>
  );

  // ═══ You: name and home airport ═══
  // Both exist because the app was guessing. The greeting said "Hey there"
  // when Clerk had no first name, and the departure airport was inferred from
  // browser geolocation against a fixed list of US cities — wrong or missing
  // for anyone outside it, or away from home when they planned.
  if(section==="you"){
    const home=data?.home;
    const ident=data?.identity;
    const firstDraft=docDraft.__first!==undefined?docDraft.__first:(ident?.firstName??"");
    const airDraft=docDraft.__air!==undefined?docDraft.__air:(home?.airport??"");
    const cityDraft=docDraft.__city!==undefined?docDraft.__city:(home?.city??"");
    const airValid=!airDraft||/^[A-Za-z]{3}$/.test(airDraft.trim());

    const saveYou=async()=>{
      if(busy)return;setBusy("you");
      try{
        const body={};
        if(docDraft.__first!==undefined)body.firstName=firstDraft.trim()||null;
        if(docDraft.__air!==undefined)body.homeAirport=airDraft.trim()||null;
        if(docDraft.__city!==undefined)body.homeCity=cityDraft.trim()||null;
        if(!Object.keys(body).length){setBusy(null);return;}
        const r=await fetch("/api/profile",{
          method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||"Couldn't save that");
        setDocDraft(x=>({...x,__first:undefined,__air:undefined,__city:undefined}));
        toast("Saved");await load();
        // The greeting reads the app's copy of the user, not this screen's,
        // so without this a new name only appeared after a reload.
        if(body.firstName!==undefined)onIdentityChange?.();
      }catch(e){toast(e.message);}
      finally{setBusy(null);}
    };

    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection(null)} label="Profile" title="You"/>
        <div style={{padding:"0 20px 18px"}}>
          <div className="sl" style={{marginBottom:8}}>What should we call you?</div>
          <input aria-label="First name" className="inp" value={firstDraft} placeholder="First name"
            onChange={e=>setDocDraft(x=>({...x,__first:e.target.value}))}/>
          <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
            Used on your home screen and wherever your group sees you.
          </div>
        </div>

        <div style={{padding:"0 20px 18px",borderTop:`1px solid ${C.border}`,paddingTop:18}}>
          <div className="sl" style={{marginBottom:8}}>Home airport</div>
          <div style={{display:"flex",gap:8}}>
            <input aria-label="Home airport" className="inp" value={airDraft} placeholder="SFO" maxLength={3}
              style={{width:96,textTransform:"uppercase",fontWeight:600,letterSpacing:".08em"}}
              onChange={e=>setDocDraft(x=>({...x,__air:e.target.value}))}/>
            <input aria-label="Home city" className="inp" value={cityDraft} placeholder="San Francisco, CA" style={{flex:1}}
              onChange={e=>setDocDraft(x=>({...x,__city:e.target.value}))}/>
          </div>
          {!airValid&&(
            <div style={{fontSize:12,color:C.red,marginTop:8}}>
              An airport code is three letters, like SFO or JFK.
            </div>
          )}
          {/* Two fields that describe one thing were let to disagree, and
              nothing noticed: a profile here read Pittsburgh and RDU at once
              — 350 miles apart — and the trip screen showed both for months.
              Said out loud rather than fixed silently, because living in one
              place and flying from another is ordinary and this is somebody
              else's business to settle. */}
          {(()=>{ const m=airValid&&airportMismatch(cityDraft,airDraft); return m?(
            <div style={{marginTop:10,padding:"10px 12px",background:C.amberDim,
              border:`1px solid ${C.amber}`,borderRadius:12,fontSize:12,color:C.t1,lineHeight:1.5}}>
              {m.city}'s airport is {m.expected}, and you have {m.saved} set. If you fly from
              {" "}{m.saved} that's fine — otherwise:
              <button className="bs" style={{marginTop:8,width:"100%"}}
                onClick={()=>setDocDraft(x=>({...x,__air:m.expected}))}>
                Use {m.expected} instead
              </button>
            </div>
          ):null; })()}
          {/* Nothing chosen: say what it will use, so it is not a surprise
              on the trip screen later. */}
          {airValid&&!airDraft.trim()&&airportForCity(cityDraft)&&(
            <div style={{fontSize:11.5,color:C.t2,marginTop:8,lineHeight:1.5}}>
              Leave this empty and we'll use {airportForCity(cityDraft)} from your home city.
            </div>
          )}
          <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
            Every flight estimate departs from here. Without it the app guesses from your
            browser's location, which is wrong whenever you plan a trip from somewhere
            that isn't home.
          </div>
          {home&&home.available===false&&(
            <div style={{marginTop:10,padding:"10px 12px",background:C.amberDim,border:`1px solid ${C.amber}`,borderRadius:12,fontSize:12,color:C.t1,lineHeight:1.5}}>
              Saving this needs a database migration that hasn't been run yet:
              sql/home-airport-2026-09-12.sql
            </div>
          )}
        </div>

        <div style={{padding:"0 20px 30px"}}>
          <button className="bp" disabled={busy==="you"||!airValid} onClick={saveYou}>
            {busy==="you"?"Saving…":"Save"}
          </button>
        </div>
      </div>
    );
  }

  // ═══ Flying details ═══
  // Three fields an airline checks against the document you travel on. They
  // are asked for here, once, rather than in a booking form under time
  // pressure — and they stay yours: the group sees "Ready" or "Incomplete"
  // and never a value.
  if(section==="flying"){
    const e=data?.essentials||{};
    const lastDraft=docDraft.__last!==undefined?docDraft.__last:(e.lastName??"");
    const firstDraft=docDraft.__fFirst!==undefined?docDraft.__fFirst:(e.firstName??"");
    const dobDraft=docDraft.__dob!==undefined?docDraft.__dob:(e.dateOfBirth??"");
    const genDraft=docDraft.__gender!==undefined?docDraft.__gender:(e.gender??"");
    const phoneDraft=docDraft.__phone!==undefined?docDraft.__phone:(e.phone??"");
    const dobValid=!dobDraft||/^\d{4}-\d{2}-\d{2}$/.test(dobDraft);
    const GENDERS=[
      {v:"female",label:"Female"},
      {v:"male",label:"Male"},
      {v:"x",label:"X"},
      {v:"unspecified",label:"Rather not say"},
    ];

    const saveFlying=async()=>{
      if(busy)return;setBusy("flying");
      try{
        const body={};
        if(docDraft.__fFirst!==undefined)body.firstName=firstDraft.trim()||null;
        if(docDraft.__last!==undefined)body.lastName=lastDraft.trim()||null;
        if(docDraft.__dob!==undefined)body.dateOfBirth=dobDraft.trim()||null;
        if(docDraft.__gender!==undefined)body.gender=genDraft||null;
        if(docDraft.__phone!==undefined)body.phone=phoneDraft.trim()||null;
        if(!Object.keys(body).length){setBusy(null);return;}
        const r=await fetch("/api/profile",{
          method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||"Couldn't save that");
        setDocDraft(x=>({...x,__fFirst:undefined,__last:undefined,__dob:undefined,__gender:undefined,__phone:undefined}));
        toast("Saved");await load();
        if(body.firstName!==undefined)onIdentityChange?.();
      }catch(err){toast(err.message);}
      finally{setBusy(null);}
    };

    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection(null)} label="Profile" title="Flying details"/>
        <Empty>
          No airline will issue a ticket without these three, and each one is checked
          against the ID you travel on. Your group sees only whether you're ready —
          never the answers.
        </Empty>

        <div style={{padding:"0 20px 18px"}}>
          <div className="sl" style={{marginBottom:8}}>Name, as printed on your ID</div>
          <div style={{display:"flex",gap:8}}>
            <input aria-label="Legal first name" className="inp" value={firstDraft} placeholder="First"
              style={{flex:1}} onChange={ev=>setDocDraft(x=>({...x,__fFirst:ev.target.value}))}/>
            <input aria-label="Legal last name" className="inp" value={lastDraft} placeholder="Last"
              style={{flex:1}} onChange={ev=>setDocDraft(x=>({...x,__last:ev.target.value}))}/>
          </div>
          <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
            This is the same name your group already sees. A ticket that doesn't match
            your ID is refused at the gate, so a nickname here costs a flight.
          </div>
        </div>

        <div style={{padding:"0 20px 18px",borderTop:`1px solid ${C.border}`,paddingTop:18}}>
          <div className="sl" style={{marginBottom:8}}>Date of birth</div>
          <input aria-label="Date of birth" className="inp" type="date" value={dobDraft}
            max={new Date().toISOString().slice(0,10)}
            onChange={ev=>setDocDraft(x=>({...x,__dob:ev.target.value}))}/>
          {!dobValid&&(
            <div style={{fontSize:12,color:C.red,marginTop:8}}>
              A date of birth looks like 1991-04-02.
            </div>
          )}
        </div>

        <div style={{padding:"0 20px 18px",borderTop:`1px solid ${C.border}`,paddingTop:18}}>
          <div className="sl" style={{marginBottom:8}}>Phone number</div>
          <input aria-label="Phone number" className="inp" type="tel" value={phoneDraft}
            placeholder="+1 555 123 4567"
            onChange={ev=>setDocDraft(x=>({...x,__phone:ev.target.value}))}/>
          <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
            The airline's requirement, not ours — it is how they reach you when a
            flight moves. No ticket is issued without one.
          </div>
        </div>

        <div style={{padding:"0 20px 18px",borderTop:`1px solid ${C.border}`,paddingTop:18}}>
          <div className="sl" style={{marginBottom:8}}>Gender on your ID</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {GENDERS.map(g=>(
              <button key={g.v} className="bs"
                aria-pressed={genDraft===g.v}
                style={genDraft===g.v?{color:C.accentText,borderColor:C.accentText,fontWeight:600}:undefined}
                onClick={()=>setDocDraft(x=>({...x,__gender:g.v}))}>{g.label}</button>
            ))}
          </div>
          <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
            Airlines carry the marker printed on your passport or licence, which is
            not always how you'd describe yourself. If yours is X, or you'd rather
            not say, we book that flight with the airline directly — automatic
            booking only carries male or female and we won't put the wrong one on
            your ticket.
          </div>
          {e.gender===undefined&&(
            <div style={{marginTop:10,padding:"10px 12px",background:C.amberDim,border:`1px solid ${C.amber}`,borderRadius:12,fontSize:12,color:C.t1,lineHeight:1.5}}>
              Saving this needs a database migration that hasn't been run yet:
              sql/travel-essentials-2026-09-18.sql
            </div>
          )}
        </div>

        {e.missing?.length>0&&(
          <div style={{padding:"0 20px 18px"}}>
            <div style={{fontSize:13,color:C.t2,lineHeight:1.5}}>
              Still needed before you can be booked on a flight: {e.missing.join(", ")}.
            </div>
          </div>
        )}

        <div style={{padding:"0 20px 30px"}}>
          <button className="bp" disabled={busy==="flying"||!dobValid} onClick={saveFlying}>
            {busy==="flying"?"Saving…":"Save"}
          </button>
        </div>
      </div>
    );
  }

  // ═══ Travel documents ═══
  if(section==="documents"){
    const docs=[
      {key:"passport",icon:"🛂",label:"Passport number"},
      {key:"tsaPrecheck",icon:"🪪",label:"TSA PreCheck (KTN)"},
      {key:"globalEntry",icon:"✈️",label:"Global Entry number"},
    ];
    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection(null)} label="Profile" title="Travel documents"/>
        <Empty>
          Stored encrypted with AES-256. Only the last four characters are ever sent back
          to this screen, and they are never shared with a group.
        </Empty>
        {docs.map(d=>{
          const cur=data?.documents?.[d.key];
          const draft=docDraft[d.key];
          const editing=draft!==undefined;
          return(
            <div key={d.key} style={{padding:"12px 20px",borderTop:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <span style={{fontSize:18}}>{d.icon}</span>
                <span style={{fontSize:14,fontWeight:600,color:C.t1,flex:1}}>{d.label}</span>
                {cur?.present&&!editing&&(
                  <span style={{fontSize:12,color:C.t2}}>
                    {cur.last4?`•••• ${cur.last4}`:"Saved"}
                  </span>
                )}
              </div>
              {editing?(
                <>
                  <input className="inp" value={draft} autoFocus
                    onChange={e=>setDocDraft(x=>({...x,[d.key]:e.target.value}))}
                    placeholder={d.label}/>
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    <button className="bs" style={{flex:1}} disabled={busy===d.key}
                      onClick={()=>setDocDraft(x=>({...x,[d.key]:undefined}))}>Cancel</button>
                    <button className="bs" style={{flex:1,color:C.accentText,borderColor:C.accentText}}
                      disabled={busy===d.key||draft.trim().length<4}
                      onClick={()=>saveDoc(d.key,draft.trim())}>
                      {busy===d.key?"Saving…":"Save"}
                    </button>
                  </div>
                </>
              ):(
                <div style={{display:"flex",gap:8}}>
                  <button className="bs" style={{flex:1}}
                    onClick={()=>setDocDraft(x=>({...x,[d.key]:""}))}>
                    {cur?.present?"Replace":"Add"}
                  </button>
                  {cur?.present&&(
                    <button className="bs" style={{flex:1,color:C.red,borderColor:C.redDim}}
                      disabled={busy===d.key} onClick={()=>saveDoc(d.key,null)}>
                      {busy===d.key?"Removing…":"Remove"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ═══ Loyalty programmes ═══
  if(section==="loyalty"){
    const rows=data?.loyalty||[];
    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection(null)} label="Profile" title="Loyalty programmes"/>
        {rows.length===0&&<Empty>No programmes yet. Add the ones you actually hold — Reach uses them when it prices a trip.</Empty>}
        {rows.map(p=>(
          <Row key={p.id} icon="🎫" title={p.program_name}
            sub={[p.tier,p.points!=null?`${p.points.toLocaleString()} pts`:null].filter(Boolean).join(" · ")||"No tier recorded"}
            right={<button className="bsm bsm-r" disabled={busy===p.id} onClick={()=>removeLoyalty(p.id)}>
              {busy===p.id?"…":"Remove"}</button>}/>
        ))}
        <div style={{padding:"16px 20px 30px",borderTop:`1px solid ${C.border}`,marginTop:8}}>
          <div className="sl" style={{marginBottom:10}}>Add a programme</div>
          <input aria-label="Loyalty programme" className="inp" value={loyName} onChange={e=>setLoyName(e.target.value)}
            placeholder="Programme, e.g. United MileagePlus" style={{marginBottom:8}}/>
          <input aria-label="Tier" className="inp" value={loyTier} onChange={e=>setLoyTier(e.target.value)}
            placeholder="Tier (optional)" style={{marginBottom:8}}/>
          <input aria-label="Membership number" className="inp" value={loyNum} onChange={e=>setLoyNum(e.target.value)}
            placeholder="Membership number (optional, encrypted)" style={{marginBottom:12}}/>
          <button className="bp" disabled={busy==="loyalty"||!loyName.trim()} onClick={addLoyalty}>
            {busy==="loyalty"?"Adding…":"Add programme"}
          </button>
        </div>
      </div>
    );
  }

  // ═══ Payment ═══
  if(section==="payment"){
    const cards=data?.cards||[];
    const pays=data?.payments||[];
    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection(null)} label="Profile" title="Payment"/>
        <div style={{padding:"0 20px 6px"}}><span className="sl">Saved cards</span></div>
        {cards.length===0
          ?<Empty>No card saved yet. A card is stored by Stripe the first time you pay into a plan — Reach never sees the number.</Empty>
          :cards.map(c=>(
            <Row key={c.id} icon="💳"
              title={`${c.brand[0].toUpperCase()}${c.brand.slice(1)} ···· ${c.last4}`}
              sub={c.expMonth?`Expires ${String(c.expMonth).padStart(2,"0")}/${String(c.expYear).slice(-2)} · held by Stripe`:"Held by Stripe"}/>
          ))}
        <div style={{padding:"16px 20px 6px"}}><span className="sl">Recent payments</span></div>
        {pays.length===0
          ?<Empty>Nothing yet. Payments appear here once you contribute to a plan.</Empty>
          :pays.map(p=>(
            <Row key={p.id} icon={p.refund_amount_cents>0?"↩️":"💵"}
              title={money(p.amount_cents)}
              sub={`${day(p.created_at)} · ${p.status}${p.refund_amount_cents>0?` · ${money(p.refund_amount_cents)} refunded`:""}`}
              right={<span className={`pill ${p.status==="succeeded"?"pill-g":p.status==="failed"?"pill-r":"pill-a"}`}>{p.status}</span>}/>
          ))}
      </div>
    );
  }

  // ═══ Privacy ═══
  if(section==="privacy"){
    const c=data?.consent||{};
    const toggles=[
      {k:"personalized",col:"consent_personalized",l:"Personalised recommendations",d:"Uses your trips and votes to suggest experiences."},
      {k:"analytics",col:"consent_analytics",l:"Usage analytics",d:"Anonymous counts of which screens get used."},
      {k:"marketing",col:"consent_marketing",l:"Product emails",d:"Occasional updates about new features."},
      {k:"thirdParty",col:"consent_third_party",l:"Share with booking partners",d:"Only what a partner needs to hold a reservation."},
    ];
    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection(null)} label="Profile" title="Privacy"/>
        <div style={{padding:"0 20px 6px"}}><span className="sl">What Reach may do with your data</span></div>
        {toggles.map(t=>(
          <div key={t.k} className="ri" style={{cursor:"pointer"}} {...pressable} onClick={()=>setConsent(t.k,t.col,!c[t.k])}>
            <div className="ri-inf"><div className="ri-t">{t.l}</div><div className="ri-s">{t.d}</div></div>
            <div style={{width:44,height:26,borderRadius:20,flexShrink:0,position:"relative",transition:"background .15s",
              background:c[t.k]?C.accentText:C.s3,border:`1px solid ${c[t.k]?C.accentText:C.border}`}}>
              <div style={{width:20,height:20,borderRadius:"50%",background:C.s1,position:"absolute",top:2,
                left:c[t.k]?21:2,transition:"left .15s"}}/>
            </div>
          </div>
        ))}
        <div style={{padding:"16px 20px 6px"}}><span className="sl">Your data rights</span></div>
        <Row icon="⬇️" title="Download everything Reach holds"
          sub="A JSON export, as required by GDPR Article 20"
          right={<span style={{fontSize:12,color:C.accentText,fontWeight:600}}>Export</span>}
          onClick={()=>{window.location.href="/api/user/data";toast("Bundling everything up…");}}/>
        <Row icon="🗑️" title="Delete your account" sub="Scheduled 30 days out, and reversible until then"
          right={<Ic.ChevR/>} onClick={()=>setSection("delete")}/>
      </div>
    );
  }

  // ═══ Delete ═══
  if(section==="delete"){
    const pending=data?.deletion;
    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection("privacy")} label="Privacy" title="Delete account"/>
        {pending?(
          <div style={{margin:"10px 20px",background:C.redDim,border:`1px solid ${C.red}`,borderRadius:16,padding:18}}>
            <div style={{fontSize:14,fontWeight:600,color:C.t1,marginBottom:6}}>Deletion already scheduled</div>
            <div style={{fontSize:13,color:C.t2,lineHeight:1.5}}>
              Requested {day(pending.requestedAt)}. Your account and everything in it is removed on {day(pending.scheduledFor)}.
              Contact support before then to stop it.
            </div>
          </div>
        ):(
          <div style={{padding:"6px 20px 30px"}}>
            <div style={{fontSize:14,color:C.t2,lineHeight:1.6,marginBottom:16}}>
              Your groups, plans, votes and saved documents are deleted permanently after 30 days.
              Payments already taken are kept, because tax law requires it. Your Stripe customer
              record is removed immediately.
            </div>
            <div style={{fontSize:13,color:C.t2,marginBottom:8}}>
              Type <strong style={{color:C.t1}}>DELETE</strong> to confirm.
            </div>
            <input aria-label="Type to confirm deleting your account" className="inp" value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)}
              placeholder="DELETE" style={{marginBottom:12}}/>
            <button className="bs" disabled={busy==="delete"||deleteConfirm!=="DELETE"}
              style={{color:deleteConfirm==="DELETE"?C.onAccent:C.t3,
                background:deleteConfirm==="DELETE"?C.red:C.s2,
                borderColor:deleteConfirm==="DELETE"?C.red:C.border}}
              onClick={requestDeletion}>
              {busy==="delete"?"Scheduling…":"Schedule deletion"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ═══ Root ═══
  const stats=data?.stats;
  const docCount=data?.documents?Object.values(data.documents).filter(d=>d.present).length:0;
  // Travel essentials. The server works out what is missing, because the same
  // function decides whether a group is told this person is holding up a
  // flight — two opinions about that would show one thing and book another.
  const ess=data?.essentials;
  // The profile takes about a second to arrive — it asks Stripe for the
  // cards — and for that second every row below was stating something as
  // fact from data it did not have: "Not set yet" over a name that is set,
  // "No card saved yet" over a card that exists, and worst of all "Ready to
  // be ticketed" to somebody who has not filled anything in. An empty
  // optional chain is falsy, so absence read as a confident negative.
  //
  // Until the answer is here, these say nothing at all.
  const settled=!!data||loadErr;
  const until=(value)=>settled?value:"…";
  const connected=(data?.connected||[]).filter(a=>a.status==="connected");
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 18px",textAlign:"center"}}>
        <div style={{width:80,height:80,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.accentDeep})`,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-display)",fontSize:32,color:C.onAccent,border:`3px solid ${C.border}`,overflow:"hidden"}}>
          {user?.avatar?<img src={user.avatar} style={{width:80,height:80,borderRadius:"50%",objectFit:"cover"}} alt=""/>:(user?.name||"?")[0]}
        </div>
        <div style={{fontFamily:"var(--font-display)",fontSize:26,color:C.t1}}>{user?.name||user?.email||"You"}</div>
        <div style={{fontSize:13,color:C.t2,marginTop:2}}>
          {user?.email}
          {data?.provider&&data.provider!=="email"&&<span style={{marginLeft:6,fontSize:11,background:C.accentDim,color:C.accentText,padding:"2px 8px",borderRadius:20,fontWeight:600}}>{data.provider==="apple"?"🍎 Apple":"🌐 Google"}</span>}
        </div>
        <div style={{display:"flex",gap:0,background:C.s2,borderRadius:16,marginTop:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          {[{v:stats?.groups,l:"Groups"},{v:stats?.plans,l:"Plans"},{v:stats?.friends,l:"Travel with"}].map((s,i)=>(
            <div key={i} style={{flex:1,padding:"13px 0",textAlign:"center",borderLeft:i?`1px solid ${C.border}`:"none"}}>
              <div style={{fontFamily:"var(--font-display)",fontSize:24,color:C.accentText}}>{s.v??"—"}</div>
              <div style={{fontSize:10,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {loadErr&&(
        <div style={{margin:"0 20px 14px",background:C.redDim,border:`1px solid ${C.red}`,borderRadius:14,padding:"12px 14px",fontSize:13,color:C.t1}}>
          Couldn't load your profile.{" "}
          <button onClick={load} style={{background:"none",border:"none",color:C.accentText,fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>Try again</button>
        </div>
      )}

      <div style={{padding:"0 20px 6px"}}><span className="sl">You</span></div>
      <Row icon="🙋" title="Name and home airport"
        sub={until([data?.identity?.firstName||null,data?.home?.airport||null].filter(Boolean).join(" · ")||"Not set yet")}
        right={<Ic.ChevR/>} onClick={()=>setSection("you")}/>
      {/* The answers behind every suggestion. Somewhere to revise them, not
          just a one-off at sign-up — what you are into in March is not what
          you were into in November. */}
      <Row icon="✨" title="Your taste"
        sub={user?.quizComplete
          ?"What you're into, how you eat, what you'd never do"
          :"Not answered yet — this is what makes suggestions yours"}
        right={<Ic.ChevR/>} onClick={()=>push&&push("taste")}/>

      <div style={{padding:"16px 20px 6px"}}><span className="sl">Travel</span></div>
      {/* The three things no airline will sell a seat without. Shown before
          travel documents because a passport number is optional and these
          are not. */}
      <Row icon="🎟️" title="Flying details"
        sub={until(ess?.missing?.length
          ?`Still needed: ${ess.missing.join(", ")}`
          :"Ready to be ticketed")}
        right={<>
          {settled&&(
            <span style={{fontSize:12,fontWeight:600,marginRight:8,
              color:ess?.missing?.length?C.amber:C.green}}>
              {ess?.missing?.length?"Incomplete":"Ready"}
            </span>
          )}
          <Ic.ChevR/>
        </>} onClick={()=>setSection("flying")}/>
      <Row icon="🛂" title="Travel documents"
        sub={until(docCount?`${docCount} saved · encrypted`:"Passport, PreCheck, Global Entry")}
        right={<Ic.ChevR/>} onClick={()=>setSection("documents")}/>
      <Row icon="🎫" title="Loyalty programmes"
        sub={until(data?.loyalty?.length?`${data.loyalty.length} saved`:"None yet")}
        right={<Ic.ChevR/>} onClick={()=>setSection("loyalty")}/>
      {connected.length>0&&(
        <Row icon="🔗" title="Connected accounts"
          sub={connected.map(a=>a.label||a.provider).join(", ")}/>
      )}

      <div style={{padding:"16px 20px 6px"}}><span className="sl">Money</span></div>
      <Row icon="💳" title="Payment"
        sub={until(data?.cards?.length?`${data.cards.length} card${data.cards.length===1?"":"s"} on file`:"No card saved yet")}
        right={<Ic.ChevR/>} onClick={()=>setSection("payment")}/>

      <div style={{padding:"16px 20px 6px"}}><span className="sl">Appearance</span></div>
      <div style={{margin:"0 20px 16px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,padding:14}}>
        <div style={{display:"flex",gap:8}}>
          {[{v:"light",icon:"☀️",label:"Light"},{v:"dark",icon:"🌙",label:"Dark"}].map(o=>{
            const on=theme===o.v;
            return(
              <button key={o.v} onClick={()=>chooseTheme&&chooseTheme(o.v)} aria-pressed={on}
                style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                  padding:"12px 10px",borderRadius:12,cursor:"pointer",
                  border:`2px solid ${on?C.accentText:C.border}`,
                  background:on?C.accentDim:C.s2,
                  color:on?C.accentText:C.t2,fontSize:13,fontWeight:600,transition:"all .15s"}}>
                <span style={{fontSize:15}}>{o.icon}</span>{o.label}
              </button>
            );
          })}
        </div>
        <div style={{fontSize:11,color:C.t3,marginTop:10,lineHeight:1.5}}>
          Saved on this device. It applies the moment you choose it.
        </div>
      </div>

      <div style={{padding:"0 20px 6px"}}><span className="sl">Account</span></div>
      <Row icon="🛡️" title="Privacy and your data"
        sub={data?.deletion?"Deletion scheduled":"Consent, export, deletion"}
        right={<Ic.ChevR/>} onClick={()=>setSection("privacy")}/>

      <div style={{padding:"18px 20px 34px"}}>
        <button className="bs" style={{borderColor:C.red,color:C.red}} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}
// ─── APP SHELL ────────────────────────────────────────────────────────────────
export default function ReachApp({realUser,onSignOut}={}){
  // Auth flow stages: splash → auth → permissions → biometric → privacy → app
  const [user,setUser]=useState(realUser??null);
  // The freshest user, for callbacks that outlive the render that made them.
  //
  // getLocation() runs once on mount, and the deadline it sets fires nine
  // seconds later — by which time syncUser() has long since returned. But
  // the fallback it calls closed over `user` at mount, when it was still
  // null, so it read no home city and returned silently. The chain that is
  // meant to go "where you are, then where you live, then ask" stopped
  // dead at the second step, every single time, on every fresh load.
  const userRef=useRef(user);
  useEffect(()=>{ userRef.current=user; },[user]);
  const [tab,setTab]=useState("home");

  // ── Theme ────────────────────────────────────────────────
  // Light is the default. The shell has already stamped a stored choice onto
  // <html> before first paint, so what is on screen is correct from the start;
  // this only catches React's own copy up to it.
  const [theme,setTheme]=useState(DEFAULT_THEME);
  useEffect(()=>{
    try{
      const saved=localStorage.getItem(THEME_KEY);
      if(THEMES.includes(saved))setTheme(saved);
    }catch(e){}
  },[]);
  useEffect(()=>{
    if(typeof document!=="undefined")document.documentElement.setAttribute("data-theme",theme);
  },[theme]);
  // Persist only on a deliberate choice, so the default can never overwrite a
  // stored preference during the first render.
  const chooseTheme=t=>{
    setTheme(t);
    try{localStorage.setItem(THEME_KEY,t);}catch(e){}
  };
  // The browser chrome follows the app, not the system. The tint above the
  // page used to be whatever the OS preferred, so a light-theme visitor on a
  // dark phone got a maroon bar over a cream screen. The meta tag is the only
  // way to say it, and it has to be kept in step with the toggle.
  useEffect(()=>{
    if(typeof document==="undefined")return;
    const colour=theme==="dark"?SURFACE.dark:SURFACE.light;
    let tag=document.querySelector('meta[name="theme-color"]:not([media])');
    if(!tag){
      tag=document.createElement("meta");
      tag.setAttribute("name","theme-color");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content",colour);
  },[theme]);
  const [groups,setGroups]=useState([]);
  const [groupsLoading,setGroupsLoading]=useState(true);
  // /api/me has answered, so the onboarding gate below is deciding on facts
  // rather than on an empty user object.
  const [identityLoaded,setIdentityLoaded]=useState(false);
  const [toastMsg,setToastMsg]=useState(null);
  const [stack,setStack]=useState([]);
  // Which page of Profile to land on, when something sent somebody there to
  // fix a specific thing. Cleared when the tab changes so it does not reopen
  // on the next visit.
  const [profileSection,setProfileSection]=useState(null);

  // User map: demo contacts plus every real member seen from the API.
  const [knownUsers,setKnownUsers]=useState({});
  const um={...Object.fromEntries(ALL_CONTACTS.map(u=>[u.id,u])),...knownUsers};
  // Real user lookup helper — returns a placeholder if user not in map
  const getUser=(id)=>um[id]||{id,name:"Member",handle:"@member",color:C.accentText,initials:"??"};
  const rememberUsers=rows=>{
    const seen={};
    for(const row of rows||[]){
      const c=toContact(row);
      if(c)seen[c.id]=c;
    }
    if(Object.keys(seen).length)setKnownUsers(m=>({...m,...seen}));
  };

  // ── Location state ───────────────────────────────────────
  const [userLocation,setUserLocation]=useState(null); // {lat,lng,city,airport}

  // What the person set in Profile wins over the browser's guess. The guess
  // comes from a fixed table of ~50 US cities and is null for everywhere else,
  // and it describes where they are right now rather than where they fly from.
  // The airport follows the home city unless somebody has chosen otherwise.
  // It used to be a second independent field, which is how a profile ended up
  // reading Pittsburgh and RDU at once and the trip screen showed both.
  const departure=departureFrom(user?.homeCity,user?.homeAirport,userLocation);

  /**
   * Change where you fly from, from wherever you happen to be standing.
   *
   * This lived only in Profile, and the trip quiz is exactly where somebody
   * notices it is wrong — they are looking at "Departing from Pittsburgh"
   * while planning. Sending them to Profile to fix it threw away everything
   * they had filled in, so in practice nobody fixed it.
   */
  const saveDeparture=async({city,airport})=>{
    try{
      const r=await fetch("/api/profile",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({homeCity:city?.trim()||null,homeAirport:airport?.trim()||null}),
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Couldn't save that");
      await syncUser();
      showToast("Departing from "+(city?.trim()||"wherever you are"));
      return true;
    }catch(e){
      console.error("[departure] could not save",e);
      showToast(e.message||"Couldn't save that");
      return false;
    }
  };

  // ── Load real data from Supabase via API ──────────────────
  // The route guard means this component only ever renders for a signed-in
  // user, so there is no stage to wait for: load on mount.
  useEffect(()=>{
    syncUser();
    loadGroups();
    getLocation();
    // Signing up hands over here with ?start=taste, so the quiz is part of
    // creating an account rather than something to find later. The parameter
    // is cleared straight away: a refresh should not reopen it, and neither
    // should a link somebody pastes to a friend.
    if(typeof window!=="undefined"){
      const params=new URLSearchParams(window.location.search);
      if(params.get("start")==="taste"){
        params.delete("start");
        const rest=params.toString();
        window.history.replaceState({},"",window.location.pathname+(rest?"?"+rest:""));
        push("taste");
      }
      // Back from a payment provider's own page. Stripe appends payment_intent
      // and redirect_status to the address checkout gave it. Reopen that
      // checkout to record it, and clear the address first so a refresh or a
      // pasted link cannot replay it.
      if(params.get("paid")&&params.get("payment_intent")){
        const planId=params.get("paid");
        const groupId=params.get("group")||null;
        const returnedIntent=params.get("payment_intent");
        const redirectStatus=params.get("redirect_status");
        for(const k of ["paid","group","payment_intent","payment_intent_client_secret","redirect_status"])params.delete(k);
        const rest=params.toString();
        window.history.replaceState({},"",window.location.pathname+(rest?"?"+rest:""));
        push("checkout",{planId,groupId,returnedIntent,redirectStatus});
      }
    }
  },[]);

  const syncUser=async()=>{
    try{
      const res=await fetch("/api/me");
      if(res.ok){
        const data=await res.json();
        setUser(u=>u?({...u,...data,id:data.id}):data);
        rememberUsers([{id:data.id,name:data.name,email:data.email,avatar_url:data.avatar}]);
        setIdentityLoaded(true);
      }
    }catch(e){console.log("User sync failed",e);}
  };

  // ── Onboarding comes first ────────────────────────────────────────────
  // Sign-up sends people to /onboarding, but that is one route in among
  // several: a saved link, an invite, a password manager opening /home, or a
  // sign-up whose redirect was overridden by the Clerk instance's own
  // settings. An account nobody has told us anything about — no name, no
  // preferences, no groups — has not been through it, whichever door it came
  // in by, so it goes there first.
  //
  // Only ever once per device: the onboarding screen records that it has been
  // shown, and somebody who skips every step must not be sent round again.
  useEffect(()=>{
    if(!identityLoaded||groupsLoading)return;
    if(typeof window==="undefined")return;
    const untouched=user&&!user.quizComplete&&!user.firstName&&groups.length===0;
    if(!untouched)return;
    try{ if(localStorage.getItem("reach_onboarding_seen"))return; }catch(e){ return; }
    window.location.href="/onboarding";
  },[identityLoaded,groupsLoading,user,groups.length]);

  // The quiz is not optional on a first run. Every recommendation, every
  // moment and every trip the app generates reads these answers, so an
  // account without them gets a Discover tab of nothing in particular and a
  // trip planner guessing. Onboarding can be tapped past — this cannot.
  //
  // Only ever a first run: an account with a group has been using Reach, and
  // whatever it has or has not answered is its own business. Skipping the
  // quiz from Profile later stays possible for the same reason.
  // Read once, so a completed run releases the gate immediately rather than
  // waiting for the server's derived flag to agree.
  const [quizDone,setQuizDone]=useState(true);
  useEffect(()=>{
    try{ setQuizDone(!!localStorage.getItem(QUIZ_DONE)); }catch(e){ setQuizDone(true); }
  },[]);
  const quizRequired = identityLoaded && !groupsLoading && !!user && !quizDone
    && user.quizComplete === false && groups.length === 0;

  // ── Push notifications ─────────────────────────────────
  const requestNotifications=async()=>{
    if(typeof Notification==="undefined")return;
    if(Notification.permission==="granted")return;
    if(Notification.permission!=="denied"){
      await Notification.requestPermission();
    }
  };

  const sendNotification=(title,body,onClick)=>{
    if(typeof Notification==="undefined")return;
    if(Notification.permission!=="granted")return;
    try{
      const n=new Notification(title,{
        body,
        icon:"/icon-192.png",
        badge:"/icon-192.png",
        tag:"reach-"+Date.now(),
      });
      if(onClick)n.onclick=onClick;
    }catch(e){}
  };

  // Notify group members when a plan changes
  const notifyGroupUpdate=(groupName,message)=>{
    sendNotification(
      "Reach — "+groupName,
      message,
      ()=>window.focus()
    );
  };

  // Request notification permission on first load
  useEffect(()=>{
    const t=setTimeout(requestNotifications,2000);
    return ()=>clearTimeout(t);
  },[]);

  // Coming back to the app after travelling should not still show last
  // week's city. Re-checked when the tab is focused, and acted on only when
  // the device says you have actually moved — roughly 25km, far enough that
  // it is a different place and not GPS drift on a sofa. A place you chose
  // yourself is never overridden by this.
  useEffect(()=>{
    if(typeof window==="undefined")return;
    const milesBetween=(a,b,c,d)=>{
      const R=3958.8,r=x=>x*Math.PI/180;
      const dLat=r(c-a),dLng=r(d-b);
      const h=Math.sin(dLat/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dLng/2)**2;
      return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
    };
    const onFocus=()=>{
      if(readOverride())return;                       // their choice stands
      if(!navigator?.geolocation)return;
      navigator.geolocation.getCurrentPosition(pos=>{
        const {latitude:lat,longitude:lng}=pos.coords;
        setUserLocation(prev=>{
          if(!prev)return prev;                        // the first load handles this
          const moved=milesBetween(prev.lat,prev.lng,lat,lng);
          if(moved<15)return prev;                     // ~25km
          // Somewhere else. Resolve it properly rather than patching the
          // coordinates and leaving the old city name on screen.
          getLocation();
          return prev;
        });
      },()=>{},{timeout:8000,maximumAge:0});
    };
    window.addEventListener("focus",onFocus);
    return ()=>window.removeEventListener("focus",onFocus);
  },[]);

  // ── Where we think you are ────────────────────────────────────────────
  // In order: what you told us, then what the device says, then the city on
  // your profile, then we ask. Never a hardcoded city — a trip planned from
  // Aberdeen came back with nights out in Pittsburgh, and before that San
  // Francisco, because something downstream had a default.
  //
  // What you told us wins outright and keeps winning. Somebody who sets this
  // is correcting us, and a correction that GPS quietly overrides on the next
  // load is not a correction.
  const PLACE_OVERRIDE="reach_place_override";

  const readOverride=()=>{
    try{
      const raw=localStorage.getItem(PLACE_OVERRIDE);
      if(!raw)return null;
      const v=JSON.parse(raw);
      return Number.isFinite(v?.lat)&&Number.isFinite(v?.lng)?v:null;
    }catch(e){ return null; }
  };

  const setPlaceOverride=(place)=>{
    try{
      if(place)localStorage.setItem(PLACE_OVERRIDE,JSON.stringify(place));
      else localStorage.removeItem(PLACE_OVERRIDE);
    }catch(e){ /* a private window still gets the rest of the session */ }
    if(place)setUserLocation({...place,source:"override"});
    else{ setUserLocation(null); getLocation(); }
  };

  const getLocation=()=>{
    // A place you chose beats anything we can detect, every time.
    const chosen=readOverride();
    if(chosen){ setUserLocation({...chosen,source:"override"}); return; }
    if(typeof navigator==="undefined"||!navigator.geolocation){ useHomeCity(); return; }

    // A deadline of our own, because the browser's is not dependable.
    //
    // Measured on production with permission already granted:
    // getCurrentPosition called back neither way — not success, not error —
    // for forty-five seconds and counting, and the `timeout` option below
    // did not fire either. So clearing a saved place left the app with no
    // location at all and a line reading "Curated for you", indefinitely.
    // Nothing was broken and nothing said so; it simply never finished.
    //
    // Whichever answers first wins, and the other is ignored. The chain has
    // to terminate somewhere: where you are, then where you live, then ask.
    let settled=false;
    const answer=(fn)=>(...args)=>{ if(settled)return; settled=true; fn(...args); };
    const giveUp=setTimeout(answer(()=>{
      console.error("[location] the device never answered — falling back to your home city");
      useHomeCity();
    }),9000);
    const done=(fn)=>answer((...args)=>{ clearTimeout(giveUp); fn(...args); });

    navigator.geolocation.getCurrentPosition(
      done(async function(pos){
        try{
          const lat=pos.coords.latitude;
          const lng=pos.coords.longitude;
          // Reverse geocode to get city name
          const res=await fetch("/api/geo?lat="+lat+"&lng="+lng);
          if(res.ok){
            const geo=(await res.json()).hits?.[0]||{};
            const city=geo.city||"Your city";
            const state=geo.state||"";
            // Find nearest major airport (simplified - use city)
            const airport=getNearestAirport(city,state);
            setUserLocation({lat,lng,city,state,airport,formatted:city+(state?", "+state:""),source:"device"});
          }else{
            setUserLocation({lat,lng,city:"Your location",airport:null,source:"device"});
          }
        }catch(e){setUserLocation({lat:pos.coords.latitude,lng:pos.coords.longitude,city:"Your location",airport:null,source:"device"});}
      }),
      // Denied, or the device simply cannot say. Somebody who has told us
      // where they live should not then be asked where they are: the order
      // is where you are, then where you live, then ask. What never happens
      // is a silent default — that is how a trip planned from Aberdeen came
      // back with things to do in San Francisco.
      done(function(err){ console.log("Location denied:",err.message); useHomeCity(); }),
      {timeout:10000,enableHighAccuracy:false,maximumAge:600000}
    );
  };

  /**
   * The city on their profile, turned into a point. Marked as `home` so the
   * screen can say which it is using — "near you" and "near where you live"
   * are different claims, and on a trip they are different places.
   */
  const useHomeCity=async()=>{
    // Read through the ref, never the captured value — see userRef above.
    const who=userRef.current;
    const city=who?.homeCity;
    if(!city)return;                       // nothing to fall back to: ask.
    try{
      const res=await fetch("/api/geo?limit=1&q="+encodeURIComponent(city));
      if(!res.ok){console.error("[location] home city lookup returned",res.status);return;}
      const hit=(await res.json()).hits?.[0];
      if(!hit)return;                      // an unrecognised city is not a point.
      const lat=Number(hit.lat), lng=Number(hit.lng);
      if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
      setUserLocation({lat,lng,city,airport:who?.homeAirport||null,formatted:city,source:"home"});
    }catch(e){
      // No location rather than a wrong one. The screen asks, which is the
      // honest end of the chain.
      console.error("[location] home city lookup failed",e);
    }
  };

  const getNearestAirport=(city,state)=>{
    // Major airport lookup by city
    const airports={
      "New York":"JFK","Los Angeles":"LAX","Chicago":"ORD","Houston":"IAH",
      "Phoenix":"PHX","Philadelphia":"PHL","San Antonio":"SAT","San Diego":"SAN",
      "Dallas":"DFW","San Jose":"SJC","Austin":"AUS","Jacksonville":"JAX",
      "Fort Worth":"DFW","Columbus":"CMH","Charlotte":"CLT","Indianapolis":"IND",
      "San Francisco":"SFO","Seattle":"SEA","Denver":"DEN","Nashville":"BNA",
      "Boston":"BOS","Las Vegas":"LAS","Portland":"PDX","Miami":"MIA",
      "Atlanta":"ATL","Minneapolis":"MSP","New Orleans":"MSY","Detroit":"DTW",
      "Memphis":"MEM","Baltimore":"BWI","Louisville":"SDF","Milwaukee":"MKE",
      "Albuquerque":"ABQ","Tucson":"TUS","Fresno":"FAT","Sacramento":"SMF",
      "Kansas City":"MCI","Mesa":"PHX","Omaha":"OMA","Raleigh":"RDU",
      "Colorado Springs":"COS","Long Beach":"LGB","Virginia Beach":"ORF",
      "Oakland":"OAK","Minneapolis":"MSP","Tulsa":"TUL","Tampa":"TPA",
      "Arlington":"DFW","New Orleans":"MSY","Wichita":"ICT","Cleveland":"CLE",
      "Tampa":"TPA","Bakersfield":"BFL","Aurora":"DEN","Anaheim":"SNA",
      "Orlando":"MCO","Pittsburgh":"PIT","Salt Lake City":"SLC","Birmingham":"BHM",
    };
    return airports[city]||null;
  };

  const loadGroups=async()=>{
    try{
      setGroupsLoading(true);
      const res=await fetch("/api/groups");
      if(!res.ok){setGroupsLoading(false);return;}
      const {groups:data}=await res.json();
      if(!data||data.length===0){setGroupsLoading(false);return;}

      // Every member row carries its user, so the avatar map can be filled in
      // from the same response instead of staying empty.
      rememberUsers(data.flatMap(g=>(g.group_members||[]).map(m=>m.users).filter(Boolean)));

      // Groups, members and plans all arrive in this one response.
      setGroups(data.map(g=>{
        const memberIds=(g.group_members||[]).map(m=>m.user_id);
        const plans=(g.plans||[]).map(p=>convertPlan(p,memberIds));
        return{
          id:g.id,
          name:g.name,
          emoji:g.emoji||"✈️",
          // "admin" or "member" — decides who is offered Delete and who is
          // offered Leave.
          role:g.role||"member",
          memberIds,
          members:(g.group_members||[]).map(m=>m.users||{id:m.user_id}),
          wallet:Math.round((g.wallet_balance_cents||0)/100),
          tags:[],
          plans,
        };
      }));
      // Only safe to prune once the real list is in hand — a failed load must
      // never look like "you have no groups" and wipe a valid draft.
      purgeStaleDraft(data.map(g=>g.id));
    }catch(e){console.log("API unavailable, using local state",e);}
    finally{setGroupsLoading(false);}
  };

  // A saved plan draft outlives the session, so it can end up pointing at a
  // group that never reached the server (a g_local_ id) or one that has since
  // been deleted. Either way "Resume your draft" becomes a dead end. Drop just
  // the dead reference and keep every answer already given.
  const purgeStaleDraft=(validIds)=>{
    if(typeof window==="undefined")return;
    try{
      const raw=window.localStorage.getItem("reach_plan_draft");
      if(!raw)return;
      const draft=JSON.parse(raw);
      const gid=draft?.gid;
      if(!gid)return;
      // isTempId, not a second spelling of it. This read `startsWith("g_local_")`
      // and missed the `p1758...` form entirely, so a draft could come back
      // from storage pointing at an id the server has never heard of and the
      // guards elsewhere would keep saying "still saving" for ever.
      if(isTempId(gid)||!validIds.includes(gid)){
        delete draft.gid;
        window.localStorage.setItem("reach_plan_draft",JSON.stringify(draft));
      }
    }catch(e){}
  };

  // Convert API plan format to app format. `fallbackMembers` covers plan rows
  // that came back without participants attached.
  const convertPlan=(p,fallbackMembers)=>({
    id:p.id,
    title:p.title,
    type:p.type||"trip",
    status:p.status||"planning",
    dates:formatDates(p.start_date,p.end_date),
    startDate:p.start_date||null,
    endDate:p.end_date||null,
    destinationCity:p.destination_city||null,
    // The picture of the place and whose it is. Read together, because the
    // credit travels with the photograph or the photograph is not shown.
    imageUrl:p.image_url||null,
    imageCredit:p.image_credit||null,
    destinationCountry:p.destination_country||null,
    budget:Math.round((p.budget_cents||0)/100),
    participants:p.participants||fallbackMembers||[],
    // One shape, from lib/contracts/itinerary-item.ts. This was a
    // hand-written field list, and the comments it replaces record three
    // separate occasions when somebody added a column and forgot it here —
    // the practicals, then the trip reasons, then the ticket URL. Each
    // showed once after generating and vanished on the next load.
    itinerary:itemsFromRows(p.itinerary),
    votes:p.votes||{},
    options:p.vote_options||[],
    accommodation:p.accommodation,
    vibe:p.vibe,
    destStyle:p.destination_style,
    // Why this trip, as the group was shown when they chose it. Without
    // reading it back, the reasons survived until the first reload.
    aiData:p.why_chosen?.length?{used_suggestions:p.why_chosen}:null,
    dealbreakers:p.dealbreakers||[],
  });

  // Refresh a single group's data from server
  const refreshGroup=async(groupId)=>{
    if(isTempId(groupId))return;
    try{
      const r=await fetch(`/api/groups/${groupId}`);
      if(!r.ok)return;
      const detail=await r.json();
      const memberIds=(detail.members||[]).map(m=>m.user_id||m.users?.id).filter(Boolean);
      const plans=(detail.plans||[]).map(p=>convertPlan(p,memberIds));
      rememberUsers((detail.members||[]).map(m=>m.users).filter(Boolean));
      setGroups(gs=>gs.map(g=>g.id===groupId?{...g,plans,memberIds,role:detail.myRole||g.role||"member"}:g));
    }catch(e){console.log("Refresh failed",e);}
  };

  // ── Group membership actions ─────────────────────────────
  // Each hits the server first and only touches local state once it succeeds.
  // The members tab used to filter a member out of local state and never call
  // the API at all, so whoever you removed reappeared on the next refresh.
  const removeGroupMember=async(groupId,userId)=>{
    if(isTempId(groupId))throw new Error("That group is still saving — try again in a moment");
    const r=await fetch(`/api/groups/${groupId}/members`,{
      method:"DELETE",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({userId}),
    });
    const d=await r.json().catch(()=>({}));
    // The server refuses to strand a group with no admin, and says so.
    if(!r.ok)throw new Error(d.error||"Couldn't remove them from the group");
    setGroups(gs=>gs.map(g=>g.id===groupId
      ?{...g,memberIds:(g.memberIds||[]).filter(id=>id!==userId)}:g));
  };

  // Leaving is the same call aimed at yourself, but the group then has to
  // disappear from this device rather than just lose a member.
  const leaveGroup=async(groupId)=>{
    if(!user?.id)throw new Error("Still signing you in — try again in a moment");
    await removeGroupMember(groupId,user.id);
    setGroups(gs=>{
      const left=gs.filter(g=>g.id!==groupId);
      purgeStaleDraft(left.map(g=>g.id));
      return left;
    });
    setStack([]);setTab("groups");
  };

  // Admin only, and the database cascades: the group's plans, members and
  // pending invites go with it. The confirmation for this lives in the UI.
  const deleteGroup=async(groupId)=>{
    if(isTempId(groupId))throw new Error("That group is still saving — try again in a moment");
    const r=await fetch(`/api/groups/${groupId}`,{method:"DELETE"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Couldn't delete that group");
    setGroups(gs=>{
      const left=gs.filter(g=>g.id!==groupId);
      purgeStaleDraft(left.map(g=>g.id));
      return left;
    });
    setStack([]);setTab("groups");
  };

  /**
   * The swipe row's version: the same delete, answering yes or no instead of
   * throwing, so a refusal puts the row back rather than leaving a card
   * mid-gesture. The server's own words are shown — it refuses when a trip
   * is holding a live booking, and that reason is worth reading.
   */
  const deleteGroupFromList=async(groupId)=>{
    try{ await deleteGroup(groupId); showToast("Group deleted"); return true; }
    catch(e){
      console.error("[groups] delete refused",e);
      showToast(e?.message||"Couldn't delete that group — try again in a moment");
      return false;
    }
  };

  const saveGroupToServer=async(group)=>{
    try{
      const isNew=!group.id||group.id.startsWith("g_local_");
      if(isNew){
        const res=await fetch("/api/groups",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({name:group.name,emoji:group.emoji,memberIds:group.memberIds||[],inviteEmails:group.inviteEmails||[]}),
        });
        const payload=await res.json().catch(()=>null);
        const savedId=payload&&payload.group&&payload.group.id;
        if(res.ok&&savedId){
          // Swap the temp g_local_ id for the server's real one.
          setGroups(gs=>gs.map(g=>g.id===group.id?{...g,id:savedId}:g));
          return savedId;
        }
        // The group only ever existed on this device — drop it rather than
        // leave a ghost that every later write will 404 against.
        console.error("[saveGroupToServer]",res.status,payload);
        setGroups(gs=>gs.filter(g=>g.id!==group.id));
        showToast("Couldn't create that group — please try again");
        return null;
      }else{
        const res=await fetch(`/api/groups/${group.id}`,{
          method:"PATCH",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({name:group.name,emoji:group.emoji}),
        });
        // The caller says "Group updated" as soon as this returns. A rejected
        // rename — not an admin, say — looked identical to a successful one,
        // and the old name came back on the next refresh with no explanation.
        if(!res.ok){
          const err=await res.json().catch(()=>({}));
          console.error("[saveGroupToServer] update rejected",res.status,err);
          showToast(err.error||"Couldn't save that change");
          // Null, not the id. Callers could not tell a rejected rename from a
          // saved one, because both came back with the same truthy value — so
          // the screen said "Saved — looking good" over the failure it had
          // just shown. Whoever needs the real id is on the create branch.
          return null;
        }
      }
    }catch(e){
      console.error("[saveGroupToServer] failed, data kept locally",e);
      return null;
    }
    return group.id;
  };


  const savePlanToServer=async(groupId,plan)=>{
    try{
      // Structured only. Every screen that creates a plan sets startDate and
      // endDate, so splitting the display label apart again — which broke the
      // moment the label became human-readable — is gone.
      const startDate=toDateOrNull(plan.startDate);
      const endDate=toDateOrNull(plan.endDate);

      const res=await fetch("/api/plans",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          group_id:groupId,
          title:plan.title,
          type:plan.type||"trip",
          start_date:startDate||null,
          end_date:endDate||null,
          destination_city:plan.destinationCity||null,
          destination_country:plan.destinationCountry||null,
          budget_cents:(plan.budget||0)*100,
          accommodation:plan.accommodation||null,
          vibe:plan.vibe||null,
          destination_style:plan.destStyle||null,
          dealbreakers:plan.dealbreakers||[],
          vote_options:plan.options||[],
          enable_voting:plan.status==="voting",
          // What they wrote when asked what this trip is about, carried from
          // the quiz. The server records it against the plan, which is what
          // makes readiness about this trip rather than a quiz done once.
          goal_blurb:plan.goalBlurb||null,
          trip_answers:plan.tripAnswers||null,
          why_chosen:plan.aiData?.used_suggestions||null,
          solo_mode:plan.soloMode===true,
        }),
      });
      if(res.ok){
        const {plan:saved}=await res.json();
        // Update local plan with real server ID
        setGroups(gs=>gs.map(g=>g.id===groupId?{...g,plans:g.plans.map(p=>p.id===plan.id?{...p,id:saved.id}:p)}:g));
        return saved.id;
      }
      const err=await res.json().catch(()=>null);
      console.error("[savePlanToServer]",res.status,err);
      showToast("Couldn't save that plan — it's only on this device");
    }catch(e){
      console.error("[savePlanToServer]",e);
      showToast("Couldn't save that plan — it's only on this device");
    }
    return plan.id;
  };

  // Update a plan's status on the server
  const updatePlanOnServer=async(planId,updates)=>{
    if(isTempId(planId)){console.error("[plan] update skipped, plan not saved yet",planId);return false;}
    try{
      const res=await fetch(`/api/plans/${planId}`,{
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(updates),
      });
      // A status change is the thing the whole group is waiting on — approving
      // a plan, marking it booked. Announcing one the server rejected tells
      // everybody something that is not true.
      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        // 409 with consequences is not a rejection. It is the server saying
        // what moving these dates would disturb — a table somebody booked on
        // their own account, a hotel held for the old nights — and waiting to
        // be told to go ahead. Handed back so the screen can ask.
        if(res.status===409&&err.needsConfirmation){
          return {needsConfirmation:true,...err};
        }
        console.error("[plan] update rejected",res.status,err);
        showToast(err.error||"That change didn't save — try again");
        return false;
      }
      const plan=groups.flatMap(g=>g.plans.map(p=>({...p,groupName:g.name}))).find(p=>p.id===planId);
      if(plan&&updates.status){
        const msgs={
          voting:plan.title+" is now open for voting!",
          approved:plan.title+" has been approved!",
          booked:plan.title+" is fully booked! 🎉",
        };
        if(msgs[updates.status])notifyGroupUpdate(plan.groupName,msgs[updates.status]);
      }
      // Callers read this. Returning nothing on success made every one of them
      // treat a saved change as a failed one and put the screen back.
      return true;
    }catch(e){
      console.error("[plan] update failed",e);
      showToast("That change didn't save — check your connection");
      return false;
    }
  };

  // Cast a vote on the server
  // The response was never checked, so a rejected vote looked exactly like a
  // counted one: the tally moved on screen and the server had no record. In a
  // product where nothing books until the group is in, a phantom vote is worse
  // than a failed one.
  const castVoteOnServer=async(planId,option)=>{
    if(isTempId(planId)){showToast("Give that a second — the plan is still saving");return false;}
    try{
      const res=await fetch(`/api/plans/${planId}/vote`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({option}),
      });
      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        console.error("[vote] rejected",res.status,err);
        showToast(err.error||"Your vote didn't save — try again");
        return false;
      }
      const plan=groups.flatMap(g=>g.plans.map(p=>({...p,groupName:g.name}))).find(p=>p.id===planId);
      if(plan)notifyGroupUpdate(plan.groupName,`${firstNameOf(user,"Someone")} voted for ${option}`);
      return true;
    }catch(e){
      console.error("[vote] failed",e);
      showToast("Your vote didn't save — check your connection");
      return false;
    }
  };

  // Save itinerary items to server
  const saveItineraryToServer=async(planId,items)=>{
    if(isTempId(planId)){console.error("[itinerary] save skipped, plan not saved yet",planId);return false;}
    try{
      const res=await fetch(`/api/plans/${planId}/itinerary`,{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({items}),
      });
      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        console.error("[itinerary] save rejected",res.status,err);
        showToast("Couldn't save those days — they're only on this device");
        return false;
      }
      const plan=groups.flatMap(g=>g.plans.map(p=>({...p,groupName:g.name}))).find(p=>p.id===planId);
      if(plan)notifyGroupUpdate(plan.groupName,`${firstNameOf(user,"Someone")} updated the itinerary for ${plan.title}`);
      return true;
    }catch(e){
      console.error("[itinerary] save failed",e);
      showToast("Couldn't save those days — check your connection");
      return false;
    }
  };
  const showToast=msg=>setToastMsg(msg);
  const push=(screen,props={})=>setStack(s=>[...s,{screen,props}]);
  const pop=()=>setStack(s=>s.slice(0,-1));
  // Swaps the current screen for another. Pushing instead would leave the
  // screen you just finished with sitting underneath, so Back would walk you
  // into the form you had already completed.
  const replace=(screen,props={})=>setStack(s=>[...s.slice(0,-1),{screen,props}]);
  // Applies the change to whatever state is current, not to whatever `groups`
  // happened to hold when this closure was made.
  //
  // The old version read `groups` from the enclosing render, computed the new
  // group from that, and wrote it back wholesale — so any two updates in the
  // same tick lost the first. Selecting a trip did exactly that: it added the
  // plan, the server swapped in the real id, and then the itinerary update
  // overwrote the group with a copy that predated both. The plan vanished
  // from local state and the plan screen rendered nothing at all — a black
  // screen after "confirmed".
  const updateGroup=(gid,fn,{sync=false}={})=>{
    setGroups(gs=>gs.map(g=>g.id===gid?fn(g):g));
    // The sync path still needs a concrete value to send. `fn` is a pure
    // updater in every caller, so applying it again here is safe.
    if(sync){
      const current=groups.find(g=>g.id===gid);
      if(current)saveGroupToServer(fn(current));
    }
  };

  // Ends the Clerk session and lets the route guard redirect. Clearing local
  // state alone left the session cookie in place, so this only looked like a
  // sign-out — and it dropped you into the in-app auth screens, which the
  // route guard means nobody can ever legitimately reach.
  const handleSignOut=()=>{
    setStack([]);setTab("home");
    if(onSignOut){showToast("Signing you out…");onSignOut();return;}
    // No Clerk in the tree (tests, storybook): fall back to a hard reload so
    // the guard re-evaluates rather than pretending.
    if(typeof window!=="undefined")window.location.href="/sign-in";
  };

  const cur=stack[stack.length-1];
  // Somewhere to send a person who has been told what is missing. A pushed
  // screen sits above the tabs, so it cannot reach one on its own — and every
  // "add your home airport in Profile" in this app was a sentence with
  // nowhere to press until now.
  const goToProfileSection=(sec)=>{ setStack([]); setProfileSection(sec); setTab("profile"); };
  const cp={onBack:pop,replace,groups,setGroups,updateGroup,um,push,toast:showToast,goToProfileSection,refreshGroup,updatePlanOnServer,castVoteOnServer,saveItineraryToServer,savePlanToServer,saveGroupToServer,userLocation,departure,setPlaceOverride,saveDeparture,notifyGroupUpdate,removeGroupMember,leaveGroup,deleteGroup,me:user?.id};

  const renderSub=()=>{
    if(!cur)return null;
    const {screen,props}=cur;
    if(screen==="groupDetail")return <GroupDetailScreen {...cp} {...props}/>;
    if(screen==="planDetail")return <PlanDetailScreen {...cp} {...props}/>;
    // Re-reading /api/me is what makes quizComplete true, which is what
    // takes the prompt off the home screen. Without it the card stays up
    // telling somebody to do the thing they have just done.
    if(screen==="taste")return <TasteQuizScreen {...cp} {...props} onSaved={syncUser} required={quizRequired&&stack.length<=1}/>;
    if(screen==="planPrefs")return <PlanPreferencesScreen {...cp} {...props}/>;
    if(screen==="createGroup")return <CreateGroupScreen {...cp} {...props}/>;
    if(screen==="groupTrip")return <GroupTripScreen {...cp} {...props}/>;
    if(screen==="createPlan")return <CreatePlanFlow {...cp} {...props} user={user} departure={departure}/>;
    if(screen==="editGroup")return <EditGroupScreen {...cp} {...props} onBack={pop}/>;
    if(screen==="checkout")return <CheckoutScreenV2 {...cp} {...props}/>;
    if(screen==="editItinerary")return <EditItineraryScreen {...cp} {...props}/>;
    if(screen==="expDetail")return <ExpDetailScreen {...cp} {...props} updateGroup={updateGroup} savePlanToServer={savePlanToServer}/>;
    return null;
  };

  const tabs=[
    {id:"home",label:"Home",Icon:Ic.Home},
    {id:"discover",label:"Discover",Icon:Ic.Compass},
    {id:"groups",label:"Groups",Icon:Ic.Users},
    {id:"profile",label:"Profile",Icon:Ic.User},
  ];

  return(
    <>
      {/* dangerouslySetInnerHTML, not a child string. The stylesheet contains
          :root[data-theme="dark"], and the server escapes those quotes inside
          style text while the browser writes them raw. React saw the text
          differ, failed hydration, and replaced the document — which threw
          away the data-theme attribute the pre-paint script had just set. The
          whole app lost its theme on every load, and the console filled with
          #418/#423/#425. Same fault as the auth screens had; this is the rest
          of it. */}
      <style dangerouslySetInnerHTML={{__html:CSS}}/>
      <div className="aw">
        {/* The header REF6 draws: the mark in its white circle, the wordmark
            in gold serif, and the two things you might want from any screen —
            the theme, and the way out. The fake "9:41 / 5G" chrome belonged to
            the desktop mockup and said nothing on a real phone. */}
        <div className="sb">
          <div className="sb-left">
            <span className="sb-mark"><img src="/logo-mark.png" alt="" aria-hidden="true"/></span>
            <span className="sb-logo">Reach</span>
          </div>
          <div className="sb-right">
            <button className="sb-act" onClick={()=>chooseTheme(theme==="dark"?"light":"dark")}
              aria-label={theme==="dark"?"Switch to the light theme":"Switch to the dark theme"}>
              {theme==="dark"?<Ic.Sun/>:<Ic.Moon/>}
            </button>
            <button className="sb-act" onClick={handleSignOut} aria-label="Sign out"><Ic.SignOut/></button>
          </div>
        </div>
        <div className="ma">
          <>
              {/* A first run answers the quiz before it gets the app. The tabs
                  and the nav are not rendered at all — not disabled, not
                  hidden behind a card — because every one of them reads the
                  answers this screen collects. */}
              {quizRequired&&!cur?(
                <div className="sc">
                  <TasteQuizScreen required toast={showToast}
                    onSaved={()=>{ setQuizDone(true); syncUser(); }}
                    onBack={()=>{ setQuizDone(true); syncUser(); setTab("home"); }}/>
                </div>
              ):cur?(
                <div className="sc" style={{paddingBottom:20}}>{renderSub()}</div>
              ):(
                <div className="sc">
                  {tab==="home"&&<HomeScreen groups={groups} um={um} push={push} toast={showToast} loading={groupsLoading} user={user} setTab={setTab}/>}
                  {tab==="discover"&&<DiscoverScreen push={push} groups={groups} toast={showToast} user={user} userLocation={userLocation} departure={departure} setPlaceOverride={setPlaceOverride}/>}
                  {tab==="groups"&&<GroupsScreen groups={groups} um={um} push={push} loading={groupsLoading} onDeleteGroup={deleteGroupFromList}/>}
                  {tab==="profile"&&<ProfileScreen toast={showToast} user={user} onIdentityChange={syncUser} onSignOut={handleSignOut} theme={theme} chooseTheme={chooseTheme} push={push} openSection={profileSection}/>}
                </div>
              )}
              {!cur&&!quizRequired&&(
                <nav className="nb">
                  {tabs.map(({id,label,Icon})=>(
                    <button key={id} className={`nb-btn ${tab===id?"active":""}`} onClick={()=>setTab(id)}
                      aria-label={label} aria-current={tab===id?"page":undefined}>
                      <Icon/><span>{label}</span><div className="nb-dot"/>
                    </button>
                  ))}
                </nav>
              )}
          </>
        </div>
        {toastMsg&&<Toast msg={toastMsg} onDone={()=>setToastMsg(null)}/>}
      </div>
    </>
  );
}

// ─── AUTH & COMPLIANCE SCREENS ────────────────────────────────────────────────

// Apple SSO Icon
function AppleIcon(){return(
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
);}

function GoogleIcon(){return(
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);}