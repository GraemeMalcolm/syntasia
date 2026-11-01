import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 120000,
  expect: { timeout: 120000 },
  use: {
    baseURL: 'http://127.0.0.1:4173/syntasia/',
    headless: true,
  },
  projects: [
    { name: 'edge', use: { channel: 'msedge' } },
    { name: 'chrome', use: { channel: 'chrome' } },
  ],
  webServer: [{
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/syntasia/',
    reuseExistingServer: false,
    timeout: 60000,
  }, {
    command: 'npm run preview -- --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/syntasia/',
    reuseExistingServer: false,
    timeout: 60000,
  }],
});
