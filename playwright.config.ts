import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    channel: process.env.M1TERA_TEST_BROWSER ?? 'chrome',
    viewport: { width: 1280, height: 850 },
  },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3000 --strictPort', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI },
});
