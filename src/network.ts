import { AppError } from './errors';
export function canceled(signal: AbortSignal): void { signal.throwIfAborted(); }

export async function request(url: string, init: RequestInit): Promise<Response> {
  init.signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AppError('network', `Network/CORS request failed for ${new URL(url).hostname}. The COI worker cannot bypass Azure CORS.`);
  }
  if (!response.ok) {
    const wait = response.headers.get('Retry-After');
    const retryAfterMs = wait ? /^\d+$/.test(wait) ? Number(wait) * 1000 : Math.max(0, Date.parse(wait) - Date.now()) : undefined;
    throw new AppError(response.status === 401 ? 'authentication' : response.status === 403 ? 'authorization' : response.status === 429 ? 'rate-limit' : 'synthesis',
      `Service returned HTTP ${response.status}${retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? `; retry after ${Math.ceil(retryAfterMs / 1000)} seconds` : ''}. Check credentials, region, model/tool access and quota.`,
      undefined, retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
  }
  return response;
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
