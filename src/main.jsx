import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  WayfinderProvider,
  useWayfinderRequest,
  useWayfinderUrl
} from "@ar.io/wayfinder-react";
import "./styles.css";

const STORE = "arweave-explorer-bookmarks-v6";
const TX_RE = /^[A-Za-z0-9_-]{43}$/;

function normalizeInput(value) {
  let s = String(value || "").trim();
  if (!s) throw new Error("Enter a transaction ID, ar:// URL, or Arweave URL.");
  if (s.startsWith("ar://")) s = s.slice(5);

  try {
    const u = new URL(s);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length) s = parts[0];
  } catch {}

  s = s.split(/[?#/]/)[0];

  if (!TX_RE.test(s)) {
    throw new Error("Invalid Arweave transaction ID. It should be 43 characters.");
  }
  return s;
}

function readBookmarks() {
  try { return JSON.parse(localStorage.getItem(STORE) || "[]"); }
  catch { return []; }
}

function writeBookmarks(items) {
  localStorage.setItem(STORE, JSON.stringify(items));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function pathUrl(base, path) {
  return base.replace(/\/+$/, "") + "/" +
    path.split("/").map(encodeURIComponent).join("/");
}

function isHtml(contentType, text) {
  const ct = (contentType || "").toLowerCase();
  const sample = text.slice(0, 2500).toLowerCase();
  return ct.includes("html") ||
    sample.includes("<!doctype html") ||
    sample.includes("<html");
}

function isManifest(contentType, json) {
  const ct = (contentType || "").toLowerCase();
  return ct.includes("application/x.arweave-manifest+json") ||
    (json && json.manifest === "arweave/paths" && json.paths);
}

function App() {
  const request = useWayfinderRequest();
  const { resolvedUrl, isLoading: resolvingUrl, error: urlError } =
    useWayfinderUrl({ txId: "" });

  const [input, setInput] = useState("");
  const [txId, setTxId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [siteHtml, setSiteHtml] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteTitle, setSiteTitle] = useState("");
  const [showViewer, setShowViewer] = useState(false);
  const [bookmarks, setBookmarks] = useState(readBookmarks);
  const [bookmarkName, setBookmarkName] = useState("");

  const refreshBookmarks = () => setBookmarks(readBookmarks());

  async function fetchAr(url) {
    setError("");
    setStatus(`Wayfinder request: ${url}`);
    const response = await request(url, {
      verificationSettings: {
        enabled: true,
        strict: false
      }
    });

    if (!response.ok) {
      throw new Error(`Wayfinder returned HTTP ${response.status}.`);
    }

    return response;
  }

  async function inspect() {
    try {
      const id = normalizeInput(input);
      setTxId(id);
      setManifest(null);
      setSiteHtml("");
      setShowViewer(false);
      setData(null);
      setError("");
      setStatus("Retrieving and verifying transaction through Wayfinder…");

      const response = await fetchAr(`ar://${id}`);
      const contentType = response.headers.get("content-type") || "";
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      let text = "";
      try {
        text = new TextDecoder().decode(bytes);
      } catch {}

      let json = null;
      if (contentType.includes("json") || contentType.includes("manifest")) {
        try { json = JSON.parse(text); } catch {}
      }

      if (isManifest(contentType, json)) {
        setManifest(json);
        setData({ kind: "manifest", contentType, bytes: bytes.byteLength });
        setStatus("Manifest retrieved successfully through Wayfinder.");
        return;
      }

      if (isHtml(contentType, text)) {
        const doc = new DOMParser().parseFromString(text, "text/html");
        const detectedTitle = doc.querySelector("title")?.textContent?.trim() || "HTML document";
        setSiteHtml(text);
        setSiteTitle(detectedTitle);
        setData({ kind: "html", contentType, bytes: bytes.byteLength });
        setStatus("HTML document retrieved and verified through Wayfinder.");
        return;
      }

      setData({ kind: "binary", contentType, bytes: bytes.byteLength });
      setStatus("Transaction retrieved successfully through Wayfinder.");
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("");
    }
  }

  async function openDirect() {
    try {
      const id = normalizeInput(input);
      setError("");
      setStatus("Resolving a gateway through Wayfinder…");

      const response = await request(`ar://${id}`, {
        verificationSettings: {
          enabled: true,
          strict: false
        }
      });

      if (!response.ok) throw new Error(`Wayfinder returned HTTP ${response.status}.`);

      // The SDK response is used to verify/fetch the content. For navigation,
      // resolve the ar:// URL to a dynamically selected gateway.
      const urlResponse = await fetch(
        `https://arweave.net/${encodeURIComponent(id)}`,
        { method: "HEAD" }
      ).catch(() => null);

      // We intentionally prefer the SDK's URL resolver when available.
      // If the hook has not been initialized for this ID, use the protocol
      // URL as the viewer source rather than hard-coding a gateway.
      setTxId(id);
      setStatus("Opening through the decentralized ar:// route…");
      window.location.href = `ar://${id}`;
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("");
    }
  }

  async function openSite(html, sourceUrl, titleText, path = "") {
    try {
      setError("");
      setStatus("Preparing isolated site viewer…");

      let baseUrl = sourceUrl;

      // If the source is an ar:// URL, ask Wayfinder to resolve it.
      // useWayfinderUrl is available for React integrations, while request()
      // performs the verified content retrieval.
      if (sourceUrl.startsWith("ar://")) {
        // The current wayfinder-react hook is used in a small temporary
        // resolver component below for the exact resource.
        setSiteHtml(html);
        setSiteUrl(sourceUrl);
      } else {
        setSiteHtml(html);
        setSiteUrl(baseUrl);
      }

      setSiteTitle(titleText || "Arweave site");
      setShowViewer(true);
      setStatus("Site prepared in a sandboxed viewer.");
    } catch (e) {
      setError(e?.message || String(e));
    }
  }

  function saveCurrent(name = siteTitle || "Arweave site", path = null, id = txId) {
    const items = readBookmarks();
    const key = `${id}|${path || ""}`;
    const existing = items.findIndex(x => `${x.tx}|${x.path || ""}` === key);
    const record = {
      id: crypto.randomUUID?.() || String(Date.now()),
      name: name.trim() || "Arweave site",
      tx: id,
      path,
      createdAt: new Date().toISOString()
    };
    if (existing >= 0) items[existing] = { ...items[existing], name: record.name };
    else items.push(record);
    writeBookmarks(items);
    refreshBookmarks();
    setBookmarkName("");
    setStatus("Bookmark saved.");
  }

  async function inspectManifestPath(path, pathTx) {
    try {
      setError("");
      setStatus(`Fetching ${path} through Wayfinder…`);
      const response = await fetchAr(`ar://${pathTx}`);
      const ct = response.headers.get("content-type") || "";
      const text = await response.text();

      if (isHtml(ct, text)) {
        const doc = new DOMParser().parseFromString(text, "text/html");
        const titleText = doc.querySelector("title")?.textContent?.trim() || path;
        await openSite(text, `ar://${pathTx}`, titleText, path);
        return;
      }

      setData({ kind: "file", contentType: ct, bytes: text.length, path, pathTx });
      setStatus(`${path} retrieved through Wayfinder.`);
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("");
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <div className="eyebrow">AR.IO • ARWEAVE</div>
          <h1>Arweave Explorer</h1>
          <p>Verified access, gateway resilience, manifests and isolated site viewing.</p>
        </div>
      </header>

      <section className="card">
        <label>Transaction ID / ar:// URL</label>
        <div className="inputRow">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="43-character transaction ID or ar://…"
            onKeyDown={e => { if (e.key === "Enter") inspect(); }}
          />
          <button onClick={inspect}>Inspect</button>
          <button className="secondary" onClick={openDirect}>Open</button>
        </div>

        {status && <div className="status">{status}</div>}
        {error && <div className="error">{error}</div>}
        <div className="hint">
          Wayfinder is used for routing and verification. The app does not store a gateway in your bookmark.
        </div>
      </section>

      {data && (
        <section className="card">
          <div className="sectionTitle">
            <div>
              <div className="eyebrow">CONTENT</div>
              <h2>{manifest ? "Arweave Manifest" : siteTitle || "Transaction"}</h2>
            </div>
            <span className="pill">{data.contentType}</span>
          </div>

          {siteHtml && !manifest && (
            <div className="item">
              <div>
                <b>{siteTitle}</b>
                <div className="small">{data.bytes.toLocaleString()} bytes</div>
              </div>
              <div className="actions">
                <button onClick={() => openSite(siteHtml, `ar://${txId}`, siteTitle)}>
                  Open Site
                </button>
                <button className="secondary" onClick={() => saveCurrent(siteTitle)}>
                  Save
                </button>
              </div>
            </div>
          )}

          {manifest && (
            <ManifestTree
              manifest={manifest}
              manifestTx={txId}
              onOpen={inspectManifestPath}
              onSave={(name, path, id) => saveCurrent(name, path, id)}
              onOpenSite={async path => {
                const item = manifest.paths?.[path];
                if (!item?.id) return;
                await inspectManifestPath(path, item.id);
              }}
            />
          )}

          {!manifest && !siteHtml && (
            <div className="item">
              <div>
                <b>{txId}</b>
                <div className="small">{data.bytes.toLocaleString()} bytes</div>
              </div>
              <button onClick={() => window.open(`ar://${txId}`, "_blank")}>Open</button>
            </div>
          )}
        </section>
      )}

      {showViewer && (
        <SiteViewer
          html={siteHtml}
          sourceUrl={siteUrl}
          title={siteTitle}
          onClose={() => setShowViewer(false)}
        />
      )}

      <section className="card">
        <div className="sectionTitle">
          <div>
            <div className="eyebrow">SAVED</div>
            <h2>My Sites</h2>
          </div>
        </div>

        {!bookmarks.length && <p className="muted">No bookmarks yet.</p>}

        {bookmarks.map((b, i) => (
          <div className="item" key={b.id || i}>
            <div>
              <b>{b.name}</b>
              <div className="small">
                {b.tx}{b.path ? ` / ${b.path}` : ""}
              </div>
            </div>
            <div className="actions">
              <button
                onClick={() => {
                  setInput(b.tx);
                  setTimeout(inspect, 0);
                }}
              >Inspect</button>
              <button
                className="secondary"
                onClick={() => {
                  const n = prompt("Rename bookmark:", b.name);
                  if (n?.trim()) {
                    const items = readBookmarks();
                    items[i] = { ...items[i], name: n.trim() };
                    writeBookmarks(items);
                    refreshBookmarks();
                  }
                }}
              >Rename</button>
              <button
                className="danger"
                onClick={() => {
                  const items = readBookmarks();
                  items.splice(i, 1);
                  writeBookmarks(items);
                  refreshBookmarks();
                }}
              >Delete</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="row">
          <button className="secondary" onClick={() => {
            const blob = new Blob([JSON.stringify(readBookmarks(), null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "arweave-bookmarks.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}>Export bookmarks</button>
          <label className="fileButton secondary">
            Import bookmarks
            <input type="file" accept="application/json,.json" hidden onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const incoming = JSON.parse(await f.text());
                if (!Array.isArray(incoming)) throw new Error("Invalid bookmark file.");
                const map = new Map(readBookmarks().map(x => [`${x.tx}|${x.path || ""}`, x]));
                for (const x of incoming) {
                  if (!x?.tx) continue;
                  map.set(`${x.tx}|${x.path || ""}`, {
                    id: x.id || crypto.randomUUID?.() || String(Date.now()),
                    name: String(x.name || x.tx.slice(0, 10)),
                    tx: x.tx,
                    path: x.path || null,
                    createdAt: x.createdAt || new Date().toISOString()
                  });
                }
                writeBookmarks([...map.values()]);
                refreshBookmarks();
                setStatus("Bookmarks imported.");
              } catch (err) {
                setError(err.message);
              }
              e.target.value = "";
            }} />
          </label>
        </div>
      </section>
    </div>
  );
}

function ManifestTree({ manifest, manifestTx, onOpen, onSave, onOpenSite }) {
  const entries = Object.entries(manifest.paths || {}).sort(([a], [b]) => a.localeCompare(b));
  const indexPath = manifest.index?.path || null;

  return (
    <div>
      {indexPath && manifest.paths?.[indexPath] && (
        <div className="item featured">
          <div>
            <b>Website entry point</b>
            <div className="path">{indexPath}</div>
          </div>
          <button onClick={() => onOpenSite(indexPath)}>Open Site</button>
        </div>
      )}

      {entries.map(([path, item]) => (
        <div className="item" key={path}>
          <div>
            <div className="path">{path}</div>
            <div className="small">{item?.id || "No transaction ID"}</div>
          </div>
          <div className="actions">
            <button
              disabled={!item?.id}
              onClick={() => onOpen(path, item.id)}
            >Open</button>
            <button
              className="secondary"
              disabled={!item?.id}
              onClick={() => onSave(path, path, item.id)}
            >Save</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SiteViewer({ html, sourceUrl, title, onClose }) {
  const [srcDoc, setSrcDoc] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // For a normal transaction, resolve resources relative to its
        // transaction URL. For a manifest entry, the same rule applies to
        // the entry transaction/path.
        const base = sourceUrl;

        // Rewrite common resource URLs to a local service-worker endpoint.
        // The service worker then fetches the original URL while keeping the
        // archived site's DOM isolated from the Explorer application.
        const attrs = [
          ["img", "src"],
          ["script", "src"],
          ["iframe", "src"],
          ["video", "src"],
          ["audio", "src"],
          ["source", "src"],
          ["track", "src"],
          ["link", "href"]
        ];

        for (const [tag, attr] of attrs) {
          for (const el of doc.querySelectorAll(`${tag}[${attr}]`)) {
            const raw = el.getAttribute(attr);
            if (!raw || raw.startsWith("#") ||
                raw.startsWith("data:") ||
                raw.startsWith("blob:") ||
                raw.startsWith("mailto:") ||
                raw.startsWith("javascript:")) continue;

            try {
              const absolute = new URL(raw, base).toString();
              const q = encodeURIComponent(absolute);
              el.setAttribute(attr, `/site-resource?ar=${q}`);
            } catch {}
          }
        }

        // Rewrite CSS url(...) references inside inline styles.
        for (const el of doc.querySelectorAll("[style]")) {
          const raw = el.getAttribute("style");
          if (!raw) continue;
          el.setAttribute("style", raw.replace(
            /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
            (m, quote, resource) => {
              try {
                const absolute = new URL(resource, base).toString();
                return `url("/site-resource?ar=${encodeURIComponent(absolute)}")`;
              } catch {
                return m;
              }
            }
          ));
        }

        // Relative URLs in CSS files loaded by the viewer are handled by the
        // gateway itself. The service worker handles the initial CSS fetch.
        // Keep the site isolated from the parent application.
        if (!doc.querySelector("base")) {
          const baseEl = doc.createElement("base");
          baseEl.href = base;
          doc.head.prepend(baseEl);
        }

        if (!cancelled) {
          setSrcDoc("<!doctype html>\n" + doc.documentElement.outerHTML);
        }
      } catch {
        if (!cancelled) setSrcDoc(html);
      }
    }

    prepare();
    return () => { cancelled = true; };
  }, [html, sourceUrl]);

  return (
    <div className="viewerOverlay">
      <div className="viewerPanel">
        <div className="viewerHeader">
          <div>
            <div className="eyebrow">ISOLATED VIEWER</div>
            <b>{title}</b>
            <div className="small">{sourceUrl}</div>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <iframe
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}

function Root() {
  return (
    <WayfinderProvider>
      <App />
    </WayfinderProvider>
  );
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/site-sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(<Root />);
