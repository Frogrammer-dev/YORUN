import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: 'e2e',
  outputDir: '../test-results/mobile-app',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3191', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'android-shell', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-shell', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run build && node scripts/serve.mjs',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    url: 'http://127.0.0.1:3191',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
