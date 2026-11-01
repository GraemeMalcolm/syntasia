import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
test('active isolation worker does not bypass a real controlled CORS-denied origin', async ({ page }) => {
  let calls = 0;
  const server = createServer((_request, response) => { calls++; response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('Public local fixture; no credentials.'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.route('https://**/*', route => route.abort('blockedbyclient'));
    await page.goto('./');
    await expect(page.locator('#scenes article')).toHaveCount(1);
    await page.goto('tests/fixtures/coi.html');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable.');
    const result = await page.evaluate(async port => {
      let denied = false;
      try { await fetch(`http://127.0.0.1:${port}/denied`, { mode: 'cors', credentials: 'omit' }); } catch { denied = true; }
      return { denied, isolated: crossOriginIsolated, controlled: !!navigator.serviceWorker.controller };
    }, address.port);
    expect(result).toEqual({ denied: true, isolated: true, controlled: true });
    expect(calls).toBe(1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test('blocked worker startup permits only a verified nonisolated single-thread fallback without reload loops', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  let navigations = 0;
  page.on('request', request => { if (request.isNavigationRequest()) navigations++; });
  try {
    await page.route('https://**/*', route => route.abort('blockedbyclient'));
    await page.goto('http://127.0.0.1:4173/syntasia/');
    await expect(page.locator('#scenes article')).toHaveCount(1);
    await expect(page.locator('#browser-status')).toContainText('pipeline fixture: passed');
    await expect(page.locator('#browser-status')).toContainText('Isolation: no');
    expect(navigations).toBe(1);
    await expect(page.locator('#startup')).toHaveText('Local video ready (single-thread mode).');
    await expect(page.locator('#browser-status')).toContainText('Worker control timed out.');
    await expect(page.locator('#produce')).toBeDisabled();
  } finally { await context.close(); }
});
