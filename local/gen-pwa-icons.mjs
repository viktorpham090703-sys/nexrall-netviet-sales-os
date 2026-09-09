// Sinh icon PWA từ logo chính thức (BRAND_LOGO trong src/const.js) — không dùng thư viện ngoài.
// KHÔNG nằm trong luồng build; chỉ chạy lại khi logo thương hiệu thay đổi.
// Decode PNG (palette/RGBA) -> resize box-filter -> đặt giữa nền trắng -> encode PNG RGB.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Chỉ chạy TAY khi logo thương hiệu đổi:  node local/gen-pwa-icons.mjs
// Kết quả ghi thẳng vào static/icons/ (đã commit vào git) — `npm run build` KHÔNG gọi file này.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_CONST = join(root, 'src', 'const.js');
const OUT = process.argv[2] || join(root, 'static', 'icons');

/* ---------- decode ---------- */
function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9];
      if (depth !== 8) throw new Error('chỉ hỗ trợ bit depth 8, gặp ' + depth);
      if (data[12] !== 0) throw new Error('không hỗ trợ ảnh interlaced');
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error('color type không hỗ trợ: ' + ctype);
  const bpp = channels;
  const stride = w * bpp;
  const lines = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    raw.copy(cur, 0, p, p + stride);
    p += stride;
    const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  // -> RGBA
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    let r, g, b, a = 255;
    if (ctype === 3) {
      const idx = lines[i];
      r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (ctype === 6) { r = lines[i * 4]; g = lines[i * 4 + 1]; b = lines[i * 4 + 2]; a = lines[i * 4 + 3]; }
    else if (ctype === 2) { r = lines[i * 3]; g = lines[i * 3 + 1]; b = lines[i * 3 + 2]; }
    else if (ctype === 0) { r = g = b = lines[i]; }
    else { r = g = b = lines[i * 2]; a = lines[i * 2 + 1]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}

/* ---------- resize (box filter, alpha premultiplied) ---------- */
function resize(src, dw, dh) {
  const { w: sw, h: sh, rgba } = src;
  const out = new Float64Array(dw * dh * 4);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          const wgt = wx * wy;
          const i = (yy * sw + xx) * 4;
          const al = rgba[i + 3] / 255;
          r += rgba[i] * al * wgt; g += rgba[i + 1] * al * wgt; b += rgba[i + 2] * al * wgt;
          a += al * wgt; wsum += wgt;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = r / wsum; out[o + 1] = g / wsum; out[o + 2] = b / wsum; out[o + 3] = a / wsum;
    }
  }
  return { w: dw, h: dh, pre: out }; // premultiplied
}

/* ---------- compose lên nền trắng ---------- */
function compose(size, layer, ox, oy, bg = [255, 255, 255]) {
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2]; }
  for (let y = 0; y < layer.h; y++) {
    for (let x = 0; x < layer.w; x++) {
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
      const s = (y * layer.w + x) * 4, d = (dy * size + dx) * 3;
      const a = layer.pre[s + 3];
      px[d] = Math.round(layer.pre[s] + bg[0] * (1 - a));
      px[d + 1] = Math.round(layer.pre[s + 1] + bg[1] * (1 - a));
      px[d + 2] = Math.round(layer.pre[s + 2] + bg[2] * (1 - a));
    }
  }
  return px;
}

/* ---------- encode ---------- */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
let TBL = null;
function crc32(buf) {
  if (!TBL) {
    TBL = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TBL[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
function encodePNG(size, rgb) {
  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 1; // filter Sub — nén tốt cho vùng nền phẳng
    for (let x = 0; x < stride; x++) {
      const v = rgb[y * stride + x] - (x >= 3 ? rgb[y * stride + x - 3] : 0);
      raw[y * (stride + 1) + 1 + x] = v & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- chạy ---------- */
const src = decodePNG(Buffer.from(
  readFileSync(SRC_CONST, 'utf8').match(/BRAND_LOGO = 'data:image\/png;base64,([^']+)'/)[1], 'base64'));
console.log(`logo nguồn: ${src.w}x${src.h}`);

mkdirSync(OUT, { recursive: true });
// ratio = bề rộng logo / cạnh icon. Icon thường 0.84; maskable 0.60 để nằm gọn trong vùng an toàn.
const JOBS = [
  ['icon-192.png', 192, 0.84],
  ['icon-512.png', 512, 0.84],
  ['icon-512-maskable.png', 512, 0.60],
  ['apple-touch-icon.png', 180, 0.84],
];
for (const [name, size, ratio] of JOBS) {
  const lw = Math.round(size * ratio);
  const lh = Math.max(1, Math.round(lw * src.h / src.w));
  const layer = resize(src, lw, lh);
  const png = encodePNG(size, compose(size, layer, Math.round((size - lw) / 2), Math.round((size - lh) / 2)));
  writeFileSync(join(OUT, name), png);
  console.log(`  ${name}  ${size}x${size}  logo ${lw}x${lh}  ${(png.length / 1024).toFixed(1)}KB`);
}
