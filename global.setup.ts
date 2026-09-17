import { clerkSetup } from '@clerk/testing/playwright';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const BASE_URL = process.env.TEST_URL || 'https://www.alcanzar.io';

// The Clerk instance the keys belong to has to be the one the site under test
// uses. .env.local holds the development instance's keys, while
// www.alcanzar.io runs on the production instance, and a sign-in token minted
// by one instance means nothing to the other. So keys for the target are read
// from E2E_CLERK_* first (kept in .env.test.local, which git ignores), and the
// site's own publishable key is checked before anything is attempted.
dotenv.config({ path: path.resolve(__dirname, '.env.test.local') });

export default async function globalSetup() {
  const publishableKey = process.env.E2E_CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.E2E_CLERK_SECRET_KEY || process.env.CLERK_SECRET_KEY;

  const served = await fetch(`${BASE_URL}/sign-in`)
    .then(r => r.text())
    .then(html => html.match(/pk_(?:live|test)_[A-Za-z0-9$]+/)?.[0] ?? null)
    .catch(() => null);

  if (!publishableKey || !secretKey) {
    process.env.E2E_CLERK_SKIP = 'No Clerk keys set.';
    return;
  }
  if (served && served !== publishableKey) {
    process.env.E2E_CLERK_SKIP =
      `${BASE_URL} uses Clerk key ${served.slice(0, 12)}…, but the keys available are for ${publishableKey.slice(0, 12)}…. ` +
      'Put that instance\'s keys in .env.test.local as E2E_CLERK_PUBLISHABLE_KEY and E2E_CLERK_SECRET_KEY.';
    return;
  }

  // clerk.signIn() reads CLERK_SECRET_KEY directly, and workers inherit what
  // is set here.
  process.env.CLERK_SECRET_KEY = secretKey;
  try {
    await clerkSetup({ publishableKey, secretKey });
  } catch (e) {
    process.env.E2E_CLERK_SKIP = `Could not get a Clerk testing token: ${(e as Error).message.split('\n')[0]}`;
  }
}
