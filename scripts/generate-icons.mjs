// Generates the PWA icons from the same pixel-art "CE" motif as
// assets/favicon.svg. The repository has no image dependencies installed, so the
// PNGs are encoded here with node:zlib alone. Output is byte-deterministic and
// test/offline.test.js re-runs this logic in memory to catch drift.

import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BACKGROUND = "#120f1c";

// The favicon drawn on a 32x32 grid: outer frame, inner panel, then "CE".
const MOTIF = Object.freeze([
  { x: 0, y: 0, w: 32, h: 32, fill: BACKGROUND },
  { x: 3, y: 3, w: 26, h: 26, fill: "#ffd166" },
  { x: 6, y: 6, w: 20, h: 20, fill: "#292238" },
  { x: 10, y: 10, w: 9, h: 3, fill: "#ffd166" },
  { x: 10, y: 19, w: 9, h: 3, fill: "#ffd166" },
  { x: 10, y: 13, w: 3, h: 6, fill: "#ffd166" },
  { x: 21, y: 10, w: 3, h: 12, fill: "#ffd166" },
]);

const GRID = 32;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

const rgb = (hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/**
 * Rasterizes the motif into raw RGB pixels.
 * `coverage` shrinks the motif inside a full-bleed background, which is what a
 * maskable icon needs so nothing important lands outside the safe zone.
 */
export function renderIcon(size, coverage = 1) {
  const pixels = Buffer.alloc(size * size * 3);
  const [bgR, bgG, bgB] = rgb(BACKGROUND);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = bgR;
    pixels[offset + 1] = bgG;
    pixels[offset + 2] = bgB;
  }

  const inner = Math.max(GRID, Math.round((size * coverage) / GRID) * GRID);
  const unit = inner / GRID;
  const originX = Math.round((size - inner) / 2);
  const originY = Math.round((size - inner) / 2);

  for (const rect of MOTIF) {
    const [r, g, b] = rgb(rect.fill);
    const left = originX + Math.round(rect.x * unit);
    const top = originY + Math.round(rect.y * unit);
    const right = originX + Math.round((rect.x + rect.w) * unit);
    const bottom = originY + Math.round((rect.y + rect.h) * unit);
    for (let y = Math.max(0, top); y < Math.min(size, bottom); y += 1) {
      for (let x = Math.max(0, left); x < Math.min(size, right); x += 1) {
        const offset = (y * size + x) * 3;
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
      }
    }
  }
  return pixels;
}

export function encodePng(size, coverage = 1) {
  const pixels = renderIcon(size, coverage);
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const ICON_TARGETS = Object.freeze([
  { file: "assets/icon-192.png", size: 192, coverage: 1 },
  { file: "assets/icon-512.png", size: 512, coverage: 1 },
  // Maskable icons get cropped to a platform-chosen shape, so the motif is
  // pulled into the inner ~62% safe zone over a full-bleed background.
  { file: "assets/icon-maskable-512.png", size: 512, coverage: 0.625 },
]);

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  for (const target of ICON_TARGETS) {
    const bytes = encodePng(target.size, target.coverage);
    await writeFile(resolve(root, target.file), bytes);
    console.log(`Wrote ${target.file} (${target.size}x${target.size}, ${bytes.length} bytes)`);
  }
}
