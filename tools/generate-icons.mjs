import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'icons');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path, size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixels(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

function insideBell(u, v) {
  const cx = u - 0.5;
  const cy = v - 0.40;
  if (cy <= 0.02 && (cx * cx) / (0.27 * 0.27) + (cy * cy) / (0.27 * 0.27) <= 1) return true;
  if (v >= 0.36 && v <= 0.78) {
    const t = (v - 0.36) / 0.42;
    const half = 0.14 + t * 0.17;
    if (Math.abs(cx) <= half) return true;
  }
  const dx = u - 0.5;
  const dy = v - 0.855;
  if (dx * dx + dy * dy <= 0.055 * 0.055) return true;
  if (v >= 0.76 && v <= 0.82 && Math.abs(cx) <= 0.20) return true;
  return false;
}

function roundedRect(u, v, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(u, x1 - r));
  const cy = Math.max(y0 + r, Math.min(v, y1 - r));
  return (u - cx) * (u - cx) + (v - cy) * (v - cy) <= r * r || (u >= x0 + r && u <= x1 - r && v >= y0 && v <= y1) || (u >= x0 && u <= x1 && v >= y0 + r && v <= y1 - r);
}

function pixel(u, v) {
  const feather = 0.012;
  if (!roundedRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22)) return [0, 0, 0, 0];
  if (insideBell(u, v)) return [255, 255, 255, 255];
  const edge = roundedRect(u, v, 0.015, 0.015, 0.985, 0.985, 0.23);
  return edge ? [0, 120, 212, 255] : [0, 0, 0, 0];
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writePng(join(OUT, `icon-${size}.png`), size, pixel);
  console.log(`wrote icon-${size}.png`);
}
