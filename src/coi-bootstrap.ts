import { publicError } from './errors';

export async function bootstrapIsolation(timeout = 6000): Promise<string> {
  if (globalThis.crossOriginIsolated) return 'Document isolation verified.';
  if (!isSecureContext || !('serviceWorker' in navigator)) return 'Isolation unavailable: secure context and service-worker support required. Testing single-thread fallback.';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listener: (() => void) | undefined;
  const controlled = new Promise<void>(resolve => {
    listener = () => { if (navigator.serviceWorker.controller) resolve(); };
    navigator.serviceWorker.addEventListener('controllerchange', listener);
    if (navigator.serviceWorker.controller) resolve();
  });
  try {
    const base = new URL(import.meta.env.BASE_URL, location.origin);
    const registration = await Promise.race([
      navigator.serviceWorker.register(new URL('coi-serviceworker.js', base), { scope: base.pathname }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worker registration timed out.')), timeout); }),
    ]);
    await Promise.race([controlled, new Promise<never>((_, reject) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reject(new Error('Worker control timed out.')), timeout);
    })]);
    if (registration.waiting) return 'Worker update deferred until a fresh session; current document remains nonisolated.';
    try {
      const key = `syntasia.coi.reload.${base.pathname}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        location.reload();
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (error) { return `Automatic isolation reload skipped (${publicError(error)}). Testing single-thread fallback.`; }
    return 'Worker controls this scope but document is not isolated. Testing single-thread fallback; refresh before entering work to retry.';
  } catch (error) { return `Isolation setup failed (${publicError(error)}). Testing single-thread fallback; remote CORS is unchanged.`; }
  finally {
    if (timer) clearTimeout(timer);
    if (listener) navigator.serviceWorker.removeEventListener('controllerchange', listener);
  }
}
