export interface Config {
  projectUrl: string;
  key: string;
  model: string;
  responsesOrigin: string;
  speechOrigin: string;
  speechKey: string;
  speechRegion: string;
}
const storageKey = 'syntasia.config.v1';
function notifyStorageFailure(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('syntasia-storage-error', { detail: 'Browser settings storage is unavailable or invalid. Settings remain session-only.' }));
}
export function resourceOrigin(value: string, speech = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS Azure URL.'); }
  const host = speech
    ? /^[a-z0-9-]+\.(cognitiveservices\.azure\.com|tts\.speech\.microsoft\.com|api\.cognitive\.microsoft\.com)$/
    : /^[a-z0-9-]+\.(services\.ai\.azure\.com|openai\.azure\.com)$/;
  const path = /^\/?$/.test(url.pathname) || (!speech && url.hostname.endsWith('.services.ai.azure.com') &&
    /^\/api\/projects\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !host.test(url.hostname) || !path) {
    throw new Error('Use a supported HTTPS Azure resource root or Foundry project URL, without credentials, query, or fragment.');
  }
  return url.origin;
}
export function normalizeConfig(value: Partial<Config>): Config {
  const projectUrl = value.projectUrl?.trim() ?? '';
  const projectOrigin = resourceOrigin(projectUrl);
  const model = value.model?.trim() ?? '';
  const key = value.key?.trim() ?? '';
  if (!model || model.length > 256 || !key || /[\r\n]/.test(key)) throw new Error('Enter a valid model deployment name and authorization key.');
  const responsesOrigin = value.responsesOrigin ? resourceOrigin(value.responsesOrigin) : projectOrigin;
  const speechOrigin = value.speechOrigin ? resourceOrigin(value.speechOrigin, true)
    : projectOrigin.endsWith('.services.ai.azure.com') ? projectOrigin.replace(/\.services\.ai\.azure\.com$/, '.cognitiveservices.azure.com') : '';
  const speechRegion = value.speechRegion?.trim().toLowerCase() ?? '';
  if (speechRegion && !/^[a-z0-9]+$/.test(speechRegion)) throw new Error('Use an Azure region identifier such as westus2.');
  const speechKey = value.speechKey?.trim() ?? '';
  if (/[\r\n]/.test(speechKey)) throw new Error('Invalid Speech authorization key.');
  return { projectUrl, key, model, responsesOrigin, speechOrigin, speechKey, speechRegion };
}
export const validateConfig = normalizeConfig;
export function endpoints(config: Config): { inference: string; speech: string; key: string } {
  const normalized = normalizeConfig(config);
  if (!normalized.speechOrigin) throw new Error('Provide a Speech endpoint in Advanced settings for this Foundry host.');
  return { inference: normalized.responsesOrigin, speech: normalized.speechOrigin, key: normalized.speechKey || normalized.key };
}
export function saveSettings(config: Config, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    (storage ?? localStorage).setItem(storageKey, JSON.stringify({ projectUrl: config.projectUrl, model: config.model }));
    return true;
  } catch { notifyStorageFailure(); return false; }
}
export function loadSettings(storage?: Pick<Storage, 'getItem'>): Pick<Config, 'projectUrl' | 'model'> {
  try {
    const parsed: unknown = JSON.parse((storage ?? localStorage).getItem(storageKey) ?? '{}');
    if (parsed && typeof parsed === 'object' && 'projectUrl' in parsed && 'model' in parsed &&
        typeof parsed.projectUrl === 'string' && typeof parsed.model === 'string') {
      resourceOrigin(parsed.projectUrl);
      return { projectUrl: parsed.projectUrl, model: parsed.model };
    }
  } catch { notifyStorageFailure(); }
  return { projectUrl: '', model: '' };
}
export function clearSettings(storage?: Pick<Storage, 'removeItem'>): boolean {
  try { (storage ?? localStorage).removeItem(storageKey); return true; } catch { notifyStorageFailure(); return false; }
}
