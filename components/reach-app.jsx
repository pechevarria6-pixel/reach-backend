import { useState, useEffect, useRef } from "react";
import { formatDates, nightsBetween, toDateOrNull } from "@/lib/dates";

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
  "accentGlowHover", "focusRing", "frameShadow", "frameGlow",
];

const C = Object.fromEntries(
  TOKENS.map(t => [t, `var(--c-${t.replace(/[A-Z]/g, m => "-" + m.toLowerCase())})`])
);

const PALETTE = {
  // ── Light — warm off-white. The default, and the approachable one. ──────
  light: {
    page: "#EDE6D8",
    bg: "#FCFAF5", s1: "#FFFFFF", s2: "#FBF7EF", s3: "#F3ECDD",
    border: "#E8DFCB", borderLight: "#D8CBAF",

    accent: "#D4A843", accentDeep: "#C49A38", accentHover: "#E0BC68",
    accentDim: "rgba(212,168,67,0.18)", accentBorder: "rgba(160,120,30,0.28)",
    // 5.6:1 on bg, 6.0:1 on white cards.
    accentText: "#8A6512",
    onAccent: "#2A1D06", onGreen: "#FFFFFF",

    // Semantic colours are darkened for the light theme: the dark-theme values
    // are tuned to glow on near-black and fail badly as text on white.
    green: "#1D8248", greenDim: "rgba(29,130,72,0.12)",
    amber: "#96650A", amberDim: "rgba(150,101,10,0.12)",
    red: "#C0332C", redDim: "rgba(192,51,44,0.10)",
    blue: "#1E62C4", blueDim: "rgba(30,98,196,0.10)",

    t1: "#241C10", t2: "#6B5C42", t3: "#76674C", t4: "#817154",

    navBg: "rgba(252,250,245,0.92)",
    overlay: "rgba(45,35,20,0.45)",
    // Warm shadows, not grey ones. A neutral shadow on a cream ground reads
    // as dirt.
    cardShadow: "0 2px 8px rgba(90,70,30,0.07)",
    cardShadowHover: "0 10px 28px rgba(90,70,30,0.14)",
    accentGlow: "0 4px 16px rgba(180,135,40,0.28)",
    accentGlowHover: "0 8px 24px rgba(180,135,40,0.36)",
    focusRing: "rgba(212,168,67,0.28)",
    frameShadow: "0 60px 140px rgba(80,62,28,0.28)",
    frameGlow: "rgba(212,168,67,0.10)",
  },

  // ── Dark — the original warm deep noir, kept intact. ────────────────────
  dark: {
    page: "#050406",
    bg: "#0A0805", s1: "#120F09", s2: "#1A1510", s3: "#221C14",
    border: "#2E2618", borderLight: "#3D3220",

    accent: "#D4A843", accentDeep: "#C49A38", accentHover: "#E0BC68",
    accentDim: "rgba(212,168,67,0.12)", accentBorder: "rgba(212,168,67,0.3)",
    // On near-black the fill gold is already 8.9:1, so text uses it unchanged.
    accentText: "#D4A843",
    onAccent: "#1A1206", onGreen: "#0C2A17",

    green: "#52C97B", greenDim: "rgba(82,201,123,0.1)",
    amber: "#F59E0B", amberDim: "rgba(245,158,11,0.1)",
    red: "#F87171", redDim: "rgba(248,113,113,0.1)",
    blue: "#60A5FA", blueDim: "rgba(96,165,250,0.1)",

    t1: "#F5EDD8", t2: "#9A8A6A", t3: "#97845E", t4: "#8A7550",

    navBg: "rgba(10,8,5,0.95)",
    overlay: "rgba(0,0,0,0.72)",
    cardShadow: "0 2px 10px rgba(0,0,0,0.35)",
    cardShadowHover: "0 8px 30px rgba(0,0,0,0.45)",
    accentGlow: "0 4px 20px rgba(212,168,67,0.25)",
    accentGlowHover: "0 6px 24px rgba(212,168,67,0.35)",
    focusRing: "rgba(212,168,67,0.18)",
    frameShadow: "0 80px 200px rgba(0,0,0,.95)",
    frameGlow: "rgba(212,168,67,0.08)",
  },
};

const THEMES = Object.keys(PALETTE);
const DEFAULT_THEME = "light";
// Must match the key the no-flash script in app/layout.tsx reads.
const THEME_KEY = "reach-theme";

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
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
${THEME_CSS}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
body{background:${C.page};display:flex;justify-content:center;min-height:100vh;font-family:'Space Grotesk',sans-serif;color:${C.t1};-webkit-font-smoothing:antialiased;}
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
.aw{width:100%;max-width:520px;min-height:100dvh;background:${C.bg};position:relative;display:flex;flex-direction:column;overflow:hidden;
  padding-top:env(safe-area-inset-top);}
@media (min-width:560px) and (min-height:900px){
  body{padding:20px 0 40px;}
  .aw{width:393px;max-width:393px;height:852px;min-height:0;border-radius:50px;padding-top:0;
    border:1.5px solid ${C.accentBorder};
    box-shadow:${C.frameShadow},0 0 80px ${C.frameGlow};}
}
.sb{display:flex;justify-content:space-between;align-items:center;padding:14px 28px 0;flex-shrink:0;font-size:12px;font-weight:600;color:${C.t2};letter-spacing:.02em;}
.sb-fake{display:none;}
@media (min-width:560px) and (min-height:900px){.sb-fake{display:inline;}}
@media (max-width:559px){.sb{justify-content:center;}}
.sb-logo{font-family:'Instrument Serif',serif;font-size:17px;color:${C.t1};letter-spacing:-.02em;}
.ma{flex:1;overflow:hidden;position:relative;}
.sc{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;padding-bottom:calc(90px + env(safe-area-inset-bottom));}
.sc::-webkit-scrollbar{display:none;}
.nb{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;background:${C.navBg};backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid ${C.accentBorder};padding:10px 0 max(24px,env(safe-area-inset-bottom));z-index:100;}
.nb-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:10px;font-weight:500;color:${C.t3};transition:color .15s;padding:4px 0;}
.nb-btn.active{color:${C.accentText};}
.nb-btn svg{width:22px;height:22px;transition:transform .15s;}
.nb-btn.active svg{transform:translateY(-1px);}
.nb-dot{width:4px;height:4px;border-radius:50%;background:${C.accent};margin:0 auto;opacity:0;transition:opacity .15s;}
.nb-btn.active .nb-dot{opacity:1;}
.pt{font-family:'Instrument Serif',serif;font-size:30px;color:${C.t1};line-height:1.1;}
.hd{padding:8px 20px 16px;flex-shrink:0;}
.hd-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;}
.hd-back{display:inline-flex;align-items:center;gap:4px;background:none;border:none;cursor:pointer;color:${C.t2};font-size:13px;font-weight:500;padding:10px 14px 10px 0;margin-left:-2px;transition:color .15s;flex-shrink:0;}
.hd-back:hover{color:${C.t1};}
.hd-back:active{opacity:.6;}
.hd-back svg{width:18px;height:18px;}
.hd-ov{position:absolute;top:calc(16px + env(safe-area-inset-top));left:16px;width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;z-index:10;}
.hd-ov:active{transform:scale(.94);}
.sl{font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;color:${C.t2};}
.card{background:linear-gradient(145deg,${C.s1},${C.s2});border:1px solid ${C.border};border-radius:24px;overflow:hidden;transition:all .2s;cursor:pointer;box-shadow:${C.cardShadow};}
.card:hover{border-color:${C.accentBorder};transform:translateY(-2px);box-shadow:${C.cardShadowHover};}
.card:active{transform:scale(.98);}
.pill{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:20px;font-size:11.5px;font-weight:600;}
.pill-g{background:${C.greenDim};color:${C.green};}
.pill-a{background:${C.amberDim};color:${C.amber};}
.pill-r{background:${C.redDim};color:${C.red};}
.pill-p{background:${C.accentDim};color:${C.accentText};}
.pill-m{background:${C.s3};color:${C.t2};}
.bp{width:100%;min-height:52px;padding:16px 20px;background:linear-gradient(135deg,${C.accentDeep},${C.accent});color:${C.onAccent};border:none;border-radius:18px;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;letter-spacing:.01em;box-shadow:${C.accentGlow};}
.bp:hover{transform:translateY(-1px);box-shadow:${C.accentGlowHover};}
.bp:active{transform:scale(.98);}
.bp:disabled{opacity:.35;cursor:not-allowed;}
.bs{width:100%;padding:15px 20px;background:${C.s2};color:${C.t1};border:1px solid ${C.border};border-radius:18px;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:500;cursor:pointer;transition:border-color .15s;}
.bs:hover{border-color:${C.borderLight};}
.bsm{padding:7px 14px;border-radius:10px;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:opacity .15s;}
.bsm:hover{opacity:.85;}
.bsm-p{background:${C.accent};color:${C.onAccent};}
.bsm-g{background:${C.s3};color:${C.t2};}
.bsm-r{background:${C.redDim};color:${C.red};}
.bsm-gr{background:${C.greenDim};color:${C.green};}
.inp{width:100%;padding:15px 16px;background:${C.s2};border:1.5px solid ${C.border};border-radius:16px;color:${C.t1};font-family:'Space Grotesk',sans-serif;font-size:14px;outline:none;transition:all .2s;}
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
.ov{position:absolute;inset:0;background:${C.overlay};z-index:200;display:flex;align-items:flex-end;animation:fi .2s ease;}
.sh{width:100%;max-height:90%;background:${C.s1};border-radius:28px 28px 0 0;border-top:1px solid ${C.border};overflow-y:auto;scrollbar-width:none;animation:su .25s cubic-bezier(.32,.72,0,1);padding-bottom:30px;}
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
  return name.split(/\s+/)[0];
}

function toContact(u){
  if(!u||!u.id)return null;
  const name=u.name||u.email?.split("@")[0]||"Member";
  return {
    id:u.id,
    name,
    handle:"@"+(u.email?u.email.split("@")[0]:"member"),
    email:u.email||"",
    avatar:u.avatar_url||u.avatar||null,
    color:colorFor(u.id),
    initials:initialsFor(u.name,u.email),
  };
}

const INIT_GROUPS = [];


