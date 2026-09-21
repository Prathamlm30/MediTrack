import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: 'chrome', headless: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
