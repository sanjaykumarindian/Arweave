const CACHE = "arweave-site-viewer-v2";

self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname !== "/site-resource") return;

  const target = url.searchParams.get("ar");
  if (!target) {
    event.respondWith(new Response("Missing ar parameter", {status: 400}));
    return;
  }

  let targetUrl;
  try { targetUrl = new URL(target).toString(); }
  catch {
    event.respondWith(new Response("Invalid target URL", {status: 400}));
    return;
  }

  event.respondWith(
    fetch(targetUrl, {
      method: event.request.method,
      headers: event.request.headers,
      credentials: "omit",
      redirect: "follow"
    }).then(response => {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      headers.delete("Content-Security-Policy");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }).catch(err =>
      new Response(`Resource proxy failed: ${err.message}`, {
        status: 502,
        headers: {"Content-Type": "text/plain"}
      })
    )
  );
});
