# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reach.spec.ts >> 8. Mobile viewport >> Phone frame is visible on desktop
- Location: tests/reach.spec.ts:265:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.aw').first()
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for locator('.aw').first()

```

```yaml
- main:
  - heading "Sign in to Reach" [level=1]
  - paragraph: Welcome back! Please sign in to continue
  - button "Sign in with Google Continue with Google":
    - img "Sign in with Google"
    - text: Continue with Google
  - paragraph: or
  - text: Email address or username Last used
  - textbox "Email address or username":
    - /placeholder: Enter email or username
  - text: Password
  - textbox "Password":
    - /placeholder: Enter your password
  - button "Show password":
    - img
  - button "Continue":
    - text: Continue
    - img
  - text: Don’t have an account?
  - link "Sign up":
    - /url: https://www.alcanzar.io/sign-up/sign-up/sign-up#/?redirect_url=https%3A%2F%2Fwww.alcanzar.io%2Fhome
  - paragraph: Secured by
  - link "Clerk logo":
    - /url: https://go.clerk.com/components
    - img
- alert
```

# Test source

```ts
  169 |       const data = await res.json();
  170 |       expect(data).toHaveProperty('events');
  171 |       expect(Array.isArray(data.events)).toBeTruthy();
  172 |     }
  173 |   });
  174 | 
  175 |   test('/api/recommendations accepts POST', async ({ request }) => {
  176 |     const res = await request.post(`${BASE_URL}/api/recommendations`, {
  177 |       data: { vibe: 'chill', budget: 2000, nights: 5, travelers: 2 }
  178 |     });
  179 |     expect(res.status()).toBeLessThan(500);
  180 |   });
  181 | 
  182 |   test('Webhook endpoints exist', async ({ request }) => {
  183 |     const stripe = await request.post(`${BASE_URL}/api/webhooks/stripe`, { data: {} });
  184 |     expect(stripe.status()).toBeLessThan(500);
  185 |     const clerk = await request.post(`${BASE_URL}/api/webhooks/clerk`, { data: {} });
  186 |     expect(clerk.status()).toBeLessThan(500);
  187 |   });
  188 | });
  189 | 
  190 | test.describe('6. Trip quiz flow', () => {
  191 |   test.beforeEach(async ({ page }) => {
  192 |     await signIn(page);
  193 |     await waitForApp(page);
  194 |   });
  195 | 
  196 |   test('Can navigate to group trip planner', async ({ page }) => {
  197 |     await page.waitForSelector('.nb-btn', { timeout: 15000 });
  198 |     const tabs = await page.locator('.nb-btn').all();
  199 |     if (tabs[2]) await tabs[2].click();
  200 |     await page.waitForTimeout(1000);
  201 | 
  202 |     // Look for a group to click
  203 |     const cards = await page.locator('.card').all();
  204 |     if (cards.length > 0) {
  205 |       await cards[0].click();
  206 |       await page.waitForTimeout(1000);
  207 |       const planBtn = await page.locator('text=/Plan a Trip|groupTrip/i').isVisible({ timeout: 5000 }).catch(() => false);
  208 |       expect(planBtn).toBeTruthy();
  209 |     }
  210 |   });
  211 | });
  212 | 
  213 | test.describe('7. Performance', () => {
  214 |   test('Home page loads in under 10 seconds', async ({ page }) => {
  215 |     const start = Date.now();
  216 |     await page.goto(`${BASE_URL}/home`);
  217 |     await page.waitForLoadState('domcontentloaded');
  218 |     const elapsed = Date.now() - start;
  219 |     expect(elapsed).toBeLessThan(10000);
  220 |   });
  221 | 
  222 |   test('Sign in page loads in under 5 seconds', async ({ page }) => {
  223 |     const start = Date.now();
  224 |     await page.goto(`${BASE_URL}/sign-in`);
  225 |     await page.waitForLoadState('domcontentloaded');
  226 |     const elapsed = Date.now() - start;
  227 |     expect(elapsed).toBeLessThan(5000);
  228 |   });
  229 | 
  230 |   test('No console errors on home page load', async ({ page }) => {
  231 |     const errors: string[] = [];
  232 |     page.on('response', r => { if (r.status() === 404) errors.push('404: ' + r.url()); });
  233 |     page.on('console', msg => {
  234 |       if (msg.type() === 'error') errors.push(msg.text());
  235 |     });
  236 |     await page.goto(`${BASE_URL}/sign-in`);
  237 |     await page.waitForLoadState('networkidle');
  238 |     // Filter out known non-critical errors
  239 |     const critical = errors.filter(e =>
  240 |       !e.includes('icon-192') &&
  241 |       !e.includes('favicon') &&
  242 |       !e.includes('manifest') &&
  243 |       !e.includes('development keys') &&
  244 |       !e.includes('afterSignInUrl') &&
  245 |       !e.includes('themeColor') &&
  246 |       !e.includes('viewport')
  247 |     );
  248 |     expect(critical).toEqual([]);
  249 |   });
  250 | });
  251 | 
  252 | test.describe('8. Mobile viewport', () => {
  253 |   test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14
  254 | 
  255 |   test('App renders correctly on iPhone viewport', async ({ page }) => {
  256 |     await page.goto(`${BASE_URL}/sign-in`);
  257 |     await page.waitForLoadState('domcontentloaded');
  258 |     // Check nothing is overflowing
  259 |     const overflow = await page.evaluate(() => {
  260 |       return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  261 |     });
  262 |     expect(overflow).toBeFalsy();
  263 |   });
  264 | 
  265 |   test('Phone frame is visible on desktop', async ({ page }) => {
  266 |     await page.setViewportSize({ width: 1440, height: 900 });
  267 |     await page.goto(`${BASE_URL}/home`);
  268 |     await page.waitForLoadState('domcontentloaded');
> 269 |     await expect(page.locator('.aw').first()).toBeVisible({ timeout: 20000 });
      |                                               ^ Error: expect(locator).toBeVisible() failed
  270 |   });
  271 | });
  272 | 
  273 | // ─────────────────────────────────────────────────────────────────────────
  274 | // 9. Legal pages — listed as public in middleware, and for a long time they
  275 | //    404'd, which is the kind of gap nobody notices until someone looks.
  276 | test.describe('9. Legal pages', () => {
  277 |   test.use({ storageState: { cookies: [], origins: [] } });
  278 | 
  279 |   for (const [path, heading] of [['/privacy', 'Privacy'], ['/terms', 'Terms']]) {
  280 |     test(`${path} is public and has real content`, async ({ page }) => {
  281 |       const res = await page.goto(`${BASE_URL}${path}`);
  282 |       expect(res?.status()).toBe(200);
  283 |       await expect(page.locator('h1')).toContainText(heading);
  284 |       // A stub page would pass a status check; this asserts substance.
  285 |       const words = (await page.locator('main').innerText()).split(/\s+/).length;
  286 |       expect(words).toBeGreaterThan(300);
  287 |     });
  288 |   }
  289 | 
  290 |   test('Terms state plainly that Reach never holds funds', async ({ page }) => {
  291 |     await page.goto(`${BASE_URL}/terms`);
  292 |     // The product principle the whole payment design rests on. If this
  293 |     // sentence ever disappears, the page has drifted from the product.
  294 |     await expect(page.locator('main')).toContainText(/never hold/i);
  295 |   });
  296 | });
  297 | 
  298 | // ─────────────────────────────────────────────────────────────────────────
  299 | // 10. API authorisation boundaries. RLS is not the security model here — the
  300 | //     routes are — so an unauthenticated call must be refused, not empty.
  301 | test.describe('10. Profile API', () => {
  302 |   test.use({ storageState: { cookies: [], origins: [] } });
  303 | 
  304 |   for (const path of ['/api/profile', '/api/profile/loyalty']) {
  305 |     test(`${path} refuses an unauthenticated caller`, async ({ request }) => {
  306 |       const res = await request.get(`${BASE_URL}${path}`);
  307 |       expect([401, 405]).toContain(res.status());
  308 |     });
  309 |   }
  310 | 
  311 |   test('Profile never returns a full document number', async ({ request }) => {
  312 |     // Even unauthenticated, assert the shape contract: the route is built to
  313 |     // send last4 only, never the decrypted value.
  314 |     const res = await request.get(`${BASE_URL}/api/profile`);
  315 |     const body = await res.text();
  316 |     expect(body).not.toMatch(/passport_number_enc|tsa_precheck_enc|global_entry_enc/);
  317 |   });
  318 | });
  319 | 
  320 | // ─────────────────────────────────────────────────────────────────────────
  321 | // 11. Stripe publishable key is served at runtime, because Vercel hides
  322 | //     Sensitive variables from the build and NEXT_PUBLIC_ would compile in
  323 | //     as undefined.
  324 | test.describe('11. Stripe config', () => {
  325 |   test.use({ storageState: { cookies: [], origins: [] } });
  326 | 
  327 |   test('/api/config/stripe serves a publishable key, never a secret', async ({ request }) => {
  328 |     const res = await request.get(`${BASE_URL}/api/config/stripe`);
  329 |     expect(res.status()).toBe(200);
  330 |     const body = await res.json();
  331 |     expect(body.publishableKey).toMatch(/^pk_(test|live)_/);
  332 |     // The one thing this endpoint must never do.
  333 |     expect(JSON.stringify(body)).not.toMatch(/sk_(test|live)_/);
  334 |   });
  335 | });
  336 | 
  337 | // ─────────────────────────────────────────────────────────────────────────
  338 | // 12. Theme. Light is the default, and a stored choice is applied before
  339 | //     first paint so dark users never see a light frame flash past.
  340 | test.describe('12. Theme', () => {
  341 |   test.use({ storageState: { cookies: [], origins: [] } });
  342 | 
  343 |   test('Defaults to light with no stored preference', async ({ page }) => {
  344 |     await page.goto(`${BASE_URL}/sign-in`);
  345 |     const stamped = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  346 |     expect(stamped).toBeNull();
  347 |   });
  348 | 
  349 |   test('A stored dark choice is applied before paint', async ({ page }) => {
  350 |     await page.addInitScript(() => localStorage.setItem('reach-theme', 'dark'));
  351 |     await page.goto(`${BASE_URL}/sign-in`);
  352 |     await expect.poll(() =>
  353 |       page.evaluate(() => document.documentElement.getAttribute('data-theme')),
  354 |     ).toBe('dark');
  355 |   });
  356 | 
  357 |   test('The shell paints a themed background, never transparent', async ({ page }) => {
  358 |     await page.goto(`${BASE_URL}/sign-in`);
  359 |     const bg = await page.evaluate(() =>
  360 |       getComputedStyle(document.body).backgroundColor);
  361 |     expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  362 |   });
  363 | });
  364 | 
```