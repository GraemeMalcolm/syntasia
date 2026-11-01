import { z } from 'zod';
import { endpoints, type Config } from './configuration';
import type { Avatar } from './types';
import type { Voice } from './speech';
import { validateSsml, spokenText } from './ssml';
import { request, delay } from './network';
import { AppError } from './errors';
export const AVATAR_REGIONS = ['westus2', 'eastus', 'eastus2', 'southcentralus', 'southeastasia', 'centralindia', 'westeurope', 'swedencentral', 'northeurope', 'italynorth', 'francecentral'];
const jobSchema = z.object({
  status: z.enum(['NotStarted', 'Running', 'Succeeded', 'Failed']),
  outputs: z.object({ result: z.string().optional() }).passthrough().optional(),
}).passthrough();
export function avatarEndpoint(config: Config, id: string): string {
  const endpoint = endpoints(config);
  if (!/^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(new URL(endpoint.speech).hostname) ||
      !AVATAR_REGIONS.includes(config.speechRegion)) throw new Error('Avatar synthesis needs an explicit documented supported Speech region and custom-subdomain endpoint; verify availability in your resource.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,62}[a-zA-Z0-9]$/.test(id)) throw new Error('Invalid avatar job identifier.');
  return `${endpoint.speech}/avatar/batchsyntheses/${id}?api-version=2024-08-01`;
}
export function validateOutputUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !/^stttssvcprod[a-z0-9]+\.blob\.core\.windows\.net$/.test(url.hostname) ||
      !url.pathname.startsWith('/batchsynthesis-output/')) throw new Error('Avatar output origin/path is not the documented Microsoft-managed synthesis storage. Custom destinations require separate qualification; credentials were not forwarded.');
  return url.href;
}
export function avatarRequest(script: string, ssml: boolean, voice: Voice, avatar: Avatar, transparent: boolean) {
  const content = ssml ? validateSsml(script, voice) : script;
  if (!spokenText(content, ssml)) throw new Error('Enter spoken narration before avatar synthesis.');
  return {
    inputKind: ssml ? 'SSML' : 'PlainText', inputs: [{ content }],
    ...(ssml ? {} : { synthesisConfig: { voice: voice.id } }),
    avatarConfig: {
      talkingAvatarCharacter: avatar.character, talkingAvatarStyle: avatar.style, customized: false,
      videoFormat: transparent ? 'webm' : 'mp4', videoCodec: transparent ? 'vp9' : 'h264',
      backgroundColor: transparent ? '#FFFFFF00' : '#FFFFFFFF', subtitleType: 'soft_embedded', useBuiltInVoice: false,
    },
    properties: { timeToLiveInHours: 24 },
  };
}
export async function avatarVideo(config: Config, script: string, ssml: boolean, voice: Voice,
  avatar: Avatar, transparent: boolean, signal: AbortSignal, status: (text: string) => void): Promise<Blob> {
  const url = avatarEndpoint(config, `syntasia-${crypto.randomUUID()}`);
  const body = JSON.stringify(avatarRequest(script, ssml, voice, avatar, transparent));
  if (new TextEncoder().encode(body).length > 500000) throw new Error('Avatar request exceeds the service payload limit.');
  const headers = { 'Ocp-Apim-Subscription-Key': endpoints(config).key, 'Content-Type': 'application/json' };
  status('Queued avatar synthesis; submit is never automatically retried.');
  await request(url, { method: 'PUT', headers, body, signal });
  const deadline = Date.now() + 20 * 60 * 1000;
  let wait = 5000;
  while (Date.now() < deadline) {
    if (Date.now() + wait >= deadline) break;
    await delay(wait, signal);
    let response: Response;
    try { response = await request(url, { headers, signal }); }
    catch (error) {
      if (error instanceof AppError && error.error.code === 'rate-limit') {
        wait = Math.max(1000, error.retryAfterMs ?? 5000);
        status('Avatar status polling is throttled; respecting retry guidance without resubmitting the job.');
        continue;
      }
      throw error;
    }
    const retry = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(retry) && retry > 0) wait = Math.max(1000, retry * 1000);
    const job = jobSchema.parse(await response.json());
    status(`Avatar ${job.status}. Cancellation stops local polling, not necessarily remote billing.`);
    if (job.status === 'Failed') throw new Error('Avatar synthesis failed. Check region, standard style access, quota and service status.');
    if (job.status === 'Succeeded') {
      if (!job.outputs?.result) throw new Error('Avatar job completed without output.');
      const output = validateOutputUrl(job.outputs.result);
      status('Downloading avatar output with original CORS semantics and no Speech credentials.');
      const result = await request(output, { signal });
      const size = Number(result.headers.get('Content-Length'));
      if (size > 256 * 1024 * 1024) throw new Error('Avatar output exceeds the conservative 256 MiB download budget.');
      const blob = await result.blob();
      signal.throwIfAborted();
      if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error('Avatar output is empty or exceeds the device budget.');
      return blob;
    }
  }
  throw new Error('Avatar polling timed out. The remote job may still be processing and incur charges.');
}
