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
