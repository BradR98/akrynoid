// Generates the PWA icons (dependency-free: own rasteriser + PNG encoder via zlib). Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const BRICKS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5'];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Colour at (u,v) in 0..1. All artwork sits inside the central ~70% so the icon survives maskable cropping. */
function scene(u, v) {
  let c = [5 + 10 * v, 6 + 12 * v, 15 + 30 * v];                         // dark navy gradient
  const inRect = (x0, y0, x1, y1) => u >= x0 && u < x1 && v >= y0 && v < y1;
  // brick wall: 6 rows x 5 cols
  for (let r = 0; r < 6; r++) for (let k = 0; k < 5; k++) {
    const x0 = 0.18 + k * 0.128, y0 = 0.2 + r * 0.075;
    if (inRect(x0 + 0.006, y0 + 0.006, x0 + 0.122, y0 + 0.069)) {
      c = hex(BRICKS[r]);
      if (v < y0 + 0.022) c = c.map((q) => Math.min(255, q + 55));      // top highlight
    }
  }
  const d = Math.hypot(u - 0.56, v - 0.73);                                // ball
  if (d < 0.045) c = [255, 255, 255];
  if (inRect(0.34, 0.8, 0.66, 0.845)) c = [154, 165, 255];                // Vaus
  if (inRect(0.34, 0.8, 0.385, 0.845) || inRect(0.615, 0.8, 0.66, 0.845)) c = [207, 216, 255];
  return c;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size) {
  const SS = 3, raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;                                         // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = scene((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size); r += c[0]; g += c[1]; b += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3, n = SS * SS;
      raw[o] = r / n; raw[o + 1] = g / n; raw[o + 2] = b / n;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
for (const s of [180, 192, 512]) { writeFileSync(join(OUT, `icon-${s}.png`), png(s)); console.log(`icons/icon-${s}.png`); }
