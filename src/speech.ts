import { z } from 'zod';
import { endpoints, type Config } from './configuration';
import { request } from './network';
import { toSsml, validateSsml, spokenText } from './ssml';
export interface Voice { id: string; name: string; locale: string }
const voicesSchema = z.array(z.object({ ShortName: z.string().min(1), DisplayName: z.string().min(1), Locale: z.string().min(1) }).passthrough()).max(2000);
export async function loadVoices(config: Config, signal: AbortSignal): Promise<Voice[]> {
  const endpoint = endpoints(config);
  const response = await request(`${endpoint.speech}/tts/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': endpoint.key }, signal,
  });
  return voicesSchema.parse(await response.json()).map(v => ({ id: v.ShortName, name: v.DisplayName, locale: v.Locale }));
}
export async function previewSpeech(config: Config, script: string, ssml: boolean, voice: Voice, signal: AbortSignal): Promise<Blob> {
  const content = ssml ? validateSsml(script, voice) : toSsml(script, voice);
  if (!spokenText(content, true).trim()) throw new Error('Enter spoken narration before synthesizing speech.');
  const endpoint = endpoints(config);
  const response = await request(`${endpoint.speech}/tts/cognitiveservices/v1`, {
    method: 'POST', signal,
    headers: { 'Ocp-Apim-Subscription-Key': endpoint.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm' },
    body: content,
  });
  const blob = await response.blob();
  const magic = new TextDecoder().decode(await blob.slice(0, 4).arrayBuffer());
  if (magic !== 'RIFF' || blob.size > 64 * 1024 * 1024) throw new Error('Speech returned invalid or oversized PCM audio.');
  signal.throwIfAborted();
  return blob;
}
export const synthesize = previewSpeech;
export { avatarVideo } from './avatar';
