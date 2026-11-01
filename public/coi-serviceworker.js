/* Static-hosting isolation shim: no caching, remote rewriting or update reload. */
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) ||
      request.method !== 'GET' || request.headers.has('range') || url.search ||
      request.headers.has('authorization') || request.headers.has('api-key') ||
      (request.cache === 'only-if-cached' && request.mode !== 'same-origin') ||
      !(/\.(js|css|wasm|woff2|png|jpg|svg|html)$/.test(url.pathname) || url.pathname === scope.pathname)) return;
  event.respondWith((async () => {
    const response = await fetch(request);
    if (!response.ok || response.type === 'opaque' || response.redirected ||
        [204, 205, 206, 304].includes(response.status) || !response.body) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  })());
});
