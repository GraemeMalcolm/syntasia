import { FFmpeg } from '@ffmpeg/ffmpeg';
import { z } from 'zod';
import { WIDTH, HEIGHT, FPS } from './types';
import { fitPlanText, framePng, validatePlan } from './animation';
import type { AnimationPlan } from './animation';
import { parseServiceVtt, type Cue } from './transcript';

const budget = 384 * 1024 * 1024;
const metadataSchema = z.object({
  streams: z.array(z.object({
    codec_type: z.string(), codec_name: z.string().optional(),
    width: z.number().optional(), height: z.number().optional(),
    avg_frame_rate: z.string().optional(), sample_rate: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  }).passthrough()),
  format: z.object({ duration: z.coerce.number().finite().positive(), format_name: z.string().optional() }).passthrough(),
}).passthrough();
export interface Media { blob: Blob; duration: number; cues?: Cue[] }
type Status = (text: string) => void;
let encodingThreaded = false;
export function setEncodingPath(threaded: boolean): void { encodingThreaded = threaded; }
export function validateMetadata(value: unknown, expected?: number): number {
  const metadata = metadataSchema.parse(value);
  const duration = assert1080(metadata);
  const video = metadata.streams.find(stream => stream.codec_type === 'video')!;
  const audio = metadata.streams.find(stream => stream.codec_type === 'audio')!;
  const [num, den] = (video.avg_frame_rate ?? '0/1').split('/').map(Number);
  if (video.codec_name !== 'h264' || audio.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000 ||
      num / den !== FPS || !metadata.format.format_name?.split(',').includes('mp4')) throw new Error('Output is not verified 1080p / 30 fps H.264/AAC 48 kHz MP4.');
  if (expected !== undefined && Math.abs(duration - expected) > 0.1) throw new Error('Final duration differs from scene durations by more than 100 ms.');
  return duration;
}

export function assert1080(metadata: z.infer<typeof metadataSchema>): number {
  const video = metadata.streams.find(stream => stream.codec_type === 'video');
  if (!video || video.width !== WIDTH || video.height !== HEIGHT) {
    throw new Error('Video must be exactly 1920 × 1080. Lower-resolution service output is not accepted.');
  }
  if (!metadata.streams.some(stream => stream.codec_type === 'audio')) throw new Error('Video has no narration audio track.');
  return metadata.format.duration;
}

