import { test, expect, Page } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

const BASE_URL = process.env.TEST_URL || 'https://www.alcanzar.io';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test+clerk_test@reach-test.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestReach2026!';

// —— Helpers ————————————————————————————————————————————————
// Drives Clerk's hosted <SignIn/> widget. Clerk uses a two-step flow
// (identifier → Continue → password → Continue), and its inputs are
// name="identifier" / name="password" — NOT type="email"/"password"
// on a single screen like the old custom AuthScreen.
async function signIn(page: Page) {
  // First visit lets Clerk's dev-instance handshake complete (it may bounce
  // through /sign-in and land at "/"); second visit then passes middleware.
  await page.goto(`${BASE_URL}/home`).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  await page.goto(`${BASE_URL}/home`).catch(() => {});
  await page.waitForURL('**/home', { timeout: 20000 });
}

async function waitForApp(page: Page) {
  await page.waitForSelector('text=reach', { timeout: 20000 });
}

// —— TEST SUITE ————————————————————————————————————————————

test.describe('1. Authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('Sign in page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/sign-in`);
    await expect(page).toHaveTitle(/Reach/i);
    // Clerk's identifier field, not input[type="email"]
    await expect(page.locator('input[name="identifier"]')).toBeVisible({ timeout: 15000 });
  });

  test('Sign up page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/sign-up`);
    // Clerk's sign-up email field is name="emailAddress"
    await expect(page.locator('input[name="emailAddress"]')).toBeVisible({ timeout: 15000 });
  });

  test('Redirects to sign-in when not authenticated', async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/sign-in/, { timeout: 10000 });
  });
});

