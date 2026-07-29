import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const debugPort = Number(process.argv[2] ?? 9226);
const siteUrl = process.argv[3] ?? "http://127.0.0.1:8766/";
const quality = Number(process.argv[4] ?? 0.82);
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const sheets = [
  "card-sprites.png",
  "card-sprites-set-1.png",
  "card-sprites-set-2.png",
  "card-sprites-set-3.png",
  "card-sprites-set-4.png",
  "card-sprites-set-5.png",
  "card-sprites-set-6.png",
  "card-sprites-set-7.png",
  "card-sprites-set-8.png",
  "card-sprites-set-9.png",
  "card-sprites-set-10.png",
  "card-sprites-set-11.png",
];

const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No debuggable Chrome page found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handlers.reject(new Error(message.error.message));
  else handlers.resolve(message.result);
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveMessage, reject) => pending.set(id, { resolve: resolveMessage, reject }));
}

await send("Page.enable");
await send("Page.navigate", { url: siteUrl });
await new Promise((resolveWait) => setTimeout(resolveWait, 500));

const expression = `(async () => {
  const sheets = ${JSON.stringify(sheets)};
  const quality = ${JSON.stringify(quality)};
  const sheetOutput = [];
  const loadedSheets = new Map();
  for (const source of sheets) {
    const image = new Image();
    image.src = new URL(\`assets/\${source}\`, location.href).href;
    await image.decode();
    loadedSheets.set(source, image);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { alpha: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0);
    const dataUrl = canvas.toDataURL("image/webp", quality);
    sheetOutput.push({ source, data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
  }

  const { CARD_LIBRARY } = await import("./js/data.js");
  const cardOutput = [];
  const size = 320;
  const atlasArtSize = 256;
  const atlasGutter = 4;
  const atlasCellSize = atlasArtSize + atlasGutter * 2;
  const atlasColumns = 10;
  const atlas = document.createElement("canvas");
  atlas.width = atlasColumns * atlasCellSize;
  atlas.height = Math.ceil(Object.keys(CARD_LIBRARY).length / atlasColumns) * atlasCellSize;
  const atlasContext = atlas.getContext("2d", { alpha: true });
  atlasContext.imageSmoothingEnabled = false;

  function drawCard(context, card, image, outputSize) {
    if (card.sprite_rows === 2) {
      const width = 4.5 * outputSize;
      const height = width * image.naturalHeight / image.naturalWidth;
      const x = (0.05 - 0.9 * card.sprite_x) * outputSize;
      const positionY = card.sprite_y === 0 ? 0.125 : 0.875;
      const y = (outputSize - height) * positionY;
      context.drawImage(image, x, y, width, height);
      const overlap = outputSize * 0.05;
      context.clearRect(0, 0, overlap, outputSize);
      context.clearRect(outputSize - overlap, 0, overlap, outputSize);
      return;
    }
    const width = card.sprite_columns * outputSize;
    const height = card.sprite_rows * outputSize;
    context.drawImage(image, -card.sprite_x * outputSize, -card.sprite_y * outputSize, width, height);
  }

  function normalizeCard(source, outputSize) {
    const sourceContext = source.getContext("2d", { alpha: true });
    const imageData = sourceContext.getImageData(0, 0, source.width, source.height);
    const pixels = imageData.data;
    const labels = new Int32Array(source.width * source.height);
    const components = [];
    let nextLabel = 1;

    for (let index = 0; index < labels.length; index += 1) {
      if (labels[index] !== 0 || pixels[index * 4 + 3] < 16) continue;
      const component = {
        label: nextLabel,
        count: 0,
        minX: source.width,
        minY: source.height,
        maxX: -1,
        maxY: -1,
      };
      const queue = [index];
      labels[index] = nextLabel;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const x = current % source.width;
        const y = Math.floor(current / source.width);
        component.count += 1;
        component.minX = Math.min(component.minX, x);
        component.minY = Math.min(component.minY, y);
        component.maxX = Math.max(component.maxX, x);
        component.maxY = Math.max(component.maxY, y);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if (nextX < 0 || nextX >= source.width || nextY < 0 || nextY >= source.height) continue;
            const next = nextY * source.width + nextX;
            if (labels[next] !== 0 || pixels[next * 4 + 3] < 16) continue;
            labels[next] = nextLabel;
            queue.push(next);
          }
        }
      }
      components.push(component);
      nextLabel += 1;
    }

    if (components.length === 0) return source;
    const largest = components.reduce((best, component) => (
      component.count > best.count ? component : best
    ));
    const largestExtent = Math.max(
      largest.maxX - largest.minX + 1,
      largest.maxY - largest.minY + 1,
    );
    const keptLabels = new Set([largest.label]);
    components.forEach((component) => {
      const gapX = Math.max(0, largest.minX - component.maxX, component.minX - largest.maxX);
      const gapY = Math.max(0, largest.minY - component.maxY, component.minY - largest.maxY);
      const gap = Math.hypot(gapX, gapY);
      if (component.count >= largest.count * 0.18 || gap <= largestExtent * 0.12) {
        keptLabels.add(component.label);
      }
    });

    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;
    components.forEach((component) => {
      if (!keptLabels.has(component.label)) return;
      minX = Math.min(minX, component.minX);
      minY = Math.min(minY, component.minY);
      maxX = Math.max(maxX, component.maxX);
      maxY = Math.max(maxY, component.maxY);
    });
    for (let index = 0; index < labels.length; index += 1) {
      if (keptLabels.has(labels[index])) continue;
      const pixel = index * 4;
      pixels[pixel] = 0;
      pixels[pixel + 1] = 0;
      pixels[pixel + 2] = 0;
      pixels[pixel + 3] = 0;
    }
    sourceContext.putImageData(imageData, 0, 0);

    const sourceWidth = maxX - minX + 1;
    const sourceHeight = maxY - minY + 1;
    const targetExtent = Math.round(outputSize * 0.78);
    const scale = Math.min(targetExtent / sourceWidth, targetExtent / sourceHeight);
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const targetX = Math.round((outputSize - targetWidth) / 2);
    const targetY = Math.round((outputSize - targetHeight) / 2);
    const output = document.createElement("canvas");
    output.width = outputSize;
    output.height = outputSize;
    const outputContext = output.getContext("2d", { alpha: true });
    outputContext.imageSmoothingEnabled = false;
    outputContext.drawImage(
      source,
      minX,
      minY,
      sourceWidth,
      sourceHeight,
      targetX,
      targetY,
      targetWidth,
      targetHeight,
    );
    return output;
  }

  let cardIndex = 0;
  for (const card of Object.values(CARD_LIBRARY)) {
    const source = card.sprite_sheet.replace(/\\.webp$/u, ".png");
    const image = loadedSheets.get(source);
    const rawCanvas = document.createElement("canvas");
    rawCanvas.width = size;
    rawCanvas.height = size;
    const context = rawCanvas.getContext("2d", { alpha: true });
    context.imageSmoothingEnabled = false;
    drawCard(context, card, image, size);
    const canvas = normalizeCard(rawCanvas, size);

    const dataUrl = canvas.toDataURL("image/webp", quality);
    cardOutput.push({ id: card.id.toLowerCase(), data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
    const atlasX = (cardIndex % atlasColumns) * atlasCellSize + atlasGutter;
    const atlasY = Math.floor(cardIndex / atlasColumns) * atlasCellSize + atlasGutter;
    atlasContext.drawImage(canvas, atlasX, atlasY, atlasArtSize, atlasArtSize);
    cardIndex += 1;
  }
  const atlasUrl = atlas.toDataURL("image/webp", quality);

  const metaSource = new Image();
  metaSource.src = new URL("assets/meta-atlas-source.png", location.href).href;
  await metaSource.decode();
  const metaColumns = 4;
  const metaRows = 4;
  const metaCellOutput = 128;
  const metaAtlas = document.createElement("canvas");
  metaAtlas.width = metaColumns * metaCellOutput;
  metaAtlas.height = metaRows * metaCellOutput;
  const metaContext = metaAtlas.getContext("2d", { alpha: true });
  metaContext.imageSmoothingEnabled = false;
  for (let metaY = 0; metaY < metaRows; metaY += 1) {
    for (let metaX = 0; metaX < metaColumns; metaX += 1) {
      const sourceX = Math.round(metaX * metaSource.naturalWidth / metaColumns);
      const sourceY = Math.round(metaY * metaSource.naturalHeight / metaRows);
      const sourceRight = Math.round((metaX + 1) * metaSource.naturalWidth / metaColumns);
      const sourceBottom = Math.round((metaY + 1) * metaSource.naturalHeight / metaRows);
      const rawMeta = document.createElement("canvas");
      rawMeta.width = sourceRight - sourceX;
      rawMeta.height = sourceBottom - sourceY;
      const rawMetaContext = rawMeta.getContext("2d", { alpha: true });
      rawMetaContext.imageSmoothingEnabled = false;
      rawMetaContext.drawImage(
        metaSource,
        sourceX,
        sourceY,
        rawMeta.width,
        rawMeta.height,
        0,
        0,
        rawMeta.width,
        rawMeta.height,
      );
      const normalizedMeta = normalizeCard(rawMeta, metaCellOutput);
      metaContext.drawImage(normalizedMeta, metaX * metaCellOutput, metaY * metaCellOutput);
    }
  }
  const metaUrl = metaAtlas.toDataURL("image/webp", quality);

  const shopMetaSource = new Image();
  shopMetaSource.src = new URL("assets/shop-items-atlas-v013-source.png", location.href).href;
  await shopMetaSource.decode();
  const shopMetaColumns = 6;
  const shopMetaRows = 4;
  const shopMetaCellOutput = 128;
  const shopMetaAtlas = document.createElement("canvas");
  shopMetaAtlas.width = shopMetaColumns * shopMetaCellOutput;
  shopMetaAtlas.height = shopMetaRows * shopMetaCellOutput;
  const shopMetaContext = shopMetaAtlas.getContext("2d", { alpha: false });
  shopMetaContext.imageSmoothingEnabled = false;
  shopMetaContext.fillStyle = "#000000";
  shopMetaContext.fillRect(0, 0, shopMetaAtlas.width, shopMetaAtlas.height);
  for (let shopY = 0; shopY < shopMetaRows; shopY += 1) {
    for (let shopX = 0; shopX < shopMetaColumns; shopX += 1) {
      const sourceX = Math.round(shopX * shopMetaSource.naturalWidth / shopMetaColumns);
      const sourceY = Math.round(shopY * shopMetaSource.naturalHeight / shopMetaRows);
      const sourceRight = Math.round((shopX + 1) * shopMetaSource.naturalWidth / shopMetaColumns);
      const sourceBottom = Math.round((shopY + 1) * shopMetaSource.naturalHeight / shopMetaRows);
      const rawShop = document.createElement("canvas");
      rawShop.width = sourceRight - sourceX;
      rawShop.height = sourceBottom - sourceY;
      const rawShopContext = rawShop.getContext("2d", { alpha: true });
      rawShopContext.imageSmoothingEnabled = false;
      rawShopContext.drawImage(
        shopMetaSource,
        sourceX,
        sourceY,
        sourceRight - sourceX,
        sourceBottom - sourceY,
        0,
        0,
        rawShop.width,
        rawShop.height,
      );
      const shopImageData = rawShopContext.getImageData(0, 0, rawShop.width, rawShop.height);
      const shopPixels = shopImageData.data;
      for (let pixel = 0; pixel < rawShop.width * rawShop.height; pixel += 1) {
        const offset = pixel * 4;
        if (Math.max(shopPixels[offset], shopPixels[offset + 1], shopPixels[offset + 2]) < 18) shopPixels[offset + 3] = 0;
      }
      rawShopContext.putImageData(shopImageData, 0, 0);
      const normalizedShop = normalizeCard(rawShop, shopMetaCellOutput);
      shopMetaContext.drawImage(normalizedShop, shopX * shopMetaCellOutput, shopY * shopMetaCellOutput);
    }
  }
  const shopMetaUrl = shopMetaAtlas.toDataURL("image/webp", quality);
  return {
    sheets: sheetOutput,
    cards: cardOutput,
    atlas: atlasUrl.slice(atlasUrl.indexOf(",") + 1),
    meta: metaUrl.slice(metaUrl.indexOf(",") + 1),
    shopMeta: shopMetaUrl.slice(shopMetaUrl.indexOf(",") + 1),
  };
})()`;

const result = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);

for (const item of result.result.value.sheets) {
  const outputName = item.source.replace(/\.png$/u, ".webp");
  await writeFile(resolve(root, "assets", outputName), Buffer.from(item.data, "base64"));
  console.log(`Optimized ${item.source} -> ${outputName}`);
}

const cardOutput = resolve(root, "assets", "cards");
await mkdir(cardOutput, { recursive: true });
for (const item of result.result.value.cards) {
  const outputName = `${item.id}.webp`;
  await writeFile(resolve(cardOutput, outputName), Buffer.from(item.data, "base64"));
  console.log(`Exported card -> cards/${outputName}`);
}
await writeFile(resolve(root, "assets", "cards-atlas.webp"), Buffer.from(result.result.value.atlas, "base64"));
console.log("Exported runtime atlas -> cards-atlas.webp");
await writeFile(resolve(root, "assets", "meta-atlas.webp"), Buffer.from(result.result.value.meta, "base64"));
console.log("Exported UI icon atlas -> meta-atlas.webp");
await writeFile(resolve(root, "assets", "shop-items-atlas-v013.webp"), Buffer.from(result.result.value.shopMeta, "base64"));
console.log("Exported shop item atlas -> shop-items-atlas-v013.webp");

socket.close();
