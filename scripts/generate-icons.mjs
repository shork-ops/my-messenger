// Generates PWA icons without external dependencies: a dark tile with a yellow "N".
// Writes PNGs (for the manifest and the favicon) plus a tiny ICO fallback.
import { deflateSync, crc32 } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const BACKGROUND = [8, 9, 11, 255];
const ACCENT = [255, 212, 0, 255];

/** Returns true when the normalized point (nx, ny) belongs to the logo glyph. */
function isGlyph(nx, ny) {
  if (nx < 0.22 || nx > 0.78 || ny < 0.2 || ny > 0.8) return false;
  const stroke = 0.14;
  const leftBar = nx <= 0.22 + stroke;
  const rightBar = nx >= 0.78 - stroke;
  // Diagonal from the top of the left bar to the bottom of the right bar.
  const t = (ny - 0.2) / 0.6;
  const diagonalCenter = 0.22 + t * 0.56;
  const diagonal = Math.abs(nx - diagonalCenter) <= stroke / 2;
  return leftBar || rightBar || diagonal;
}

/** Rasterizes the rounded tile + glyph into RGBA pixels. `scale` shrinks the glyph inside the tile. */
function rasterize(size, scale = 1) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = Math.min(x + 0.5, size - x - 0.5);
      const cy = Math.min(y + 0.5, size - y - 0.5);
      const outside = Math.hypot(Math.max(0, radius - cx), Math.max(0, radius - cy)) > radius;
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const glyphX = (nx - 0.5) / scale + 0.5;
      const glyphY = (ny - 0.5) / scale + 0.5;
      const color = !outside && isGlyph(glyphX, glyphY) ? ACCENT : BACKGROUND;
      pixels.set(color, (y * size + x) * 4);
    }
  }
  return pixels;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeBmp32(size, pixels) {
  const headerSize = 40;
  const pixelBytes = Buffer.alloc(size * size * 4);
  // BMP stores rows bottom-up as BGRA.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      const target = ((size - 1 - y) * size + x) * 4;
      pixelBytes[target] = pixels[source + 2];
      pixelBytes[target + 1] = pixels[source + 1];
      pixelBytes[target + 2] = pixels[source];
      pixelBytes[target + 3] = pixels[source + 3];
    }
  }
  const maskBytes = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(headerSize, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // height covers the XOR bitmap and the AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(pixelBytes.length + maskBytes.length, 20);
  return Buffer.concat([header, pixelBytes, maskBytes]);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size;
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(entry.data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

await mkdir(outputDirectory, { recursive: true });

const anySizes = [192, 512];
for (const size of anySizes) {
  await writeFile(resolve(outputDirectory, `icon-${size}.png`), encodePng(size, rasterize(size)));
}
// Maskable icons keep the glyph inside the safe inner 80%.
await writeFile(resolve(outputDirectory, "maskable-192.png"), encodePng(192, rasterize(192, 0.8)));
await writeFile(resolve(outputDirectory, "maskable-512.png"), encodePng(512, rasterize(512, 0.8)));
await writeFile(resolve(outputDirectory, "apple-touch-icon.png"), encodePng(180, rasterize(180)));
await writeFile(resolve(outputDirectory, "favicon-32.png"), encodePng(32, rasterize(32)));

const icoSizes = [16, 32, 48];
await writeFile(
  resolve(outputDirectory, "favicon.ico"),
  encodeIco(icoSizes.map((size) => ({ size, data: encodeBmp32(size, rasterize(size)) })))
);

console.log(`Generated PWA icons in ${outputDirectory}`);
