// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig, clearSettings, loadSettings, resourceOrigin } from './configuration';
import { FoundryClient, buildRequest, readSse } from './foundry';
import { readAttachments, validateBudget } from './chat';
import { availableAvatars, avatarEndpoint, avatarRequest, avatarVideo, validateOutputUrl } from './avatar';
import { AVATARS } from './types';
import { toSsml, validateSsml, spokenText } from './ssml';
import { parseServiceVtt, validateCues, webVtt } from './transcript';
import { validateMetadata } from './production';
import { addScene, moveScene, deleteScene } from './scenes';
import { createState } from './state';
const config = normalizeConfig({ projectUrl: 'https://studio.services.ai.azure.com/api/projects/demo', key: 'fixture-key', model: 'fixture', speechRegion: 'westus2' });
const voice = { id: 'en-US-AvaMultilingualNeural', name: 'Ava', locale: 'en-US' };
const source = { title: 'Learn', url: 'https://learn.microsoft.com/azure/' };
const options = { prompt: 'Explain Azure.', script: '', ssml: false, editorial: false, microsoft: true, attachments: [], sources: [], signal: new AbortController().signal };
const output = (id: string, tools: unknown[] = [], narration = 'A spoken draft.') => ({
  id, status: 'completed', output: [...tools, { type: 'message', content: [{
    type: 'output_text', text: JSON.stringify({ narration, sources: [source] }), annotations: [{ type: 'url_citation', url: 'https://example.org/', title: 'Annotated source' }],
  }] }],
});
const tools = [{ type: 'web_search_call', status: 'completed' }, { type: 'mcp_call', server_label: 'microsoft_learn', output: 'Verified Learn search output.', error: null }];
function mockFetch(...results: unknown[]) {
  return vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(results.shift()), { headers: { 'Content-Type': 'application/json' } })));
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Foundry research and continuity', () => {
  it('verifies real tool outputs, preserves annotations and advances only validated completed turns', async () => {
    mockFetch(output('one', tools), output('two', tools));
    const client = new FoundryClient(config);
    const draft = await client.generate(options);
    expect(draft.researched).toBe(true);
    expect(draft.sources).toContainEqual({ title: 'Annotated source', url: 'https://example.org/' });
    await client.generate(options);
    const fetchMock = vi.mocked(fetch);
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(call[1]!.body as string));
    expect(bodies[0].previous_response_id).toBeUndefined();
    expect(bodies[1].previous_response_id).toBe('one');
    expect(JSON.stringify(bodies)).not.toContain('fixture-key');
    expect(bodies[0].tools[0].server_url).toBe('https://learn.microsoft.com/api/mcp');
    expect(bodies[0].tools[0].require_approval).toBe('never');
  });
  it('bounds missing-tool research to two followups and never treats tool_choice as proof', async () => {
    mockFetch(output('one'), output('two'), output('three'), output('four', tools));
    const client = new FoundryClient(config);
    expect(await client.generate(options)).toMatchObject({ researched: false, editorial: false });
    expect(fetch).toHaveBeenCalledTimes(3);
    await client.generate(options);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[3][1]!.body as string).previous_response_id).toBeUndefined();
  });
  it('tool failure retains a clearly unresearched draft without automatic billable retries', async () => {
    mockFetch(output('failed-tool', [{ type: 'web_search_call', status: 'failed', error: { message: 'Unavailable' } }]));
    expect(await new FoundryClient(config).generate(options)).toMatchObject({ researched: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('unrelated topics do not require Learn; editorial sends no tools and retains only applicable provenance', async () => {
    mockFetch(output('web', [tools[0]]), output('editorial'));
    const client = new FoundryClient(config);
    expect((await client.generate({ ...options, microsoft: false })).researched).toBe(true);
    const draft = await client.generate({ ...options, script: 'Existing draft.', editorial: true, sources: [source] });
    expect(draft).toMatchObject({ editorial: true, researched: false, sources: [source] });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).tools).toEqual([]);
  });
  it('reset, failed response, invalid model data and cancellation never create a new conversation chain', async () => {
    mockFetch(output('one', tools), { ...output('bad', tools), status: 'incomplete' }, output('after-reset', tools));
    const client = new FoundryClient(config);
    await client.generate(options);
    await expect(client.generate(options)).rejects.toThrow();
    client.reset();
    await client.generate(options);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string).previous_response_id).toBeUndefined();
    const abort = new AbortController(); abort.abort();
    await expect(client.generate({ ...options, signal: abort.signal })).rejects.toThrow();
  });
  it('streaming parity includes store:true and forbids partial/malformed/error completion', async () => {
    expect(buildRequest(config, 'data', 'rules', { stream: true, previous: 'prior' })).toMatchObject({ store: true, stream: true, previous_response_id: 'prior' });
    for (const text of ['data: not-json\n\n', 'data: {"type":"response.failed"}\n\n', 'data: {"type":"response.completed"']) {
      await expect(readSse(new Response(text), options.signal)).rejects.toThrow();
    }
    const controller = new AbortController();
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"part"}\n\n')); } });
    const pending = readSse(new Response(stream), controller.signal, () => controller.abort());
    await expect(pending).rejects.toThrow();
  });
  it('does not accept invented model URLs as research provenance', async () => {
    mockFetch(output('one', tools));
    const draft = await new FoundryClient(config).generate(options);
    expect(draft.sources).not.toContainEqual(source);
    expect(draft.sources).toContainEqual({ title: 'Annotated source', url: 'https://example.org/' });
  });
  it('invalid generated SSML does not advance the completed response chain', async () => {
    mockFetch(output('invalid-ssml', tools), output('valid-next', tools));
    const client = new FoundryClient(config);
    await expect(client.generate({ ...options, ssml: true, script: toSsml('Existing narration.', voice) })).rejects.toThrow();
    await client.generate(options);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).previous_response_id).toBeUndefined();
  });
});
describe('conditional avatar transport', () => {
  const avatar = { id: 'lisa', character: 'lisa', style: 'casual-sitting', label: 'Lisa' };
  it('submits once, polls to completion and downloads only validated output without Speech credentials', async () => {
    vi.useFakeTimers();
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Running' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Succeeded', outputs: { result: 'https://stttssvcprodusw2.blob.core.windows.net/batchsynthesis-output/job/1.mp4?sig=fixture' } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 1])));
    vi.stubGlobal('fetch', mock);
    const pending = avatarVideo(config, 'Narration.', false, voice, avatar, false, new AbortController().signal, () => {});
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).size).toBe(4);
    expect(mock.mock.calls.map(call => call[1].method ?? 'GET')).toEqual(['PUT', 'GET', 'GET', 'GET']);
    expect(mock.mock.calls[3][1].headers).toBeUndefined();
    expect(mock.mock.calls[3][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
  });
  it('rate-limited submission is never blindly retried', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '5' } }));
    vi.stubGlobal('fetch', mock);
    await expect(avatarVideo(config, 'Narration.', false, voice, avatar, false, options.signal, () => {})).rejects.toThrow('HTTP 429');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('throttled polling honors Retry-After and never resubmits a billable job', async () => {
    vi.useFakeTimers();
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 202 }))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '10' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Succeeded', outputs: { result: 'https://stttssvcprodusw2.blob.core.windows.net/batchsynthesis-output/job/1.mp4?sig=fixture' } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 1])));
    vi.stubGlobal('fetch', mock);
    const pending = avatarVideo(config, 'Narration.', false, voice, avatar, false, options.signal, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(mock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9999);
    expect(mock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).size).toBe(4);
    expect(mock.mock.calls.filter(call => call[1].method === 'PUT')).toHaveLength(1);
  });
  it('local cancellation stops polling without claiming remote cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const mock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', mock);
    const pending = avatarVideo(config, 'Narration.', false, voice, avatar, false, controller.signal, () => {});
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(20000);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
describe('input, endpoint and media validation', () => {
  it.each(['https://a.b.services.ai.azure.com', 'https://a.openai.azure.com/api/projects/x', 'https://a.services.ai.azure.com:444/', 'https://a.services.ai.azure.com/#secret', 'https://a.services.ai.azure.com/api/projects/a%2Fb'])('rejects unsupported origin %s', url => {
    expect(() => resourceOrigin(url)).toThrow();
  });
  it('load/clear denial remains session-only and no advanced fields or secrets are restored', () => {
    const saved = JSON.stringify({ projectUrl: config.projectUrl, model: config.model, key: 'must-not-restore', speechRegion: 'westus2' });
    expect(loadSettings({ getItem: () => saved })).toEqual({ projectUrl: config.projectUrl, model: config.model });
    expect(clearSettings({ removeItem: () => { throw new Error('denied'); } })).toBe(false);
    expect(loadSettings({ getItem: () => { throw new Error('denied'); } })).toEqual({ projectUrl: '', model: '' });
  });
  it('rejects oversized, binary and invalid UTF-8 attachments without changing existing references', async () => {
    const fake = (name: string, data: number[]) => ({ name, size: data.length, arrayBuffer: async () => new Uint8Array(data).buffer }) as File;
    expect(await readAttachments([fake('x.md', [65])])).toMatchObject([{ name: 'x.md', text: 'A' }]);
    await expect(readAttachments([fake('x.md', [0xc3, 0x28])])).rejects.toThrow('UTF-8');
    await expect(readAttachments([fake('x.bin', [65])])).rejects.toThrow();
    await expect(readAttachments([fake('x.md', [0])])).rejects.toThrow('binary');
    await expect(readAttachments(Array.from({ length: 11 }, () => fake('x.txt', [65])))).rejects.toThrow();
    expect(() => validateBudget('😀'.repeat(7000))).toThrow('nothing was truncated');
  });
  it('SSML stays single-voice and selected voice is authoritative, external markup is rejected', () => {
    const text = toSsml('Azure & text.', voice);
    expect(validateSsml(text, { ...voice, id: 'en-US-JennyNeural' })).toContain('en-US-JennyNeural');
    expect(() => validateSsml(text.replace('Azure &amp; text.', '<voice name="other">Extra</voice>'))).toThrow();
    expect(() => validateSsml(text.replace('Azure &amp; text.', '<foreignObject>bad</foreignObject>'))).toThrow();
    expect(spokenText(text)).toBe('Azure & text.');
  });
  it('avatar payload honors voice, does not upload local images and gates documented region/output origins', () => {
    const body = avatarRequest('Narration.', false, voice, { id: 'lisa', character: 'lisa', style: 'casual-sitting', label: 'Lisa' }, true);
    expect(body.synthesisConfig).toEqual({ voice: voice.id });
    expect(body.avatarConfig).toMatchObject({ videoFormat: 'webm', videoCodec: 'vp9', backgroundColor: '#FFFFFF00', useBuiltInVoice: false });
    expect(body.avatarConfig).not.toHaveProperty('backgroundImage');
    expect(avatarEndpoint(config, 'syntasia-test')).toContain('?api-version=2024-08-01');
    expect(() => avatarEndpoint({ ...config, speechRegion: '' }, 'syntasia-test')).toThrow();
    expect(validateOutputUrl('https://stttssvcprodusw2.blob.core.windows.net/batchsynthesis-output/job/1.mp4?sig=fixture')).toContain('sig=fixture');
    for (const url of ['https://evil.test/video.mp4', 'https://storage.blob.core.windows.net/video.mp4', 'https://stttssvcprodusw2.blob.core.windows.net.evil.test/batchsynthesis-output/a']) expect(() => validateOutputUrl(url)).toThrow();
  });
  it('contains every documented batch character/style with unique IDs and official previews', () => {
    const fullBody = AVATARS.filter(avatar => !avatar.photoAvatarBaseModel);
    expect(fullBody.map(avatar => `${avatar.character}:${avatar.style ?? ''}`).sort()).toEqual([
      'celine:', 'harry:', 'harry:casual', 'harry:youthful',
      'lisa:business-sitting', 'lisa:business-standing', 'lisa:casual-sitting', 'lisa:coach-sitting', 'lisa:coach-standing',
      'lisa:graceful-sitting', 'lisa:graceful-standing', 'lisa:technical-sitting', 'lisa:technical-standing',
      'lori:casual', 'lori:formal', 'lori:graceful', 'malik:', 'max:business', 'max:casual', 'max:formal',
      'meg:business', 'meg:casual', 'meg:formal', 'nia:', 'rowan:',
    ].sort());
    expect(AVATARS.filter(avatar => avatar.photoAvatarBaseModel).map(avatar => avatar.character).sort()).toEqual([
      'adrian', 'amara', 'amira', 'anika', 'bianca', 'camila', 'carlos', 'clara', 'darius', 'diego',
      'elise', 'farhan', 'faris', 'gabrielle', 'hyejin', 'imran', 'isabella', 'layla', 'liwei', 'ling',
      'marcus', 'matteo', 'rahul', 'rana', 'ren', 'riya', 'sakura', 'simone', 'zayd', 'zoe',
    ].sort());
    expect(AVATARS).toHaveLength(55);
    expect(new Set(AVATARS.map(avatar => avatar.id)).size).toBe(55);
    expect(AVATARS[0].id).toBe('lisa-casual-sitting');
    expect(AVATARS.find(avatar => avatar.id === 'zayd')?.previewUrl).toMatch(/\/zayd-avatar\.png$/);
    expect(AVATARS.filter(avatar => avatar.preview).map(avatar => avatar.id).sort()).toEqual([
      'lisa-business-sitting', 'lisa-business-standing', 'lisa-coach-sitting', 'lisa-coach-standing',
    ]);
    for (const avatar of AVATARS) expect(avatar.previewUrl).toMatch(/^https:\/\/learn\.microsoft\.com\/en-us\/azure\/ai-services\/speech-service\/text-to-speech-avatar\/media\/[a-z-]+\.png$/);
  });
  it('filters unsupported regions and retiring styles at the documented retirement boundary', () => {
    const retirement = Date.parse('2026-12-01T00:00:00Z');
    expect(availableAvatars('westus2', retirement - 1)).toHaveLength(55);
    expect(availableAvatars('westus2', retirement)).toHaveLength(51);
    expect(availableAvatars('australiaeast', retirement - 1)).toEqual([]);
    const retired = AVATARS.filter(avatar => avatar.retiredOn);
    expect(retired.map(avatar => avatar.id).sort()).toEqual([
      'lisa-graceful-sitting', 'lisa-graceful-standing', 'lisa-technical-sitting', 'lisa-technical-standing',
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(retirement - 1);
    for (const avatar of retired) expect(() => avatarRequest('Narration.', false, voice, avatar, false)).not.toThrow();
    vi.setSystemTime(retirement);
    for (const avatar of retired) expect(() => avatarRequest('Narration.', false, voice, avatar, false)).toThrow('retired');
  });
  it('uses standard photo request fields without video-avatar style or customized fields', () => {
    for (const avatar of AVATARS.filter(item => item.photoAvatarBaseModel)) {
      const body = avatarRequest('Narration.', false, voice, avatar, false);
      expect(body.avatarConfig).toMatchObject({
        talkingAvatarCharacter: avatar.character, photoAvatarBaseModel: 'vasa-1', videoFormat: 'mp4',
        videoCodec: 'h264', subtitleType: 'soft_embedded', useBuiltInVoice: false,
      });
      expect(body.avatarConfig).not.toHaveProperty('talkingAvatarStyle');
      expect(body.avatarConfig).not.toHaveProperty('customized');
      expect(body.synthesisConfig).toEqual({ voice: voice.id });
      const transparent = avatarRequest('Narration.', false, voice, avatar, true);
      expect(transparent.avatarConfig).toMatchObject({ videoFormat: 'webm', videoCodec: 'vp9', backgroundColor: '#FFFFFF00' });
    }
  });
  it('sends named video styles but does not invent styles for N/A catalog entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
    for (const avatar of AVATARS.filter(item => !item.photoAvatarBaseModel)) {
      const body = avatarRequest('Narration.', false, voice, avatar, false);
      expect(body.avatarConfig).toMatchObject({ talkingAvatarCharacter: avatar.character, customized: false });
      expect(body.avatarConfig).not.toHaveProperty('photoAvatarBaseModel');
      if (avatar.style) expect(body.avatarConfig).toHaveProperty('talkingAvatarStyle', avatar.style);
      else expect(body.avatarConfig).not.toHaveProperty('talkingAvatarStyle');
    }
  });
  it('validates full encoded profile, duration and VTT positive bounds, exact gaps and approximate offsets', () => {
    const metadata = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' }], format: { duration: '2', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' } };
    expect(validateMetadata(metadata, 2)).toBe(2);
    expect(() => validateMetadata(metadata, 2.2)).toThrow();
    expect(() => validateMetadata({ ...metadata, streams: [{ ...metadata.streams[0], width: 1280 }, metadata.streams[1]] })).toThrow();
    const cues = parseServiceVtt('WEBVTT\n\n1\n00:00:00.200 --> 00:00:01.200\nHello.\n', 2);
    const vtt = webVtt([{ text: 'Hello.', duration: 2, cues }, { text: 'World.', duration: 1 }]);
    expect(vtt).toContain('00:00:00.200 --> 00:00:01.200');
    expect(vtt).toContain('00:00:02.000 --> 00:00:03.000');
    expect(vtt).toContain('Approximate timing for scenes 2');
    expect(() => validateCues([{ start: 1, end: 1, text: 'No.' }], 2)).toThrow();
  });
  it('production state rejects scene reordering/addition/deletion while locked', () => {
    const state = createState(); state.working = true;
    expect(() => addScene(state)).toThrow('locks');
    expect(() => moveScene(state, state.scenes[0].id, 1)).toThrow('locks');
    expect(() => deleteScene(state, state.scenes[0].id)).toThrow('locks');
  });
  it.each([
    ['00:00.200 --> 00:01.200', 0.2, 1.2],
    ['00:00:00.200 --> 00:00:01.200', 0.2, 1.2],
    ['00:00.200 --> 00:00:01.200', 0.2, 1.2],
    ['  00:00.200\t-->\t00:01.200\talign:start  ', 0.2, 1.2],
    ['01:00:00.200 --> 01:00:01.200', 3600.2, 3601.2],
    ['100:00:00.200 --> 100:00:01.200', 360000.2, 360001.2],
  ])('parses valid WebVTT cue timing %s', (timing, start, end) => {
    expect(parseServiceVtt(`WEBVTT\r\n\r\n1\r\n${timing}\r\nHello.\r\n`, end + 1))
      .toEqual([{ start, end, text: 'Hello.' }]);
  });
  it.each(['60:00.000', '00:60.000', '00:60:00.000', '00:00:60.000', '0:01.000',
    '00:01.00', '00:01,000', '-00:01.000', '00:01.000extra'])('rejects invalid WebVTT timestamp %s', timestamp => {
    expect(() => parseServiceVtt(`WEBVTT\n\n00:00.000 --> ${timestamp}\nHello.\n`, 4000))
      .toThrow('Invalid subtitle timestamp.');
  });
  it('preserves actual short-form service timings and scene offsets without accepting invalid cue bounds', () => {
    const cues = parseServiceVtt('WEBVTT\n\n00:00.200 --> 00:01.200\nHello.\n', 2);
    const vtt = webVtt([{ text: 'Hello.', duration: 2, cues }, { text: 'Hello.', duration: 2, cues }]);
    expect(vtt).toContain('00:00:02.200 --> 00:00:03.200');
    expect(vtt).not.toContain('Approximate timing');
    for (const timing of ['00:00.200 --> 00:00.200', '00:01.200 --> 00:00.200', '00:00.000 --> 00:02.001']) {
      expect(() => parseServiceVtt(`WEBVTT\n\n${timing}\nHello.\n`, 2)).toThrow('Transcript cues');
    }
    expect(() => parseServiceVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nFirst.\n\n00:00.900 --> 00:01.500\nSecond.\n', 2))
      .toThrow('Transcript cues');
  });
});
