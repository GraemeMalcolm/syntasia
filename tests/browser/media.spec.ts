import { test, expect } from '@playwright/test';

test('real browser encodes and concatenates two 1080p H.264/AAC scenes without Azure', async ({ page }) => {
  test.setTimeout(240000);
  page.on('pageerror', error => console.error(error.message));
  await page.route('https://**/*', route => route.abort('blockedbyclient'));
  await page.goto('./');
  await expect(page.locator('#scenes article')).toHaveCount(1);
  await expect(page.locator('#browser-status')).not.toHaveText('Checking…');
  console.log(await page.locator('#browser-status').textContent());
  const result = await page.evaluate(async () => {
    const production = await import('/syntasia/src/production.ts');
    const signal = new AbortController().signal;
    const fixture = await production.smokeFixture(signal, () => {});
    const final = await production.concatenate([fixture, fixture], signal, () => {});
    const url = URL.createObjectURL(final.blob);
    const video = document.createElement('video');
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Browser could not decode final MP4'));
    });
    const metadata = { width: video.videoWidth, height: video.videoHeight, duration: final.duration, bytes: final.blob.size };
    URL.revokeObjectURL(url);
    return metadata;
  });
  expect(result.width).toBe(1920);
  expect(result.height).toBe(1080);
  expect(result.bytes).toBeGreaterThan(1000);
  expect(Math.abs(result.duration - 1.6)).toBeLessThanOrEqual(0.1);
});
