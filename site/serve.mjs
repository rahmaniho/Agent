#!/usr/bin/env node
// serve.mjs — سرور استاتیک بدون وابستگی برای پیش‌نمایش سایت
// استفاده: node site/serve.mjs [--port 4173] [--host 0.0.0.0]
import { createServer } from "node:http";
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
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
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
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
      "Access-Control-Allow-Origin": "*",
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
