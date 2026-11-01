// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeConfig, saveSettings, resourceOrigin } from './configuration';
import { toolPolicy, buildRequest, readSse } from './foundry';
import { validatePlan, svgFrame } from './animation';
import { toSsml, spokenText, validateSsml } from './ssml';
import { approximateCues, webVtt } from './transcript';
import { assert1080 } from './production';
import { createState } from './state';
import { addScene, moveScene, deleteScene, invalidateScene } from './scenes';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config = normalizeConfig({ projectUrl: 'https://studio.services.ai.azure.com/api/projects/demo', model: 'demo', key: 'fixture-only-key' });
const voice = { id: 'en-US-AvaMultilingualNeural', name: 'Ava', locale: 'en-US' };
const plan = { version: 1, elements: [{ kind: 'text', text: 'Hello', x: 100, y: 100, size: 50, color: '#5271ff', start: 0, end: 1 }] };
afterEach(() => vi.restoreAllMocks());

describe('settings and requests', () => {
  it('normalizes project and Speech origins without corrupting URL hosts', () => {
    expect(config.responsesOrigin).toBe('https://studio.services.ai.azure.com');
    expect(config.speechOrigin).toBe('https://studio.cognitiveservices.azure.com');
    for (const url of ['http://studio.services.ai.azure.com', 'https://studio.services.ai.azure.com.evil.test',
      'https://studio.services.ai.azure.com/?key=secret', 'https://user:pass@studio.services.ai.azure.com']) {
      expect(() => resourceOrigin(url)).toThrow();
    }
  });
  it('persists only project and model, never credentials', () => {
    const setItem = vi.fn();
    expect(saveSettings(config, { setItem })).toBe(true);
    expect(JSON.parse(setItem.mock.calls[0][1])).toEqual({ projectUrl: config.projectUrl, model: 'demo' });
  });
  it('notifies rather than silently succeeding on storage denial', () => {
    const handler = vi.fn();
    window.addEventListener('syntasia-storage-error', handler);
    expect(saveSettings(config, { setItem: () => { throw new Error('Denied'); } })).toBe(false);
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('syntasia-storage-error', handler);
  });
  it('uses identical tools for streaming/nonstreaming, no tools for editorial edits', () => {
    expect(buildRequest(config, 'input', 'rules', { stream: true }).tools).toEqual(toolPolicy(false));
    expect(buildRequest(config, 'input', 'rules', { stream: false }).tools).toEqual(toolPolicy(false));
    expect(buildRequest(config, 'input', 'rules', { editorial: true }).tools).toEqual([]);
  });
  it('parses split SSE chunks and requires successful completion', async () => {
    const complete = { id: 'response-1', status: 'completed', output: [] };
    const text = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Hi' })}\r\n\r\ndata: ${JSON.stringify({ type: 'response.completed', response: complete })}\r\n\r\n`;
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const onDelta = vi.fn();
    expect(await readSse(new Response(stream), new AbortController().signal, onDelta)).toMatchObject(complete);
    expect(onDelta).toHaveBeenCalledWith('Hi');
    await expect(readSse(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'), new AbortController().signal)).rejects.toThrow();
  });
});

describe('scripts and safe animation', () => {
  it('escapes plain scripts and derives spoken aliases', () => {
    const ssml = toSsml('A < B & C', voice);
    expect(ssml).toContain('&lt;');
    expect(spokenText(ssml)).toBe('A < B & C');
    expect(spokenText(toSsml('X', voice).replace('X', '<sub alias="Azure">AZ</sub>'))).toBe('Azure');
  });
  it('rejects external resources and entities', () => {
    expect(() => validateSsml('<!DOCTYPE speak SYSTEM "https://evil.test"><speak/>')).toThrow();
    expect(() => validateSsml(toSsml('X', voice).replace('X', '<audio src="https://evil.test"/>'))).toThrow();
  });
  it('validates a bounded declarative timeline and rejects code', () => {
    const validated = validatePlan(plan, 1);
    expect(svgFrame(validated, 1, 'data:font/woff2;base64,AAAA')).toContain('Hello');
    expect(svgFrame(validated, 0, 'data:font/woff2;base64,AAAA')).not.toContain('Hello');
    expect(() => validatePlan({ ...plan, script: 'alert(1)' }, 1)).toThrow();
    expect(() => validatePlan(plan, 0.5)).toThrow();
    expect(() => svgFrame(validated, 1, 'https://evil.test/font')).toThrow();
  });
});

describe('timeline and scenes', () => {
  it('allocates approximate cues over actual scene durations and offsets VTT', () => {
    const cues = approximateCues('First sentence. Second sentence.', 4);
    expect(cues[0]).toMatchObject({ start: 0, end: 2 });
    expect(cues[1]).toMatchObject({ start: 2, end: 4 });
    const vtt = webVtt([{ text: 'First.', duration: 4 }, { text: 'Second <script>.', duration: 2 }]);
    expect(vtt).toContain('00:00:04.000 --> 00:00:06.000');
    expect(vtt).toContain('Approximate timing');
    expect(vtt).toContain('&lt;script&gt;');
    expect(() => approximateCues('', 1)).toThrow();
  });
  describe('public isolation worker boundaries', () => {
    function worker() {
      const listeners = new Map<string, (event: { request: Request; respondWith: (response: Promise<Response>) => void }) => void>();
      const network = vi.fn(async () => new Response('public', { headers: { 'Content-Type': 'text/javascript' } }));
      const self = { registration: { scope: 'https://fixture.test/syntasia/' }, clients: { claim: vi.fn() },
        addEventListener: (name: string, listener: (event: { request: Request; respondWith: (response: Promise<Response>) => void }) => void) => listeners.set(name, listener) };
      new Function('self', 'fetch', 'URL', 'Response', 'Headers', readFileSync(join(process.cwd(), 'public', 'coi-serviceworker.js'), 'utf8'))(self, network, URL, Response, Headers);
      return { handler: listeners.get('fetch')!, network };
    }
    it('rewrites only eligible same-origin public assets without caching', async () => {
      const { handler } = worker();
      let response: Promise<Response> | undefined;
      handler({ request: new Request('https://fixture.test/syntasia/assets/app.js'), respondWith: result => { response = result; } });
      expect((await response!).headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    });
    it('does not intercept remote service, range, HEAD, sensitive or outside-scope requests', () => {
      const { handler, network } = worker();
      const requests = [
        new Request('https://studio.services.ai.azure.com/openai/v1/responses', { method: 'POST' }),
        new Request('https://fixture.test/syntasia/assets/app.js', { headers: { Range: 'bytes=0-10' } }),
        new Request('https://fixture.test/syntasia/assets/app.js', { method: 'HEAD' }),
        new Request('https://fixture.test/syntasia/assets/app.js?key=fixture'),
        new Request('https://fixture.test/syntasia/assets/app.js', { headers: { 'api-key': 'fixture' } }),
        new Request('https://fixture.test/other/app.js'),
      ];
      const respondWith = vi.fn();
      for (const request of requests) handler({ request, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    });
  });
  it('keeps identities on reordering and invalidates scene revisions', () => {
    const state = createState();
    const first = state.scenes[0];
    const second = addScene(state);
    moveScene(state, second.id, -1);
    expect(state.scenes[0].id).toBe(second.id);
    invalidateScene(first);
    expect(first.revision).toBe(1);
    deleteScene(state, second.id);
    expect(state.scenes).toEqual([first]);
    expect(() => deleteScene(state, first.id)).toThrow();
  });
  it('accepts only 1080p video with narration', () => {
    const metadata = { streams: [{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }], format: { duration: 2 } };
    expect(assert1080(metadata)).toBe(2);
    expect(() => assert1080({ ...metadata, streams: [{ codec_type: 'video', width: 1280, height: 720 }] })).toThrow();
  });
});
