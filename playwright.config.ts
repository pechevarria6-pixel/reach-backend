import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 1,
  reporter: 'html',
  globalSetup: './global.setup.ts',
  use: {
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Discover is a map of what is on near you, and a headless browser has no
    // location. Without this the whole lane answers "allow location to see
    // what's on near you" — correct behaviour, and it tests nothing. Southern
    // Pines is the pilot area, so these are real venues and real events.
    permissions: ['geolocation'],
    geolocation: { latitude: 35.17, longitude: -79.39 },
  },
  projects: [
    // Signs in once with Clerk's testing helpers; falls back to the saved jar.
    { name: 'setup', testMatch: /auth\.setup\.ts/, retries: 0 },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/session.json' }, dependencies: ['setup'] },
    { name: 'iPhone 14', use: { ...devices['iPhone 14'], storageState: 'playwright/.auth/session.json' }, dependencies: ['setup'] },
  ],
});
