// Gera os ícones PNG do PWA (sem dependências): quadrado escuro com duas colunas, como no icon.svg.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const s = size / 64;
  const inRect = (x, y, rx, ry, w, h, r) => {
    if (x < rx || y < ry || x >= rx + w || y >= ry + h) return false;
    const cx = Math.min(Math.max(x, rx + r), rx + w - r), cy = Math.min(Math.max(y, ry + r), ry + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      let col = [27, 29, 31, 255]; // fundo (ícone maskable: preenche tudo)
      if (inRect(px, py, 15 * s, 16 * s, 14 * s, 32 * s, 3 * s)) col = [255, 255, 255, 255];
      if (inRect(px, py, 35 * s, 16 * s, 14 * s, 20 * s, 3 * s)) col = [124, 194, 184, 255];
      raw.set(col, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size));
console.log('ícones gerados');
