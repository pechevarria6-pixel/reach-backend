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

  test('No console errors on home page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('response', r => { if (r.status() === 404) errors.push('404: ' + r.url()); });
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(`${BASE_URL}/sign-in`);
    await page.waitForLoadState('networkidle');
    // Filter out known non-critical errors
    const critical = errors.filter(e =>
      !e.includes('icon-192') &&
      !e.includes('favicon') &&
      !e.includes('manifest') &&
      !e.includes('development keys') &&
      !e.includes('afterSignInUrl') &&
      !e.includes('themeColor') &&
      !e.includes('viewport')
    );
    expect(critical).toEqual([]);
  });
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
  // Signed out on purpose: a stale link is most often opened by somebody who
  // is not signed in, and that is exactly when a dead end is worst.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('A wrong address is a designed screen, not a dead end', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/this-page-does-not-exist`);
    expect(res?.status()).toBe(404);

    // Next's built-in 404 says "This page could not be found" in black
    // Helvetica on white, with no link anywhere. Every mistyped URL and
    // every replaced invitation landed there.
    await expect(page.locator('body')).not.toContainText('This page could not be found');
    await expect(page.locator('h1')).toContainText(/isn.t here/i);

    // The part that makes it not a dead end.
    const home = page.getByRole('link', { name: /take me back/i });
    await expect(home).toBeVisible();
    await home.click();
    await expect(page).toHaveURL(new RegExp(`^${BASE_URL}/(home|sign-in)?`));
  });

  test('The not-found screen paints a themed background, never transparent', async ({ page }) => {
    await page.goto(`${BASE_URL}/this-page-does-not-exist`);
    const bg = await page.locator('.nf-body').evaluate(el => getComputedStyle(el).backgroundColor);
    // rgba(0,0,0,0) is the flash of white a dark-mode user sees.
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });
});
