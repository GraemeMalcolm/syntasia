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
  await expect(page.locator('[data-voice]')).toBeEnabled();
  await expect(page.locator('[data-avatar]')).toBeEnabled();
  await expect(page.locator('[data-avatar]')).toHaveValue('lisa-casual-sitting');
  await expect(page.locator('#status')).toHaveText('Configuration ready.');
  expect(requests).toEqual(['GET https://studio.cognitiveservices.azure.com/tts/cognitiveservices/voices/list']);
  const stored = await page.evaluate(() => localStorage.getItem('syntasia.config.v1'));
  expect(JSON.parse(stored!)).toEqual({ projectUrl: 'https://studio.services.ai.azure.com/api/projects/demo', model: 'fixture-model', speechRegion: 'westus2' });
});
test('avatar changes update only their scene preview and conceptual scenes remain white', async ({ page }) => {
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: voices }));
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-avatar]')).toBeEnabled();
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await page.getByLabel('Conceptual animation', { exact: true }).nth(1).check();
  await page.locator('[data-avatar]').nth(0).selectOption('lori-casual');
  const images = page.locator('.avatar-preview');
  await expect(images).toHaveCount(2);
  await expect(images.nth(0)).toHaveAttribute('src', /\/lori-casual\.png$/);
  await expect(images.nth(1)).toHaveAttribute('src', /\/lisa-casual-sitting\.png$/);
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(image).toHaveJSProperty('naturalWidth', 1);
  }
  await expect(page.locator('.media-canvas').nth(1).locator('img')).toHaveCount(0);
  await page.getByLabel('Virtual trainer', { exact: true }).nth(1).check();
  await expect(page.locator('.avatar-preview')).toHaveCount(3);
  await page.locator('[data-avatar]').nth(0).selectOption('lisa-casual-sitting');
  for (const image of await page.locator('.avatar-preview').all()) await expect(image).toHaveAttribute('src', /\/lisa-casual-sitting\.png$/);
});
test('the complete batch avatar catalog loads automatically with grouped choices and matching previews', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T00:00:00Z') });
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: voices }));
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const select = page.locator('[data-avatar]');
  await expect(select).toBeEnabled();
  await expect(select.locator('optgroup[label="Full-body avatars"] option')).toHaveCount(25);
  await expect(select.locator('optgroup[label="Photo avatars"] option')).toHaveCount(30);
  await expect(select.locator('option')).toHaveCount(56);
  await expect(select.locator('option[value="lisa-business-standing"]')).toContainText('(preview)');
  await expect(select.locator('option[value="lisa-graceful-standing"]')).toContainText('(retires Dec 2026)');
  await expect(select).toHaveValue('lisa-casual-sitting');
  for (const [id, filename] of [
    ['max-business', 'max-business'], ['rowan', 'rowan'], ['harry', 'harry-business'],
    ['anika', 'anika-avatar'], ['zayd', 'zayd-avatar'], ['zoe', 'zoe'],
  ]) {
    await select.selectOption(id);
    await expect(page.locator('.avatar-preview')).toHaveAttribute('src', new RegExp(`/${filename}\\.png$`));
    await expect(page.locator('.avatar-preview')).toHaveJSProperty('naturalWidth', 1);
  }
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue('zoe');
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
    await expect(page.locator('[data-voice]')).toBeDisabled();
    await expect(page.locator('[data-avatar]')).toBeDisabled();
    await expect(page.locator('.avatar-preview')).toHaveCount(0);
    await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-voice]')).toBeEnabled();
    await expect(page.locator('[data-avatar]')).toBeEnabled();
    await expect(page.getByLabel('Script', { exact: true })).toHaveValue('Keep my narration.');
    expect(calls).toBe(2);
  });
}
test('an unsupported region keeps voices available and explains unavailable avatars', async ({ page }) => {
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: voices }));
  await fillConfiguration(page, 'australiaeast');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-voice]')).toBeEnabled();
  await expect(page.locator('[data-avatar]')).toBeDisabled();
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
  await expect(page.locator('[data-voice]')).toHaveValue('en-US-JennyNeural');
  release?.();
  await expect(page.locator('[data-voice] option')).toHaveCount(2);
  await expect(page.locator('[data-voice]')).toHaveValue('en-US-JennyNeural');
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
    await expect(page.locator('[data-voice]')).toBeEnabled();
    await expect(page.locator('[data-avatar]')).toBeEnabled();
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
  await expect(page.locator('[data-voice]')).toBeEnabled();
  await page.locator('[data-voice]').selectOption('en-US-JennyNeural');
  await page.locator('[data-avatar]').selectOption('lori-casual');
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-voice]')).toBeEnabled();
  await expect(page.locator('[data-voice]')).toHaveValue('en-US-JennyNeural');
  await expect(page.locator('[data-avatar]')).toHaveValue('lori-casual');
});
test('failed official preview images show an explicit error without disabling avatar selection', async ({ page }) => {
  await page.route('https://learn.microsoft.com/**', route => route.abort('blockedbyclient'));
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: voices }));
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Could not load the preview image');
  await expect(page.locator('.media-label')).toContainText('Preview image unavailable');
  await expect(page.locator('[data-avatar]')).toBeEnabled();
});
test('scene settings inherit independently, mode gates avatar/background and Save preserves every scene', async ({ page }) => {
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: [
    ...voices, { ShortName: 'en-US-JennyNeural', DisplayName: 'Jenny', Locale: 'en-US' },
  ] }));
  await fillConfiguration(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const first = page.getByRole('article', { name: 'Scene 1', exact: true });
  const second = page.getByRole('article', { name: 'Scene 2', exact: true });
  await expect(first.getByLabel('Voice', { exact: true })).toBeEnabled();
  await expect(page.locator('.toolbar select')).toHaveCount(0);
  await expect(first.getByLabel('Virtual trainer', { exact: true })).toBeChecked();
  await first.getByLabel('Voice', { exact: true }).selectOption('en-US-JennyNeural');
  await first.getByLabel('Avatar', { exact: true }).selectOption('lori-casual');
  await first.getByLabel('Script', { exact: true }).fill('First narration.');
  await first.getByLabel('Use Speech Synthesis Markup Language (SSML)', { exact: true }).check();
  const png = Buffer.from(await page.evaluate(() => document.createElement('canvas').toDataURL('image/png').split(',')[1]), 'base64');
  await first.locator('input[type=file]').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: png });
  const originalBackground = await first.locator('.media-canvas img:not(.avatar-preview)').getAttribute('src');
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await expect(second.getByLabel('Voice', { exact: true })).toHaveValue('en-US-JennyNeural');
  await expect(second.getByLabel('Avatar', { exact: true })).toHaveValue('lori-casual');
  await expect(second.getByLabel('Virtual trainer', { exact: true })).toBeChecked();
  await expect(second.getByLabel('Script', { exact: true })).toHaveValue('');
  const inheritedBackground = await second.locator('.media-canvas img:not(.avatar-preview)').getAttribute('src');
  expect(inheritedBackground).not.toBe(originalBackground);
  await second.getByLabel('Voice', { exact: true }).selectOption(voices[0].ShortName);
  await second.getByLabel('Avatar', { exact: true }).selectOption('anika');
  await second.getByLabel('Script', { exact: true }).fill('Second narration.');
  await second.getByLabel('Use Speech Synthesis Markup Language (SSML)', { exact: true }).check();
  await expect(second.getByLabel('Script', { exact: true })).toHaveValue(/name="en-US-AvaMultilingualNeural"/);
  await expect(first.getByLabel('Script', { exact: true })).toHaveValue(/name="en-US-JennyNeural"/);
  await second.getByLabel('Conceptual animation', { exact: true }).check();
  await expect(second.getByLabel('Avatar', { exact: true })).toBeDisabled();
  await expect(second.getByRole('button', { name: 'Upload background', exact: true })).toBeDisabled();
  await expect(second.getByRole('button', { name: 'Remove background', exact: true })).toBeDisabled();
  await expect(second.getByLabel('Voice', { exact: true })).toBeEnabled();
  await expect(second.locator('.media-canvas img')).toHaveCount(0);
  await expect(first.getByLabel('Avatar', { exact: true })).toBeEnabled();
  await expect(first.getByLabel('Avatar', { exact: true })).toHaveValue('lori-casual');
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  const third = page.getByRole('article', { name: 'Scene 3', exact: true });
  await expect(third.getByLabel('Conceptual animation', { exact: true })).toBeChecked();
  await expect(third.getByLabel('Voice', { exact: true })).toHaveValue(voices[0].ShortName);
  await expect(third.getByLabel('Avatar', { exact: true })).toBeDisabled();
  await third.getByLabel('Virtual trainer', { exact: true }).check();
  await expect(third.getByLabel('Avatar', { exact: true })).toHaveValue('anika');
  await expect(third.locator('.media-canvas img:not(.avatar-preview)')).toHaveCount(1);
  await first.getByRole('button', { name: 'Remove background', exact: true }).click();
  expect(await page.evaluate(async url => (await fetch(url!)).ok, inheritedBackground)).toBe(true);
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(first.getByLabel('Voice', { exact: true })).toBeEnabled();
  await expect(first.getByLabel('Voice', { exact: true })).toHaveValue('en-US-JennyNeural');
  await expect(second.getByLabel('Voice', { exact: true })).toHaveValue(voices[0].ShortName);
  await expect(second.getByLabel('Conceptual animation', { exact: true })).toBeChecked();
  await expect(third.getByLabel('Avatar', { exact: true })).toHaveValue('anika');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
