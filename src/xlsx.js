/**
 * Đọc / ghi bảng tính .xlsx (và .csv) ngay trên trình duyệt — không kéo thư viện ngoài.
 *
 * App không có bước build (src/ phục vụ thẳng dạng ES module), nên thay vì nhúng SheetJS (~1 MB)
 * chỉ để đọc danh sách khách hàng, ở đây tự đọc đúng phần cần: .xlsx là 1 tệp ZIP chứa XML;
 * giải nén bằng DecompressionStream('deflate-raw') có sẵn trong trình duyệt, đọc XML bằng
 * DOMParser. Chỉ lấy GIÁ TRỊ ô của sheet đầu tiên — không cần công thức, định dạng hay ảnh.
 *
 * Ghi: tạo file mẫu .xlsx (ZIP không nén + vài tệp XML tối thiểu mà Excel/Numbers/Google Sheets
 * đều mở được).
 */

/* ============================== ĐỌC ============================== */

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

/** Liệt kê các tệp trong ZIP qua central directory (đáng tin hơn đọc tuần tự local header). */
function zipEntries(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('File không phải định dạng Excel (.xlsx) hợp lệ');
  const count = u16(v, eocd + 10);
  let o = u32(v, eocd + 16);
  const dec = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(v, o) !== 0x02014b50) break;
    const method = u16(v, o + 10), size = u32(v, o + 20);
    const nameLen = u16(v, o + 28), extraLen = u16(v, o + 30), commentLen = u16(v, o + 32);
    const local = u32(v, o + 42);
    const name = dec.decode(new Uint8Array(buf, o + 46, nameLen));
    const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    out.set(name, { method, data: new Uint8Array(buf, start, size) });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method !== 8) throw new Error('File Excel dùng kiểu nén không hỗ trợ');
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Trình duyệt này quá cũ để đọc file Excel — cập nhật trình duyệt, hoặc lưu file dạng .csv rồi nhập lại.');
  }
  const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readXml(files, path) {
  const e = files.get(path);
  if (!e) return null;
  const text = new TextDecoder().decode(await inflate(e));
  return new DOMParser().parseFromString(text, 'application/xml');
}

/* getElementsByTagNameNS('*') để đọc được cả file ghi XML có tiền tố (x:row, x:c…). */
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const kids = (node, name) => [...node.childNodes].filter(n => n.localName === name);

