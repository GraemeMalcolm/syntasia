import { test, expect } from '@playwright/test';
test('compiled static build loads base-aware workers, WASM and font assets and verifies media', async ({ page }) => {
  const errors: string[] = [];
  const broken: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) broken.push(response.url()); });
  await page.route('https://**/*', route => route.abort('blockedbyclient'));
  await page.goto('http://127.0.0.1:4174/syntasia/');
  await expect(page.locator('#scenes article')).toHaveCount(1);
  await expect(page.locator('#browser-status')).toContainText('pipeline fixture: passed');
  await expect(page.locator('#browser-status')).toContainText('Isolation: yes');
  await expect(page.locator('#browser-status')).toContainText('alpha decode: passed');
  await page.getByLabel('Script', { exact: true }).fill('Compiled local editing works.');
  expect(errors).toEqual([]);
  expect(broken).toEqual([]);
  const mime = await page.evaluate(async () => {
    const paths = ['vendor/core/ffmpeg-core.wasm', 'vendor/core-mt/ffmpeg-core.worker.js', 'vendor/fonts/caveat.woff2'];
    return Promise.all(paths.map(async path => (await fetch(path)).headers.get('Content-Type')));
  });
  expect(mime[0]).toContain('application/wasm');
  expect(mime[1]).toMatch(/javascript/);
  expect(mime[2]).toContain('font/woff2');
});