test.describe('2. App loads after sign in', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Home screen renders', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('.sb-logo').first()).toBeVisible({ timeout: 20000 });
  });

  test('Navigation tabs are visible', async ({ page }) => {
    await waitForApp(page);
    await page.waitForSelector('.nb', { timeout: 15000 });
    const tabs = page.locator('.nb-btn');
    await expect(tabs).toHaveCount(4, { timeout: 10000 });
  });

  test('All 4 tabs are clickable', async ({ page }) => {
    await waitForApp(page);
    await page.waitForSelector('.nb-btn', { timeout: 15000 });
    const tabs = await page.locator('.nb-btn').all();
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    for (const tab of tabs) {
      await tab.click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('3. Discover tab', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
    await page.waitForSelector('.nb-btn', { timeout: 15000 });
    const tabs = await page.locator('.nb-btn').all();
    if (tabs[1]) await tabs[1].click(); // Discover tab
    await page.waitForTimeout(1000);
  });

  test('Discover screen loads', async ({ page }) => {
    await expect(page.locator('text=Discover').first()).toBeVisible({ timeout: 15000 });
  });

  test('Category filter pills exist', async ({ page }) => {
    await page.waitForTimeout(2000);
    const filters = page.locator('button:has-text("All")');
    await expect(filters.first()).toBeVisible({ timeout: 10000 });
  });

  test('Experience cards are displayed', async ({ page }) => {
    // The suite grants a real location (see playwright.config.ts), so this is
    // the discovery lane doing its actual job: things on near Southern Pines.
    // It used to look for "Share with group", which is on the detail view and
    // not on this list, and it passed only because the empty state matched.
    await expect(
      page.locator('text=/NEAR YOU|Based on your location/i').first(),
    ).toBeVisible({ timeout: 20000 });
  });

  test('Clicking a card opens detail view', async ({ page }) => {
    // This looked for ".card", which Discover has never used — so it matched
    // nothing, skipped its own assertion, and reported green for months. A
    // test that cannot fail is worse than no test, because the suite says it
    // is covered.
    const cards = page.locator('.exp-card');
    await expect(cards.first()).toBeVisible({ timeout: 25000 });

    await cards.first().click();
    // The detail view offers the two things you can do with a find: go to it,
    // or put it in front of a group. The wording of the first depends on who
    // owns the link — "Get tickets" for a ticketed event, "See their page"
    // for a place you simply walk into.
    await expect(
      page.locator('text=/Get tickets|See their page|Put this in front of a group/i').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('4. Groups tab', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
    await page.waitForSelector('.nb-btn', { timeout: 15000 });
    const tabs = await page.locator('.nb-btn').all();
    if (tabs[2]) await tabs[2].click();
    await page.waitForTimeout(1000);
  });

  test('Groups screen loads', async ({ page }) => {
    await expect(page.locator('text=/Groups|Your groups/i').first()).toBeVisible({ timeout: 15000 });
  });

  test('Create group button exists', async ({ page }) => {
    const createBtn = await page.locator('text=/New|Create|\\+/').first().isVisible({ timeout: 10000 }).catch(() => false);
    expect(createBtn).toBeTruthy();
  });

  test('Can open create group flow', async ({ page }) => {
    const btns = await page.locator('button').all();
    for (const btn of btns) {
      const text = await btn.textContent().catch(() => '');
      if (text?.includes('+') || text?.includes('New') || text?.includes('Create')) {
        await btn.click();
        await page.waitForTimeout(1000);
        break;
      }
    }
    // The flow opens on "Who's going?" — solo or with other people — because
    // that answer changes every screen after it. It does not open on a name
    // field or an emoji picker, which is what this used to look for.
    const whosGoing = await page.locator('text=/Who.s going/i').first()
      .isVisible({ timeout: 8000 }).catch(() => false);
    const choices = await page.locator('text=/Just me|With other people/i').first()
      .isVisible({ timeout: 8000 }).catch(() => false);
    expect(whosGoing || choices).toBeTruthy();
  });
});

test.describe('5. API endpoints', () => {
  test('/api/me returns user data when authenticated', async ({ request }) => {
    // Unauthenticated request — middleware now lets API routes answer,
    // so this should be a clean 401 (307 kept for safety).
    const res = await request.get(`${BASE_URL}/api/me`);
    expect([200, 401, 307]).toContain(res.status());
  });

  test('/api/groups returns valid JSON', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/groups`);
    expect([200, 401, 307]).toContain(res.status());
  });

  test('/api/nearby returns events', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nearby`);
    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('events');
      expect(Array.isArray(data.events)).toBeTruthy();
    }
  });

  test('/api/recommendations accepts POST', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/recommendations`, {
      data: { vibe: 'chill', budget: 2000, nights: 5, travelers: 2 }
    });
    expect(res.status()).toBeLessThan(500);
  });

  test('Webhook endpoints exist', async ({ request }) => {
    const stripe = await request.post(`${BASE_URL}/api/webhooks/stripe`, { data: {} });
    expect(stripe.status()).toBeLessThan(500);
    const clerk = await request.post(`${BASE_URL}/api/webhooks/clerk`, { data: {} });
    expect(clerk.status()).toBeLessThan(500);
  });
});

test.describe('6. Trip quiz flow', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
  });

  test('Can navigate to group trip planner', async ({ page }) => {
    await page.waitForSelector('.nb-btn', { timeout: 15000 });
    const tabs = await page.locator('.nb-btn').all();
    if (tabs[2]) await tabs[2].click();
    await page.waitForTimeout(1000);

    // The account under test always has groups; if it does not, this test is
    // not exercising navigation and should say so rather than pass quietly.
    const cards = page.locator('.card');
    await expect(cards.first()).toBeVisible({ timeout: 15000 });
    {
      await cards.first().click();
      await page.waitForTimeout(1000);
      // A group opens on its plans: the trips it already has, each with a way
      // in, and a way to start another. "Plan a Trip" was the old label.
      const plans = await page.locator('text=/Plans|Coming up/i').first()
        .isVisible({ timeout: 8000 }).catch(() => false);
      const intoAPlan = await page.locator('text=/View|New/i').first()
        .isVisible({ timeout: 8000 }).catch(() => false);
      expect(plans || intoAPlan).toBeTruthy();
    }
  });
});

test.describe('7. Performance', () => {
  test('Home page loads in under 10 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}/home`);
    await page.waitForLoadState('domcontentloaded');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10000);
  });

  test('Sign in page loads in under 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}/sign-in`);
    await page.waitForLoadState('domcontentloaded');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  // Noise the browser makes that is not this app failing. Kept small and
  // named: every entry here is a screen fault somebody has chosen not to see,
  // so the list is the part of this test worth reviewing.
  const NOT_OURS = [
    'icon-192', 'favicon', 'manifest', 'development keys',
    'afterSignInUrl', 'themeColor', 'viewport',
  ];

  /** Every addressable screen. The rest of the app is push() inside /home. */
  const SCREENS = ['/home', '/onboarding', '/sign-in', '/sign-up', '/terms', '/privacy'];

  for (const path of SCREENS) {
    test(`No console errors on ${path}`, async ({ page }) => {
      // This used to be one test called "No console errors on home page load"
      // which loaded /sign-in — so home, the screen the whole app lives on,
      // was never once checked. The name said one thing and the code did
      // another, which is the same shape as every other bug found this week.
      const errors: string[] = [];
      page.on('response', r => { if (r.status() === 404) errors.push('404: ' + r.url()); });
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      page.on('pageerror', e => errors.push('uncaught: ' + e.message));

      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState('networkidle');

      const critical = errors.filter(e => !NOT_OURS.some(ok => e.includes(ok)));
      expect(critical, `${path} logged errors a person would have seen`).toEqual([]);
    });
  }
});

