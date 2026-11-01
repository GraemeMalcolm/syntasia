import { expect, test, type Page } from '@playwright/test';

const voices = [{ ShortName: 'en-US-AvaMultilingualNeural', DisplayName: 'Ava', Locale: 'en-US' }];
async function fillConfiguration(page: Page, region = 'westus2'): Promise<void> {
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Project URL', { exact: true }).fill('https://studio.services.ai.azure.com/api/projects/demo');
  await page.getByLabel('Authorization key', { exact: true }).fill('fixture-key');
  await page.getByLabel('Model name', { exact: true }).fill('fixture-model');
  await page.getByLabel('Speech region', { exact: true }).fill(region);
}
test.beforeEach(async ({ page }) => {
  const preview = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.route('https://**/*', route => route.abort('blockedbyclient'));
  await page.route('https://learn.microsoft.com/**', route => route.fulfill({
    contentType: 'image/png', body: preview, headers: { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' },
  }));
  await page.goto('./');
  await expect(page.locator('#scenes article')).toHaveCount(1);
});
test('compact configuration requires region and automatically enables choices without billable requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://studio.')) requests.push(`${request.method()} ${request.url()}`); });
  await page.route('**/tts/cognitiveservices/voices/list', route => {
    expect(route.request().headers()['ocp-apim-subscription-key']).toBe('fixture-key');
    return route.fulfill({ json: voices });
  });
  await fillConfiguration(page, '');
  const dialog = page.locator('#config-dialog');
  await expect(dialog.locator('button')).toHaveCount(4);
  await expect(dialog.locator('.notice, table, small')).toHaveCount(0);
  const cancelBox = await page.locator('#config-cancel').boundingBox();
  const saveBox = await dialog.getByRole('button', { name: 'Save', exact: true }).boundingBox();
  expect(cancelBox!.y).toBe(saveBox!.y);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByLabel('Speech region', { exact: true }).fill('WestUS2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#voice')).toBeEnabled();
  await expect(page.locator('#avatar')).toBeEnabled();
  await expect(page.locator('#avatar')).toHaveValue('lisa-casual-sitting');
  await expect(page.locator('#status')).toHaveText('Configuration ready.');
  expect(requests).toEqual(['GET https://studio.cognitiveservices.azure.com/tts/cognitiveservices/voices/list']);
  const stored = await page.evaluate(() => localStorage.getItem('syntasia.config.v1'));
  expect(JSON.parse(stored!)).toEqual({ projectUrl: 'https://studio.services.ai.azure.com/api/projects/demo', model: 'fixture-model' });
});
test('avatar changes update every empty avatar preview but not conceptual scenes', async ({ page }) => {
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: voices }));
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#avatar')).toBeEnabled();
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await page.getByLabel('Conceptual animation', { exact: true }).nth(1).check();
  await page.locator('#avatar').selectOption('lori-casual');
  const images = page.locator('.avatar-preview');
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute('src', /\/lori-casual\.png$/);
    await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(image).toHaveJSProperty('naturalWidth', 1);
  }
  await expect(page.locator('.media-canvas').nth(1).locator('img')).toHaveCount(0);
  await page.getByLabel('Conceptual animation', { exact: true }).nth(1).uncheck();
  await expect(page.locator('.avatar-preview')).toHaveCount(3);
  await page.locator('#avatar').selectOption('lisa-casual-sitting');
  for (const image of await page.locator('.avatar-preview').all()) await expect(image).toHaveAttribute('src', /\/lisa-casual-sitting\.png$/);
});
for (const failure of ['unauthorized', 'empty', 'malformed'] as const) {
  test(`voice catalog ${failure} is visible and Save retries without resetting local narration`, async ({ page }) => {
    let calls = 0;
    await page.route('https://learn.microsoft.com/**', route => route.abort('blockedbyclient'));
    await page.route('**/tts/cognitiveservices/voices/list', route => {
      calls++;
      return route.fulfill(calls > 1 ? { json: voices } : failure === 'unauthorized' ? { status: 401, body: 'Unauthorized' } : { json: failure === 'empty' ? [] : [{}] });
    });
    await page.getByLabel('Script', { exact: true }).fill('Keep my narration.');
    await fillConfiguration(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Could not load voices');
    await expect(page.locator('#voice')).toBeDisabled();
    await expect(page.locator('#avatar')).toBeDisabled();
    await expect(page.locator('.avatar-preview')).toHaveCount(0);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#voice')).toBeEnabled();
    await expect(page.locator('#avatar')).toBeEnabled();
    await expect(page.getByLabel('Script', { exact: true })).toHaveValue('Keep my narration.');
    expect(calls).toBe(2);
  });
}
test('an unsupported region keeps voices available and explains unavailable avatars', async ({ page }) => {
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: voices }));
  await fillConfiguration(page, 'australiaeast');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#voice')).toBeEnabled();
  await expect(page.locator('#avatar')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Avatars are not supported in australiaeast');
});
test('late voice loading cannot overwrite newer configuration', async ({ page }) => {
  let release: (() => void) | undefined;
  let started = false;
  await page.route('**/tts/cognitiveservices/voices/list', async route => {
    if (route.request().headers()['ocp-apim-subscription-key'] === 'fixture-key') {
      started = true;
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: voices }).catch(() => { /* The old request was canceled. */ });
    } else {
      await route.fulfill({ json: [{ ShortName: 'en-US-JennyNeural', DisplayName: 'Jenny', Locale: 'en-US' }] });
    }
  });
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Authorization key', { exact: true }).fill('new-fixture-key');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#voice')).toHaveValue('en-US-JennyNeural');
  release?.();
  await expect(page.locator('#voice option')).toHaveCount(2);
  await expect(page.locator('#voice')).toHaveValue('en-US-JennyNeural');
});
for (const edit of [false, true]) {
  test(`canceling configuration ${edit ? 'after edits' : 'without edits'} preserves automatic catalog loading`, async ({ page }) => {
    let release: (() => void) | undefined;
    let calls = 0;
    await page.route('**/tts/cognitiveservices/voices/list', async route => {
      calls++;
      if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: voices }).catch(() => { /* Unsaved edits cancel the old request. */ });
    });
    await fillConfiguration(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    if (edit) await page.getByLabel('Authorization key', { exact: true }).fill('discarded-key');
    await page.locator('#config-cancel').click();
    release?.();
    await expect(page.locator('#voice')).toBeEnabled();
    await expect(page.locator('#avatar')).toBeEnabled();
    expect(calls).toBe(edit ? 2 : 1);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(page.getByLabel('Authorization key', { exact: true })).toHaveValue('fixture-key');
  });
}
test('saving unchanged configuration preserves selected voice and avatar', async ({ page }) => {
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: [
    ...voices, { ShortName: 'en-US-JennyNeural', DisplayName: 'Jenny', Locale: 'en-US' },
  ] }));
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#voice')).toBeEnabled();
  await page.locator('#voice').selectOption('en-US-JennyNeural');
  await page.locator('#avatar').selectOption('lori-casual');
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#voice')).toBeEnabled();
  await expect(page.locator('#voice')).toHaveValue('en-US-JennyNeural');
  await expect(page.locator('#avatar')).toHaveValue('lori-casual');
});
test('failed official preview images show an explicit error without disabling avatar selection', async ({ page }) => {
  await page.route('https://learn.microsoft.com/**', route => route.abort('blockedbyclient'));
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: voices }));
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Could not load the preview image');
  await expect(page.locator('.media-label')).toContainText('Preview image unavailable');
  await expect(page.locator('#avatar')).toBeEnabled();
});