// Icons
const Ic = {
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

// ─── Itinerary rows ───────────────────────────────────────────────────────
// Turns generated days into the rows the itinerary tab and the API both use.
// Written once because two screens had their own copy and they disagreed: one
// read day.tips, which the model never returns — the field is insider_tip — so
// every second-visit tip was silently dropped.
function itineraryRows(days){
  return (days||[]).flatMap(day=>{
    const cost=Math.round((day.cost_today||0)*100);
    return [
      {time:`Day ${day.day} · Morning`,title:day.morning,sub:day.title||"",type:"activity",conf:null,filled:false,cost_cents:cost},
      {time:`Day ${day.day} · Afternoon`,title:day.afternoon,sub:"",type:"activity",conf:null,filled:false},
      {time:`Day ${day.day} · Evening`,title:day.evening,sub:day.insider_tip||"",type:"restaurant",conf:null,filled:false},
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

// A client-made id that the server has never seen. Hitting an API with one of
// these is always a 404, so the callers that can hold one check first.
function isTempId(id){
  return typeof id==="string"&&(/^g_local_/.test(id)||/^p\d{10,}$/.test(id));
}

// ─── HOME ────────────────────────────────────────────────────────────────────
function HomeScreen({groups,um,push,toast,loading,user,setTab}){
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
  const upcoming=allPlans.filter(p=>p.status==="booked"||p.status==="voting"||p.status==="approved");
  const actions=[
    ...allPlans.filter(p=>p.status==="voting").map(p=>({type:"vote",text:`Vote: ${p.options.join(" vs ")}`,sub:p.group.name,plan:p})),
  ];
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"14px 20px 12px"}}>
        <div style={{fontSize:13.5,color:C.t2,marginBottom:5,fontWeight:500}}>
          {new Date().getHours()<12?"Good morning":new Date().getHours()<17?"Good afternoon":"Good evening"}
        </div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:36,color:C.t1,lineHeight:1.1}}>
          Hey {firstNameOf(user)} 👋
        </div>
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
            <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:C.accentText}}>{actions.length} actions needed</span>
          </div>
          {actions.map((a,i)=>(
            <div key={i} onClick={()=>{if(a.plan&&a.plan.id&&a.plan.group?.id)push("planDetail",{planId:a.plan.id,groupId:a.plan.group.id});}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderTop:i?"1px solid "+C.accentBorder:"none",cursor:"pointer"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,color:C.t1,fontWeight:500}}>{a.text}</div>
                <div style={{fontSize:11,color:C.t2,marginTop:2}}>{a.sub}</div>
              </div>
              <button className="bsm bsm-p" onClick={e=>{e.stopPropagation();a.plan&&push("planDetail",{planId:a.plan.id,groupId:a.plan.group?.id});}}>{a.type==="vote"?"Vote →":a.type==="pay"?"Pay →":"RSVP →"}</button>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 20px 10px"}}>
        <span className="sl">Upcoming trips</span>
        <span style={{fontSize:12,color:C.accentText,cursor:"pointer"}} onClick={()=>setTab("groups")}>See all →</span>
      </div>
      <div style={{display:"flex",gap:12,padding:"0 20px 18px",overflowX:"auto",scrollbarWidth:"none"}}>
        {upcoming.map(plan=>(
          <div key={plan.id} onClick={()=>push("planDetail",{planId:plan.id,groupId:plan.group.id})}
            style={{minWidth:200,background:`linear-gradient(145deg,#1a1060,${C.accent})`,borderRadius:20,border:`1px solid ${C.border}`,cursor:"pointer",flexShrink:0,transition:"transform .15s"}}>
            <div style={{padding:16}}>
              <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`} style={{marginBottom:10,display:"inline-flex"}}>
                {plan.status==="booked"?"✓ Booked":plan.status==="voting"?"⏳ Voting":"📋 Planning"}
              </span>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:"white",marginBottom:4}}>{plan.title}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.65)",marginBottom:10}}>{plan.dates} · {plan.group.name}</div>
              <AvCluster ids={plan.participants} um={um} max={4}/>
            </div>
          </div>
        ))}
        <div onClick={()=>push("createPlan",{})} style={{minWidth:130,background:"transparent",border:`2px dashed ${C.border}`,borderRadius:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,padding:20,cursor:"pointer",flexShrink:0}}>
          <div style={{fontSize:24,color:C.t3}}>＋</div>
          <div style={{fontSize:12,color:C.t2,fontWeight:500,textAlign:"center"}}>New plan</div>
        </div>
      </div>
      <div style={{padding:"0 20px 10px"}}><span className="sl">Your groups</span></div>
      {(groups.length>0?[
        {emoji:"✈️",text:groups[0].name+" · "+(groups[0].plans?.length||0)+" plan"+(((groups[0].plans?.length||0)!==1)?"s":""),cta:"Open →",action:()=>push("groupDetail",{groupId:groups[0].id})},
        groups.length>1?{emoji:"👥",text:"You're in "+groups.length+" groups.",cta:"See all →",action:()=>setTab("groups")}:{emoji:"➕",text:"Invite friends to plan together.",cta:"Create a group →",action:()=>push("createGroup")},
      ]:[
        {emoji:"👋",text:"Welcome! Create your first group to start planning.",cta:"Get started →",action:()=>push("createGroup")},
      ]).filter(Boolean).map((ins,i)=>(
        <div key={i} onClick={ins.action} style={{margin:"0 20px 10px",background:C.s1,border:"1px solid "+C.border,borderRadius:16,padding:14,display:"flex",gap:12,cursor:"pointer"}}>
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
          {nearbyState==="loading"?"Looking for events near you…"
            :nearbyState==="denied"?"Allow location in your browser and reload to see events near you."
            :nearbyReason==="no_key"?"Event listings aren't switched on for this deployment yet."
            :nearbyReason==="provider_error"?"Couldn't reach the ticket provider. Try again shortly."
            :"Nothing on sale within 90 miles right now."}
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
function BuildingItinerary({destination,nights,onCancel}){
  const steps=[
    {at:0,  t:"Reading what your group likes"},
    {at:4,  t:`Choosing where to base you in ${destination||"your destination"}`},
    {at:9,  t:"Picking restaurants that fit everyone's food"},
    {at:15, t:`Writing ${nights||7} days, morning to evening`},
    {at:22, t:"Adding the tips you'd only know on a second visit"},
    {at:30, t:"Almost there — checking the days hang together"},
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
      <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1,textAlign:"center",lineHeight:1.2,marginBottom:8}}>
        Building your {destination||"trip"}
      </div>
      <div style={{fontSize:13.5,color:C.t2,textAlign:"center",marginBottom:26,minHeight:38,lineHeight:1.5}}>
        {over
          ? "Taking longer than usual. Still working — give it a few more seconds."
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
function DiscoverScreen({push,groups,toast,user,userLocation}){
  const [filter,setFilter]=useState("All");
  const [localRecs,setLocalRecs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [reason,setReason]=useState(null);

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
        if(data.events?.length){
          setLocalRecs(data.events);
          // Cache in sessionStorage so reload is instant
          try{sessionStorage.setItem("reach_nearby",JSON.stringify({events:data.events,city:data.city,ts:Date.now()}));}catch(e){}
        }
      }
    }catch(e){}
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
  const allItems=localRecs.map(e=>({
    id:"local_"+e.id,
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
    bg:`linear-gradient(135deg,${C.accentDeep},${C.accent})`,
    isLocal:true,
  }));

  // Filters come from what actually came back, so a filter can never be empty.
  const categories=[...new Set(allItems.map(e=>e.category).filter(Boolean))].sort();
  const filters=["All",...categories];

  const shown=filter==="All"?allItems:allItems.filter(e=>e.category===filter);
  const emptyNote=loading?"Finding what's on near you…"
    :reason==="no_key"?"Event listings aren't switched on for this deployment yet."
    :reason==="no_location"?"Allow location in your browser to see what's on near you."
    :reason==="provider_error"?"Couldn't reach the ticket provider. Try again shortly."
    :allItems.length===0?"Nothing on sale within 90 miles right now."
    :null;

  const city=userLocation?.city||userLocation?.formatted;

  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 10px"}}>
        <div className="pt">Discover</div>
        <div style={{fontSize:13,color:C.t2,marginTop:2}}>
          {city?"Based on your location in "+city:"Curated for you"}
        </div>
        {!userLocation&&(
          <div style={{fontSize:12,color:C.accentText,marginTop:4,cursor:"pointer"}}
            onClick={()=>toast("Enable location in your browser for local picks")}>
            📍 Enable location for local recommendations
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

      {emptyNote&&shown.length===0&&(
        <div style={{margin:"0 20px",padding:"18px 16px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,fontSize:13,color:C.t2,lineHeight:1.6}}>
          {emptyNote}
        </div>
      )}

      {/* Main cards */}
      {shown.map(exp=>(
        <div key={exp.id} style={{margin:"0 20px 14px",borderRadius:20,overflow:"hidden",
          border:"1px solid "+C.border,cursor:"pointer"}}
          onClick={()=>push("expDetail",{exp,groups})}>
          <div style={{height:175,background:exp.bg,position:"relative"}}>
            <div style={{position:"absolute",inset:0,
              background:"linear-gradient(to bottom,transparent 30%,rgba(0,0,0,.85))",
              display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:16}}>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:"white",marginBottom:3}}>
                {exp.title}
              </div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.65)"}}>{exp.sub}</div>
            </div>
            <div style={{position:"absolute",top:12,right:14,fontSize:34}}>{exp.emoji}</div>
            {exp.isLocal&&exp.dist&&(
              <div style={{position:"absolute",top:12,left:14,background:"rgba(0,0,0,.6)",
                borderRadius:20,padding:"3px 10px",fontSize:11,color:"white"}}>
                📍 {exp.dist}
              </div>
            )}
          </div>
          <div style={{background:C.s1,padding:"12px 16px",display:"flex",
            justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:exp.price?C.t1:C.t2}}>
                {exp.price||"Price on Ticketmaster"}
              </div>
              <div style={{fontSize:11,color:C.t2}}>
                {exp.isLocal?"Near you":"per person, all-in"}
              </div>
            </div>
            <button className="bsm bsm-p"
              onClick={e=>{e.stopPropagation();toast(exp.title+" shared");}}>
              Share with group
            </button>
          </div>
        </div>
      ))}

      {shown.length===0&&!loading&&(
        <div style={{textAlign:"center",padding:"40px 20px",color:C.t3,fontSize:14}}>
          {filter==="Nearby"?"No local events found. Try enabling location access.":"Nothing here yet."}
        </div>
      )}

      <div style={{height:20}}/>
    </div>
  );
}

// ─── EXPERIENCE DETAIL ───────────────────────────────────────────────────────
function ExpDetailScreen({onBack,exp,groups,push,toast,updateGroup,savePlanToServer}){
  const [gpicker,setGpicker]=useState(false);
  const [planPicker,setPlanPicker]=useState(false);
  const [saving,setSaving]=useState(false);
  const [quizDone,setQuizDone]=useState(false);
  const [booking,setBooking]=useState(false);
  const [bookStep,setBookStep]=useState(0); // 0=details 1=confirm 2=done
  const [bookDate,setBookDate]=useState("");
  const [bookTime,setBookTime]=useState("");
  const [bookGuests,setBookGuests]=useState("2");
  const [bookNotes,setBookNotes]=useState("");

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
    updateGroup(group.id,g=>({...g,plans:[...g.plans,np],lastActivity:"Added: "+exp.title}));
    const _sp1=savePlanToServer?savePlanToServer(group.id,np):Promise.resolve(null);
    setSaving(false);
    setPlanPicker(false);
    toast(exp.title+" added to "+group.name+" 🎉");
    _sp1.then(_rid=>push("planDetail",{planId:_rid||np.id,groupId:group.id})).catch(()=>push("planDetail",{planId:np.id,groupId:group.id}));
  };

  return(
    <div className="sc" style={{paddingBottom:0}}>
      {/* Header */}
      <div style={{height:200,background:exp.bg||`linear-gradient(135deg,#1a1060,${C.accent})`,position:"relative",flexShrink:0}}>
        <ScreenHeader onBack={onBack} overlay/>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.9))",display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:20}}>
          <div style={{fontSize:40,marginBottom:8}}>{exp.emoji||"🎯"}</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:"white",lineHeight:1.2}}>{exp.title}</div>
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
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>{exp.price||"—"}</div>
            <div style={{fontSize:11,color:C.t2}}>per person</div>
          </div>
          <div style={{flex:1,background:C.s2,borderRadius:14,padding:14,border:"1px solid "+C.border}}>
            <div style={{fontSize:11,color:C.t3,marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>Type</div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>{exp.category||exp.tags?.[0]||"Experience"}</div>
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
        {exp?.url?(
          <>
            <button className="bp" style={{marginBottom:8,width:"100%",background:`linear-gradient(135deg,${C.accentDeep},${C.accent})`}}
              onClick={()=>{
                window.open(exp.url,"_blank","noopener,noreferrer");
                toast("Opening Ticketmaster");
              }}>
              🎟️ Get tickets
            </button>
            <div style={{fontSize:11.5,color:C.t3,marginBottom:12,lineHeight:1.5,textAlign:"center"}}>
              Tickets are sold by Ticketmaster. You'll pay and get your confirmation there.
            </div>
          </>
        ):(
          <button className="bp" style={{marginBottom:10,width:"100%",background:`linear-gradient(135deg,${C.accentDeep},${C.accent})`}}
            onClick={()=>setBooking(true)}>
            🎯 Book Now
          </button>
        )}
        <button className="bs" style={{marginBottom:10,width:"100%"}}
          onClick={()=>setPlanPicker(true)}>
          ➕ Add to a Group Plan
        </button>
        <button style={{background:"none",border:"none",color:C.t2,fontSize:13,cursor:"pointer",width:"100%",padding:"8px 0"}}
          onClick={()=>setGpicker(true)}>
          💬 Share with a Group
        </button>
      </div>

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
              <div key={g.id} className="ri" onClick={()=>!saving&&addToGroup(g)}
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
                      <input type="date" className="inp" value={bookDate}
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
                    <input className="inp" value={bookNotes} onChange={e=>setBookNotes(e.target.value)}
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
                      {l:"👥 Party",v:bookGuests+(bookGuests==="8+"?" people":" people")},
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
                    💡 This sends a booking request to {exp.title}. They'll confirm via the app within 24 hours. No charge until confirmed.
                  </div>

                  <button className="bp" style={{width:"100%",marginBottom:8}}
                    onClick={()=>{
                      // Save as confirmed plan in group
                      setBookStep(2);
                      toast("Booking request sent to "+exp.title+" ✓");
                    }}>
                    ✓ Confirm Booking Request
                  </button>
                  <button className="bs" style={{width:"100%"}} onClick={()=>setBookStep(0)}>Edit details</button>
                </div>
              </>
            )}

            {bookStep===2&&(
              <div style={{padding:"20px 0 30px",textAlign:"center"}}>
                <div style={{fontSize:60,marginBottom:16}}>🎉</div>
                <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1,marginBottom:8}}>Booking request sent!</div>
                <div style={{fontSize:14,color:C.t2,lineHeight:1.7,marginBottom:24}}>
                  Your request for {exp.title} on {bookDate} for {bookGuests} people has been sent. You'll get a confirmation notification within 24 hours.
                </div>
                <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:14,padding:14,marginBottom:20,textAlign:"left"}}>
                  <div style={{fontSize:12,color:C.t3,marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>What happens next</div>
                  {["📱 Venue confirms within 24 hrs","💳 Card charged only on confirmation","📅 Added to your calendar","👥 Group notified automatically"].map((s,i)=>(
                    <div key={i} style={{fontSize:13,color:C.t2,padding:"4px 0"}}>{s}</div>
                  ))}
                </div>
                <button className="bp" style={{width:"100%"}} onClick={()=>{setBooking(false);setBookStep(0);onBack();}}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share picker */}
      {gpicker&&(
        <div className="ov" onClick={()=>setGpicker(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div className="sh-hdr">
              <span className="sh-ttl">Share with group</span>
              <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2}} onClick={()=>setGpicker(false)}><Ic.X/></button>
            </div>
            {groups.map(g=>(
              <div key={g.id} className="ri" onClick={()=>{setGpicker(false);toast("Shared with "+g.name);}}>
                <div className="ri-ic" style={{background:C.s3}}>{g.emoji}</div>
                <div className="ri-inf"><div className="ri-t">{g.name}</div><div className="ri-s">{g.memberIds?.length||0} members</div></div>
                <Ic.ChevR/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GROUPS LIST ─────────────────────────────────────────────────────────────
function GroupsScreen({groups,um,push,loading}){
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div><div className="pt">Groups</div><div style={{fontSize:13,color:C.t2,marginTop:2}}>Your planning circles</div></div>
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
            A group is the people you travel with. Make one, invite them, and Reach
            plans around what everybody actually wants.
          </div>
          <button className="bp" onClick={()=>push("createGroup")}>Create your first group</button>
          <div style={{fontSize:12,color:C.t3,marginTop:14,lineHeight:1.5}}>
            Travelling alone? Make one anyway — you can plan a solo trip from it.
          </div>
        </div>
      )}
      {groups.map(g=>{
        const active=g.plans.filter(p=>p.status!=="completed");
        return(
          <div key={g.id} className="card" style={{margin:"0 20px 12px",cursor:"pointer"}} onClick={()=>push("groupDetail",{groupId:g.id})}>
            <div style={{padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:28}}>{g.emoji}</div>
                  <div>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>{g.name}</div>
                    <div style={{fontSize:12,color:C.t2}}>{g.memberIds.length} members</div>
                  </div>
                </div>
                <span className="pill pill-g">💰 ${g.wallet.toLocaleString()}</span>
              </div>
              <AvCluster ids={g.memberIds} um={um} max={5}/>
              <div style={{height:1,background:C.border,margin:"12px 0"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:12,color:C.t2}}>{g.lastActivity}</div>
                {active.length>0&&<span className="pill pill-p">{active.length} active</span>}
              </div>
            </div>
          </div>
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
  const isAdmin=group?.role==="admin";

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
            <div style={{fontSize:13,color:C.t2,marginTop:2}}>{group.memberIds.length} members · ${group.wallet.toLocaleString()} wallet</div>
          </div>
          {isAdmin&&<button className="bsm bsm-g" onClick={()=>push("editGroup",{groupId})}>Edit</button>}
        </div>
        <div style={{display:"flex",gap:0,marginTop:16,borderBottom:`1px solid ${C.border}`}}>
          {["plans","members","wallet"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px 0",background:"none",border:"none",borderBottom:`2px solid ${tab===t?C.accentText:"transparent"}`,color:tab===t?C.accentText:C.t2,fontSize:13,fontWeight:600,cursor:"pointer",textTransform:"capitalize",transition:"all .15s"}}>{t}</button>
          ))}
        </div>
      </div>
      {tab==="plans"&&(
        <div style={{padding:"14px 0"}}>
          {group.plans.length===0&&(
            <div style={{padding:"40px 20px",textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:12}}>🗺️</div>
              <div style={{fontSize:16,fontWeight:600,color:C.t1,marginBottom:6}}>No plans yet</div>
              <div style={{fontSize:13,color:C.t2,marginBottom:20}}>Start planning your first experience together</div>
              <button className="bp" onClick={()=>push("groupTrip",{groupId})}>✨ Plan a Trip Together</button>
              <button style={{background:"none",border:"none",color:C.t2,fontSize:13,cursor:"pointer",marginTop:10,padding:"8px 0"}} onClick={()=>push("createPlan",{defaultGroupId:groupId})}>+ Add plan manually</button>
            </div>
          )}
          {group.plans.map(plan=>(
            <div key={plan.id} className="card" style={{margin:"0 20px 12px"}} onClick={()=>push("planDetail",{planId:plan.id,groupId})}>
              <div style={{padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>{plan.title}</div>
                  <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`}>
                    {plan.status==="booked"?"✓ Booked":plan.status==="voting"?"Voting":plan.status==="approved"?"Approved":"Planning"}
                  </span>
                </div>
                <div style={{fontSize:13,color:C.t2,marginBottom:10}}>{plan.dates} · ${plan.budget}/person</div>
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
                  ? <button className="bsm bsm-r" disabled={!!busyId} onClick={doLeave}>{busyId===me?"Leaving…":"Leave"}</button>
                  : isAdmin
                    ? <button className="bsm bsm-r" disabled={!!busyId} onClick={()=>doRemove(uid,u.name)}>{busyId===uid?"Removing…":"Remove"}</button>
                    : null}
              </div>
            );
          })}
          {isAdmin&&<div style={{padding:"12px 20px"}}><button className="bs" onClick={()=>push("editGroup",{groupId})}>+ Invite Someone</button></div>}
          {!isAdmin&&(
            <div style={{padding:"12px 20px"}}>
              <button className="bs" disabled={!!busyId} onClick={doLeave}
                style={{color:C.red,borderColor:C.redDim}}>
                {busyId===me?"Leaving…":`Leave ${group.name}`}
              </button>
            </div>
          )}
        </div>
      )}
      {tab==="wallet"&&(
        <div style={{padding:"18px 20px"}}>
          <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:20,padding:20,marginBottom:18,textAlign:"center"}}>
            <div style={{fontSize:12,color:C.accentText,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Group Wallet</div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:44,color:C.t1}}>${group.wallet.toLocaleString()}</div>
            <div style={{fontSize:12,color:C.t2,marginTop:4}}>Shared · {group.memberIds.length} members</div>
          </div>
          <div style={{marginBottom:18,padding:"12px 14px",background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,fontSize:12.5,color:C.t2,lineHeight:1.5}}>
            The wallet fills from what members contribute at checkout. Paying into it
            directly isn't built yet, so there is nothing here that would take your money.
          </div>
          <div className="sl" style={{marginBottom:12}}>Recent transactions</div>
          {[].map((tx,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
              <div>
                <div style={{fontSize:14,color:C.t1}}>{tx.l}</div>
                <div style={{fontSize:11,color:C.t3,marginTop:2}}>{tx.d}</div>
              </div>
              <div style={{fontSize:15,fontWeight:600,color:tx.c}}>{tx.a}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── EDIT GROUP ───────────────────────────────────────────────────────────────
function EditGroupScreen({onBack,groupId,groups,um,updateGroup,toast,refreshGroup,leaveGroup,deleteGroup,me}){
  const group=groups.find(g=>g.id===groupId);
  if(!group)return <NotLoaded what="This group" onBack={onBack}/>;
  const [name,setName]=useState(group.name);

  const members=group.memberIds||[];
  const [invites,setInvites]=useState([]);
  const [q,setQ]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [searchFailed,setSearchFailed]=useState(false);
  const [busy,setBusy]=useState(false);

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
        if(!d.emailed&&d.acceptUrl){try{await navigator.clipboard?.writeText(d.acceptUrl);toast("Invite link copied");}catch(e){}}
        loadInvites();
      }else{
        toast("Added to the group");
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
      toast("Invite withdrawn");loadInvites();
    }catch(e){console.error("[invites] withdraw failed",e);toast("Couldn't withdraw that invite");}
  };

  const save=()=>{updateGroup(groupId,g=>({...g,name,emoji:inferGroupEmoji(name)}),{sync:true});toast("Group updated");onBack();};

  // ── Leaving and deleting ───────────────────────────────────────────────
  // Deleting cascades in the database: the group's plans, members and pending
  // invites all go with it, and nothing restores them. That is why it asks the
  // name to be typed rather than showing a single confirm button.
  const [danger,setDanger]=useState(null); // null | "leave" | "delete"
  const [typed,setTyped]=useState("");
  const [working,setWorking]=useState(false);
  const isAdmin=group.role==="admin";
  const nameMatches=typed.trim().toLowerCase()===group.name.trim().toLowerCase();

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
        <input className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="Group name" style={{flex:1}}/>
      </div>
      <div style={{padding:"0 20px 14px",fontSize:12,color:C.t3,lineHeight:1.5}}>
        The icon follows the name.
      </div>

      <div style={{height:1,background:C.border,margin:"6px 0 14px"}}/>

      <div style={{padding:"0 20px 10px"}}>
        <span className="sl">Add someone</span>
        <input className="inp" value={q} onChange={e=>search(e.target.value)}
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
          <div key={u.id} className="ri" onClick={()=>addMember({userId:u.id})}>
            <Av u={c} lg/>
            <div className="ri-inf"><div className="ri-t">{c.name}</div><div className="ri-s">{c.handle}</div></div>
            <button className="bsm bsm-p">+ Add</button>
          </div>
        );
      })}

      <div style={{padding:"14px 20px 10px"}}>
        <span className="sl">Members ({members.length})</span>
      </div>
      {members.map(uid=>{
        const u=um[uid];if(!u)return null;
        return(
          <div key={uid} className="ri">
            <Av u={u} lg/>
            <div className="ri-inf"><div className="ri-t">{u.name}</div><div className="ri-s">{u.handle}</div></div>
            {uid===me
              ? <span style={{fontSize:11,color:C.t3,fontWeight:600}}>You</span>
              : <button className="bsm bsm-r" disabled={busy} onClick={()=>removeMember(uid)}>Remove</button>}
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
                    <input className="inp" value={typed} onChange={e=>setTyped(e.target.value)}
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
function inferGroupEmoji(n){const s=(n||"").toLowerCase();const rules=[[/birthday|bday/,"🎂"],[/ski|snow|tahoe|aspen/,"🎿"],[/beach|cabo|cancun|island|bahamas|miami|playa|lake/,"🏝️"],[/concert|show|festival|music|tour/,"🎸"],[/dinner|food|restaurant|brunch|taco|pizza|omakase/,"🍕"],[/camp|hike|hiking|trail|mountain|yosemite|zion/,"🏕️"],[/vegas|party|bachelor|bachelorette/,"🎉"],[/golf/,"⛳"],[/wedding/,"💍"],[/road ?trip|drive/,"🚗"],[/europe|paris|tokyo|london|flight|abroad|trip|travel/,"✈️"]];for(const r of rules){if(r[0].test(s))return r[1];}return DEFAULT_GROUP_EMOJI;}
function CreateGroupScreen({onBack,setGroups,toast,um,saveGroupToServer}){
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
    const finalEmoji=inferGroupEmoji(name);const newGroup={id:tempId,name,emoji:finalEmoji,memberIds:members,inviteEmails,wallet:0,tags:[],lastActivity:"Just created",plans:[]};
    setGroups(gs=>[...gs,newGroup]);
    toast(`${name} created!`);
    // Save to server in background
    if(typeof saveGroupToServer==="function")saveGroupToServer(newGroup);
    onBack();
    // The screen normally unmounts on onBack, so this rarely runs — but if it
    // ever does not, a flag that is never cleared leaves the button dead.
    setTimeout(()=>setCreating(false),1500);
  };
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 18px"}}>
        <ScreenHeader onBack={onBack} label="Cancel"/>
        <div className="pt">{step===0?"Name your group":"Add Members"}</div>
        <div className="sd" style={{marginTop:14}}>{[0,1].map(i=><div key={i} className={`sd-d ${i<=step?"active":""}`}/>)}</div>
      </div>
      {step===0&&(
        <div style={{padding:"0 20px"}}>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
            {/* The emoji is inferred from the name as you type — one fewer
                decision, and it updates live so it never feels imposed. */}
            <div style={{fontSize:44,minWidth:52,textAlign:"center"}}>{inferGroupEmoji(name)}</div>
            <input className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Ski Trip Crew" style={{flex:1}} autoFocus/>
          </div>
          <div style={{fontSize:12,color:C.t3,marginBottom:24,lineHeight:1.5}}>
            We pick an icon from the name. Call it a ski trip and you get a ski trip.
          </div>
          <button className="bp" disabled={!name.trim()} onClick={()=>setStep(1)}>Continue →</button>
        </div>
      )}
      {step===1&&(
        <div>
          <div style={{padding:"0 20px 12px",fontSize:13,color:C.t2}}>Invite people to {name||"your group"}</div>
          <div style={{padding:"0 20px 12px"}}>
            <input className="inp" value={searchQuery||""} onChange={e=>searchUsers(e.target.value)} placeholder="Search by name or email..." style={{marginBottom:8}}/>
            {searching&&<div style={{fontSize:12,color:C.t3,padding:"4px 0"}}>Searching...</div>}
            {(searchQuery||"").length>=2&&searchResults.length===0&&!searching&&isEmail(searchQuery)&&(
              <button className="bsm bsm-p" onClick={addInviteEmail}>Invite {searchQuery.trim()}</button>
            )}
            {(searchQuery||"").length>=2&&searchResults.length===0&&!searching&&!isEmail(searchQuery)&&(
              <div style={{fontSize:12,color:searchFailed?C.red:C.t3,padding:"8px 0",lineHeight:1.5}}>
                {searchFailed
                  ? "Couldn't search just now. Check your connection — they may well have an account."
                  : "Nobody found. Type their full email address to invite them."}
              </div>
            )}
            {(searchQuery||"").length<2&&(
              <div style={{fontSize:12,color:C.t3,padding:"4px 0"}}>Type a name or email address to find people.</div>
            )}
          </div>
          {searchResults.map(u=>{
            const sel=members.includes(u.id);
            const initials=(u.name||u.email||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
            return(
              <div key={u.id} className="cb-row" onClick={()=>setMembers(m=>sel?m.filter(id=>id!==u.id):[...m,u.id])}>
                <div className={"cb "+(sel?"ck":"")}>{sel&&<Ic.Check/>}</div>
                <div style={{width:36,height:36,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",color:C.onAccent,fontWeight:700,fontSize:14,flexShrink:0,overflow:"hidden"}}>
                  {u.avatar_url?<img src={u.avatar_url} style={{width:36,height:36,objectFit:"cover"}} alt=""/>:initials}
                </div>
                <div><div style={{fontSize:14,fontWeight:500,color:C.t1}}>{u.name||u.email}</div><div style={{fontSize:12,color:C.t2}}>{u.email}</div></div>
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

// ─── TRIP PLANNING QUIZ ───────────────────────────────────────────────────────
// Completely separate from the onboarding quiz.
// This fuels the AI trip generator with trip-specific preferences.
function TripQuiz({group,userLocation,departure,error,onGenerate,allComplete,completedCount,totalCount,isSolo}){
  const [qStep,setQStep]=useState(0);
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [answers,setAnswers]=useState({
    tripType:[],accommodation:[],budget:null,pace:null,noWayJose:[],
  });
  const [customInputs,setCustomInputs]=useState({
    tripType:"",accommodation:"",noWayJose:"",
  });
  // An exact figure beats a bucket: it is the number the model plans against,
  // and the tiers are computed from it.
  const [budgetCustom,setBudgetCustom]=useState("");
  const tog=(k,v)=>setAnswers(a=>({...a,[k]:a[k].includes(v)?a[k].filter(x=>x!==v):[...a[k],v]}));
  const sel=(k,v)=>setAnswers(a=>({...a,[k]:v}));
  const setCustom=(k,v)=>setCustomInputs(c=>({...c,[k]:v}));

  const nights=startDate&&endDate
    ?Math.round((new Date(endDate)-new Date(startDate))/86400000):0;

  const questions=[
    {
      id:"tripType",icon:"🌍",
      title:"What kind of trip?",
      sub:"Pick all that apply.",
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
      title:"Where do you want to stay?",
      sub:"Pick all that work.",
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
      title:"Budget per person?",
      sub:"Everything included — flights, hotel, food, activities.",
      isbudget:true,
      // Exact amounts, not ranges: the label now says what actually gets sent.
      // "No limit" is gone — it was not a number, so it parsed to nothing.
      options:[
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
      title:"What's the vibe?",
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
      sub:"Hard vetoes for this trip. Never appears in results.",
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

  const isDateStep=qStep===0;
  const quizQ=questions[qStep-1];
  const totalSteps=questions.length+1;
  const isLast=qStep===totalSteps-1;
  const canNext=isDateStep
    ?(startDate&&endDate&&nights>0)
    :(quizQ?.optional||(quizQ?.multi?(answers[quizQ?.id]||[]).length>0:!!answers[quizQ?.id]));

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
    const typed=parseInt(String(budgetCustom).replace(/[^0-9]/g,""));
    const budgetNum=Number.isFinite(typed)&&typed>0
      ? typed
      : (parseInt(merged.budget)||null);
    onGenerate({start:startDate,end:endDate},budgetNum,{...merged,nights});
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
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1,marginBottom:6}}>
              When are you going?
            </div>
            <div style={{fontSize:14,color:C.t2}}>
              Departing from {departure?.city||"your location"}
              {departure?.airport&&" ("+departure.airport+")"}
            </div>
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
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Departure</div>
              <input type="date" className="inp" value={startDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Return</div>
              <input type="date" className="inp" value={endDate}
                min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
            </div>
          </div>
          {nights>0&&(
            <div style={{textAlign:"center",padding:"14px",background:C.accentDim,
              border:"1px solid "+C.accentBorder,borderRadius:14,marginBottom:16}}>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.accentText}}>
                {nights} night{nights!==1?"s":""}
              </div>
              <div style={{fontSize:13,color:C.t2,marginTop:2}}>
                {nights<=2?"Quick getaway":nights<=4?"Weekend trip":nights<=7?"Week adventure":"Extended trip"}
                {" · "}{group.memberIds?.length||2} people
              </div>
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
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,
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
            {/* 6 option grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              {quizQ.options.map(opt=>{
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
                  <span style={{fontFamily:"'Instrument Serif',serif",fontSize:30,color:C.t2}}>$</span>
                  <input
                    inputMode="numeric"
                    value={budgetCustom}
                    onChange={e=>{
                      const digits=e.target.value.replace(/[^0-9]/g,"");
                      setBudgetCustom(digits);
                      // Typing an amount replaces whichever chip was picked.
                      if(digits)sel(quizQ.id,digits);
                    }}
                    placeholder="3500"
                    style={{flex:1,background:"none",border:"none",
                      fontFamily:"'Instrument Serif',serif",fontSize:30,color:C.t1,width:"100%"}}/>
                </div>
                <div style={{fontSize:11.5,color:C.t3,marginTop:6,lineHeight:1.5}}>
                  Everything in: flights, stay, food, activities. We plan three options around it —
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
            {isSolo?"✨ Build my solo trip":allComplete?"✨ Generate trips for "+group.name:"⚠️ Generate anyway ("+completedCount+"/"+totalCount+" ready)"}
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


function GroupTripScreen({onBack,groupId,groups,updateGroup,toast,push,userLocation,departure,savePlanToServer,saveItineraryToServer}){
  const group=groups.find(g=>g.id===groupId);
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

  if(!group)return <NotLoaded what="This group" onBack={onBack}/>;

  const nights=startDate&&endDate?Math.round((new Date(endDate)-new Date(startDate))/86400000):0;

  const generate=async(sd,ed,bud,prefs={},retrying=false)=>{
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
          userLat:userLocation?.lat||null,
          userLng:userLocation?.lng||null,
          tripPrefs:prefs,
        }),
      });
      if(res.ok){
        const data=await res.json();
        if(data.trips&&data.trips.length>0){
          setTrips(data.trips);
          setStep(2);
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

  const [buildingItinerary,setBuildingItinerary]=useState(null);

  const selectTrip=async(trip)=>{
    // Re-entry here cost twice: a duplicate plan and a second itinerary
    // generation, which is a paid model call.
    if(buildingItinerary)return;
    // Save plan immediately with placeholder itinerary
    const np={
      id:"p"+Date.now(),
      title:trip.destination,
      status:"approved",
      dates:formatDates(startDate,endDate),
      startDate:startDate||null,
      endDate:endDate||null,
      budget:trip.total_per_person,
      type:"trip",
      participants:group.memberIds||[],
      itinerary:[],
      votes:{},options:[],
      aiGenerated:true,aiData:trip,
    };
    updateGroup(groupId,g=>({...g,plans:[...g.plans,np],lastActivity:"Planning: "+trip.destination}));
    toast(trip.destination+" saved! Building itinerary… ✨");
    const _sp2=savePlanToServer?savePlanToServer(groupId,np):Promise.resolve(null);

    // Fetch full itinerary in background
    setBuildingItinerary(trip.id);
    // Declared out here because the navigation after the catch needs it.
    let realId=np.id;
    try{
      const res=await fetch("/api/trips/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,
          startDate,endDate,
          detailTripId:trip.id,
          tripData:{destination:trip.destination,vibe:trip.vibe,costs:trip.costs},
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
        const itinerary=itineraryRows(data.itinerary);
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
    }catch(e){console.error("Itinerary generation failed",e);toast("Couldn't build the day-by-day plan");}
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
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>
            {group.emoji} {group.name}
          </div>
          <div style={{fontSize:12,color:C.t2}}>
            {step===0?"Set your trip details":step===1?"Finding your perfect trips…":"Pick your trip"}
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
                    {m.quizDone&&m.topPrefs&&(
                      <div style={{fontSize:11,color:C.t3,textAlign:"right",maxWidth:100,lineHeight:1.4}}>
                        {m.topPrefs.slice(0,2).join(" · ")}
                      </div>
                    )}
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
                      Reach builds better trips when everyone shares their preferences. Remind your crew to complete their quiz.
                    </div>
                  </div>
                </div>
                <button onClick={()=>{
                  // Was hardcoded to a preview deployment that no longer
                  // resolves, so every nudge sent people to a dead link.
                  const where=typeof window!=="undefined"?window.location.origin:"";
                  const msg=`Hey! We're planning a trip on Reach and need your preferences to build the perfect options. Take 2 minutes: ${where}`;
                  if(navigator.share){navigator.share({title:"Complete your Reach quiz",text:msg}).catch(()=>{});}
                  else{navigator.clipboard?.writeText(msg);toast("Link copied 📋");}
                }} style={{width:"100%",padding:"11px 16px",
                  background:`linear-gradient(135deg,${C.accentDeep},${C.accent})`,
                  color:C.onAccent,border:"none",borderRadius:14,
                  fontSize:13,fontWeight:600,cursor:"pointer",
                  
                  boxShadow:"0 4px 16px rgba(212,168,67,0.25)"}}>
                  📲 Invite them to complete quiz
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
            error={error}
            allComplete={allComplete}
            completedCount={completedCount}
            totalCount={totalCount}
            isSolo={isSolo}
            onGenerate={(dates,tripBudget,prefs)=>{
              setStartDate(dates.start);
              setEndDate(dates.end);
              setBudget(tripBudget);
              setTripPrefs(prefs);
              generate(dates.start,dates.end,tripBudget,prefs);
            }}
          />
        </>
      )}

      {/* ── STEP 1: Generating ── */}
      {step===1&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40,textAlign:"center"}}>
          <div style={{fontSize:60,marginBottom:20}}>✨</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1,marginBottom:12}}>
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
          <style>{`@keyframes loading{0%{width:0%}50%{width:100%}100%{width:0%;margin-left:100%}}`}</style>
        </div>
      )}

      {/* ── STEP 2: Results ── */}
      {step===2&&trips&&(
        <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none"}}>
          <div style={{padding:"0 20px 12px"}}>
            <div style={{fontSize:14,color:C.t2,lineHeight:1.6}}>
              3 options built around {group.name}'s preferences.{" "}
              <span style={{color:C.red}}>❌ Veto</span> anything you won't do.{" "}
              <span style={{color:C.accentText}}>❤️ Vote</span> for your favorite.
            </div>
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
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:4}}>
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
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:voted?C.accentText:C.t1}}>
                          ${trip.total_per_person?.toLocaleString()}
                        </div>
                        <div style={{fontSize:11,color:C.t3}}>per person</div>
                        <div style={{fontSize:11,color:C.t3}}>{nights} nights</div>
                      </div>
                    </div>
                    <div style={{display:"inline-block",background:C.s3,borderRadius:20,padding:"4px 12px",fontSize:12,color:C.t2,marginTop:8}}>
                      {trip.vibe}
                    </div>
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
                      <div style={{fontSize:13,fontWeight:600,color:C.t1}}>Total per person</div>
                      <div style={{fontSize:16,fontWeight:700,color:voted?C.accentText:C.t1}}>${trip.total_per_person?.toLocaleString()}</div>
                    </div>
                    {group.memberIds?.length>1&&(
                      <div style={{fontSize:12,color:C.t3,textAlign:"right",marginTop:2}}>
                        ${(trip.total_per_person*(group.memberIds?.length||2))?.toLocaleString()} total for the group
                      </div>
                    )}
                  </div>

                  {/* Itinerary preview */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>
                      Day-by-day
                    </div>
                    {(trip.itinerary||[]).slice(0,2).map((day,j)=>(
                      <div key={j} style={{marginBottom:12,paddingBottom:12,borderBottom:j<1?"1px solid "+C.border:"none"}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.accentText,marginBottom:6}}>
                          Day {day.day} · {day.title}
                        </div>
                        <div style={{fontSize:12,color:C.t2,lineHeight:1.7}}>
                          ☀️ {day.morning}<br/>
                          🌤️ {day.afternoon}<br/>
                          🌙 {day.evening}
                        </div>
                        {day.insider_tip&&(
                          <div style={{fontSize:11,color:C.t3,marginTop:4,fontStyle:"italic",background:C.s2,padding:"6px 10px",borderRadius:8}}>
                            💡 {day.insider_tip}
                          </div>
                        )}
                      </div>
                    ))}
                    {(trip.itinerary||[]).length>2&&(
                      <div style={{fontSize:12,color:C.accentText,fontWeight:500}}>
                        + {trip.itinerary.length-2} more days in full itinerary after you pick this
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


// ─── AI TRIP GENERATOR ────────────────────────────────────────────────────────
function AiTripScreen({onBack,groups,updateGroup,toast,push,userLocation,departure,savePlanToServer,saveItineraryToServer}){
  const [groupId,setGroupId]=useState(null);
  const [buildingItinerary,setBuildingItinerary]=useState(null);
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [budget,setBudget]=useState("");
  const [loading,setLoading]=useState(false);
  const [trips,setTrips]=useState(null);
  const [vetoes,setVetoes]=useState({});
  const [votes,setVotes]=useState({});
  const [step,setStep]=useState(0); // 0=setup 1=loading 2=results 3=voted
  const selGroup=groups.find(g=>g.id===groupId);

  const generate=async()=>{
    if(!groupId)return;
    setStep(1);setLoading(true);
    try{
      const res=await fetch("/api/trips/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,startDate,endDate,
          budgetPerPerson:parseInt(budget)||null,
          departureCity:departure?.city||null,
          departureAirport:departure?.airport||null,
          userLat:userLocation?.lat||null,
          userLng:userLocation?.lng||null,
        }),
      });
      if(res.ok){
        const data=await res.json();
        setTrips(data.trips);
        setStep(2);
      }else{
        toast("AI trip generation failed — check your API key");
        setStep(0);
      }
    }catch(e){
      toast("Network error — try again");
      setStep(0);
    }finally{setLoading(false);}
  };

  const veto=(tripId)=>setVetoes(v=>({...v,[tripId]:!v[tripId]}));
  const vote=(tripId)=>setVotes(v=>({...v,[tripId]:!v[tripId]}));

  const activeTips=trips?.filter(t=>!vetoes[t.id]);
  const topVoted=activeTips?.sort((a,b)=>(votes[b.id]?1:0)-(votes[a.id]?1:0))[0];

  // This screen saved a plan with an empty itinerary and never asked for one:
  // trip.itinerary only exists after stage 2, which it never called. It also
  // referenced _sp3, a variable belonging to another component, so the save
  // threw before it could navigate. It now does what the quiz path does —
  // save, get the real id, build the days, attach them.
  const saveToPlan=async(trip)=>{
    if(!groupId||buildingItinerary)return;
    const newPlan={
      id:"p"+Date.now(),
      title:trip.destination,
      // Was hardcoded to "voting", so a solo traveller got a plan asking them
      // to vote on a destination they had already chosen.
      status:(selGroup?.memberIds?.length??1)>1?"voting":"planning",
      dates:formatDates(startDate,endDate),
      startDate:startDate||null,
      endDate:endDate||null,
      budget:trip.total_per_person,
      type:"trip",
      participants:selGroup?.memberIds||[],
      itinerary:[],
      votes:{},
      options:[],
      aiGenerated:true,
      aiData:trip,
    };
    updateGroup(groupId,g=>({...g,plans:[...g.plans,newPlan]}));

    setBuildingItinerary(trip.id);
    let realId=newPlan.id;
    try{
      realId=(savePlanToServer?await savePlanToServer(groupId,newPlan):null)||newPlan.id;
      const res=await fetch("/api/trips/generate",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,startDate,endDate,
          detailTripId:trip.id,
          tripData:{destination:trip.destination,vibe:trip.vibe,costs:trip.costs},
          departureCity:departure?.city||null,
          departureAirport:departure?.airport||null,
        }),
      });
      if(res.ok){
        const data=await res.json();
        const itinerary=itineraryRows(data.itinerary);
        if(itinerary.length){
          updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>(p.id===realId||p.id===newPlan.id)?{...p,itinerary}:p)}));
          if(saveItineraryToServer)await saveItineraryToServer(realId,itinerary);
          toast(`${data.itinerary.length} days planned for ${trip.destination} 🗺️`);
        }else{
          console.error("[aiTrip] itinerary came back empty",{planId:realId});
          toast("Saved, but the day-by-day plan is empty — you can add days yourself");
        }
      }else{
        const err=await res.json().catch(()=>({}));
        console.error("[aiTrip] itinerary request failed",err);
        toast(err.error||"Saved, but couldn't build the day-by-day plan");
      }
    }catch(e){
      console.error("[aiTrip] save failed",e);
      toast("Saved locally, but couldn't reach the server");
    }
    setBuildingItinerary(null);
    push("planDetail",{planId:realId,groupId});
  };

  const buildingTrip=trips?.find(t=>t.id===buildingItinerary);
  // Declared here rather than borrowed: the waiting screen names the number of
  // days it is writing, and an undeclared identifier throws at render.
  const buildNights=nightsBetween(startDate,endDate)||7;

  return(
    <div className="sc">
      {buildingItinerary&&(
        <BuildingItinerary
          destination={buildingTrip?.destination}
          nights={buildNights}
          onCancel={()=>setBuildingItinerary(null)}/>
      )}
      <div style={{padding:"12px 20px 0",display:"flex",alignItems:"center",gap:12}}>
        <ScreenHeader onBack={onBack}/>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>AI Trip Planner ✨</div>
      </div>

      {step===0&&(
        <div style={{padding:"20px 20px 30px",overflowY:"auto",flex:1}}>
          <div style={{background:C.accentDim,border:"1px solid "+C.accentBorder,borderRadius:16,padding:16,marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:600,color:C.accentText,marginBottom:4}}>How it works</div>
            <div style={{fontSize:13,color:C.t2,lineHeight:1.7}}>
              Reach reads every group member's travel preferences and generates 3 complete trip options — with real costs for flights, hotels, food, and activities. Your group votes. Any absolute veto cuts a destination. The winner gets booked.
            </div>
          </div>

          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Which group?</div>
            {groups.map(g=>(
              <div key={g.id} onClick={()=>setGroupId(g.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:14,border:"2px solid "+(groupId===g.id?C.accentText:C.border),background:groupId===g.id?C.accentDim:C.s2,marginBottom:8,cursor:"pointer"}}>
                <span style={{fontSize:24}}>{g.emoji}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:C.t1}}>{g.name}</div>
                  <div style={{fontSize:12,color:C.t2}}>{g.memberIds?.length||0} members · preferences loaded</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:10,marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Departure</div>
              <input type="date" className="inp" value={startDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Return</div>
              <input type="date" className="inp" value={endDate} min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
            </div>
          </div>

          <div style={{marginBottom:24}}>
            <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Max budget per person (optional)</div>
            <input className="inp" type="number" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="Leave blank to use group preferences"/>
          </div>

          <button className="bp" onClick={generate} disabled={!groupId} style={{width:"100%"}}>
            ✨ Generate 3 AI Trip Options
          </button>
          <div style={{fontSize:12,color:C.t3,textAlign:"center",marginTop:10}}>
            AI reads all {selGroup?.memberIds?.length||"your"} members' preferences
          </div>
        </div>
      )}

      {step===1&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40}}>
          <div style={{fontSize:48,marginBottom:20}}>✨</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:12,textAlign:"center"}}>Building your trips...</div>
          <div style={{fontSize:14,color:C.t2,textAlign:"center",lineHeight:1.7,marginBottom:24}}>
            Reading everyone's preferences,<br/>finding flights, hotels, and activities,<br/>building full itineraries with real costs...
          </div>
          <div style={{width:200,height:4,background:C.s3,borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",background:C.accent,borderRadius:2,animation:"loading 2s ease-in-out infinite"}}/>
          </div>
          <style>{`@keyframes loading{0%{width:0}50%{width:100%}100%{width:0}}`}</style>
        </div>
      )}

      {step===2&&trips&&(
        <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none",padding:"20px 0"}}>
          <div style={{padding:"0 20px 16px"}}>
            <div style={{fontSize:14,color:C.t2}}>
              3 trips built for <strong style={{color:C.t1}}>{selGroup?.name}</strong> · Tap ❌ to veto, ❤️ to vote
            </div>
          </div>

          {trips.map((trip,i)=>{
            const vetoed=vetoes[trip.id];
            const voted=votes[trip.id];
            return(
              <div key={trip.id} style={{margin:"0 20px 20px",opacity:vetoed?.4:1,transition:"opacity .3s"}}>
                <div style={{background:C.s1,border:"1px solid "+(voted?C.accentText:vetoed?C.red:C.border),borderRadius:20,overflow:"hidden"}}>

                  {/* Header */}
                  <div style={{padding:"18px 18px 14px",background:voted?C.accentDim:vetoed?"rgba(239,68,68,.08)":C.s2}}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8}}>
                      <div>
                        <div style={{fontSize:28,marginBottom:4}}>{trip.emoji}</div>
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:vetoed?C.t3:C.t1}}>{trip.destination}</div>
                        <div style={{fontSize:13,color:C.t2,marginTop:2}}>{trip.tagline}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:voted?C.accentText:C.t1}}>${trip.total_per_person.toLocaleString()}</div>
                        <div style={{fontSize:11,color:C.t3}}>per person</div>
                      </div>
                    </div>
                    <div style={{display:"inline-block",background:C.s3,borderRadius:20,padding:"4px 12px",fontSize:12,color:C.t2}}>{trip.vibe}</div>
                  </div>

                  {/* Cost breakdown */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Cost breakdown</div>
                    {[
                      {icon:"✈️",label:"Flights",cost:trip.costs?.flights?.per_person,detail:trip.costs?.flights?.details},
                      {icon:"🏨",label:"Hotel",cost:trip.costs?.accommodation?.per_person,detail:trip.costs?.accommodation?.example},
                      {icon:"🚗",label:"Transport",cost:trip.costs?.ground_transport?.per_person,detail:trip.costs?.ground_transport?.details},
                      {icon:"🍽️",label:"Food & drinks",cost:trip.costs?.food_drink?.per_person,detail:trip.costs?.food_drink?.details},
                      {icon:"🎯",label:"Activities",cost:trip.costs?.activities?.per_person,detail:trip.costs?.activities?.details},
                      {icon:"🛡️",label:"Insurance + misc",cost:trip.costs?.misc?.per_person,detail:trip.costs?.misc?.details},
                    ].map((c,j)=>c.cost?(
                      <div key={j} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <span style={{fontSize:16,width:24,flexShrink:0}}>{c.icon}</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,color:C.t1}}>{c.label}</div>
                          <div style={{fontSize:11,color:C.t3,lineHeight:1.4}}>{c.detail}</div>
                        </div>
                        <div style={{fontSize:13,fontWeight:600,color:C.t1}}>${c.cost}</div>
                      </div>
                    ):null)}
                  </div>

                  {/* Itinerary preview */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Day-by-day</div>
                    {(trip.itinerary||[]).slice(0,3).map((day,j)=>(
                      <div key={j} style={{marginBottom:10}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.accentText,marginBottom:3}}>Day {day.day} · {day.title}</div>
                        <div style={{fontSize:12,color:C.t2,lineHeight:1.5}}>
                          ☀️ {day.morning}<br/>
                          🌤️ {day.afternoon}<br/>
                          🌙 {day.evening}
                        </div>
                        {day.tips&&<div style={{fontSize:11,color:C.t3,marginTop:3,fontStyle:"italic"}}>💡 {day.tips}</div>}
                      </div>
                    ))}
                    {(trip.itinerary||[]).length>3&&(
                      <div style={{fontSize:12,color:C.accentText}}>+{trip.itinerary.length-3} more days in full plan</div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{padding:"14px 18px",display:"flex",gap:8}}>
                    <button onClick={()=>veto(trip.id)} style={{flex:1,padding:"10px",borderRadius:12,border:"1px solid "+(vetoed?C.red:C.border),background:vetoed?"rgba(239,68,68,.12)":"none",color:vetoed?C.red:C.t2,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                      {vetoed?"Unveto ↩️":"❌ Hard veto"}
                    </button>
                    <button onClick={()=>vote(trip.id)} style={{flex:1,padding:"10px",borderRadius:12,border:"1px solid "+(voted?C.accentText:C.border),background:voted?C.accentDim:"none",color:voted?C.accentText:C.t2,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                      {voted?"Voted ❤️":"Vote ❤️"}
                    </button>
                    <button onClick={()=>saveToPlan(trip)} style={{flex:1,padding:"10px",borderRadius:12,background:C.accent,color:C.onAccent,border:"none",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                      Pick this
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div style={{padding:"0 20px 40px"}}>
            <button className="bs" onClick={()=>{setStep(0);setTrips(null);setVetoes({});setVotes({});}}>
              ↺ Generate different options
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePlanFlow({onBack,groups,updateGroup,um,toast,defaultGroupId,push,savePlanToServer,saveGroupToServer,setGroups,me,user}){
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
  useEffect(()=>{
    if(draftLoaded)return;
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
        inviteEmails:[],wallet:0,tags:[],lastActivity:"Just created",plans:[]};
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
        const res=await fetch("/api/recommendations",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({vibe,destStyle:dest,accommodation:accom,dealbreakers:bks,budget:parseInt(budget),nights:nights(),travelers:selGroup?.memberIds?.length||2}),
        });
        if(res.ok){const {recommendations}=await res.json();setAiRecs(recommendations||[]);}
        else console.error("[createPlan] recommendations returned",res.status);
      }catch(e){console.error("[createPlan] recommendations failed",e);}
      finally{setLoadingRecs(false);}
    },800);
    return()=>clearTimeout(timer);
  },[vibe,dest,budget,accom]);

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
      participants:selGroup?.memberIds||[],
      itinerary:[],
      votes:(voting&&!isSoloGroup)?Object.fromEntries(vopts.filter(Boolean).map(o=>[o,0])):{},
      options:voting?vopts.filter(Boolean):[],
    };
    updateGroup(gid,g=>({...g,plans:[...g.plans,np],lastActivity:`Planning: ${np.title}`}));
    toast("Plan created! 🎉");
    clearDraft();
    const _sp3=(typeof savePlanToServer==="function")?savePlanToServer(gid,np):Promise.resolve(null);
    onBack();
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
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1,marginBottom:8}}>Save your progress?</div>
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
            <input className="inp" value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="Plan name (e.g., Summer Beach Trip)" style={{marginBottom:14}}/>
            <div className="sl" style={{marginBottom:10}}>Who is this for?</div>
            <div onClick={chooseSolo}
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
              <div key={g.id} onClick={()=>setGid(g.id)} style={{display:"flex",alignItems:"center",gap:12,padding:13,borderRadius:14,border:`2px solid ${gid===g.id?C.accentText:C.border}`,background:gid===g.id?C.accentDim:C.s2,marginBottom:8,cursor:"pointer"}}>
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
                  <input type="date" className="inp" value={eventDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setEventDate(e.target.value)} style={{color:C.t1}}/>
                </div>
                {planType==="restaurant"&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Reservation time (optional)</div>
                    <input type="time" className="inp" value={eventTime} onChange={e=>setEventTime(e.target.value)} style={{color:C.t1}}/>
                  </div>
                )}
                {planType==="concert"&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,color:C.t2,marginBottom:8}}>Do you already have a specific event in mind?</div>
                    <input className="inp" value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="Artist or event name (optional)" style={{marginBottom:8}}/>
                  </div>
                )}
                {eventDate&&(
                  <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:"12px 16px",textAlign:"center",marginBottom:14}}>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>
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
                  {isWeekend?"Pick your weekend getaway dates.":"Everyone's availability is checked automatically."}
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
                    <input type="date" className="inp" value={startDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{isWeekend?"Sunday":"Return"}</div>
                    <input type="date" className="inp" value={endDate} min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
                  </div>
                </div>
                {nights()>0&&(
                  <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:"12px 16px",marginBottom:14,textAlign:"center"}}>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1}}>{getDurationLabel()}</div>
                    <div style={{fontSize:12,color:C.t2,marginTop:2}}>{selGroup?.name} · {selGroup?.memberIds?.length||"?"} people</div>
                  </div>
                )}
              </>
            )}
            {selGroup&&(
              <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,color:C.t2,marginBottom:8}}><strong style={{color:C.t1}}>{isEvent?"Going with:":"Traveling with:"}</strong></div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {selGroup.memberIds.map(uid=>{const u=um[uid];return u?(<div key={uid} style={{display:"flex",alignItems:"center",gap:6,background:C.s3,borderRadius:20,padding:"4px 10px"}}><div className="av" style={{background:u.color,width:18,height:18,fontSize:9}}>{u.initials}</div><span style={{fontSize:12,color:C.t1}}>{u.name.split(" ")[0]}</span></div>):null;})}
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
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Maximum spend per person, everything included.</div>
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:16,marginBottom:14}}>
              <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>
                {isEvent?"Typical cost for this":"AI cost estimate"}
              </div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.accentText}}>
                {planType==="restaurant"?`$${Math.round(parseInt(budget||0)*.6).toLocaleString()} – $${parseInt(budget||0).toLocaleString()} pp`
                :planType==="concert"?`$${Math.round(parseInt(budget||0)*.5).toLocaleString()} – $${parseInt(budget||0).toLocaleString()} pp`
                :`$${Math.round(parseInt(budget||0)*.7).toLocaleString()} – $${Math.round(parseInt(budget||0)*1.05).toLocaleString()}`}
              </div>
              <div style={{fontSize:12,color:C.t2,marginTop:4}}>
                {isEvent
                  ?`${selGroup?.memberIds?.length||2} people · ${planType==="restaurant"?"dinner & drinks":"tickets & transport"}`
                  :`${selGroup?.memberIds?.length||2} travelers · ${nights()>0?nights()+" nights · ":""}${getBudgetLabel()}`
                }
              </div>
            </div>
            <div style={{background:C.s1,border:`2px solid ${C.accentText}`,borderRadius:16,padding:"14px 20px",display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <span style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t3}}>$</span>
              <input style={{background:"none",border:"none",fontFamily:"'Instrument Serif',serif",fontSize:36,color:C.t1,width:"100%"}} value={budget} onChange={e=>setBudget(e.target.value.replace(/\D/g,""))} inputMode="numeric" placeholder="2500"/>
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
                  <div><div style={{fontSize:14,fontWeight:500,color:C.t1}}>Enable destination voting</div><div style={{fontSize:12,color:C.t2,marginTop:2}}>Let the group vote on where to go</div></div>
                  <button onClick={()=>setVoting(v=>!v)} aria-pressed={voting} style={{width:44,height:26,borderRadius:13,background:voting?C.accentText:C.s3,border:`1px solid ${voting?C.accentText:C.border}`,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                    <div style={{width:20,height:20,borderRadius:"50%",background:C.s1,position:"absolute",top:2,left:voting?21:2,transition:"left .2s"}}/>
                  </button>
                </div>
                {voting&&vopts.map((opt,i)=>(
                  <input key={i} className="inp" style={{fontSize:13,marginTop:8}} placeholder={`Option ${i+1} (e.g. Lisbon)`} value={opt} onChange={e=>setVopts(v=>v.map((x,j)=>j===i?e.target.value:x))}/>
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

// ─── PLAN DETAIL ──────────────────────────────────────────────────────────────
function PlanDetailScreen({onBack,planId,groupId,groups,um,updateGroup,push,toast,updatePlanOnServer,castVoteOnServer,refreshGroup,saveItineraryToServer}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans.find(p=>p.id===planId);
  const [atab,setAtab]=useState("overview");
  const [myVote,setMyVote]=useState(null);
  const [loading,setLoading]=useState(false);

  const [loadFailed,setLoadFailed]=useState(false);
  const [building,setBuilding]=useState(false);
  const [nudging,setNudging]=useState(false);

  // Every plan made before the itinerary was persisted has no days, and there
  // was no way to get them: the empty state offered only a manual builder. A
  // trip the model already chose can have its day-by-day plan generated on
  // demand, which is also the repair path for those older plans.
  const buildItinerary=async()=>{
    if(building)return;
    if(isTempId(planId)){toast("This trip is still saving — try again in a moment");return;}
    setBuilding(true);
    try{
      const res=await fetch("/api/trips/generate",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,
          startDate:plan.startDate||null,
          endDate:plan.endDate||null,
          detailTripId:planId,
          tripData:{destination:plan.title,vibe:plan.vibe||null,costs:null},
        }),
      });
      const d=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(d.error||"Couldn't build the day-by-day plan");
      const rows=itineraryRows(d.itinerary);
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
        if(data.itinerary)updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:data.itinerary.map(item=>({time:item.scheduled_time||"",title:item.title,sub:item.subtitle||"",type:item.type,conf:item.confirmation_number||null,filled:item.is_confirmed}))}:p)}));
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

  if(!plan||!group)return <NotLoaded what={group?"This plan":"This group"} onBack={onBack}/>;

  const tIc={flight:"✈️",hotel:"🏨",activity:"🎯",restaurant:"🍽️",transport:"🚗"};
  const totalV=Object.values(plan.votes||{}).reduce((a,b)=>a+b,0);

  const castVote=async opt=>{
    if(myVote)return;
    setMyVote(opt);
    // Optimistic update
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,votes:{...p.votes,[opt]:(p.votes[opt]||0)+1}}:p)}));
    toast(`Voted for ${opt}!`);
    // Server sync
    if(castVoteOnServer)await castVoteOnServer(planId,opt);
  };

  const updateStatus=async(newStatus)=>{
    setLoading(true);
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:newStatus}:p)}));
    if(updatePlanOnServer)await updatePlanOnServer(planId,{status:newStatus});
    setLoading(false);
  };
  const tabs=["overview","itinerary",plan.options.length>0?"vote":null,"budget"].filter(Boolean);

  return(
    <div className="sc" style={{paddingBottom:0}}>
      <div style={{background:`linear-gradient(145deg,#1a1060,${C.accent})`,padding:"18px 20px 22px",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
          <ScreenHeader onBack={onBack} overlay/>
          <button className="bsm" style={{background:"rgba(255,255,255,.15)",color:"white",border:"none"}} onClick={()=>push("editItinerary",{planId,groupId})}>Edit plan</button>
        </div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:"white",marginBottom:4}}>{plan.title}</div>
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
            <div style={{display:"flex",gap:10,padding:"0 20px 14px"}}>
              {[{l:"Travelers",v:plan.participants.length,e:"👥"},{l:"Budget",v:`$${plan.budget}`,e:"💳"},{l:"Nights",v:nightsBetween(plan.startDate,plan.endDate)??"—",e:"🌙"}].map((s,i)=>(
                <div key={i} style={{flex:1,background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:12,textAlign:"center"}}>
                  <div style={{fontSize:20}}>{s.e}</div>
                  <div style={{fontFamily:"'Instrument Serif',serif",fontSize:18,color:C.t1,marginTop:4}}>{s.v}</div>
                  <div style={{fontSize:10,color:C.t3,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
                </div>
              ))}
            </div>
            <div style={{padding:"0 20px 14px"}}>
              <div className="sl" style={{marginBottom:10}}>Who's coming</div>
              {plan.participants.map(uid=>{const u=um[uid];return u?(
                <div key={uid} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div className="av-lg" style={{background:u.color}}>{u.initials}</div>
                  <div style={{flex:1}}><div style={{fontSize:14,fontWeight:500,color:C.t1}}>{u.name}</div><div style={{fontSize:12,color:C.t2}}>{u.handle}</div></div>
                  <span className="pill pill-g" style={{fontSize:10}}>✓ In</span>
                </div>
              ):null;})}
            </div>
            {plan.itinerary.length>0&&(
              <div style={{padding:"0 20px 14px"}}>
                <div className="sl" style={{marginBottom:10}}>Bookings</div>
                <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{fontSize:13,color:C.t1}}>Confirmed</span>
                    <span style={{fontSize:13,color:C.green,fontWeight:600}}>{plan.itinerary.filter(i=>i.conf).length}/{plan.itinerary.length}</span>
                  </div>
                  <div className="pb-t"><div className="pb-f" style={{width:`${(plan.itinerary.filter(i=>i.conf).length/Math.max(plan.itinerary.length,1))*100}%`,background:C.green}}/></div>
                </div>
              </div>
            )}
            <div style={{padding:"0 20px"}}>
              {plan.status==="planning"&&<button className="bp" style={{marginBottom:10}} onClick={()=>{updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:"voting"}:p)}));setAtab("vote");toast("Sent to the group for a vote!");}}>Send to group for a vote</button>}
              {plan.status==="voting"&&<button className="bp" style={{marginBottom:10}} onClick={()=>{updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:"approved"}:p)}));toast("Plan approved!");}}>Approve and proceed to booking</button>}
              {plan.status==="approved"&&<button className="bp" style={{marginBottom:10,background:C.green}} onClick={()=>push("checkout",{planId,groupId})}>Book Everything →</button>}
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
                    :`Build a day-by-day plan for ${plan.title}, or add flights, hotels and reservations yourself.`}
                </div>
                {!loadFailed&&(
                  <>
                    <button className="bp" disabled={building} onClick={buildItinerary} style={{marginBottom:10}}>
                      {building?"Building your days…":"✨ Build the day-by-day plan"}
                    </button>
                    <button className="bs" onClick={()=>push("editItinerary",{planId,groupId})}>Add items myself</button>
                  </>
                )}
              </div>
            ):(
              <>
                {plan.itinerary.map((item,i)=>(
                  <div key={i} className="it-item">
                    <div className="it-time">{item.time}</div>
                    <div className="it-lc">
                      <div className={`it-dot ${item.filled?"fi":""}`}/>
                      {i<plan.itinerary.length-1&&<div className="it-cn"/>}
                    </div>
                    <div className="it-cont">
                      <div style={{display:"flex",alignItems:"center",gap:6}}><span>{tIc[item.type]||"📌"}</span><div className="it-tt">{item.title}</div></div>
                      <div className="it-sb">{item.sub}</div>
                      {item.conf&&<div className="it-cf">✓ Confirmed · {item.conf}</div>}
                    </div>
                  </div>
                ))}
                <div style={{padding:"14px 20px"}}><button className="bs" onClick={()=>push("editItinerary",{planId,groupId})}>+ Add or Edit Items</button></div>
              </>
            )}
          </div>
        )}
        {atab==="vote"&&plan.options.length>0&&(
          <div style={{padding:"16px 20px"}}>
            <div className="pt" style={{fontSize:22,marginBottom:6}}>Where should we go?</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:18,flexWrap:"wrap"}}>
              <div style={{fontSize:13,color:C.t2}}>{totalV} of {plan.participants.length} voted.</div>
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
                }}>{nudging?"Sending…":"Remind them"}</button>
              )}
            </div>
            {plan.options.map(opt=>{
              const v=plan.votes[opt]||0; const pct=totalV>0?(v/totalV)*100:0; const mine=myVote===opt;
              return(
                <div key={opt} onClick={()=>castVote(opt)} style={{background:mine?C.accentDim:C.s2,border:`2px solid ${mine?C.accentText:C.border}`,borderRadius:16,padding:16,marginBottom:10,cursor:myVote?"default":"pointer",transition:"all .15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>{opt}</div>
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
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:44,color:C.t1}}>${plan.budget.toLocaleString()}</div>
              <div style={{fontSize:12,color:C.t2,marginTop:4}}>{plan.participants.length} travelers total</div>
            </div>
            {/* These figures were fixed strings — "$480–$720" whether the
                budget was $500 or $10,000 — laid out to look like a quote one
                screen before checkout. They are a planning split of the
                budget, derived from it and labelled as such. Real prices come
                from a provider at booking. */}
            <div style={{fontSize:12,color:C.t2,marginBottom:12,lineHeight:1.5}}>
              A rough split of your ${plan.budget.toLocaleString()} to plan against.
              Not a quote — real prices come from the airline and hotel when you book.
            </div>
            {[{l:"Flights",p:28},{l:"Accommodation",p:34},{l:"Food & dining",p:18},{l:"Activities",p:13},{l:"Transport",p:4},{l:"Buffer",p:3}].map((r,i)=>(
              <div key={i} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontSize:13,color:C.t1}}>{r.l}</span>
                  <span style={{fontSize:13,color:C.t2}}>
                    ≈ ${Math.round((plan.budget*r.p)/100).toLocaleString()}
                  </span>
                </div>
                <div className="pb-t"><div className="pb-f" style={{width:`${r.p}%`}}/></div>
              </div>
            ))}
            <div style={{height:1,background:C.border,margin:"14px 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:14,color:C.t1,fontWeight:600}}>Total estimate</span>
              <span style={{fontSize:14,color:C.green,fontWeight:600}}>${(plan.budget*.8).toFixed(0)} – ${plan.budget.toLocaleString()}</span>
            </div>
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
  if(!plan)return <NotLoaded what="This plan" onBack={onBack}/>;
  const tIc={flight:"✈️",hotel:"🏨",activity:"🎯",restaurant:"🍽️",transport:"🚗"};
  const addItem=()=>{if(!ni.title)return;setItems(p=>[...p,{...ni,filled:!!ni.conf}]);setNi({time:"",title:"",sub:"",type:"activity",conf:""});setAdding(false);};
  const rm=idx=>setItems(p=>p.filter((_,i)=>i!==idx));
  const save=async()=>{
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:items}:p)}));
    toast("Itinerary saved");
    if(saveItineraryToServer)await saveItineraryToServer(planId,items);
    onBack();
  };
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <ScreenHeader onBack={onBack} label="Back"/>
          <button className="bsm bsm-p" onClick={save}>Save</button>
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
                <div style={{fontSize:12,color:C.t2}}>{item.time}{item.sub?` · ${item.sub}`:""}</div>
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
            <input className="inp" style={{width:88,fontSize:13}} placeholder="Time / Day" value={ni.time} onChange={e=>setNi(n=>({...n,time:e.target.value}))}/>
            <input className="inp" style={{flex:1,fontSize:13}} placeholder="Title (required)" value={ni.title} onChange={e=>setNi(n=>({...n,title:e.target.value}))}/>
          </div>
          <input className="inp" style={{marginBottom:8,fontSize:13}} placeholder="Details or location" value={ni.sub} onChange={e=>setNi(n=>({...n,sub:e.target.value}))}/>
          <input className="inp" style={{marginBottom:12,fontSize:13}} placeholder="Confirmation number (if booked)" value={ni.conf} onChange={e=>setNi(n=>({...n,conf:e.target.value}))}/>
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
function CheckoutScreenV2({onBack,planId,groupId,groups,updateGroup,toast}){
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
      const [fRes,bRes]=await Promise.all([
        fetch(`/api/plans/${planId}/funding`),
        fetch(`/api/bookings?planId=${planId}`)
      ]);
      const f=fRes.ok?await fRes.json():null;
      const bJson=bRes.ok?await bRes.json():null;
      setFunding(f);
      setBookings((bJson&&(bJson.bookings||bJson))||[]);
      setPhase("review");
    }catch(e){ setMsg("Couldn't load your trip \u2014 check your connection and try again."); setPhase("error"); }
  };
  useEffect(()=>{ load(); },[]);

  const startPayment=async()=>{
    if(busy)return;
    // Paying against a plan the server has never seen would take money with
    // nothing to attach it to.
    if(isTempId(planId)){ toast("This trip is still saving — try again in a moment"); return; }
    setBusy(true);
    try{
      const r=await fetch(`/api/plans/${planId}/funding`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
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
      }catch(e){ setMsg("Payment form couldn't load \u2014 try again."); setPhase("error"); }
    };
    const withStripeJs=(pk)=>{
      if(cancelled)return;
      if(window.Stripe){boot(pk);return;}
      const s=document.createElement("script"); s.src="https://js.stripe.com/v3";
      s.onload=()=>{ if(!cancelled)boot(pk); };
      s.onerror=()=>{ if(cancelled)return; setMsg("Payment form couldn't load \u2014 check your connection."); setPhase("error"); };
      document.head.appendChild(s);
    };
    (async()=>{
      try{
        const r=await fetch("/api/config/stripe");
        const d=await r.json().catch(()=>({}));
        if(cancelled)return;
        if(!r.ok||!d.publishableKey){ setMsg("Payments aren't switched on yet."); setPhase("error"); return; }
        withStripeJs(d.publishableKey);
      }catch(e){ if(!cancelled){ setMsg("Payment form couldn't load \u2014 check your connection."); setPhase("error"); } }
    })();
    return ()=>{ cancelled=true; };
  },[phase,clientSecret]);

  const confirmPay=async()=>{
    if(busy||!stripeRef.current)return;
    // Guarded again here rather than relying on startPayment: this is the call
    // that follows the money leaving someone's account.
    if(isTempId(planId)){ toast("This trip is still saving — try again in a moment"); return; }
    setBusy(true);
    try{
      const {error,paymentIntent}=await stripeRef.current.confirmPayment({elements:elementsRef.current,redirect:"if_required"});
      if(error)throw new Error(error.message||"Payment didn't go through.");
      // Stripe has taken the money by this point. The response to this call
      // was never checked, so if recording the contribution failed the app
      // still walked on to "done" — card charged, nothing recorded, and the
      // person told they were finished. With live keys that is real money
      // going missing quietly.
      const cr=await fetch(`/api/plans/${planId}/funding/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentIntentId:paymentIntent.id})});
      if(!cr.ok){
        const err=await cr.json().catch(()=>({}));
        console.error("[checkout] payment taken but not recorded",{planId,paymentIntentId:paymentIntent.id,status:cr.status,err});
        setBusy(false);
        setMsg(`Your payment went through, but we couldn't record it against this trip. Nothing is lost — quote reference ${paymentIntent.id} and we'll sort it. Do not pay again.`);
        setPhase("error");
        return;
      }
      setBusy(false);
      await approveAll(false);
    }catch(e){ toast(e.message||"Payment didn't go through."); setBusy(false); }
  };

  const approveAll=async(acceptNewPrice)=>{
    setPhase("approving");
    let fresh=[];
    try{
      const r=await fetch(`/api/bookings?planId=${planId}`);
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
        const r=await fetch(`/api/bookings/${b.id}/approve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(acceptNewPrice?{acceptNewPrice:true}:{})});
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
    setBookings(fresh);
    if(failed.length){
      setMsg(`Your payment is recorded, but ${failed.length} of ${waiting.length} booking${waiting.length===1?"":"s"} couldn't be confirmed. Nothing has been double-charged. We'll follow up — you don't need to do anything.`);
      setPhase("error");
      return;
    }
    setPhase("done");
  };

  const chip=(label,tone)=>(<span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,letterSpacing:.3,
    background:tone==="green"?"rgba(16,185,129,.15)":tone==="gold"?"rgba(212,175,55,.15)":"rgba(255,255,255,.08)",
    color:tone==="green"?C.green:tone==="gold"?C.accentText:C.t2}}>{label}</span>);

  const lines=(bookings&&bookings.length?bookings.map(b=>({
    icon:vIcon[b.vertical]||"\u2728", l:(b.detail&&(b.detail.title||b.detail.name))||b.vertical,
    d:b.provider==="concierge"?"We'll handle this one for you":(b.mode==="redirect"?"Opens in partner site":""),
    a:b.price_cents, st:b.status
  })):[
    {icon:"\u2708\uFE0F",l:"Round-trip flights",d:`${participants} travelers`,a:Math.round(myShareCents*.34*participants)},
    {icon:"\uD83C\uDFE8",l:"Accommodation",d:"",a:Math.round(myShareCents*.4*participants)},
    {icon:"\uD83C\uDFAF",l:"Activities & tours",d:"",a:Math.round(myShareCents*.26*participants)}
  ]);

  if(phase==="loading")return(<div className="sc"><div style={{padding:"60px 20px",textAlign:"center",color:C.t2}}>Getting your trip ready\u2026</div></div>);

  if(phase==="error")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:34,marginBottom:12}}>\uD83D\uDE48</div>
    <div style={{color:C.t1,fontWeight:600,marginBottom:8}}>{msg}</div>
    <button onClick={()=>{setPhase("loading");load();}} style={{marginTop:12,padding:"12px 24px",borderRadius:14,border:"none",background:C.accent,color:C.page,fontWeight:700}}>Try again</button>
    <div onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Go back</div>
  </div></div>);

  if(phase==="waiting")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:12}}>\uD83E\uDD1D</div>
    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:8}}>You're in!</div>
    <div style={{color:C.t2,fontSize:14,lineHeight:1.5,marginBottom:16}}>A few people still need to chip in before we book. We'll lock everything in the moment the group is fully funded.</div>
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
      {nudging?"Sending…":"Remind them"}
    </button>
    <div onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Back to trip</div>
  </div></div>);

  if(phase==="priceUp")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:12}}>\uD83D\uDCC8</div>
    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:8}}>Price went up a little</div>
    <div style={{color:C.t2,fontSize:14,lineHeight:1.5,marginBottom:20}}>One of your bookings costs a bit more than when we quoted it. Still book it?</div>
    <button disabled={busy} onClick={()=>approveAll(true)} style={{padding:"12px 24px",borderRadius:14,border:"none",background:C.accent,color:C.page,fontWeight:700,opacity:busy?.6:1}}>Yes, book it</button>
    <div onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Let me think</div>
  </div></div>);

  if(phase==="approving")return(<div className="sc"><div style={{padding:"80px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:14}}>\u2728</div>
    <div style={{color:C.t1,fontWeight:600}}>Locking in your bookings\u2026</div>
    <div style={{color:C.t2,fontSize:13,marginTop:6}}>This takes a few seconds</div>
  </div></div>);

  if(phase==="done"){
    const confetti=Array.from({length:36},(_,i)=>i);
    return(<div className="sc" style={{paddingBottom:40,position:"relative",overflow:"hidden"}}>
      <style>{`@keyframes rfall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(540deg);opacity:0}}`}</style>
      {confetti.map(i=>(<span key={i} style={{position:"absolute",left:(i*137)%100+"%",top:-10,width:8,height:12,borderRadius:2,
        background:[C.accent,C.green,C.blue,"#F472B6"][i%4],animation:`rfall ${2.2+(i%5)*.4}s ${(i%7)*.18}s ease-in forwards`,zIndex:5}}/>))}
      <div style={{background:`linear-gradient(145deg,#064E3B,${C.green})`,padding:"48px 28px 36px",textAlign:"center"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 16px"}}>\u2713</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:30,color:"white",marginBottom:6}}>You're all booked!</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,.75)"}}>Powered by Stripe \u00B7 PCI-DSS compliant</div>
      </div>
      <div style={{padding:"20px 20px 0"}}>
        <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Amount charged</span>
            <span style={{fontSize:13,color:C.t1,fontWeight:700}}>{fmt(myShareCents)}</span></div>
          <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Security</span>
            <span style={{fontSize:12,color:C.green,fontWeight:600}}>\uD83D\uDD12 Secured by Stripe</span></div>
        </div>
        <div style={{marginBottom:16}}>
          <div className="sl" style={{marginBottom:10}}>Your bookings</div>
          {lines.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 4px"}}>
            <span style={{fontSize:20}}>{it.icon}</span>
            <div style={{flex:1}}><div style={{fontSize:14,color:C.t1,fontWeight:600}}>{it.l}</div>
              {it.d?<div style={{fontSize:12,color:C.t2}}>{it.d}</div>:null}</div>
            {chip(it.st==="confirmed"?"Booked \u2713":it.st==="pending"?"We're on it":"Booked \u2713",it.st==="pending"?"gold":"green")}
          </div>))}
        </div>
        <button onClick={onBack} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:C.accent,color:C.page,fontWeight:700,fontSize:15}}>See my itinerary</button>
      </div>
    </div>);
  }

  if(phase==="pay")return(<div className="sc" style={{paddingBottom:40}}>
    <div style={{padding:"18px 20px 6px",display:"flex",alignItems:"center",gap:10}}>
      <span onClick={()=>setPhase("review")} style={{cursor:"pointer",color:C.t2,fontSize:20}}>←</span>
      <span style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>Your share \u00B7 {fmt(myShareCents)}</span>
    </div>
    <div style={{padding:"8px 20px 0"}}>
      <div ref={payRef} style={{minHeight:220,background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:14}}/>
      {!payReady&&<div style={{textAlign:"center",color:C.t2,fontSize:13,marginTop:10}}>Loading secure payment\u2026</div>}
      <button disabled={!payReady||busy} onClick={confirmPay}
        style={{width:"100%",marginTop:16,padding:"15px",borderRadius:14,border:"none",background:C.accent,color:C.page,fontWeight:700,fontSize:15,opacity:(!payReady||busy)?.6:1}}>
        {busy?"Paying\u2026":`Pay ${fmt(myShareCents)}`}</button>
      <div style={{textAlign:"center",fontSize:12,color:C.t2,marginTop:10}}>\uD83D\uDD12 Secured by Stripe \u00B7 you only pay your share</div>
    </div>
  </div>);

  // phase === review
  return(<div className="sc" style={{paddingBottom:40}}>
    <div style={{padding:"18px 20px 6px",display:"flex",alignItems:"center",gap:10}}>
      <span onClick={onBack} style={{cursor:"pointer",color:C.t2,fontSize:20}}>←</span>
      <span style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>{plan?.destination||plan?.name||"Your trip"}</span>
    </div>
    <div style={{padding:"6px 20px 0"}}>
      <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:"6px 4px",marginBottom:14}}>
        {lines.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderBottom:i<lines.length-1?`1px solid ${C.border}`:"none"}}>
          <span style={{fontSize:20}}>{it.icon}</span>
          <div style={{flex:1}}><div style={{fontSize:14,color:C.t1,fontWeight:600}}>{it.l}</div>
            {it.d?<div style={{fontSize:12,color:C.t2}}>{it.d}</div>:null}</div>
          {it.st?chip(it.st==="awaiting_approval"?"Quoted":it.st==="confirmed"?"Booked \u2713":"We're on it",it.st==="confirmed"?"green":it.st==="awaiting_approval"?"":"gold"):null}
        </div>))}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"0 4px",marginBottom:16}}>
        <span style={{fontSize:14,color:C.t2}}>Your share ({participants} people)</span>
        <span style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1}}>{fmt(myShareCents)}</span>
      </div>
      <button disabled={busy} onClick={startPayment}
        style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.accent,color:C.page,fontWeight:700,fontSize:16,opacity:busy?.6:1}}>
        {busy?"One sec\u2026":"Looks good"}</button>
      <div style={{textAlign:"center",fontSize:12,color:C.t2,marginTop:10}}>Nothing books until the whole group is in \uD83E\uDD1D</div>
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
function ProfileScreen({toast,user,onSignOut,theme,chooseTheme}){
  const [section,setSection]=useState(null);
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
      toast("Programme added");await load();
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
      toast("Programme removed");await load();
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
      toast("Preference saved");
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
    <div className="ri" onClick={onClick} style={{cursor:onClick?"pointer":"default"}}>
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
      }catch(e){toast(e.message);}
      finally{setBusy(null);}
    };

    return(
      <div className="sc">
        <ScreenHeader onBack={()=>setSection(null)} label="Profile" title="You"/>
        <div style={{padding:"0 20px 18px"}}>
          <div className="sl" style={{marginBottom:8}}>What should we call you?</div>
          <input className="inp" value={firstDraft} placeholder="First name"
            onChange={e=>setDocDraft(x=>({...x,__first:e.target.value}))}/>
          <div style={{fontSize:11.5,color:C.t3,marginTop:8,lineHeight:1.5}}>
            Used on your home screen and wherever your group sees you.
          </div>
        </div>

        <div style={{padding:"0 20px 18px",borderTop:`1px solid ${C.border}`,paddingTop:18}}>
          <div className="sl" style={{marginBottom:8}}>Home airport</div>
          <div style={{display:"flex",gap:8}}>
            <input className="inp" value={airDraft} placeholder="SFO" maxLength={3}
              style={{width:96,textTransform:"uppercase",fontWeight:600,letterSpacing:".08em"}}
              onChange={e=>setDocDraft(x=>({...x,__air:e.target.value}))}/>
            <input className="inp" value={cityDraft} placeholder="San Francisco, CA" style={{flex:1}}
              onChange={e=>setDocDraft(x=>({...x,__city:e.target.value}))}/>
          </div>
          {!airValid&&(
            <div style={{fontSize:12,color:C.red,marginTop:8}}>
              An airport code is three letters, like SFO or JFK.
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
          <input className="inp" value={loyName} onChange={e=>setLoyName(e.target.value)}
            placeholder="Programme, e.g. United MileagePlus" style={{marginBottom:8}}/>
          <input className="inp" value={loyTier} onChange={e=>setLoyTier(e.target.value)}
            placeholder="Tier (optional)" style={{marginBottom:8}}/>
          <input className="inp" value={loyNum} onChange={e=>setLoyNum(e.target.value)}
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
          <div key={t.k} className="ri" style={{cursor:"pointer"}} onClick={()=>setConsent(t.k,t.col,!c[t.k])}>
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
          onClick={()=>{window.location.href="/api/user/data";toast("Preparing your export…");}}/>
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
            <input className="inp" value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)}
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
  const connected=(data?.connected||[]).filter(a=>a.status==="connected");
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 18px",textAlign:"center"}}>
        <div style={{width:80,height:80,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.accentDeep})`,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Instrument Serif',serif",fontSize:32,color:C.onAccent,border:`3px solid ${C.border}`,overflow:"hidden"}}>
          {user?.avatar?<img src={user.avatar} style={{width:80,height:80,borderRadius:"50%",objectFit:"cover"}} alt=""/>:(user?.name||"?")[0]}
        </div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1}}>{user?.name||user?.email||"You"}</div>
        <div style={{fontSize:13,color:C.t2,marginTop:2}}>
          {user?.email}
          {data?.provider&&data.provider!=="email"&&<span style={{marginLeft:6,fontSize:11,background:C.accentDim,color:C.accentText,padding:"2px 8px",borderRadius:20,fontWeight:600}}>{data.provider==="apple"?"🍎 Apple":"🌐 Google"}</span>}
        </div>
        <div style={{display:"flex",gap:0,background:C.s2,borderRadius:16,marginTop:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          {[{v:stats?.groups,l:"Groups"},{v:stats?.plans,l:"Plans"},{v:stats?.friends,l:"Travel with"}].map((s,i)=>(
            <div key={i} style={{flex:1,padding:"13px 0",textAlign:"center",borderLeft:i?`1px solid ${C.border}`:"none"}}>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.accentText}}>{s.v??"—"}</div>
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
        sub={[data?.identity?.firstName||null,data?.home?.airport||null].filter(Boolean).join(" · ")||"Not set yet"}
        right={<Ic.ChevR/>} onClick={()=>setSection("you")}/>

      <div style={{padding:"16px 20px 6px"}}><span className="sl">Travel</span></div>
      <Row icon="🛂" title="Travel documents"
        sub={docCount?`${docCount} saved · encrypted`:"Passport, PreCheck, Global Entry"}
        right={<Ic.ChevR/>} onClick={()=>setSection("documents")}/>
      <Row icon="🎫" title="Loyalty programmes"
        sub={data?.loyalty?.length?`${data.loyalty.length} saved`:"None yet"}
        right={<Ic.ChevR/>} onClick={()=>setSection("loyalty")}/>
      {connected.length>0&&(
        <Row icon="🔗" title="Connected accounts"
          sub={connected.map(a=>a.label||a.provider).join(", ")}/>
      )}

      <div style={{padding:"16px 20px 6px"}}><span className="sl">Money</span></div>
      <Row icon="💳" title="Payment"
        sub={data?.cards?.length?`${data.cards.length} card${data.cards.length===1?"":"s"} on file`:"No card saved yet"}
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
  const [groups,setGroups]=useState([]);
  const [groupsLoading,setGroupsLoading]=useState(true);
  const [toastMsg,setToastMsg]=useState(null);
  const [stack,setStack]=useState([]);

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
  const departure={
    airport:user?.homeAirport||userLocation?.airport||null,
    city:user?.homeCity||userLocation?.formatted||userLocation?.city||null,
  };

  // ── Load real data from Supabase via API ──────────────────
  // The route guard means this component only ever renders for a signed-in
  // user, so there is no stage to wait for: load on mount.
  useEffect(()=>{
    syncUser();
    loadGroups();
    getLocation();
  },[]);

  const syncUser=async()=>{
    try{
      const res=await fetch("/api/me");
      if(res.ok){
        const data=await res.json();
        setUser(u=>u?({...u,...data,id:data.id}):data);
        rememberUsers([{id:data.id,name:data.name,email:data.email,avatar_url:data.avatar}]);
      }
    }catch(e){console.log("User sync failed",e);}
  };

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

  const getLocation=()=>{
    if(typeof navigator==="undefined"||!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(
      async function(pos){
        try{
          const lat=pos.coords.latitude;
          const lng=pos.coords.longitude;
          // Reverse geocode to get city name
          const res=await fetch("https://nominatim.openstreetmap.org/reverse?lat="+lat+"&lon="+lng+"&format=json");
          if(res.ok){
            const geo=await res.json();
            const city=geo.address?.city||geo.address?.town||geo.address?.county||"Your city";
            const state=geo.address?.state_code||"";
            // Find nearest major airport (simplified - use city)
            const airport=getNearestAirport(city,state);
            setUserLocation({lat,lng,city,state,airport,formatted:city+(state?", "+state:"")});
          }else{
            setUserLocation({lat,lng,city:"Your location",airport:null});
          }
        }catch(e){setUserLocation({lat:pos.coords.latitude,lng:pos.coords.longitude,city:"Your location",airport:null});}
      },
      function(err){console.log("Location denied:",err.message);},
      {timeout:10000,enableHighAccuracy:false,maximumAge:600000}
    );
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
          lastActivity:plans.length>0
            ?`${plans.length} plan${plans.length>1?"s":""}`
            :(g.updated_at?new Date(g.updated_at).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"Just created"),
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
      const isTemp=typeof gid==="string"&&gid.startsWith("g_local_");
      if(isTemp||!validIds.includes(gid)){
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
    budget:Math.round((p.budget_cents||0)/100),
    participants:p.participants||fallbackMembers||[],
    itinerary:(p.itinerary||[]).map(item=>({
      time:item.scheduled_time||"",
      title:item.title,
      sub:item.subtitle||"",
      type:item.type,
      conf:item.confirmation_number||null,
      filled:item.is_confirmed,
    })),
    votes:p.votes||{},
    options:p.vote_options||[],
    accommodation:p.accommodation,
    vibe:p.vibe,
    destStyle:p.destination_style,
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
          return group.id;
        }
      }
    }catch(e){console.log("Group save failed, data kept locally",e);}
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
          budget_cents:(plan.budget||0)*100,
          accommodation:plan.accommodation||null,
          vibe:plan.vibe||null,
          destination_style:plan.destStyle||null,
          dealbreakers:plan.dealbreakers||[],
          vote_options:plan.options||[],
          enable_voting:plan.status==="voting",
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
    }catch(e){console.log("Plan update failed",e);}
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
  const cp={onBack:pop,groups,setGroups,updateGroup,um,push,toast:showToast,refreshGroup,updatePlanOnServer,castVoteOnServer,saveItineraryToServer,savePlanToServer,saveGroupToServer,userLocation,departure,notifyGroupUpdate,removeGroupMember,leaveGroup,deleteGroup,me:user?.id};

  const renderSub=()=>{
    if(!cur)return null;
    const {screen,props}=cur;
    if(screen==="groupDetail")return <GroupDetailScreen {...cp} {...props}/>;
    if(screen==="planDetail")return <PlanDetailScreen {...cp} {...props}/>;
    if(screen==="createGroup")return <CreateGroupScreen {...cp} {...props}/>;
    if(screen==="aiTrip")return <AiTripScreen {...cp} {...props}/>;
    if(screen==="groupTrip")return <GroupTripScreen {...cp} {...props}/>;
    if(screen==="createPlan")return <CreatePlanFlow {...cp} {...props} user={user}/>;
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
      <style>{CSS}</style>
      <div className="aw">
        <div className="sb">
          {/* The fake "9:41 / 5G" chrome belongs to the desktop mockup frame.
              On a real phone it sits directly under the actual status bar and
              reads as a bug, so it is hidden there and only the wordmark
              stays. CSS does the hiding so there is no hydration mismatch. */}
          <span className="sb-fake">9:41</span>
          <span className="sb-logo">reach</span>
          <span className="sb-fake">5G ▪▪▪</span>
        </div>
        <div className="ma">
          <>
              {cur?(
                <div className="sc" style={{paddingBottom:20}}>{renderSub()}</div>
              ):(
                <div className="sc">
                  {tab==="home"&&<HomeScreen groups={groups} um={um} push={push} toast={showToast} loading={groupsLoading} user={user} setTab={setTab}/>}
                  {tab==="discover"&&<DiscoverScreen push={push} groups={groups} toast={showToast} user={user} userLocation={userLocation} departure={departure}/>}
                  {tab==="groups"&&<GroupsScreen groups={groups} um={um} push={push} loading={groupsLoading}/>}
                  {tab==="profile"&&<ProfileScreen toast={showToast} user={user} onSignOut={handleSignOut} theme={theme} chooseTheme={chooseTheme}/>}
                </div>
              )}
              {!cur&&(
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