/** Chữ của 1 chuỗi (shared string / inline string): nối các <t>, bỏ phần phiên âm <rPh>. */
const richText = (si) => tags(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('');

/** "C12" → 2 (cột thứ 3, đánh số từ 0). */
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Đường dẫn tệp của sheet đầu tiên theo đúng thứ tự tab trong workbook. */
async function firstSheet(files) {
  const wb = await readXml(files, 'xl/workbook.xml');
  const rels = await readXml(files, 'xl/_rels/workbook.xml.rels');
  const sheet = wb && tags(wb, 'sheet')[0];
  if (sheet && rels) {
    const rid = sheet.getAttribute('r:id') || [...sheet.attributes].find(a => a.localName === 'id')?.value;
    const rel = tags(rels, 'Relationship').find(r => r.getAttribute('Id') === rid);
    if (rel) {
      const target = rel.getAttribute('Target').replace(/^\//, '');
      return { name: sheet.getAttribute('name'), path: target.startsWith('xl/') ? target : 'xl/' + target };
    }
  }
  const any = [...files.keys()].filter(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  return any ? { name: '', path: any } : null;
}

/** Đọc sheet đầu tiên của .xlsx → { sheetName, rows: [{ line, cells: [chuỗi] }] }. */
async function readXlsx(buf) {
  const files = zipEntries(buf);
  const sheet = await firstSheet(files);
  if (!sheet) throw new Error('Không tìm thấy trang tính nào trong file');
  const ssDoc = await readXml(files, 'xl/sharedStrings.xml');
  const shared = ssDoc ? kids(ssDoc.documentElement, 'si').map(richText) : [];
  const doc = await readXml(files, sheet.path);
  if (!doc) throw new Error('Không đọc được trang tính');

  const rows = [];
  tags(doc, 'row').forEach((rowEl, ri) => {
    const line = Number(rowEl.getAttribute('r')) || ri + 1;
    const cells = [];
    kids(rowEl, 'c').forEach((c, ci) => {
      const idx = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : ci;
      const type = c.getAttribute('t');
      const vEl = kids(c, 'v')[0];
      let val = '';
      if (type === 's') val = shared[Number(vEl?.textContent)] ?? '';
      else if (type === 'inlineStr') val = kids(c, 'is')[0] ? richText(kids(c, 'is')[0]) : '';
      else if (type === 'b') val = vEl?.textContent === '1' ? 'TRUE' : 'FALSE';
      else val = vEl ? vEl.textContent : '';
      if (idx >= 0) cells[idx] = val;
    });
    rows.push({ line, cells: Array.from(cells, x => x ?? '') });
  });
  return { sheetName: sheet.name, rows };
}

/** CSV (UTF-8, dấu phẩy hoặc chấm phẩy — Excel tiếng Việt hay xuất bằng chấm phẩy). */
function readCsv(buf) {
  let text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let cells = [], cur = '', q = false, line = 1;
  const pushRow = () => { cells.push(cur); rows.push({ line, cells }); cells = []; cur = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { cells.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow(); line++;
    } else cur += ch;
  }
  if (cur || cells.length) pushRow();
  return { sheetName: '', rows };
}

/** Đọc file người dùng chọn (.xlsx / .csv) → { sheetName, rows }. */
export async function readSpreadsheet(file) {
  const buf = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return readCsv(buf);
  if (/\.xls$/i.test(file.name)) {
    throw new Error('File .xls (Excel 97–2003) chưa được hỗ trợ — mở file bằng Excel, chọn Lưu thành .xlsx rồi nhập lại.');
  }
  return readXlsx(buf);
}

/* ============================== GHI ============================== */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (d) => { let c = 0xFFFFFFFF; for (const b of d) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

/** Gói các tệp thành ZIP không nén (method 0 — Excel đọc bình thường). */
function zipStore(files) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameB = enc.encode(name), data = enc.encode(content), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true);
    locals.push(new Uint8Array(lh.buffer), nameB, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = centrals.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

/**
 * Tạo 1 file .xlsx một trang tính.
 * columns: [{ title, width, text }] — `text: true` định dạng cả cột là Văn bản (giữ số 0 đầu SĐT).
 * rows: mảng các mảng chuỗi. listValidation: { col, values } — ô chọn nhanh (vẫn gõ tự do được).
 */
export function buildXlsx({ sheetName = 'Sheet1', columns, rows = [], listValidation }) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const cell = (ref, v, s) => `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  const header = `<row r="1">${columns.map((c, i) => cell(colName(i) + '1', c.title, 1)).join('')}</row>`;
  const body = rows.map((r, ri) => `<row r="${ri + 2}">${r.map((v, i) => cell(colName(i) + (ri + 2), v, columns[i]?.text ? 2 : 0)).join('')}</row>`).join('');
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 18}" customWidth="1"${c.text ? ' style="2"' : ''}/>`).join('');
  const dv = listValidation
    ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${colName(listValidation.col)}2:${colName(listValidation.col)}1000"><formula1>"${xmlEsc(listValidation.values.join(','))}"</formula1></dataValidation></dataValidations>`
    : '';

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${header}${body}</sheetData>${dv}</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  return zipStore([
    ['[Content_Types].xml', types], ['_rels/.rels', rootRels], ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', wbRels], ['xl/worksheets/sheet1.xml', sheet], ['xl/styles.xml', styles],
  ]);
}

/** Tải 1 Blob về máy dưới tên cho trước. */
export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
