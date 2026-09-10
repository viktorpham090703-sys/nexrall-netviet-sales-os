// Sinh TOÀN BỘ icon của app từ logo chính thức (BRAND_LOGO trong src/const.js) — không dùng thư
// viện ngoài. KHÔNG nằm trong luồng build; chỉ chạy lại khi logo thương hiệu thay đổi.
// Decode PNG (palette/RGBA) -> resize box-filter -> đặt giữa nền trắng -> encode PNG RGB (+ ICO).
//
// Phủ hết các hệ điều hành / trình duyệt, mỗi nơi đòi một đường dẫn khác nhau:
//   iOS  : /icons/apple-touch-icon.png (theo thẻ <link>) VÀ /apple-touch-icon.png ở GỐC — iOS tự
//          dò đường dẫn gốc khi không đọc được thẻ, ví dụ trong webview của Zalo/Facebook.
//   Android/Chrome : /icons/icon-192.png, /icons/icon-512.png, và bản maskable để Android cắt theo
//          hình khối của máy (tròn, squircle...) mà không phạm vào chữ.
//   Windows/Edge   : dùng icon-192 làm ô tile qua thẻ msapplication-TileImage.
//   Mọi trình duyệt: /favicon.ico ở GỐC — trình duyệt, trình đọc bookmark và webview đòi thẳng
//          đường dẫn này mà không thèm đọc HTML, không có thì hiện icon trắng mặc định.
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

/* ---------- encode ICO (nhiều kích thước, mỗi mục là 1 PNG) ---------- */
/* ICO từ Windows Vista trở đi cho phép nhúng thẳng PNG thay vì bitmap thô, nên tái dùng luôn
 * encodePNG() ở trên. Cấu trúc: ICONDIR (6 byte) + mỗi ảnh 1 ICONDIRENTRY (16 byte) + dữ liệu. */
function encodeICO(entries) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const heads = [], bodies = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;   // 0 nghĩa là 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4);           // color planes
    e.writeUInt16LE(24, 6);          // bit depth — khớp PNG RGB do encodePNG sinh ra
    e.writeUInt32BE(0, 8); e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    heads.push(e); bodies.push(png);
    offset += png.length;
  }
  return Buffer.concat([dir, ...heads, ...bodies]);
}

/* ---------- chạy ---------- */
const src = decodePNG(Buffer.from(
  readFileSync(SRC_CONST, 'utf8').match(/BRAND_LOGO = 'data:image\/png;base64,([^']+)'/)[1], 'base64'));
console.log(`logo nguồn: ${src.w}x${src.h}`);

mkdirSync(OUT, { recursive: true });
/* ratio = bề rộng logo / cạnh icon.
 * Logo NetViet là chữ NGANG tỉ lệ 5.53:1 và không có lề thừa để cắt bớt, nên đặt vào ô vuông thì
 * chiều cao luôn chỉ bằng ~1/5.5 bề rộng — muốn chữ đọc được ở cỡ icon màn hình chính (~60px thật)
 * thì phải kéo bề rộng sát mép. 0.92 là mức gần tối đa còn chừa viền thở.
 * Riêng maskable: Android cắt theo hình tròn đường kính 80% cạnh icon. Dải ngang rộng 0.76 có góc
 * cách tâm sqrt(0.38² + 0.069²) = 0.386 → nằm trong đường tròn an toàn 0.4, không bị cắt chữ. */
const JOBS = [
  ['icon-192.png', 192, 0.92],
  ['icon-512.png', 512, 0.92],
  ['icon-512-maskable.png', 512, 0.76],
  ['apple-touch-icon.png', 180, 0.92],
  // Favicon: ở cỡ này chữ không còn đọc được, mục tiêu chỉ là ra đúng KHỐI MÀU đỏ thương hiệu
  // thay vì ô trắng mặc định của trình duyệt. Kéo sát mép (0.96) để màu chiếm nhiều pixel nhất.
  ['favicon-16.png', 16, 0.96],
  ['favicon-32.png', 32, 0.96],
  ['favicon-48.png', 48, 0.96],
];

/** Vẽ logo căn giữa trên nền trắng, trả về PNG đã encode. */
function render(size, ratio) {
  const lw = Math.round(size * ratio);
  const lh = Math.max(1, Math.round(lw * src.h / src.w));
  const layer = resize(src, lw, lh);
  return {
    png: encodePNG(size, compose(size, layer, Math.round((size - lw) / 2), Math.round((size - lh) / 2))),
    lw, lh,
  };
}

const made = new Map();
for (const [name, size, ratio] of JOBS) {
  const { png, lw, lh } = render(size, ratio);
  made.set(name, png);
  writeFileSync(join(OUT, name), png);
  console.log(`  icons/${name}  ${size}x${size}  logo ${lw}x${lh}  ${(png.length / 1024).toFixed(1)}KB`);
}

/* Hai tệp phải nằm ở GỐC tên miền, không phải trong /icons/ — trình duyệt và webview đòi đúng
 * đường dẫn này mà không đọc HTML. static/ được build đổ thẳng ra gốc nên ghi vào static/. */
const ROOT = resolve(OUT, '..');
const ico = encodeICO([16, 32, 48].map(size => ({ size, png: made.get(`favicon-${size}.png`) })));
writeFileSync(join(ROOT, 'favicon.ico'), ico);
console.log(`  favicon.ico  16+32+48  ${(ico.length / 1024).toFixed(1)}KB`);

writeFileSync(join(ROOT, 'apple-touch-icon.png'), made.get('apple-touch-icon.png'));
console.log(`  apple-touch-icon.png  (bản dự phòng ở gốc tên miền)`);
