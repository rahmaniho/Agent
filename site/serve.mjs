#!/usr/bin/env node
// serve.mjs — سرور استاتیک بدون وابستگی برای پیش‌نمایش سایت
// استفاده: node site/serve.mjs [--port 4173] [--host 0.0.0.0]
import { createServer, request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(flag("port", process.env.PORT || 4173));
const HOST = flag("host", "0.0.0.0");
const FCC_LOCAL = args.includes("--fcc-local");
const FCC_PORT = Number(flag("fcc-port", "8082"));
if (FCC_LOCAL && (HOST !== "127.0.0.1" || !Number.isInteger(FCC_PORT) || FCC_PORT < 1 || FCC_PORT > 65535)) {
  throw new Error("--fcc-local requires --host 127.0.0.1 and a valid --fcc-port");
}

// FCC Admin is intentionally local-only. Expose just the Code commands needed by
// the UI, only with explicit opt-in and only to same-origin loopback requests.
function proxyFcc(req, res, pathname) {
  const deny = (code, detail) => res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ detail }));
  const localAuthority = `127.0.0.1:${PORT}`;
  if (!FCC_LOCAL || req.headers.host !== localAuthority || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return deny(403, "Local FCC bridge is disabled");
  const origin = req.headers.origin;
  if ((origin && origin !== `http://${localAuthority}`) || (req.method !== "GET" && origin !== `http://${localAuthority}`) || req.headers['sec-fetch-site'] === 'cross-site') return deny(403, "Invalid origin");
  const tail = pathname.slice('/api/fcc/'.length);
  const isUuid = '[0-9a-fA-F-]{36}';
  const allowed = (req.method === 'GET' && (tail === 'bootstrap' || new RegExp(`^sessions/${isUuid}$`).test(tail))) ||
    (req.method === 'POST' && (tail === 'sessions' || new RegExp(`^sessions/${isUuid}/(turns|stop)$`).test(tail)));
  if (!allowed || req.url.includes('?')) return deny(404, "Not found");
  const upstream = httpRequest({ hostname: '127.0.0.1', port: FCC_PORT, path: `/admin/api/code/${tail}`, method: req.method, headers: { host: `127.0.0.1:${FCC_PORT}`, origin: `http://127.0.0.1:${FCC_PORT}`, 'content-type': 'application/json', accept: 'application/json' } }, (response) => {
    res.writeHead(response.statusCode || 502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) deny(502, 'FCC is not running on the local device'); else res.destroy(); });
  let bytes = 0;
  req.on('data', chunk => { bytes += chunk.length; if (bytes > 1100000) { upstream.destroy(); if (!res.headersSent) deny(413, 'Request too large'); } else upstream.write(chunk); });
  req.on('end', () => { if (!upstream.destroyed) upstream.end(); });
}


const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    if (FCC_LOCAL && (req.headers.host !== `127.0.0.1:${PORT}` || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress))) {
      res.writeHead(403).end("Forbidden"); return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/fcc/")) return proxyFcc(req, res, pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    // جلوگیری از path traversal
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    const target = info && info.isDirectory() ? join(filePath, "index.html") : filePath;
    const body = await readFile(target);

    res.writeHead(200, {
      "Content-Type": TYPES[extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      // اجازهٔ نمایش در iframe پلتفرم پیش‌نمایش
      "X-Frame-Options": FCC_LOCAL ? "DENY" : "ALLOWALL",
      "Content-Security-Policy": FCC_LOCAL ? "frame-ancestors 'none'" : "frame-ancestors *",
      ...(FCC_LOCAL ? {} : { "Access-Control-Allow-Origin": "*" }),
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>۴۰۴</title>
      <body style="font-family:system-ui;padding:3rem;text-align:center"><h1>۴۰۴</h1><p>صفحه پیدا نشد.</p>
      <p><a href="/">بازگشت به خانه</a></p></body></html>`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[ecc-playbook] http://${HOST}:${PORT}  (root: ${ROOT})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