async function engine(signal: AbortSignal, status: Status): Promise<FFmpeg> {
  const ffmpeg = new FFmpeg();
  const threaded = encodingThreaded;
  const abort = () => ffmpeg.terminate();
  signal.addEventListener('abort', abort, { once: true });
  const load = async (folder: string) => {
    const base = new URL(`${import.meta.env.BASE_URL}vendor/${folder}/`, location.origin).href;
    await ffmpeg.load({
      classWorkerURL: new URL(`${import.meta.env.BASE_URL}vendor/ffmpeg/worker.js`, location.origin).href,
      coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm`,
      ...(folder === 'core-mt' ? { workerURL: `${base}ffmpeg-core.worker.js` } : {}),
    }, { signal });
  };
  status(`Loading ${threaded ? 'threaded' : 'single-thread'} 1080p video encoder…`);
  const timer = setTimeout(abort, 30000);
  try { signal.throwIfAborted(); await load(threaded ? 'core-mt' : 'core'); }
  catch { ffmpeg.terminate(); signal.throwIfAborted(); throw new Error('Browser video encoder could not load. Check worker/WASM assets and browser support.'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  return ffmpeg;
}

async function execute(ffmpeg: FFmpeg, args: string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const messages: string[] = [];
  const log = ({ message }: { message: string }) => { messages.push(message); if (messages.length > 10) messages.shift(); };
  ffmpeg.on('log', log);
  let code: number;
  try { code = await ffmpeg.exec(['-xerror', '-threads', '2', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], -1, { signal }); }
  finally { ffmpeg.off('log', log); }
  if (code !== 0) throw new Error(`Video encoding failed (exit ${code}). ${messages.slice(-3).join(' ').slice(0, 500)} Check device memory, codecs and input media.`);
}
async function probe(ffmpeg: FFmpeg, input: string, signal: AbortSignal): Promise<z.infer<typeof metadataSchema>> {
  const messages: string[] = [];
  const log = ({ message }: { message: string }) => { messages.push(message); };
  ffmpeg.on('log', log);
  try {
    try { await ffmpeg.deleteFile('metadata.json', { signal }); } catch { signal.throwIfAborted(); }
    const code = await ffmpeg.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input, '-o', 'metadata.json'], -1, { signal });
    // The pinned core leaves ret=-1 when ffprobe returns normally; require fresh, schema-valid output below.
    if (code !== 0 && code !== -1) {
      throw new Error(`Unable to read media metadata (exit ${code}): ${messages.slice(-3).join(' ').slice(0, 500)}`);
    }
  } finally { ffmpeg.off('log', log); }
  const output = await ffmpeg.readFile('metadata.json', 'utf8', { signal });
  if (typeof output !== 'string') throw new Error('Invalid media metadata.');
  return metadataSchema.parse(JSON.parse(output));
}
async function write(ffmpeg: FFmpeg, name: string, blob: Blob, signal: AbortSignal): Promise<void> {
  if (blob.size > budget) throw new Error('Media exceeds the initial 384 MiB per-operation input budget. Shorten scenes.');
  await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()), { signal });
}
async function result(ffmpeg: FFmpeg, signal: AbortSignal): Promise<Media> {
  const metadata = await probe(ffmpeg, 'output.mp4', signal);
  const duration = validateMetadata(metadata);
  const bytes = await ffmpeg.readFile('output.mp4', 'binary', { signal });
  if (typeof bytes === 'string') throw new Error('Invalid encoded video bytes.');
  const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
  await validatePlayback(blob, signal);
  return { blob, duration };
}
export async function validatePlayback(blob: Blob, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const video = document.createElement('video');
  const url = URL.createObjectURL(blob);
  video.preload = 'auto'; video.muted = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('MP4 playback validation timed out.')), 15000);
      const abort = () => finish(signal.reason ?? new DOMException('Canceled', 'AbortError'));
      const finish = (error?: unknown) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        video.onloadeddata = null; video.onerror = null;
        error ? reject(error) : resolve();
      };
      video.onloadeddata = () => finish();
      video.onerror = () => finish(new Error('Browser could not decode the generated MP4.'));
      signal.addEventListener('abort', abort, { once: true });
      video.src = url; video.load();
      if (signal.aborted) abort();
    });
    if (video.videoWidth !== WIDTH || video.videoHeight !== HEIGHT || !Number.isFinite(video.duration)) throw new Error('Playback dimensions or duration failed validation.');
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
const encoding = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-threads', '2', '-r', String(FPS), '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-movflags', '+faststart'];

async function withEngine<T>(signal: AbortSignal, status: Status, run: (ffmpeg: FFmpeg) => Promise<T>): Promise<T> {
  const ffmpeg = await engine(signal, status);
  const abort = () => ffmpeg.terminate();
  signal.addEventListener('abort', abort, { once: true });
  try { signal.throwIfAborted(); return await run(ffmpeg); }
  finally { signal.removeEventListener('abort', abort); ffmpeg.terminate(); }
}

export async function imageBackground(file: Blob): Promise<Blob> {
  const image = await createImageBitmap(file);
  try {
    if (image.width > 4096 || image.height > 4096) throw new Error('Background dimensions must be at most 4096 pixels.');
    const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    context.fillStyle = 'white'; context.fillRect(0, 0, WIDTH, HEIGHT);
    const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
    context.drawImage(image, (WIDTH - image.width * scale) / 2, (HEIGHT - image.height * scale) / 2, image.width * scale, image.height * scale);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Background image could not be rendered.')), 'image/png'));
  } finally { image.close(); }
}

export async function normalizeAvatar(source: Blob, background: Blob | undefined,
  signal: AbortSignal, status: Status): Promise<Media> {
  return withEngine(signal, status, async ffmpeg => {
    await write(ffmpeg, 'avatar', source, signal);
    const metadata = await probe(ffmpeg, 'avatar', signal);
    const duration = assert1080(metadata);
    if (duration > 300) throw new Error('Avatar scene exceeds the five-minute limit.');
    let cues: Cue[] | undefined;
    if (metadata.streams.some(stream => stream.codec_type === 'subtitle')) {
      await execute(ffmpeg, ['-i', 'avatar', '-map', '0:s:0', '-f', 'webvtt', 'subtitles.vtt'], signal);
      const subtitles = await ffmpeg.readFile('subtitles.vtt', 'utf8', { signal });
      if (typeof subtitles !== 'string') throw new Error('Invalid avatar subtitle output.');
      cues = parseServiceVtt(subtitles, duration);
    }
    if (background) {
      const video = metadata.streams.find(stream => stream.codec_type === 'video');
      if (video?.codec_name !== 'vp9' || video.tags?.alpha_mode !== '1') {
        throw new Error('Speech did not return transparent VP9 video. Custom background cannot be applied safely.');
      }
      if (!await decodedAlpha(ffmpeg, 'avatar', signal)) throw new Error('Actual avatar alpha decoding failed; local background was not used.');
      await write(ffmpeg, 'background.png', background, signal);
      await execute(ffmpeg, [
        '-loop', '1', '-framerate', '30', '-i', 'background.png', '-c:v', 'libvpx-vp9', '-i', 'avatar',
        '-filter_complex', '[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]',
        '-map', '[v]', '-map', '1:a:0', '-t', String(duration), ...encoding, 'output.mp4',
      ], signal);
    } else {
      await execute(ffmpeg, ['-i', 'avatar', '-map', '0:v:0', '-map', '0:a:0', ...encoding, 'output.mp4'], signal);
    }
    status('Verifying 1080p scene…');
    return { ...await result(ffmpeg, signal), ...(cues ? { cues } : {}) };
  });
}

export async function animationVideo(plan: AnimationPlan, audio: Blob, duration: number,
  signal: AbortSignal, status: Status): Promise<Media> {
  if (!(duration > 0) || duration > 300) throw new Error('Narration must be between zero and five minutes.');
  status('Fitting animation labels to the frame…');
  const layout = await fitPlanText(validatePlan(plan, duration), signal);
  return withEngine(signal, status, async ffmpeg => {
    await write(ffmpeg, 'narration.wav', audio, signal);
    const count = Math.ceil(duration * FPS);
    const parts: string[] = [];
    let bytes = audio.size;
    for (let start = 0; start < count; start += FPS) {
      const end = Math.min(start + FPS, count);
      for (let frame = start; frame < end; frame++) {
        const png = await framePng(layout, frame / FPS, signal);
        await ffmpeg.writeFile(`frame-${String(frame - start).padStart(3, '0')}.png`, png, { signal });
      }
      const name = `part-${parts.length}.mp4`;
      await execute(ffmpeg, ['-framerate', '30', '-i', 'frame-%03d.png', '-frames:v', String(end - start), '-an',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '2', '-r', '30', name], signal);
      const encoded = await ffmpeg.readFile(name, 'binary', { signal });
      bytes += encoded.length;
      if (bytes > budget) throw new Error('Animation exceeds the conservative 384 MiB device budget.');
      parts.push(`file '${name}'`);
      for (let frame = start; frame < end; frame++) await ffmpeg.deleteFile(`frame-${String(frame - start).padStart(3, '0')}.png`, { signal });
      status(`Drawing 1080p animation: ${Math.round(end / count * 100)}%`);
    }
    await ffmpeg.writeFile('parts.txt', parts.join('\n'), { signal });
    status('Encoding narrated 1080p animation…');
    await execute(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', 'parts.txt', '-i', 'narration.wav',
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '1',
      '-af', 'apad', '-t', String(count / FPS), '-movflags', '+faststart', 'output.mp4'], signal);
    return result(ffmpeg, signal);
  });
}

export async function concatenate(clips: Media[], signal: AbortSignal, status: Status): Promise<Media> {
  if (!clips.length) throw new Error('Add at least one generated scene.');
  const expected = clips.reduce((sum, clip) => sum + clip.duration, 0);
  if (expected > 1800) throw new Error('Video exceeds the 30-minute ceiling.');
  if (clips.reduce((sum, clip) => sum + clip.blob.size, 0) > budget) throw new Error('Combined clips exceed the initial 384 MiB input budget.');
  return withEngine(signal, status, async ffmpeg => {
    const lines: string[] = [];
    for (let index = 0; index < clips.length; index++) {
      const name = `scene-${index}.mp4`;
      await write(ffmpeg, name, clips[index].blob, signal);
      validateMetadata(await probe(ffmpeg, name, signal), clips[index].duration);
      lines.push(`file '${name}'`);
    }
    await ffmpeg.writeFile('scenes.txt', lines.join('\n'), { signal });
    status('Appending scenes in order…');
    await execute(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', 'scenes.txt', ...encoding,
      '-af', 'aresample=async=1:first_pts=0,apad', '-t', String(Math.ceil(expected * FPS) / FPS), 'output.mp4'], signal);
    const media = await result(ffmpeg, signal);
    if (Math.abs(media.duration - expected) > 0.1) throw new Error('Final duration differs from scene durations by more than 100 ms.');
    return media;
  });
}

export async function audioDuration(blob: Blob): Promise<number> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    return audio.duration;
  } finally { await context.close(); }
}
export async function animationFixture(signal: AbortSignal): Promise<Media> {
  const samples = 9600;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const label = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  label(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * Math.PI * 2 * 440 / 48000) * 2000), true);
  const plan: AnimationPlan = { version: 1, elements: [
    { kind: 'rect', x: 100, y: 150, width: 400, height: 200, color: '#5271ff', start: 0, end: 0.1 },
    { kind: 'text', x: 110, y: 240, size: 50, text: 'Sketch', color: '#17233b', start: 0, end: 0.1 },
  ] };
  return animationVideo(plan, new Blob([bytes], { type: 'audio/wav' }), 0.2, signal, () => {});
}

async function decodedAlpha(ffmpeg: FFmpeg, input: string, signal: AbortSignal): Promise<boolean> {
  await execute(ffmpeg, ['-c:v', 'libvpx-vp9', '-i', input, '-frames:v', '1', '-vf', 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'alpha.raw'], signal);
  const bytes = await ffmpeg.readFile('alpha.raw', 'binary', { signal });
  return typeof bytes !== 'string' && bytes.length === 1024 && bytes.some((value, index) => index % 4 === 3 && value < 250);
}
export async function smokeFixture(signal: AbortSignal, status: Status): Promise<Media & { alpha: boolean }> {
  return withEngine(signal, status, async ffmpeg => {
    for (const [index, color] of ['red', 'blue'].entries()) {
      await execute(ffmpeg, ['-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=30:d=0.4`,
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.4', '-t', '0.4', ...encoding, `clip${index}.mp4`], signal);
      validateMetadata(await probe(ffmpeg, `clip${index}.mp4`, signal));
    }
    await ffmpeg.writeFile('clips.txt', "file 'clip0.mp4'\nfile 'clip1.mp4'", { signal });
    await execute(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', 'clips.txt', ...encoding,
      '-af', 'aresample=async=1:first_pts=0,apad', '-t', '0.8', 'output.mp4'], signal);
    validateMetadata(await probe(ffmpeg, 'output.mp4', signal), 0.8);
    const media = await result(ffmpeg, signal);
    await execute(ffmpeg, ['-i', 'output.mp4', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'order.raw'], signal);
    const colors = await ffmpeg.readFile('order.raw', 'binary', { signal });
    if (typeof colors === 'string' || colors[0] < 200 || colors[2] > 50 || colors[colors.length - 1] < 200) throw new Error('Hard-cut fixture lost scene order.');
    let alpha = false;
    try {
      await execute(ffmpeg, ['-f', 'lavfi', '-i', 'color=c=white@0.0:s=16x16:r=30:d=0.1,format=yuva420p',
        '-c:v', 'libvpx-vp9', '-threads', '2', '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p', 'alpha.webm'], signal);
      alpha = await decodedAlpha(ffmpeg, 'alpha.webm', signal);
    } catch { signal.throwIfAborted(); }
    return { ...media, alpha };
  });
}
