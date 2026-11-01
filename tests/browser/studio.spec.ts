import { expect, test, type Page } from '@playwright/test';

async function configure(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Project URL', { exact: true }).fill('https://studio.services.ai.azure.com/api/projects/demo');
  await page.getByLabel('Authorization key', { exact: true }).fill('local-fixture-key');
  await page.getByLabel('Model name', { exact: true }).fill('fixture-model');
  await page.getByLabel('Speech region', { exact: true }).fill('westus2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}
async function interceptServices(page: Page): Promise<void> {
  await page.route('https://**/*', route => route.abort('blockedbyclient'));
}
test.beforeEach(async ({ page }) => {
  await interceptServices(page);
  await page.goto('./');
  await expect(page.locator('#scenes article')).toHaveCount(1);
});
test('one empty local scene, unavailable catalogs and explicit video gates', async ({ page }) => {
  await expect(page.getByLabel('Script', { exact: true })).toHaveValue('');
  await expect(page.locator('[data-voice]')).toBeDisabled();
  await expect(page.locator('[data-avatar]')).toBeDisabled();
  await expect(page.getByLabel('Virtual trainer', { exact: true })).toBeChecked();
  await expect(page.locator('.toolbar select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  for (const produce of await page.getByRole('button', { name: 'Produce', exact: true }).all()) await expect(produce).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete scene', exact: true })).toBeDisabled();
  await expect(page.getByText('No assembled video yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
});
test('local scripts survive configuration cancel and only project/model persist', async ({ page }) => {
  await page.getByLabel('Script', { exact: true }).fill('My private scene.');
  await configure(page);
  const stored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
  expect(JSON.stringify(stored)).toContain('fixture-model');
  expect(JSON.stringify(stored)).not.toContain('local-fixture-key');
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Model name', { exact: true }).fill('discarded');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Script', { exact: true })).toHaveValue('My private scene.');
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await expect(page.getByLabel('Model name', { exact: true })).toHaveValue('fixture-model');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Configuration', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.locator('#scenes article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await expect(page.getByLabel('Authorization key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Project URL', { exact: true })).toHaveValue('https://studio.services.ai.azure.com/api/projects/demo');
});
test('20 scene limit, order and nonempty deletion confirmation', async ({ page }) => {
  await page.getByLabel('Script', { exact: true }).fill('First scene');
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await page.getByLabel('Script', { exact: true }).nth(1).fill('Second scene');
  await page.getByRole('button', { name: 'Move up', exact: true }).nth(1).click();
  await expect(page.getByLabel('Script', { exact: true }).nth(0)).toHaveValue('Second scene');
  await page.getByRole('button', { name: 'Delete scene', exact: true }).nth(0).click();
  await expect(page.getByRole('dialog', { name: 'Delete scene?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#scenes article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete scene', exact: true }).nth(0).click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#scenes article')).toHaveCount(1);
  await expect(page.getByLabel('Script', { exact: true })).toHaveValue('First scene');
  for (let count = 1; count < 20; count++) await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  await expect(page.locator('#scenes article')).toHaveCount(20);
  await expect(page.getByRole('button', { name: '+ Add scene', exact: true })).toBeDisabled();
});
test('local attachment validation and privacy cancel never transmit', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/openai/v1/responses')) requests++; });
  await configure(page);
  await page.locator('#attachments').setInputFiles({ name: 'outline.md', mimeType: 'text/markdown', buffer: Buffer.from('Reference facts') });
  await expect(page.locator('#attachment-list')).toContainText('outline.md');
  await page.locator('#attachments').setInputFiles({ name: 'bad.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('not allowed') });
  await expect(page.locator('#attachment-list')).not.toContainText('bad.bin');
  await page.getByLabel('Describe your video', { exact: true }).fill('Explain the reference.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Send to Foundry?' })).toContainText('store: true');
  await expect(page.locator('#confirm-text')).toContainText('https://learn.microsoft.com/api/mcp');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(requests).toBe(0);
  await expect(page.getByLabel('Describe your video', { exact: true })).toHaveValue('Explain the reference.');
});
test('decoded local background retained but excluded in conceptual mode', async ({ page }) => {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const png = Buffer.from(base64, 'base64');
  await page.locator('input[type=file][accept=".jpg,.jpeg,.png"]').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.media-canvas img')).toHaveCount(1);
  await page.getByLabel('Conceptual animation', { exact: true }).check();
  await expect(page.locator('.media-canvas img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload background', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove background', exact: true })).toBeDisabled();
  await page.getByLabel('Virtual trainer', { exact: true }).check();
  await expect(page.locator('.media-canvas img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove background', exact: true }).click();
  await expect(page.locator('.media-canvas img')).toHaveCount(0);
});
test('responsive drawer preserves unsent prompt and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Research & write', exact: true }).click();
  await expect(page.locator('#chat-panel')).toHaveAttribute('aria-modal', 'true');
  await page.getByLabel('Describe your video', { exact: true }).fill('Keep this unsent.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#chat-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Research & write', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Research & write', exact: true }).click();
  await expect(page.getByLabel('Describe your video', { exact: true })).toHaveValue('Keep this unsent.');
});
test('first Generate requests billable consent and cancel prevents network', async ({ page }) => {
  let calls = 0;
  page.on('request', request => { if (request.method() !== 'GET' && request.url().startsWith('https://')) calls++; });
  await page.route('**/tts/cognitiveservices/voices/list', route => route.fulfill({ json: [{ ShortName: 'en-US-AvaMultilingualNeural', DisplayName: 'Ava', Locale: 'en-US' }] }));
  await configure(page);
  await expect(page.locator('[data-voice]')).toBeEnabled();
  await page.getByLabel('Script', { exact: true }).fill('Hello world.');
  await page.getByLabel('Conceptual animation', { exact: true }).check();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Generate this scene?' })).toContainText('billable');
  await page.locator('#confirm-cancel').click();
  expect(calls).toBe(0);
});
test('clear settings confirms and retains local scene work', async ({ page }) => {
  await page.getByLabel('Script', { exact: true }).fill('Keep my narration.');
  await configure(page);
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Clear settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Clear settings?' })).toContainText('Scene edits and local files are retained');
  await page.locator('#confirm-accept').click();
  await expect(page.getByLabel('Script', { exact: true })).toHaveValue('Keep my narration.');
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await expect(page.getByLabel('Project URL', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Authorization key', { exact: true })).toHaveValue('');
  const stored = await page.evaluate(() => localStorage.getItem('syntasia.config.v1'));
  expect(stored).toBeNull();
});
test('SSML conversion requires a real loaded voice and preserves plain text on failure', async ({ page }) => {
  await page.getByLabel('Script', { exact: true }).fill('Plain <text> & punctuation.');
  await page.getByLabel('Use Speech Synthesis Markup Language (SSML)', { exact: true }).click();
  await expect(page.getByLabel('Use Speech Synthesis Markup Language (SSML)', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Script', { exact: true })).toHaveValue('Plain <text> & punctuation.');
  await expect(page.locator('#status')).toContainText('voice');
});
test('a renamed non-image cannot become a local background', async ({ page }) => {
  await page.locator('input[type=file][accept=".jpg,.jpeg,.png"]').setInputFiles({ name: 'renamed.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"/>') });
  await expect(page.locator('#status')).toContainText('decoded file type');
  await expect(page.locator('.media-canvas img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove background', exact: true })).toBeDisabled();
});
