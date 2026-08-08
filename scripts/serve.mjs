import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const root = process.argv[3] ? resolve(repositoryRoot, process.argv[3]) : repositoryRoot;
if (root !== repositoryRoot && !root.startsWith(`${repositoryRoot}${sep}`)) {
  throw new Error("Static root must stay inside the repository");
}
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
// Source sw.js contains an unstamped dev build marker and stays network-first;
// dist/sw.js is stamped and uses release caching even on localhost. See
// docs/PWA_OFFLINE.md.
const host = process.argv[4] ?? process.env.HOST ?? "127.0.0.1";
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    // Match Cloudflare Pages' canonical document behaviour in release-mode
    // smoke tests. This redirect previously produced a cached
    // Response.redirected=true that Chromium refused on the next navigation.
    if (root !== repositoryRoot && pathname === "/index.html") {
      response.writeHead(308, { Location: "/", "Cache-Control": "no-cache" });
      response.end();
      return;
    }
    // Generated at build time, so serve it live here instead of writing a file
    // into the working tree that could go stale during development.
    if (pathname === "/asset-manifest.json") {
      const { buildAssetManifest } = await import("./asset-manifest.mjs");
      const body = JSON.stringify(await buildAssetManifest(), null, 2);
      response.writeHead(200, { "Content-Type": contentTypes[".json"], "Cache-Control": "no-store" });
      response.end(body);
      return;
    }
    let target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Path outside root");
    if ((await stat(target)).isDirectory()) target = resolve(target, "index.html");
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("404 Not Found");
  }
});

server.listen(port, host, () => {
  console.log(`CardEater: http://${host}:${port}`);
});
