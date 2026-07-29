import { cp, mkdir, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
]);

console.log(`Built static site: ${dist}`);
