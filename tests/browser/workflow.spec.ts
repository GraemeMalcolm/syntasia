import { expect, test, type Page } from '@playwright/test';
function wav(): Buffer {
  const samples = 19200;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(96000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 48000) * 2000), 44 + i * 2);
  return buffer;
}
async function configure(page: Page) {
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Project URL', { exact: true }).fill('https://studio.services.ai.azure.com/api/projects/demo');
  await page.getByLabel('Authorization key', { exact: true }).fill('local-fixture-key');
  await page.getByLabel('Model name', { exact: true }).fill('fixture-model');
  await page.locator('summary').click();
  await page.getByLabel('Speech region override').fill('westus2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}
async function fixtures(page: Page) {
  const requests: Record<string, unknown>[] = [];
  let holdPlan = false;
  let releasePlan: (() => void) | undefined;
  let id = 0;
  await page.route('https://**/*', async route => {
    const url = route.request().url();
    if (url === 'https://studio.cognitiveservices.azure.com/tts/cognitiveservices/voices/list') {
      await route.fulfill({ json: [{ ShortName: 'en-US-AvaMultilingualNeural', DisplayName: 'Ava', Locale: 'en-US' }] });
    } else if (url === 'https://studio.cognitiveservices.azure.com/tts/cognitiveservices/v1') {
      expect(route.request().headers()['ocp-apim-subscription-key']).toBe('local-fixture-key');
      expect(route.request().postData()).toContain('en-US-AvaMultilingualNeural');
      await route.fulfill({ contentType: 'audio/wav', body: wav() });
    } else if (url === 'https://studio.services.ai.azure.com/openai/v1/responses') {
      expect(route.request().headers()['api-key']).toBe('local-fixture-key');
      const body = route.request().postDataJSON();
      requests.push(body);
      expect(JSON.stringify(body)).not.toContain('local-fixture-key');
      const isPlan = body.instructions.includes('declarative animation plan');
      if (isPlan && holdPlan) {
        holdPlan = false;
        await new Promise<void>(resolve => { releasePlan = resolve; });
      }
      const text = isPlan ? JSON.stringify({ version: 1, elements: [
        { kind: 'rect', x: 100, y: 100, width: 300, height: 200, color: '#5271ff', start: 0, end: 0.2 },
        { kind: 'text', x: 120, y: 200, text: 'Hello', size: 50, color: '#17233b', start: 0, end: 0.2 },
      ] }) : JSON.stringify({ narration: 'Hello from a researched fixture.', sources: body.tools.length ? [{ title: 'Learn fixture', url: 'https://learn.microsoft.com/azure/' }] : [] });
      const response = { id: `fixture-${++id}`, status: 'completed', output: [
        ...(body.tools.length ? [{ type: 'web_search_call', status: 'completed' }, { type: 'mcp_call', server_label: 'microsoft_learn', output: 'Mocked Learn results: https://learn.microsoft.com/azure/', error: null }] : []),
        { type: 'message', content: [{ type: 'output_text', text }] },
      ] };
      try {
        await route.fulfill(body.stream ? { contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'response.completed', response })}\n\n` } : { json: response });
      } catch { /* Canceled client requests cannot consume late mock responses. */ }
    } else await route.abort('blockedbyclient');
  });
  return { requests, hold: () => { holdPlan = true; }, release: () => { releasePlan?.(); } };
}
test('mocked researched streaming targets one scene and preserves completed response continuity', async ({ page }) => {
  const service = await fixtures(page);
  await page.goto('./');
  await expect(page.locator('#scenes article')).toHaveCount(1);
  await configure(page);
  await page.getByRole('button', { name: '+ Add scene', exact: true }).click();
  for (let turn = 0; turn < 2; turn++) {
    await page.getByLabel('Describe your video', { exact: true }).fill('Explain Azure.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('#confirm-accept').click();
    await expect(page.locator('[data-draft-index]')).toHaveCount(turn + 1);
  }
  expect(service.requests[0].previous_response_id).toBeUndefined();
  expect(service.requests[1].previous_response_id).toBe('fixture-1');
  await page.locator('[data-draft-index]').nth(1).click();
  await expect(page.getByLabel('Script', { exact: true }).nth(0)).toHaveValue('');
  await expect(page.getByLabel('Script', { exact: true }).nth(1)).toHaveValue('Hello from a researched fixture.');
  await expect(page.locator('[data-draft-index]').nth(0)).toBeDisabled();
  await page.getByLabel('Describe your video', { exact: true }).fill('Explain Azure again.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('[data-draft-index]')).toHaveCount(3);
  await page.getByLabel('Script', { exact: true }).nth(1).fill('Manual edits win.');
  await expect(page.locator('[data-draft-index]').nth(2)).toBeDisabled();
});
test('real local animation production locks inputs, cancels late results, validates MP4/VTT and invalidates downloads', async ({ page }) => {
  const service = await fixtures(page);
  await page.goto('./');
  await expect(page.locator('#scenes article')).toHaveCount(1);
  await expect(page.locator('#browser-status')).toContainText('pipeline fixture: passed');
  await configure(page);
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#responses-status')).toContainText('Inference request completed');
  await page.getByRole('button', { name: 'Load Speech voices', exact: true }).click();
  await expect(page.locator('#speech-status')).toContainText('1 voices returned');
  await page.locator('#config-cancel').click();
  await page.getByLabel('Script', { exact: true }).fill('Hello world.');
  await page.getByLabel('Conceptual animation', { exact: true }).check();
  await expect(page.locator('#produce')).toBeDisabled();
  await page.getByRole('button', { name: 'Preview speech', exact: true }).click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('#produce')).toBeEnabled();
  service.hold();
  await page.locator('#produce').click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#production-status')).toContainText('Designing');
  for (const selector of ['#configuration', '#voice', '#avatar', '#add-scene', '#send', '#prompt', '#target', '#attachments', '#scenes textarea', '#scenes input', '#scenes [data-generate]']) {
    for (const control of await page.locator(selector).all()) await expect(control).toBeDisabled();
  }
  await expect(page.locator('#cancel-production')).toBeEnabled();
  await page.locator('#cancel-production').click();
  await expect(page.locator('#production-status')).toContainText('canceled');
  service.release();
  await expect(page.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
  await expect(page.locator('#configuration')).toBeEnabled();
  await expect(page.locator('#scenes textarea')).toBeEnabled();
  await page.locator('#produce').click();
  await page.locator('#confirm-accept').click();
  await expect(page.getByRole('link', { name: 'Download MP4' })).toBeVisible();
  const validation = await page.evaluate(async () => {
    const video = document.querySelector<HTMLVideoElement>('#output video')!;
    await new Promise<void>(resolve => video.readyState >= 2 ? resolve() : video.addEventListener('loadeddata', () => resolve(), { once: true }));
    const link = [...document.querySelectorAll<HTMLAnchorElement>('#output a')].find(a => a.textContent === 'Download VTT')!;
    const text = await (await fetch(link.href)).text();
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, vtt: text, filename: link.download };
  });
  expect(validation).toMatchObject({ width: 1920, height: 1080 });
  expect(Math.abs(validation.duration - 0.4)).toBeLessThanOrEqual(0.1);
  expect(validation.vtt).toContain('WEBVTT');
  expect(validation.vtt).toContain('Approximate timing for scenes 1');
  expect(validation.vtt).toContain('Hello world.');
  expect(validation.filename).toMatch(/^syntasia-.*\.vtt$/);
  await page.getByLabel('Script', { exact: true }).fill('Changed narration.');
  await expect(page.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
  await expect(page.locator('.scene-status')).toContainText('stale');
});
