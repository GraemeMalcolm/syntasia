import { bootstrapIsolation } from './coi-bootstrap';
import { smokeFixture, animationFixture, concatenate, setEncodingPath } from './production';
import { publicError } from './errors';
export interface Capabilities {
  message: string; isolated: boolean; sharedArrayBuffer: boolean;
  videoCodec: boolean; audioCodec: boolean; pipeline: boolean; threaded: boolean; alpha: boolean;
}
export async function probeCapabilities(startupMessage?: string): Promise<Capabilities> {
  const startup = startupMessage ?? await bootstrapIsolation();
  const isolated = globalThis.crossOriginIsolated === true;
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const result: Capabilities = { message: startup, isolated, sharedArrayBuffer, videoCodec: false, audioCodec: false, pipeline: false, threaded: false, alpha: false };
  for (const threaded of isolated && sharedArrayBuffer ? [true, false] : [false]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      setEncodingPath(threaded);
      const fixture = await smokeFixture(controller.signal, () => {});
      const animation = await animationFixture(controller.signal);
      await concatenate([fixture, animation], controller.signal, () => {});
      const { alpha } = fixture;
      Object.assign(result, { videoCodec: true, audioCodec: true, pipeline: true, threaded, alpha });
      result.message += ` Local 1080p H.264/AAC encode/decode, ordered hard cuts and MP4 playback fixture passed (${threaded ? 'threaded' : 'single-thread'}). Azure paths remain unqualified.`;
      break;
    } catch (error) { result.message += ` ${threaded ? 'Threaded' : 'Single-thread'} pipeline fixture failed: ${publicError(error)}`; }
    finally { clearTimeout(timer); }
  }
  return result;
}