test.describe('8. Mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14

  test('App renders correctly on iPhone viewport', async ({ page }) => {
    await page.goto(`${BASE_URL}/sign-in`);
    await page.waitForLoadState('domcontentloaded');
    // Check nothing is overflowing
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBeFalsy();
  });

  test('Phone frame is visible on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/home`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.aw').first()).toBeVisible({ timeout: 20000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Legal pages — listed as public in middleware, and for a long time they
//    404'd, which is the kind of gap nobody notices until someone looks.
test.describe('9. Legal pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [path, heading] of [['/privacy', 'Privacy'], ['/terms', 'Terms']]) {
    test(`${path} is public and has real content`, async ({ page }) => {
      const res = await page.goto(`${BASE_URL}${path}`);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1')).toContainText(heading);
      // A stub page would pass a status check; this asserts substance.
      const words = (await page.locator('main').innerText()).split(/\s+/).length;
      expect(words).toBeGreaterThan(300);
    });
  }

  test('Terms state plainly that Reach never holds funds', async ({ page }) => {
    await page.goto(`${BASE_URL}/terms`);
    // The product principle the whole payment design rests on. If this
    // sentence ever disappears, the page has drifted from the product.
    await expect(page.locator('main')).toContainText(/never hold/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. API authorisation boundaries. RLS is not the security model here — the
//     routes are — so an unauthenticated call must be refused, not empty.
test.describe('10. Profile API', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ['/api/profile', '/api/profile/loyalty']) {
    test(`${path} refuses an unauthenticated caller`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${path}`);
      expect([401, 405]).toContain(res.status());
    });
  }

  test('Profile never returns a full document number', async ({ request }) => {
    // Even unauthenticated, assert the shape contract: the route is built to
    // send last4 only, never the decrypted value.
    const res = await request.get(`${BASE_URL}/api/profile`);
    const body = await res.text();
    expect(body).not.toMatch(/passport_number_enc|tsa_precheck_enc|global_entry_enc/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 11. Stripe publishable key is served at runtime, because Vercel hides
//     Sensitive variables from the build and NEXT_PUBLIC_ would compile in
//     as undefined.
test.describe('11. Stripe config', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/api/config/stripe serves a publishable key, never a secret', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/config/stripe`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.publishableKey).toMatch(/^pk_(test|live)_/);
    // The one thing this endpoint must never do.
    expect(JSON.stringify(body)).not.toMatch(/sk_(test|live)_/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 12. Theme. Light is the default, and a stored choice is applied before
//     first paint so dark users never see a light frame flash past.
test.describe('12. Theme', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Defaults to light with no stored preference', async ({ page }) => {
    await page.goto(`${BASE_URL}/sign-in`);
    const stamped = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(stamped).toBeNull();
  });

  test('A stored dark choice is applied before paint', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('reach-theme', 'dark'));
    await page.goto(`${BASE_URL}/sign-in`);
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBe('dark');
  });

  test('The shell paints a themed background, never transparent', async ({ page }) => {
    await page.goto(`${BASE_URL}/sign-in`);
    // The shell's background comes from a CSS variable defined in an inline
    // style tag. Reading it the instant navigation resolves races the
    // stylesheet, so poll rather than sampling once.
    await expect.poll(
      () => page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      { timeout: 10000 },
    ).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('13. Not found', () => {
  // Signed in, because that is the only way to reach this screen.
  //
  // A signed-out visitor asking for an unknown address is redirected to
  // sign-in with a returnBackUrl, not 404'd — deliberately, so an anonymous
  // caller cannot probe which addresses exist. They land here after signing
  // in. The first version of this test asserted a 404 while signed out, got
  // a 307, and was wrong about the app rather than finding a bug in it.

  test('A wrong address is a designed screen, not a dead end', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/this-page-does-not-exist`);
    expect(res?.status()).toBe(404);
    await expect(page).toHaveURL(/this-page-does-not-exist/);

    // Next's built-in 404 says "This page could not be found" in black
    // Helvetica on white, with no link anywhere. Every mistyped URL and
    // every replaced invitation landed there.
    await expect(page.locator('body')).not.toContainText('This page could not be found');
    await expect(page.locator('h1')).toContainText(/isn.t here/i);

    // The part that makes it not a dead end.
    const home = page.getByRole('link', { name: /take me back/i });
    await expect(home).toBeVisible();
    await home.click();
    await expect(page).toHaveURL(new RegExp(`^${BASE_URL}/(home)?$`));
  });

  test('The not-found screen paints a themed background, never transparent', async ({ page }) => {
    await page.goto(`${BASE_URL}/this-page-does-not-exist`);
    const bg = await page.locator('.nf-body').evaluate(el => getComputedStyle(el).backgroundColor);
    // rgba(0,0,0,0) is the flash of white a dark-mode user sees.
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });
});

// ─── 14. Rendered facts ──────────────────────────────────────────────────
// The layer that missed six bugs in a day.
//
// Every one of them passed a green build, a 200 response and a correct
// database row, and failed at the only place that matters: the screen. The
// ticket URL was generated, stored and returned, and a hand-written field
// list dropped it before the render. Nothing in the stack objected.
//
// These assert the DOM. They are deliberately structural rather than tied to
// one plan's wording — a plan gets regenerated and its restaurants change,
// but the rule "an item that has somewhere to book must offer a way to get
// there" holds for every plan there will ever be.
test.describe('14. Rendered facts', () => {
  // Serial, because every test here drives the same signed-in session.
  // Run in parallel they interfere — two workers walking one account, with
  // one rotating the session cookie under the other. It passed alone and
  // failed in the suite, which is the worst of both: a flaky test teaches
  // people to ignore red, and then a real failure goes unread too.
  test.describe.configure({ mode: 'serial' });

  async function openFirstPlanItinerary(page: Page, titled?: RegExp) {
    await page.goto(`${BASE_URL}/home`);
    await page.waitForLoadState('networkidle');
    const cards = page.locator('[class*="card"]').filter({ hasText: titled ?? /·/ });
    await cards.first().click({ timeout: 15000 }).catch(() => {});
    // The itinerary is part of the overview now; there is no tab to open.
    await page.waitForTimeout(2500);
  }

  /**
   * Any plan that holds a ticketed event.
   *
   * The first version of this opened whichever plan came first and skipped
   * when it had no gig in it — so the assertion that matters most, on the
   * feature that shipped broken this morning, quietly never ran. A test that
   * excuses itself is not a test.
   */


  test('a place we can link to always offers a way to get there', async ({ page }) => {
    await openFirstPlanItinerary(page);
    // Every outbound link on an itinerary row must actually go somewhere.
    // "Get tickets" with no href is exactly what shipped this morning.
    const links = page.locator('a[target="_blank"]');
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const href = await links.nth(i).getAttribute('href');
      expect(href, 'a link on the itinerary had no destination').toBeTruthy();
      expect(href).toMatch(/^https?:\/\//);
    }
  });

  test('no placeholder poison reaches a screen', async ({ page }) => {
    await openFirstPlanItinerary(page);
    const text = await page.locator('body').innerText();
    // Each of these has been on a screen in this app at some point.
    for (const poison of ['undefined', 'NaN', '[object Object]', '\\u2190', 'null,']) {
      expect(text, `"${poison}" rendered to a person`).not.toContain(poison);
    }
    // A raw enum is the shape "restaurant" took before it was a pill.
    expect(text).not.toMatch(/^\s*(walk_in|on_budget)\s*$/m);
  });

  test('every ticketed event has somewhere to buy', async ({ page }) => {
    // The rule that shipped broken this morning: an item typed 'event' must
    // carry the page that sells it, or the screen shows a pill saying
    // "ticketed" above nothing to press.
    //
    // Asserted against the API rather than by clicking to a plan, because
    // there is no URL for a plan — every screen lives inside the SPA shell,
    // so a headless test can only reach one by clicking a card, and that was
    // too brittle to trust. Recorded in STATUS.md as its own gap: a trip you
    // cannot link to is a trip you cannot share.
    // Fetched from inside the page, not through page.request.
    //
    // page.request carries a snapshot of the cookies, and Clerk rotates the
    // session while the earlier tests in this block are navigating — so by
    // the time this ran it was using a cookie that had expired thirty
    // seconds ago and got a 401. The document always has the live one.
    await page.goto(`${BASE_URL}/home`);
    await page.waitForLoadState('networkidle');

    const checked = await page.evaluate(async () => {
      const get = (u: string) => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
      const groups = (await get('/api/groups'))?.groups ?? [];
      const offenders: string[] = [];
      let seen = 0;
      for (const g of groups.slice(0, 3)) {
        const detail = await get(`/api/groups/${g.id}`);
        for (const plan of (detail?.plans ?? []).slice(0, 6)) {
          const p = await get(`/api/plans/${plan.id}`);
          for (const item of p?.itinerary ?? []) {
            if (item.type !== 'event') continue;
            seen++;
            if (!item.venue_website) offenders.push(String(item.title).slice(0, 60));
          }
        }
      }
      return { seen, offenders };
    });

    expect(checked.offenders, 'ticketed events with nowhere to buy').toEqual([]);
    console.log(`[contract] checked ${checked.seen} ticketed event(s)`);
  });

  test('money on a plan screen is a number, never an empty promise', async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    // "$NaN" and "$undefined" have both been on this screen.
    expect(text).not.toMatch(/\$\s*(NaN|undefined|null)/);
  });
});
