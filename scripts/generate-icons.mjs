import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });

const sizes = [16, 48, 128];

const COLORS = {
  doc: [37, 99, 235],
  fold: [29, 78, 216],
  mark: [239, 68, 68],
};

function createPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const margin = Math.floor(size * 0.1);
  const fold = Math.floor(size * 0.24);
  const markWidth = Math.max(2, Math.floor(size * 0.08));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const inDoc =
        x >= margin && x < size - margin && y >= margin && y < size - margin;
      const inFold =
        x >= size - margin - fold
        && y >= margin
        && y < margin + fold
        && x - (size - margin - fold) + (y - margin) < fold;
      const markY = size - margin - Math.floor(size * 0.22);
      const inMark =
        inDoc
        && !inFold
        && y >= markY - markWidth
        && y <= markY + markWidth
        && x >= margin + Math.floor(size * 0.18)
        && x <= size - margin - Math.floor(size * 0.18);

      if (inMark) {
        pixels[i] = COLORS.mark[0];
        pixels[i + 1] = COLORS.mark[1];
        pixels[i + 2] = COLORS.mark[2];
        pixels[i + 3] = 255;
      } else if (inDoc && !inFold) {
        pixels[i] = COLORS.doc[0];
        pixels[i + 1] = COLORS.doc[1];
        pixels[i + 2] = COLORS.doc[2];
        pixels[i + 3] = 255;
      } else if (inFold) {
        pixels[i] = COLORS.fold[0];
        pixels[i + 1] = COLORS.fold[1];
        pixels[i + 2] = COLORS.fold[2];
        pixels[i + 3] = 255;
      } else {
        pixels[i + 3] = 0;
      }
    }
  }

  return encodePng(size, size, pixels);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of sizes) {
  writeFileSync(resolve(outDir, `icon${size}.png`), createPng(size));
  console.log(`Generated icon${size}.png`);
}
