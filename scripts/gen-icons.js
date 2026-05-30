#!/usr/bin/env node
// ============================================================
// Génère les icônes PWA (PNG) à partir du motif de favicon.svg,
// sans aucune dépendance externe : encodeur PNG maison + zlib natif.
// Lancer : node scripts/gen-icons.js
// ============================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- CRC32 (pour les chunks PNG) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines, filter byte 0 par ligne
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Dessin ----
function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function makeCanvas(size, bg) {
  const buf = Buffer.alloc(size * size * 4);
  const [r, g, b] = hexToRgb(bg);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255;
  }
  return buf;
}
// Remplit un rectangle arrondi (coordonnées flottantes), anti-aliasing simple par sur-échantillon.
function fillRoundRect(buf, size, x, y, w, h, rx, color) {
  const [cr, cg, cb] = hexToRgb(color);
  const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(size, Math.ceil(x + w));
  const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(size, Math.ceil(y + h));
  const SS = 4; // super-sampling
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS;
          const fy = py + (sy + 0.5) / SS;
          if (insideRoundRect(fx, fy, x, y, w, h, rx)) cover++;
        }
      }
      if (!cover) continue;
      const a = cover / (SS * SS);
      const idx = (py * size + px) * 4;
      buf[idx]     = Math.round(buf[idx]     * (1 - a) + cr * a);
      buf[idx + 1] = Math.round(buf[idx + 1] * (1 - a) + cg * a);
      buf[idx + 2] = Math.round(buf[idx + 2] * (1 - a) + cb * a);
      buf[idx + 3] = 255;
    }
  }
}
function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dxL = x + r, dxR = x + w - r, dyT = y + r, dyB = y + h - r;
  let cx = null, cy = null;
  if (px < dxL && py < dyT) { cx = dxL; cy = dyT; }
  else if (px > dxR && py < dyT) { cx = dxR; cy = dyT; }
  else if (px < dxL && py > dyB) { cx = dxL; cy = dyB; }
  else if (px > dxR && py > dyB) { cx = dxR; cy = dyB; }
  if (cx === null) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// Motif favicon en repère 32x32 : 3 barres.
const BARS = [
  { x: 4,  y: 19, w: 6, h: 9,  rx: 1.5, fill: '#9A824A' },
  { x: 13, y: 13, w: 6, h: 15, rx: 1.5, fill: '#E4C068' },
  { x: 22, y: 5,  w: 6, h: 23, rx: 1.5, fill: '#B18BE0' },
];

function drawIcon(size, { bg = '#0E0F13', contentScale = 0.64 } = {}) {
  const buf = makeCanvas(size, bg);
  // Le motif occupe `contentScale` de la toile, centré.
  const art = size * contentScale;
  const offset = (size - art) / 2;
  const k = art / 32;
  for (const b of BARS) {
    fillRoundRect(buf, size, offset + b.x * k, offset + b.y * k, b.w * k, b.h * k, b.rx * k, b.fill);
  }
  return encodePNG(size, size, buf);
}

const ROOT = path.resolve(__dirname, '..');
const outputs = [
  { file: 'icon-192.png', size: 192, opts: { contentScale: 0.66 } },
  { file: 'icon-512.png', size: 512, opts: { contentScale: 0.66 } },
  // Maskable : marge de sécurité (zone safe iOS/Android ~ 80%), motif réduit.
  { file: 'icon-512-maskable.png', size: 512, opts: { contentScale: 0.52 } },
  { file: 'apple-touch-icon.png', size: 180, opts: { contentScale: 0.66 } },
];
for (const o of outputs) {
  const png = drawIcon(o.size, o.opts);
  fs.writeFileSync(path.join(ROOT, o.file), png);
  console.log(`wrote ${o.file} (${o.size}x${o.size}, ${png.length} bytes)`);
}
