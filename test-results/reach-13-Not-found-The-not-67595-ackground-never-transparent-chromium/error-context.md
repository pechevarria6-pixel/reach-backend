# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reach.spec.ts >> 13. Not found >> The not-found screen paints a themed background, never transparent
- Location: tests/reach.spec.ts:414:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.evaluate: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('.nf-body')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e7]:
          - heading "Sign in to Reach" [level=1] [ref=e8]
          - paragraph [ref=e9]: Welcome back! Please sign in to continue
        - generic [ref=e10]:
          - button "Sign in with Google Continue with Google" [ref=e13] [cursor=pointer]:
            - generic [ref=e14]:
              - img "Sign in with Google" [ref=e16]
              - generic [ref=e17]: Continue with Google
          - paragraph [ref=e20]: or
          - generic [ref=e22]:
            - generic [ref=e23]:
              - generic [ref=e26]:
                - generic [ref=e27]: Email address or username
                - textbox "Email address or username" [ref=e29]:
                  - /placeholder: Enter email or username
              - generic:
                - generic:
                  - generic:
                    - generic: Password
                    - generic:
                      - textbox "Password":
                        - /placeholder: Enter your password
                      - button "Show password"
            - button [ref=e32] [cursor=pointer]
      - generic [ref=e36]:
        - generic [ref=e37]:
          - generic [ref=e38]: Don’t have an account?
          - link "Sign up" [ref=e39] [cursor=pointer]:
            - /url: https://www.alcanzar.io/sign-up#/?redirect_url=https%3A%2F%2Fwww.alcanzar.io%2Fthis-page-does-not-exist
        - generic [ref=e43]:
          - paragraph [ref=e44]: Secured by
          - link "Clerk logo" [ref=e45] [cursor=pointer]:
            - /url: https://go.clerk.com/components
  - alert [ref=e51]
```

# Test source

```ts
  316 |     // sentence ever disappears, the page has drifted from the product.
  317 |     await expect(page.locator('main')).toContainText(/never hold/i);
  318 |   });
  319 | });
  320 | 
  321 | // ─────────────────────────────────────────────────────────────────────────
  322 | // 10. API authorisation boundaries. RLS is not the security model here — the
  323 | //     routes are — so an unauthenticated call must be refused, not empty.
  324 | test.describe('10. Profile API', () => {
  325 |   test.use({ storageState: { cookies: [], origins: [] } });
  326 | 
  327 |   for (const path of ['/api/profile', '/api/profile/loyalty']) {
  328 |     test(`${path} refuses an unauthenticated caller`, async ({ request }) => {
  329 |       const res = await request.get(`${BASE_URL}${path}`);
  330 |       expect([401, 405]).toContain(res.status());
  331 |     });
  332 |   }
  333 | 
  334 |   test('Profile never returns a full document number', async ({ request }) => {
  335 |     // Even unauthenticated, assert the shape contract: the route is built to
  336 |     // send last4 only, never the decrypted value.
  337 |     const res = await request.get(`${BASE_URL}/api/profile`);
  338 |     const body = await res.text();
  339 |     expect(body).not.toMatch(/passport_number_enc|tsa_precheck_enc|global_entry_enc/);
  340 |   });
  341 | });
  342 | 
  343 | // ─────────────────────────────────────────────────────────────────────────
  344 | // 11. Stripe publishable key is served at runtime, because Vercel hides
  345 | //     Sensitive variables from the build and NEXT_PUBLIC_ would compile in
  346 | //     as undefined.
  347 | test.describe('11. Stripe config', () => {
  348 |   test.use({ storageState: { cookies: [], origins: [] } });
  349 | 
  350 |   test('/api/config/stripe serves a publishable key, never a secret', async ({ request }) => {
  351 |     const res = await request.get(`${BASE_URL}/api/config/stripe`);
  352 |     expect(res.status()).toBe(200);
  353 |     const body = await res.json();
  354 |     expect(body.publishableKey).toMatch(/^pk_(test|live)_/);
  355 |     // The one thing this endpoint must never do.
  356 |     expect(JSON.stringify(body)).not.toMatch(/sk_(test|live)_/);
  357 |   });
  358 | });
  359 | 
  360 | // ─────────────────────────────────────────────────────────────────────────
  361 | // 12. Theme. Light is the default, and a stored choice is applied before
  362 | //     first paint so dark users never see a light frame flash past.
  363 | test.describe('12. Theme', () => {
  364 |   test.use({ storageState: { cookies: [], origins: [] } });
  365 | 
  366 |   test('Defaults to light with no stored preference', async ({ page }) => {
  367 |     await page.goto(`${BASE_URL}/sign-in`);
  368 |     const stamped = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  369 |     expect(stamped).toBeNull();
  370 |   });
  371 | 
  372 |   test('A stored dark choice is applied before paint', async ({ page }) => {
  373 |     await page.addInitScript(() => localStorage.setItem('reach-theme', 'dark'));
  374 |     await page.goto(`${BASE_URL}/sign-in`);
  375 |     await expect.poll(() =>
  376 |       page.evaluate(() => document.documentElement.getAttribute('data-theme')),
  377 |     ).toBe('dark');
  378 |   });
  379 | 
  380 |   test('The shell paints a themed background, never transparent', async ({ page }) => {
  381 |     await page.goto(`${BASE_URL}/sign-in`);
  382 |     // The shell's background comes from a CSS variable defined in an inline
  383 |     // style tag. Reading it the instant navigation resolves races the
  384 |     // stylesheet, so poll rather than sampling once.
  385 |     await expect.poll(
  386 |       () => page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  387 |       { timeout: 10000 },
  388 |     ).not.toBe('rgba(0, 0, 0, 0)');
  389 |   });
  390 | });
  391 | 
  392 | test.describe('13. Not found', () => {
  393 |   // Signed out on purpose: a stale link is most often opened by somebody who
  394 |   // is not signed in, and that is exactly when a dead end is worst.
  395 |   test.use({ storageState: { cookies: [], origins: [] } });
  396 | 
  397 |   test('A wrong address is a designed screen, not a dead end', async ({ page }) => {
  398 |     const res = await page.goto(`${BASE_URL}/this-page-does-not-exist`);
  399 |     expect(res?.status()).toBe(404);
  400 | 
  401 |     // Next's built-in 404 says "This page could not be found" in black
  402 |     // Helvetica on white, with no link anywhere. Every mistyped URL and
  403 |     // every replaced invitation landed there.
  404 |     await expect(page.locator('body')).not.toContainText('This page could not be found');
  405 |     await expect(page.locator('h1')).toContainText(/isn.t here/i);
  406 | 
  407 |     // The part that makes it not a dead end.
  408 |     const home = page.getByRole('link', { name: /take me back/i });
  409 |     await expect(home).toBeVisible();
  410 |     await home.click();
  411 |     await expect(page).toHaveURL(new RegExp(`^${BASE_URL}/(home|sign-in)?`));
  412 |   });
  413 | 
  414 |   test('The not-found screen paints a themed background, never transparent', async ({ page }) => {
  415 |     await page.goto(`${BASE_URL}/this-page-does-not-exist`);
> 416 |     const bg = await page.locator('.nf-body').evaluate(el => getComputedStyle(el).backgroundColor);
      |                                               ^ Error: locator.evaluate: Test timeout of 60000ms exceeded.
  417 |     // rgba(0,0,0,0) is the flash of white a dark-mode user sees.
  418 |     expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  419 |     expect(bg).not.toBe('transparent');
  420 |   });
  421 | });
  422 | 
```