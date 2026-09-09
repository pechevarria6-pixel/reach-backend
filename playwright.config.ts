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
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' } },
    { name: 'iPhone 14', use: { ...devices['iPhone 14'], storageState: 'playwright/.auth/user.json' } },
  ],
});
