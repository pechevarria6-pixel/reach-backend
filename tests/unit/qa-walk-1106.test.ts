// Run with: npm run test:unit
// 2026-11-06: what the production logs and the e2e failure screenshot showed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('components/reach-app.jsx', 'utf8');

test('Discover never waits on a hung request: twelve seconds, then one more ask', () => {
  const at = app.indexOf('const loadLocalRecs=async()=>{');
  assert.ok(at > 0);
  const body = app.slice(at, at + 2500);
  assert.match(body, /const ask=async\(ms\)=>\{/);
  assert.match(body, /try\{res=await ask\(12000\);\}/);
  assert.match(body, /res=await ask\(20000\);/);
  assert.doesNotMatch(body, /const res=await fetch\(url\);/, 'a bare fetch waits as long as the server does');
});

test('an empty Groups tab has one way to start, not "+ New" beside "Start planning"', () => {
  assert.match(app, /\{\(loading\|\|groups\.length>0\)&&<button className="bsm bsm-p" onClick=\{\(\)=>push\("createGroup"\)\}>\+ New<\/button>\}/);
  assert.match(app, />Nothing planned yet</);
  assert.doesNotMatch(app, />No groups yet</);
});

test('a trip card credits its photo on one line, over a scrim', () => {
  const at = app.indexOf('title={`Photo: ${p.photo.credit}`}');
  assert.ok(at > 0);
  assert.match(app.slice(at, at + 500), /whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"/);
});

test('"Sort one evening" opens a fresh plan that remembers it is an evening', () => {
  assert.match(app, /cta:"Sort one evening →",action:\(\)=>push\("createPlan",\{fresh:true,evening:true\}\)/);
  assert.match(app, /const \[allKinds,setAllKinds\]=useState\(!evening\);/);
  assert.match(app, /\.filter\(t=>allKinds\|\|t\.id===planType\|\|t\.id==="restaurant"\|\|t\.id==="concert"\)/);
  assert.match(app, /Planning something bigger\? A trip or a weekend →/);
});

test('with nobody to pick, the first plan screen still offers friends, by starting a group', () => {
  assert.match(app, /\{withOthers\.length===0&&\(\s*\n\s*<div \{\.\.\.pressable\} onClick=\{\(\)=>push\("createGroup"\)\}/);
  assert.match(app, />With friends</);
  assert.doesNotMatch(app, /Select a group and what you're planning\./);
});

// ── An invite survives sign-up ─────────────────────────────────────────
import { afterSignUp } from '../../lib/after-sign-up.ts';
test('signing up from an invite comes back to it through onboarding; nothing else is carried', () => {
  assert.equal(afterSignUp('?redirect_url=%2Finvite%2FAbC_123-xyzDEF'), '/onboarding?next=%2Finvite%2FAbC_123-xyzDEF');
  assert.equal(afterSignUp(''), '/onboarding');
  assert.equal(afterSignUp('?redirect_url=https%3A%2F%2Fevil.example%2Finvite%2Fabcdefgh'), '/onboarding', 'never an open redirect');
  assert.equal(afterSignUp('?redirect_url=%2Fhome'), '/onboarding');
  const ob = readFileSync('app/(app)/onboarding/page.tsx', 'utf8');
  assert.match(ob, /if \(next && \/\^\\\/invite\\\/\[A-Za-z0-9_-\]\{8,\}\$\/\.test\(next\)\) \{ router\.push\(next\); return; \}/);
});

test('an invite opened by someone already in the group says they are in, not "already used"', () => {
  const route = readFileSync('app/api/invites/[token]/route.ts', 'utf8');
  assert.match(route, /groupId: member \? invite\.group_id : null/, 'the group id only to a member');
  const page = readFileSync('app/invite/[token]/page.tsx', 'utf8');
  assert.match(page, /if \(invite\.member\) \{/);
  assert.ok(page.indexOf('if (invite.member)') < page.indexOf("if (invite.status !== 'pending')"));
  assert.doesNotMatch(page, /\{error\} Ask whoever sent it/, 'the server already says who to ask');
});

// ── Clerk's stand-in is not anybody's photo ───────────────────────────
import { isClerkDefault, ownPhoto } from '../../lib/avatar.ts';
test("Clerk's generated default image is treated as no photo, so the app draws initials", () => {
  const stand = 'https://img.clerk.com/' + Buffer.from('{"type":"default","iid":"ins_x","rid":"user_y","initials":"NT"}').toString('base64url');
  const real = 'https://img.clerk.com/' + Buffer.from('{"type":"proxy","src":"https://images.clerk.dev/uploaded/img_abc"}').toString('base64url');
  assert.equal(isClerkDefault(stand), true);
  assert.equal(ownPhoto(stand), null);
  assert.equal(ownPhoto(real), real);
  assert.equal(ownPhoto('https://lh3.googleusercontent.com/a/abc'), 'https://lh3.googleusercontent.com/a/abc');
  assert.equal(ownPhoto(null), null);
  assert.match(app, /avatar:ownPhoto\(u\.avatar_url\|\|u\.avatar\|\|null\)/);
  assert.match(readFileSync('app/api/me/route.ts', 'utf8'), /const avatar_url = ownPhoto\(clerkUser\.imageUrl\);/);
});

test('a shared link carries a picture and says what it is; an invite says whose group', () => {
  const layout = readFileSync('app/layout.tsx', 'utf8');
  assert.match(layout, /metadataBase: new URL\('https:\/\/www\.alcanzar\.io'\)/);
  assert.match(layout, /twitter: \{ card: 'summary_large_image' \}/);
  const inv = readFileSync('app/invite/[token]/layout.tsx', 'utf8');
  assert.match(inv, /const title = `Join \$\{p\.groupName\} on Reach`;/);
  const pv = readFileSync('app/invite/[token]/invite-preview.ts', 'utf8');
  assert.doesNotMatch(pv, /\.select\('[^']*email/, 'the invited address never goes into a preview');
  const mw = readFileSync('middleware.ts', 'utf8');
  assert.match(mw, /'\/opengraph-image\(\.\*\)'/, 'crawlers fetch the picture signed out');
});

test('a group with only called-off plans tells a new member to start one, and offers it at the top', () => {
  assert.match(app, /const livePlans=\(group\?\.plans\|\|\[\]\)\.filter\(p=>isLive\(p,todayISO\)\);/);
  assert.match(app, /\{livePlans\.length\?"Open a plan below to see where it stands\.":"Nothing's planned right now — start one below\."\}/);
  assert.match(app, /\{livePlans\.length===0&&\(\s*\n\s*<div style=\{\{padding:"40px 20px",textAlign:"center"\}\}>/);
});
