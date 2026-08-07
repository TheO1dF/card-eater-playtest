import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAssetManifest } from "./asset-manifest.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const dist = resolve(root, "dist");
const assets = resolve(root, "assets");
if (!dist.startsWith(`${root}${sep}`) || dist === root) throw new Error("Unsafe build output path");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all([
  cp(resolve(root, "index.html"), resolve(dist, "index.html")),
  cp(resolve(root, "styles.css"), resolve(dist, "styles.css")),
  cp(resolve(root, "js"), resolve(dist, "js"), { recursive: true }),
  cp(assets, resolve(dist, "assets"), {
    recursive: true,
    // Keep runtime PNG/WebP assets, but never deploy editable source sheets or
    // the complete historical archive to Cloudflare Pages.
    filter: (source) => {
      const assetRelative = relative(assets, source);
      if (!assetRelative) return true;
      const topLevel = assetRelative.split(sep)[0];
      return topLevel !== "source" && topLevel !== "archive";
    },
  }),
  cp(resolve(root, "_headers"), resolve(dist, "_headers")),
  cp(resolve(root, "manifest.webmanifest"), resolve(dist, "manifest.webmanifest")),
]);

// The offline asset list is generated from the real data modules, and the build
// hash is stamped into the worker so every deployment gets its own shell cache.
const assetManifest = await buildAssetManifest();
await writeFile(resolve(dist, "asset-manifest.json"), `${JSON.stringify(assetManifest, null, 2)}\n`);

const worker = await readFile(resolve(root, "sw.js"), "utf8");
if (!worker.includes("__CARDEATER_BUILD__")) throw new Error("sw.js is missing the build placeholder");
await writeFile(resolve(dist, "sw.js"), worker.replaceAll("__CARDEATER_BUILD__", assetManifest.version));

console.log(`Built static site: ${dist}`);
console.log(`Offline manifest: build ${assetManifest.version} · ${assetManifest.shell.length} shell · ${assetManifest.art.length} art`);
