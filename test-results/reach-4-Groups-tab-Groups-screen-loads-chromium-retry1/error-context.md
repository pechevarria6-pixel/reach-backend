# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reach.spec.ts >> 4. Groups tab >> Groups screen loads
- Location: tests/reach.spec.ts:127:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/home" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - main [ref=f1e2]:
    - generic [ref=f1e4]:
      - generic [ref=f1e5]:
        - generic [ref=f1e7]:
          - heading "Sign in to Reach" [level=1] [ref=f1e8]
          - paragraph [ref=f1e9]: Welcome back! Please sign in to continue
        - generic [ref=f1e10]:
          - button "Sign in with Google Continue with Google" [ref=f1e13] [cursor=pointer]:
            - generic [ref=f1e14]:
              - img "Sign in with Google" [ref=f1e16]
              - generic [ref=f1e17]: Continue with Google
          - paragraph [ref=f1e20]: or
          - generic [ref=f1e22]:
            - generic [ref=f1e23]:
              - generic [ref=f1e26]:
                - generic [ref=f1e27]:
                  - generic [ref=f1e28]: Email address or username
                  - generic [ref=f1e29]: Last used
                - textbox "Email address or username" [ref=f1e30]:
                  - /placeholder: Enter email or username
              - generic:
                - generic:
                  - generic:
                    - generic: Password
                    - generic:
                      - textbox "Password":
                        - /placeholder: Enter your password
                      - button "Show password"
            - button [ref=f1e33] [cursor=pointer]
      - generic [ref=f1e37]:
        - generic [ref=f1e38]:
          - generic [ref=f1e39]: Don’t have an account?
          - link "Sign up" [ref=f1e40] [cursor=pointer]:
            - /url: https://www.alcanzar.io/sign-up/sign-up/sign-up#/?redirect_url=https%3A%2F%2Fwww.alcanzar.io%2Fhome
        - generic [ref=f1e44]:
          - paragraph [ref=f1e45]: Secured by
          - link "Clerk logo" [ref=f1e46] [cursor=pointer]:
            - /url: https://go.clerk.com/components
  - alert [ref=f1e52]
