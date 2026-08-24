# Arweave Explorer — Bundled Wayfinder + Isolated Resource Viewer

## Run

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm run preview
```

## Added in this revision

The site viewer now registers a service worker and rewrites common archived-site resource URLs (`img`, `script`, `link`, iframe/media sources, and inline CSS `url(...)`) to an internal `/site-resource` endpoint.

The service worker fetches those resources from their original URL while the archived page remains inside a sandboxed iframe.

This is intentionally conservative: it handles common browser resources without attempting to emulate a full browser networking stack. Complex applications that construct URLs dynamically in JavaScript, use WebSockets, service workers of their own, or make arbitrary `fetch()` requests may require additional application-level interception.

## Security

The viewer iframe is sandboxed and does not receive `allow-same-origin`, so archived JavaScript cannot directly access the Explorer application's DOM or localStorage.

The parent app keeps bookmarks as Arweave transaction/path references rather than gateway URLs.

## Wayfinder

The project uses the bundled AR.IO Wayfinder packages instead of a CDN runtime import.

- `@ar.io/wayfinder-core`
- `@ar.io/wayfinder-react`
- `@ar.io/sdk`

Wayfinder requests are made with verification enabled and non-strict mode, allowing the UI to display content when verification metadata is unavailable while still attempting cryptographic verification.


## Dynamic-resource interception

The isolated viewer now also rewrites many runtime `fetch()`, `XMLHttpRequest`, and `navigator.sendBeacon()` requests to the local `/site-resource` endpoint. The service worker then retrieves the target resource.

This improves compatibility with many JavaScript-heavy Arweave sites while keeping the archived application inside a sandbox.

It is not a complete browser-network emulator: WebSockets, WebRTC, an archived site's own service worker, and browser-extension APIs are intentionally not proxied.
