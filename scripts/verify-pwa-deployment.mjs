// Verifies the files that a deployed PWA actually serves. A Pages SPA fallback
// returns index.html with status 200 for missing files, so status checks alone
// are not enough: content types and the stamped build must also match.

const baseUrl = new URL(process.argv[2] ?? "https://card-eater-playtest.pages.dev/");
const failures = [];

async function get(path, expectedType) {
  const url = new URL(path, baseUrl);
  url.searchParams.set("pwa_verify", Date.now().toString(36));
  const response = await fetch(url, { cache: "no-store", redirect: "follow" });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok) failures.push(`${path}: HTTP ${response.status}`);
  if (expectedType && !type.toLowerCase().includes(expectedType)) {
    failures.push(`${path}: expected ${expectedType}, got ${type || "no content-type"}`);
  }
  return { response, type, text: await response.text() };
}

const [index, worker, manifestFile] = await Promise.all([
  get("./", "text/html"),
  get("./sw.js", "javascript"),
  get("./asset-manifest.json", "application/json"),
  get("./manifest.webmanifest", "application/manifest"),
]);

let manifest = null;
try {
  manifest = JSON.parse(manifestFile.text);
} catch {
  failures.push("asset-manifest.json: response is not JSON (likely the Pages HTML fallback)");
}

if (!index.text.includes("./js/pwa-boot.js")) failures.push("index.html: early PWA boot script missing");
if (worker.text.includes("__CARDEATER_BUILD__")) failures.push("sw.js: build placeholder was not stamped");
if (manifest) {
  if (!/^[0-9a-f]{12}$/u.test(manifest.version ?? "")) failures.push(`asset manifest: invalid version ${manifest.version}`);
  if (!Array.isArray(manifest.shell) || manifest.shell.length < 40) failures.push("asset manifest: incomplete shell list");
  if (!Array.isArray(manifest.art) || manifest.art.length < 100) failures.push("asset manifest: incomplete art list");
  if (!worker.text.includes(`const BUILD = "${manifest.version}"`)) {
    failures.push("sw.js and asset-manifest.json have different build versions");
  }

  const assets = [...new Set([...(manifest.shell ?? []), ...(manifest.art ?? [])])];
  const pending = [...assets];
  const missing = [];
  const workers = Array.from({ length: Math.min(12, pending.length) }, async () => {
    for (let path = pending.shift(); path !== undefined; path = pending.shift()) {
      const url = new URL(path, baseUrl);
      const response = await fetch(url, { method: "HEAD", cache: "no-store", redirect: "follow" }).catch(() => null);
      const type = response?.headers.get("content-type") ?? "";
      const pathname = new URL(url).pathname;
      const isDocument = pathname.endsWith("/") || pathname.endsWith("/index.html");
      const isHtmlFallback = type.includes("text/html") && !isDocument;
      if (!response?.ok || isHtmlFallback) missing.push(`${path} (${response?.status ?? "network"}, ${type || "no type"})`);
    }
  });
  await Promise.all(workers);
  if (missing.length) failures.push(`offline assets unavailable:\n  ${missing.join("\n  ")}`);
}

const report = {
  url: baseUrl.href,
  build: manifest?.version ?? null,
  shell: manifest?.shell?.length ?? 0,
  art: manifest?.art?.length ?? 0,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