```

# Test source

```ts
  1   | import { test, expect, Page } from '@playwright/test';
  2   | import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
  3   | 
  4   | const BASE_URL = process.env.TEST_URL || 'https://www.alcanzar.io';
  5   | const TEST_EMAIL = process.env.TEST_EMAIL || 'test+clerk_test@reach-test.com';
  6   | const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestReach2026!';
  7   | 
  8   | // —— Helpers ————————————————————————————————————————————————
  9   | // Drives Clerk's hosted <SignIn/> widget. Clerk uses a two-step flow
  10  | // (identifier → Continue → password → Continue), and its inputs are
  11  | // name="identifier" / name="password" — NOT type="email"/"password"
  12  | // on a single screen like the old custom AuthScreen.
  13  | async function signIn(page: Page) {
  14  |   // First visit lets Clerk's dev-instance handshake complete (it may bounce
  15  |   // through /sign-in and land at "/"); second visit then passes middleware.
  16  |   await page.goto(`${BASE_URL}/home`).catch(() => {});
  17  |   await page.waitForLoadState('networkidle').catch(() => {});
  18  |   await page.waitForTimeout(2000);
  19  |   await page.goto(`${BASE_URL}/home`).catch(() => {});
> 20  |   await page.waitForURL('**/home', { timeout: 20000 });
      |              ^ TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
  21  | }
  22  | 
  23  | async function waitForApp(page: Page) {
  24  |   await page.waitForSelector('text=reach', { timeout: 20000 });
  25  | }
  26  | 
  27  | // —— TEST SUITE ————————————————————————————————————————————
  28  | 
  29  | test.describe('1. Authentication', () => {
  30  |   test.use({ storageState: { cookies: [], origins: [] } });
  31  |   test('Sign in page loads', async ({ page }) => {
  32  |     await page.goto(`${BASE_URL}/sign-in`);
  33  |     await expect(page).toHaveTitle(/Reach/i);
  34  |     // Clerk's identifier field, not input[type="email"]
  35  |     await expect(page.locator('input[name="identifier"]')).toBeVisible({ timeout: 15000 });
  36  |   });
  37  | 
  38  |   test('Sign up page loads', async ({ page }) => {
  39  |     await page.goto(`${BASE_URL}/sign-up`);
  40  |     // Clerk's sign-up email field is name="emailAddress"
  41  |     await expect(page.locator('input[name="emailAddress"]')).toBeVisible({ timeout: 15000 });
  42  |   });
  43  | 
  44  |   test('Redirects to sign-in when not authenticated', async ({ page }) => {
  45  |     await page.goto(`${BASE_URL}/home`);
  46  |     await expect(page).toHaveURL(/sign-in/, { timeout: 10000 });
  47  |   });
  48  | });
  49  | 
  50  | test.describe('2. App loads after sign in', () => {
  51  |   test.beforeEach(async ({ page }) => {
  52  |     await signIn(page);
  53  |   });
  54  | 
  55  |   test('Home screen renders', async ({ page }) => {
  56  |     await waitForApp(page);
  57  |     await expect(page.locator('.sb-logo').first()).toBeVisible({ timeout: 20000 });
  58  |   });
  59  | 
  60  |   test('Navigation tabs are visible', async ({ page }) => {
  61  |     await waitForApp(page);
  62  |     await page.waitForSelector('.nb', { timeout: 15000 });
  63  |     const tabs = page.locator('.nb-btn');
  64  |     await expect(tabs).toHaveCount(4, { timeout: 10000 });
  65  |   });
  66  | 
  67  |   test('All 4 tabs are clickable', async ({ page }) => {
  68  |     await waitForApp(page);
  69  |     await page.waitForSelector('.nb-btn', { timeout: 15000 });
  70  |     const tabs = await page.locator('.nb-btn').all();
  71  |     expect(tabs.length).toBeGreaterThanOrEqual(3);
  72  |     for (const tab of tabs) {
  73  |       await tab.click();
  74  |       await page.waitForTimeout(300);
  75  |     }
  76  |   });
  77  | });
  78  | 
  79  | test.describe('3. Discover tab', () => {
  80  |   test.beforeEach(async ({ page }) => {
  81  |     await signIn(page);
  82  |     await waitForApp(page);
  83  |     await page.waitForSelector('.nb-btn', { timeout: 15000 });
  84  |     const tabs = await page.locator('.nb-btn').all();
  85  |     if (tabs[1]) await tabs[1].click(); // Discover tab
  86  |     await page.waitForTimeout(1000);
  87  |   });
  88  | 
  89  |   test('Discover screen loads', async ({ page }) => {
  90  |     await expect(page.locator('text=Discover').first()).toBeVisible({ timeout: 15000 });
  91  |   });
  92  | 
  93  |   test('Category filter pills exist', async ({ page }) => {
  94  |     await page.waitForTimeout(2000);
  95  |     const filters = page.locator('button:has-text("All")');
  96  |     await expect(filters.first()).toBeVisible({ timeout: 10000 });
  97  |   });
  98  | 
  99  |   test('Experience cards are displayed', async ({ page }) => {
  100 |     await expect(page.locator('text=Share with group').first().or(page.locator('text=/No local events|Nothing here yet/i').first())).toBeVisible({ timeout: 20000 });
  101 |   });
  102 | 
  103 |   test('Clicking a card opens detail view', async ({ page }) => {
  104 |     await page.waitForTimeout(3000);
  105 |     const cards = page.locator('.card');
  106 |     const count = await cards.count();
  107 |     if (count > 0) {
  108 |       await cards.first().click();
  109 |       await page.waitForTimeout(1000);
  110 |       const hasBookNow = await page.locator('text=Book Now').isVisible({ timeout: 5000 }).catch(() => false);
  111 |       const hasAddToGroup = await page.locator('text=Add to a Group Plan').isVisible({ timeout: 5000 }).catch(() => false);
  112 |       expect(hasBookNow || hasAddToGroup).toBeTruthy();
  113 |     }
  114 |   });
  115 | });
  116 | 
  117 | test.describe('4. Groups tab', () => {
  118 |   test.beforeEach(async ({ page }) => {
  119 |     await signIn(page);
  120 |     await waitForApp(page);
```