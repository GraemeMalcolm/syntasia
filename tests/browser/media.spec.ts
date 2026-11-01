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

test('embedded avatar subtitles emitted by FFmpeg retain short-form WebVTT timing through normalization', async ({ page }) => {
  test.setTimeout(240000);
  await page.route('https://**/*', route => route.abort('blockedbyclient'));
  await page.goto('./');
  await expect(page.locator('#browser-status')).toContainText('pipeline fixture: passed');
  const result = await page.evaluate(async () => {
    const production = await import('/syntasia/src/production.ts');
    const { FFmpeg } = await import('/syntasia/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
    const signal = new AbortController().signal;
    const fixture = await production.smokeFixture(signal, () => {});
    const ffmpeg = new FFmpeg();
    try {
      const base = new URL('/syntasia/vendor/', location.origin).href;
      await ffmpeg.load({ classWorkerURL: `${base}ffmpeg/worker.js`, coreURL: `${base}core/ffmpeg-core.js`, wasmURL: `${base}core/ffmpeg-core.wasm` });
      await ffmpeg.writeFile('clip.mp4', new Uint8Array(await fixture.blob.arrayBuffer()));
      await ffmpeg.writeFile('captions.srt', new TextEncoder().encode('1\n00:00:00,100 --> 00:00:00,600\nHello from embedded subtitles.\n'));
      const mux = await ffmpeg.exec(['-i', 'clip.mp4', '-i', 'captions.srt', '-map', '0:v:0', '-map', '0:a:0', '-map', '1:s:0',
        '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', 'avatar.mp4']);
      if (mux !== 0) throw new Error(`Subtitle fixture mux failed: ${mux}`);
      const extract = await ffmpeg.exec(['-i', 'avatar.mp4', '-map', '0:s:0', '-f', 'webvtt', 'captions.vtt']);
      if (extract !== 0) throw new Error(`Subtitle fixture extraction failed: ${extract}`);
      const vtt = await ffmpeg.readFile('captions.vtt', 'utf8');
      const bytes = await ffmpeg.readFile('avatar.mp4');
      if (typeof bytes === 'string') throw new Error('Subtitle fixture MP4 is not binary.');
      const avatar = new Blob([bytes], { type: 'video/mp4' });
      ffmpeg.terminate();
      const normalized = await production.normalizeAvatar(avatar, undefined, signal, () => {});
      const { webVtt } = await import('/syntasia/src/transcript.ts');
      return { vtt, cues: normalized.cues, duration: normalized.duration,
        transcript: webVtt([{ text: 'Hello from embedded subtitles.', duration: normalized.duration, cues: normalized.cues }]) };
    } finally { ffmpeg.terminate(); }
  });
  expect(result.vtt).toContain('00:00.100 --> 00:00.600');
  expect(result.cues).toEqual([{ start: 0.1, end: 0.6, text: 'Hello from embedded subtitles.' }]);
  expect(result.duration).toBeGreaterThanOrEqual(0.6);
  expect(result.transcript).toContain('00:00:00.100 --> 00:00:00.600');
  expect(result.transcript).not.toContain('Approximate timing');
});

test('local font layout keeps full labels inside the frame at a readable size', async ({ page }) => {
  await page.route('https://**/*', route => route.abort('blockedbyclient'));
  await page.goto('./');
  await expect(page.locator('#browser-status')).toContainText('pipeline fixture: passed');
  const results = await page.evaluate(async () => {
    const animation = await import('/syntasia/src/animation.ts');
    const signal = new AbortController().signal;
    const labels = [
      { text: 'W'.repeat(100), x: 1910, y: 0, size: 100 },
      { text: 'gyp descenders near the bottom', x: 0, y: 1080, size: 50 },
      { text: '界'.repeat(100), x: 1910, y: 1080, size: 100 },
      { text: 'i'.repeat(30), x: 1600, y: 400, size: 28 },
    ];
    const results = [];
    for (const label of labels) {
      const source = { ...label, kind: 'text', color: '#17233b', start: 0, end: 1 };
      const plan = animation.validatePlan({ version: 1, elements: [source] }, 1);
      const snapshot = JSON.stringify(plan);
      const layout = await animation.fitPlanText(plan, signal);
      const item = layout.elements[0];
      if (item.kind !== 'text') throw new Error('Expected a fitted text label.');
      const png = await animation.framePng(layout, 1, signal);
      const image = await createImageBitmap(new Blob([png], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0); image.close();
      const pixels = context.getImageData(0, 0, 1920, 1080).data;
      let minX = 1920, minY = 1080, maxX = -1, maxY = -1;
      for (let pixel = 0; pixel < 1920 * 1080; pixel++) {
        if (pixels[pixel * 4] > 245 && pixels[pixel * 4 + 1] > 245 && pixels[pixel * 4 + 2] > 245) continue;
        const x = pixel % 1920, y = Math.floor(pixel / 1920);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      results.push({ original: label, text: item.text, renderedText: item.lines.join(''), lines: item.lines.length,
        x: item.x, size: item.size, start: item.start, end: item.end, unchanged: JSON.stringify(plan) === snapshot,
        minX, minY, maxX, maxY });
    }
    return results;
  });
  for (const result of results) {
    expect(result.text).toBe(result.original.text);
    expect(result.renderedText).toBe(result.original.text);
    expect(result.unchanged).toBe(true);
    expect(result.size).toBeGreaterThanOrEqual(28);
    expect(result.size).toBeLessThanOrEqual(result.original.size);
    expect(result).toMatchObject({ start: 0, end: 1 });
    expect(result.maxX).toBeGreaterThanOrEqual(result.minX);
    expect(result.minX).toBeGreaterThanOrEqual(23);
    expect(result.minY).toBeGreaterThanOrEqual(23);
    expect(result.maxX).toBeLessThan(1897);
    expect(result.maxY).toBeLessThan(1057);
  }
  expect(results[2].lines).toBeGreaterThan(1);
  expect(results[3]).toMatchObject({ x: 1600, size: 28 });
});
