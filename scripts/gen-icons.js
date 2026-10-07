#!/usr/bin/env node
// ============================================================
// Génère les icônes PWA (PNG) à partir du monogramme de favicon.svg
// (« deux arcs d'aurore »), sans aucune dépendance externe : encodeur PNG
// maison + zlib natif.
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

// ---- Dessin : monogramme « deux arcs d'aurore » de favicon.svg (repère 32 × 32) ----
// Fond : dégradé diagonal #8F7BFF → #6C47FF (55 %) → #1AA0C4, du coin haut gauche au coin bas droit.
// Deux arcs blancs à bouts ronds : l'extérieur plein (2,6), l'intérieur à 60 % d'opacité (2,2).
const STOPS = [[0, [0x8F, 0x7B, 0xFF]], [0.55, [0x6C, 0x47, 0xFF]], [1, [0x1A, 0xA0, 0xC4]]];
function gradientAt(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
    if (t <= t1) { const u = (t - t0) / (t1 - t0); return c0.map((v, k) => v + (c1[k] - v) * u); }
  }
  return STOPS[STOPS.length - 1][1];
}
// « M7 21c3-7 6-10 9-10s6 3 9 10 » et « M11 22.5c1.6-3.4 3.3-5 5-5s3.4 1.6 5 5 », en absolu
// (le point de contrôle du « s » est le symétrique du précédent).
const ARCS = [
  { width: 2.6, opacity: 1, curves: [[[7, 21], [10, 14], [13, 11], [16, 11]], [[16, 11], [19, 11], [22, 14], [25, 21]]] },
  { width: 2.2, opacity: 0.6, curves: [[[11, 22.5], [12.6, 19.1], [14.3, 17.5], [16, 17.5]], [[16, 17.5], [17.7, 17.5], [19.4, 19.1], [21, 22.5]]] },
];
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
}
// Arc aplati en segments (repère de la toile) : la distance à cette polyligne donne le trait,
// bouts et jonctions ronds compris.
function flatten(arc, map) {
  const pts = [];
  arc.curves.forEach((c, ci) => { for (let i = ci ? 1 : 0; i <= 48; i++) pts.push(map(bezier(c[0], c[1], c[2], c[3], i / 48))); });
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  return segs;
}
function distToSegs(x, y, segs) {
  let best = Infinity;
  for (const [[ax, ay], [bx, by]] of segs) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    const ex = ax + t * dx - x, ey = ay + t * dy - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
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

// rounded : coins arrondis transparents comme favicon.svg (rayon 9/32), sinon fond plein cadre
// (iOS et les icônes maskable appliquent leur propre masque). art : part de la toile occupée par
// le repère 32 × 32 du monogramme, centré.
function drawIcon(size, { rounded = false, art = 1 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const k = size * art / 32, off = (size - size * art) / 2;
  const map = ([x, y]) => [off + x * k, off + y * k];
  const arcs = ARCS.map((a) => ({ half: a.width * k / 2, opacity: a.opacity, segs: flatten(a, map) }));
  const r = size * 9 / 32;
  const SS = 4; // sur-échantillonnage 4 × 4 aux bords
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Couverture du fond (coins arrondis)
      let bg = 1;
      if (rounded) {
        let n = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (insideRoundRect(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, 0, 0, size, size, r)) n++;
        bg = n / (SS * SS);
      }
      const idx = (py * size + px) * 4;
      if (!bg) { buf[idx + 3] = 0; continue; }
      let [cr, cg, cb] = gradientAt((px + 0.5 + py + 0.5) / (2 * size));
      for (const a of arcs) {
        // Couverture du trait : pleine ou nulle loin du bord, sur-échantillonnée à moins d'un pixel.
        const d = distToSegs(px + 0.5, py + 0.5, a.segs);
        let cov;
        if (d <= a.half - 0.75) cov = 1;
        else if (d >= a.half + 0.75) cov = 0;
        else {
          let n = 0;
          for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (distToSegs(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, a.segs) <= a.half) n++;
          cov = n / (SS * SS);
        }
        const al = cov * a.opacity;
        cr += (255 - cr) * al; cg += (255 - cg) * al; cb += (255 - cb) * al;
      }
      buf[idx] = Math.round(cr); buf[idx + 1] = Math.round(cg); buf[idx + 2] = Math.round(cb);
      buf[idx + 3] = Math.round(bg * 255);
    }
  }
  return encodePNG(size, size, buf);
}

const ROOT = path.resolve(__dirname, '..');
const outputs = [
  { file: 'icon-192.png', size: 192, opts: { rounded: true } },
  { file: 'icon-512.png', size: 512, opts: { rounded: true } },
  // Maskable : fond plein cadre, monogramme réduit pour tenir dans la zone de sécurité
  // (disque central de rayon 40 % : les arcs restent sous 30 % du centre).
  { file: 'icon-512-maskable.png', size: 512, opts: { art: 0.8 } },
  // iOS arrondit lui-même et noircit la transparence : fond plein cadre.
  { file: 'apple-touch-icon.png', size: 180, opts: {} },
];
for (const o of outputs) {
  const png = drawIcon(o.size, o.opts);
  fs.writeFileSync(path.join(ROOT, o.file), png);
  console.log(`wrote ${o.file} (${o.size}x${o.size}, ${png.length} bytes)`);
}
