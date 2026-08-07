// Build-time asset manifest for offline play.
//
// The art list is derived from the real data modules through js/asset-urls.js —
// the same helpers js/ui.js uses to build sprite URLs — so it cannot drift from
// what the game actually requests. The shell list is derived from index.html and
// the js/ directory, including the `?v=` query strings exactly as the browser
// will ask for them. Nothing here is hand-maintained.

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CARD_LIBRARY } from "../js/data.js";
import { ITEM_LIBRARY } from "../js/items.js";
import { QUEST_LIBRARY } from "../js/quests.js";
import { collectCardArtUrls, collectMetaIconUrls } from "../js/asset-urls.js";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

// Assets that no data module points at but that the shell still needs.
const EXTRA_SHELL_ASSETS = Object.freeze([
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
]);

// Hashed into the version but never precached: the browser fetches the worker
// itself, yet its content still has to move the version forward.
export const VERSION_ONLY_FILES = Object.freeze(["sw.js"]);

const CSS_URL_PATTERN = /url\(\s*['"]?(\.\/assets\/[^'")]+)['"]?\s*\)/gu;
const HTML_URL_PATTERN = /(?:href|src)="(\.\/[^"]+)"/gu;

const toPath = (url) => url.replace(/^\.\//u, "").split("?")[0];

async function listJsModules() {
  const entries = await readdir(resolve(root, "js"));
  return entries.filter((name) => name.endsWith(".js")).sort();
}

/**
 * URLs index.html asks for directly, with their `?v=` query strings intact.
 * Bumping a version in index.html therefore updates the offline bundle too.
 */
async function readHtmlReferences(html) {
  const urls = new Set();
  for (const [, url] of html.matchAll(HTML_URL_PATTERN)) urls.add(url);
  return urls;
}

async function buildShellUrls() {
  const html = await readFile(resolve(root, "index.html"), "utf8");
  const css = await readFile(resolve(root, "styles.css"), "utf8");
  const htmlRefs = await readHtmlReferences(html);

  const urls = new Set(["./", "./index.html", "./manifest.webmanifest"]);
  // Stylesheet and entry module keep whatever query string index.html uses.
  for (const url of htmlRefs) {
    if (url.endsWith(".svg") || url.endsWith(".png")) continue;
    urls.add(url);
  }
  // Every other module is imported relative to js/main.js, so it has no query.
  const queried = new Map([...htmlRefs].map((url) => [toPath(url), url]));
  for (const name of await listJsModules()) {
    const path = `js/${name}`;
    if (!queried.has(path)) urls.add(`./${path}`);
  }
  for (const url of EXTRA_SHELL_ASSETS) urls.add(url);
  // Sprite sheets referenced only from styles.css belong to the shell: the
  // stylesheet requests them before any card is drawn.
  for (const [, url] of css.matchAll(CSS_URL_PATTERN)) urls.add(url);
  return [...urls];
}

function buildArtUrls() {
  const cards = Object.values(CARD_LIBRARY);
  const urls = new Set([
    ...collectCardArtUrls(cards),
    ...collectMetaIconUrls([...ITEM_LIBRARY, ...QUEST_LIBRARY]),
  ]);
  return [...urls].sort();
}

async function hashFiles(paths) {
  const digest = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error(`Asset outside repository: ${path}`);
    digest.update(path);
    digest.update(createHash("sha256").update(await readFile(absolute)).digest());
  }
  return digest.digest("hex").slice(0, 12);
}

/** Fails the build rather than shipping a manifest that promises missing files. */
async function assertPresent(urls) {
  const missing = [];
  for (const url of urls) {
    const path = toPath(url);
    if (!path || path === "index.html") continue;
    try {
      if (!(await stat(resolve(root, path))).isFile()) missing.push(path);
    } catch {
      missing.push(path);
    }
  }
  if (missing.length) throw new Error(`Asset manifest references missing files:\n  ${missing.join("\n  ")}`);
}

export async function buildAssetManifest() {
  const shell = await buildShellUrls();
  const art = buildArtUrls();
  await assertPresent([...shell, ...art]);
  const version = await hashFiles([...VERSION_ONLY_FILES, ...[...shell, ...art].map(toPath)].filter(Boolean));
  return { version, shell: shell.sort(), art };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const manifest = await buildAssetManifest();
  console.log(`version ${manifest.version} · shell ${manifest.shell.length} · art ${manifest.art.length}`);
}
