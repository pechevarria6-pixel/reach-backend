# Reach palette — saved 2026-09-15 (warm gold)

The palette as it shipped before any colour review. Kept so it can be restored
exactly, whatever we try next.

**To restore:** replace the `PALETTE` object in `components/reach-app.jsx`
(it begins `const PALETTE = {`) with the two theme blocks below, then run
`npm run check:contrast`. Nothing else reads these values — every screen uses
the `C.<token>` variables, which are generated from this object.

`git log -- components/reach-app.jsx` is the other way back: any commit before
the colour work has the same values.

## Light — warm off-white, the default

```js
light: {
  page: "#EDE6D8",
  bg: "#FCFAF5", s1: "#FFFFFF", s2: "#FBF7EF", s3: "#F3ECDD",
  border: "#E8DFCB", borderLight: "#D8CBAF",

  accent: "#D4A843", accentDeep: "#C49A38", accentHover: "#E0BC68",
  accentDim: "rgba(212,168,67,0.18)", accentBorder: "rgba(160,120,30,0.28)",
  accentText: "#8A6512",
  onAccent: "#2A1D06", onGreen: "#FFFFFF",

  green: "#1D8248", greenDim: "rgba(29,130,72,0.12)",
  amber: "#96650A", amberDim: "rgba(150,101,10,0.12)",
  red: "#C0332C", redDim: "rgba(192,51,44,0.10)",
  blue: "#1E62C4", blueDim: "rgba(30,98,196,0.10)",

  t1: "#241C10", t2: "#6B5C42", t3: "#76674C", t4: "#817154",

  navBg: "rgba(252,250,245,0.92)",
  overlay: "rgba(45,35,20,0.45)",
  cardShadow: "0 2px 8px rgba(90,70,30,0.07)",
  cardShadowHover: "0 10px 28px rgba(90,70,30,0.14)",
  accentGlow: "0 4px 16px rgba(180,135,40,0.28)",
  accentGlowHover: "0 8px 24px rgba(180,135,40,0.36)",
  focusRing: "rgba(212,168,67,0.28)",
  frameShadow: "0 60px 140px rgba(80,62,28,0.28)",
  frameGlow: "rgba(212,168,67,0.10)",
},
```

## Dark — warm deep noir

```js
dark: {
  page: "#050406",
  bg: "#0A0805", s1: "#120F09", s2: "#1A1510", s3: "#221C14",
  border: "#2E2618", borderLight: "#3D3220",

  accent: "#D4A843", accentDeep: "#C49A38", accentHover: "#E0BC68",
  accentDim: "rgba(212,168,67,0.12)", accentBorder: "rgba(212,168,67,0.3)",
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
```

## What each token is for

- `page` is the area outside the phone frame; `bg` the screen behind everything.
- `s1`/`s2`/`s3` are surfaces stacked on it: rows, cards, pressed states.
- `accent` is the gold fill and stays the same in both themes, so a button
  looks like Reach whichever theme you are in. `accentText` is gold used as
  text and darkens in the light theme, because the fill gold on white is
  about 2:1 and unreadable.
- `t1`…`t4` are text, strongest to faintest.
- `green`, `amber`, `red`, `blue` carry meaning and are darkened in the light
  theme; the dark values are tuned to glow on near-black.
