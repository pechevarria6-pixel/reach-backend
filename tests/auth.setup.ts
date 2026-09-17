import { test as setup } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';
import fs from 'fs';
import path from 'path';

// Signs the test account in with Clerk's own testing helpers and saves the
// session for every other test. The suite used to depend on a cookie jar
// captured by hand in August; once Clerk expired that session, every signed-in
// test failed at the sign-in screen and said nothing about why.
//
// The saved jar is kept as a fallback, so a run without Clerk keys behaves
// exactly as it did before rather than failing outright.

const BASE_URL = process.env.TEST_URL || 'https://www.alcanzar.io';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test+clerk_test@reach-test.com';

export const SESSION_FILE = path.resolve(__dirname, '../playwright/.auth/session.json');
const FALLBACK_JAR = path.resolve(__dirname, '../playwright/.auth/user.json');

function useFallback(reason: string) {
  console.warn(`[auth.setup] ${reason}`);
  if (fs.existsSync(FALLBACK_JAR)) {
    fs.copyFileSync(FALLBACK_JAR, SESSION_FILE);
    console.warn('[auth.setup] Falling back to playwright/.auth/user.json. If it has expired, signed-in tests will stop at the sign-in screen.');
  } else {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookies: [], origins: [] }));
  }
}

setup('sign in the test account', async ({ page }) => {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });

  if (process.env.E2E_CLERK_SKIP) return useFallback(process.env.E2E_CLERK_SKIP);

  try {
    await page.goto(`${BASE_URL}/sign-in`);
    // Signs in with a one-time token created by CLERK_SECRET_KEY, so no
    // password is typed and none needs to be stored.
    await clerk.signIn({ page, emailAddress: TEST_EMAIL });
    await page.goto(`${BASE_URL}/home`);
    await page.waitForURL('**/home', { timeout: 20000 });
    await page.context().storageState({ path: SESSION_FILE });
    console.log(`[auth.setup] Signed in ${TEST_EMAIL} with Clerk testing helpers.`);
  } catch (e) {
    useFallback(`Clerk sign-in failed: ${(e as Error).message.split('\n')[0]}`);
  }
});
