/**
 * Nhập danh sách khách hàng từ Excel — song song với thêm tay từng khách ở CRM.
 *
 * File mẫu của công ty: Doanh nghiệp · Người liên hệ · SĐT · Email · Trạng thái · Ghi chú (nhận
 * thêm Chức vụ, Ngành hàng, Quy mô, Địa chỉ nếu có). Luồng 3 bước:
 *   1. Chọn file (.xlsx / .csv) — trình duyệt tự đọc (src/xlsx.js), tìm dòng tiêu đề theo TÊN cột
 *      nên cột xếp khác thứ tự hay có thêm cột lạ vẫn đọc đúng.
 *   2. Xem trước toàn bộ danh sách: máy chủ kiểm tra thử (dryRun) từng dòng → Hợp lệ / Trùng /
 *      Lỗi. Chữ ở cột Trạng thái của file được quy về trạng thái của app; chữ nào không khớp đúng
 *      tên thì hiện ô chọn để người nhập tự quyết (vd. "Đang liên hệ" → Chăm sóc).
 *   3. Lưu các dòng được chọn → hiện danh sách khách vừa tạo, danh sách CRM phía sau tự tải lại.
 */
import { post } from './api.js';
import { isLead, salesTeamOption, state } from './state.js';
import { esc, chip, toast, modal } from './ui.js';
import { CUSTOMER_STATUSES, statusDef, LEAD_SOURCES, CUSTOMER_SCALE_OPTIONS } from './const.js';
import { readSpreadsheet, buildXlsx, downloadBlob } from './xlsx.js';

const MAX_ROWS = 500;   // khớp IMPORT_MAX_ROWS ở server/routes/crm.js

/** Chuẩn hoá để so chữ: bỏ dấu (đ→d trước, vì đ không có phân rã NFD), thường hoá, gộp khoảng trắng. */
const norm = (s) => String(s ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Tên cột chấp nhận cho từng trường (đã chuẩn hoá). Cột đầu tiên của mỗi mục là tên trong file mẫu. */
const HEADERS = {
  name: ['doanh nghiep', 'ten doanh nghiep', 'cong ty', 'ten cong ty', 'khach hang', 'ten khach hang', 'to chuc', 'don vi'],
  contactName: ['nguoi lien he', 'ten nguoi lien he', 'lien he', 'dau moi', 'nguoi dai dien'],
  contactTitle: ['chuc vu', 'chuc danh', 'vi tri'],
  phone: ['sdt', 'so dien thoai', 'dien thoai', 'dt', 'so dt', 'phone', 'mobile', 'hotline'],
  email: ['email', 'e mail', 'mail', 'thu dien tu'],
  status: ['trang thai', 'tinh trang', 'giai doan'],
  note: ['ghi chu', 'note', 'mo ta', 'nhu cau'],
  industry: ['nganh hang', 'nganh', 'nganh nghe', 'linh vuc'],
  scale: ['quy mo'],
  address: ['dia chi'],
};
const FIELD_OF = new Map(Object.entries(HEADERS).flatMap(([f, names]) => names.map(n => [n, f])));

/** Chữ trạng thái hay gặp trong file nhưng không trùng tên trạng thái của app → gợi ý mặc định. */
const STATUS_ALIASES = {
  'dang lien he': 'cham_soc', 'lien he': 'cham_soc', 'da lien he': 'cham_soc', 'dang cham soc': 'cham_soc',
  'moi': 'khach_moi', 'tiem nang': 'khach_moi', 'chua lien he': 'khach_moi', 'khach tiem nang': 'khach_moi',
  'dang chao hang': 'chao_hang', 'quan tam': 'chao_hang', 'dang tu van': 'chao_hang',
  'da bao gia': 'bao_gia', 'gui bao gia': 'bao_gia', 'dang bao gia': 'bao_gia',
  'ky hop dong': 'hop_dong', 'da ky hop dong': 'hop_dong', 'dang ky hop dong': 'hop_dong', 'da ky': 'hop_dong',
  'da mua': 'da_mua_hang', 'khach cu': 'da_mua_hang', 'da thanh toan': 'da_mua_hang',
};
const STATUS_EXACT = new Map(CUSTOMER_STATUSES.flatMap(s => [[norm(s.n), s.k], [norm(s.k), s.k]]));

/**
 * Excel hay lưu SĐT dạng SỐ nên mất số 0 đầu (0912345678 → 912345678, có khi thành 9.12E+08).
 * Chỉ vá khi ô trông đúng là số bị Excel đổi kiểu; SĐT đã ở dạng chữ giữ nguyên.
 */
function fixPhone(v) {
  let s = String(v ?? '').trim().replace(/^'/, '');
  if (/^\d+(\.0+)?$/.test(s) || /^\d(\.\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
    if (/^[1-9]\d{8}$/.test(s)) s = '0' + s;
  }
  return s;
}

/** Tìm dòng tiêu đề trong 10 dòng đầu: dòng đầu tiên có cột Doanh nghiệp + ít nhất 1 cột đã biết khác. */
function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const map = {};
    rows[i].cells.forEach((c, ci) => { const f = FIELD_OF.get(norm(c)); if (f && map[f] == null) map[f] = ci; });
    if (map.name != null && Object.keys(map).length >= 2) return { index: i, map };
  }
  return null;
}

/** Bảng tính → danh sách dòng khách hàng (bỏ dòng trống hoàn toàn). */
function toCustomerRows(sheet) {
  const head = detectHeader(sheet.rows);
  if (!head) {
    throw new Error('Không tìm thấy dòng tiêu đề. Dòng đầu của file cần có cột "Doanh nghiệp" và các cột như file mẫu (Người liên hệ, SĐT, Email, Trạng thái, Ghi chú).');
  }
  const get = (cells, f) => head.map[f] == null ? '' : String(cells[head.map[f]] ?? '').trim();
  const out = [];
  for (const r of sheet.rows.slice(head.index + 1)) {
    if (!r.cells.some(c => String(c ?? '').trim())) continue;
    const scaleRaw = get(r.cells, 'scale');
    out.push({
      line: r.line,
      name: get(r.cells, 'name'),
      contactName: get(r.cells, 'contactName'),
      contactTitle: get(r.cells, 'contactTitle'),
      phone: fixPhone(get(r.cells, 'phone')),
      email: get(r.cells, 'email'),
      statusRaw: get(r.cells, 'status'),
      note: get(r.cells, 'note'),
      industry: get(r.cells, 'industry'),
      scale: CUSTOMER_SCALE_OPTIONS.find(o => norm(o) === norm(scaleRaw)) || scaleRaw,
      address: get(r.cells, 'address'),
    });
  }
  return { rows: out, columns: Object.keys(head.map) };
}

/** Tách ô Trạng thái (có thể ghi nhiều, cách nhau bởi dấu phẩy / chấm phẩy / xuống dòng). */
const statusParts = (raw) => String(raw || '').split(/[,;|\n]+/).map(s => s.trim()).filter(Boolean);

/** Tải file mẫu đúng cấu trúc công ty, cột Trạng thái có sẵn danh sách chọn. */
export function downloadTemplate() {
  const blob = buildXlsx({
    sheetName: 'Khách hàng',
    columns: [
      { title: 'Doanh nghiệp', width: 32 }, { title: 'Người liên hệ', width: 22 },
      { title: 'SĐT', width: 16, text: true }, { title: 'Email', width: 28 },
      { title: 'Trạng thái', width: 18 }, { title: 'Ghi chú', width: 44 },
    ],
    listValidation: { col: 4, values: CUSTOMER_STATUSES.map(s => s.n) },
  });
  downloadBlob(blob, 'Mau_ds_khach_hang.xlsx');
}

/**
 * Bước 1 — chọn file. `ctx.sales` là danh sách sale (chỉ có với TP/Admin) để gán người phụ trách.
 * `after()` được gọi sau khi đã lưu để màn CRM tải lại.
 */
export function openCustomerImport(ctx, after) {
  const { root } = modal({
    title: 'Nhập danh sách khách hàng từ Excel',
    titleIcon: 'fileSpreadsheet',
    html: `
      <div class="note mb sm">Dùng file theo mẫu của công ty. Cột bắt buộc: <b>Doanh nghiệp</b>. Các cột khác:
        Người liên hệ, SĐT, Email, Trạng thái, Ghi chú. Có thể thêm Chức vụ, Ngành hàng, Quy mô, Địa chỉ.
        Thứ tự cột không quan trọng, app đọc theo tên cột ở dòng tiêu đề.</div>
      <button type="button" class="btn sm mb" data-tpl>Tải file mẫu (.xlsx)</button>
      <label class="f"><span>Chọn file Excel (.xlsx) hoặc CSV *</span>
        <input type="file" name="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label>
      <div class="xs mut">Tối đa ${MAX_ROWS} khách hàng mỗi lần. Bạn sẽ xem lại toàn bộ danh sách trước khi lưu.</div>`,
    submitText: 'Đọc file',
    onSubmit: async (_v, r) => {
      const file = r.querySelector('input[type=file]').files[0];
      if (!file) { toast('Chọn file Excel trước', 'err'); return false; }
      const parsed = toCustomerRows(await readSpreadsheet(file));
      if (!parsed.rows.length) { toast('File không có dòng khách hàng nào dưới dòng tiêu đề', 'err'); return false; }
      if (parsed.rows.length > MAX_ROWS) {
        toast(`File có ${parsed.rows.length} dòng — mỗi lần chỉ nhập tối đa ${MAX_ROWS}. Chia file nhỏ hơn.`, 'err');
        return false;
      }
      await openPreview({ ...ctx, file, parsed }, after);
    },
  });
  root.querySelector('[data-tpl]').onclick = downloadTemplate;
  // Chọn file xong là đọc luôn, không bắt bấm thêm nút.
  root.querySelector('input[type=file]').onchange = () => root.querySelector('[data-form]').requestSubmit();
}

/** Payload gửi máy chủ cho 1 dòng — trạng thái đã quy đổi theo bảng `statusMap`. */
const payloadRow = (r, statusMap) => ({
  line: r.line, name: r.name, contactName: r.contactName, contactTitle: r.contactTitle,
  phone: r.phone, email: r.email, note: r.note, industry: r.industry, scale: r.scale, address: r.address,
  statuses: [...new Set(statusParts(r.statusRaw).map(p => statusMap.get(norm(p))).filter(Boolean))],
});

/** Bước 2 — xem trước toàn bộ danh sách, kiểm tra thử trên máy chủ rồi mới lưu. */
async function openPreview({ sales = [], file, parsed }, after) {
  const rows = parsed.rows;
  const lead = isLead();

  // Bảng quy đổi trạng thái: khoá = chữ đã chuẩn hoá. Khớp đúng tên → dùng luôn, không hỏi;
  // còn lại (kể cả chữ có gợi ý sẵn) đưa vào ô chọn để người nhập xác nhận.
  const statusMap = new Map();
  const toConfirm = new Map();   // khoá → { raw, count }
  for (const r of rows) {
    for (const part of statusParts(r.statusRaw)) {
      const k = norm(part);
      if (STATUS_EXACT.has(k)) { statusMap.set(k, STATUS_EXACT.get(k)); continue; }
      if (!toConfirm.has(k)) { toConfirm.set(k, { raw: part, count: 0 }); statusMap.set(k, STATUS_ALIASES[k] || 'khach_moi'); }
      toConfirm.get(k).count++;
    }
  }

  let ownerId = state.me?.id || '';
  let source = '';
  const check = await post('/customers/import', {
    dryRun: true, rows: rows.map(r => payloadRow(r, statusMap)),
  });
  const result = new Map(check.results.map(x => [x.line, x]));
  const selected = new Set(rows.filter(r => result.get(r.line)?.ok).map(r => r.line));

  const counts = {
    ok: check.results.filter(x => x.ok).length,
    dup: check.results.filter(x => x.duplicate).length,
    err: check.results.filter(x => !x.ok && !x.duplicate).length,
  };

  const rowStatuses = (r) => {
    const ks = [...new Set(statusParts(r.statusRaw).map(p => statusMap.get(norm(p))).filter(Boolean))];
    return ks.length ? ks : ['khach_moi'];
  };
  const verdict = (x) => {
    if (!x) return chip('Chưa kiểm tra', 'grey');
    if (x.ok) return chip('Hợp lệ', 'green');
    if (x.duplicate?.inFileLine) return `${chip('Trùng trong file', 'amber')}<div class="xs mut">giống dòng ${esc(x.duplicate.inFileLine)}</div>`;
    if (x.duplicate) {
      return `${chip('Đã có', 'amber')}<div class="xs mut">${x.duplicate.mine
        ? `trong danh sách của bạn (${esc(x.duplicate.name)})`
        : `${esc(x.duplicate.ownerName || 'sale khác')} đang giữ "${esc(x.duplicate.name)}"`}</div>`;
    }
    return `${chip('Lỗi', 'red')}<div class="xs mut">${esc(x.error)}</div>`;
  };
  const cell = (v) => v ? esc(v) : '<span class="mut">—</span>';
  const bodyHtml = () => rows.map(r => {
    const x = result.get(r.line);
    return `<tr class="${x?.ok ? '' : 'imp-off'}">
      <td><input type="checkbox" data-row="${r.line}" ${selected.has(r.line) ? 'checked' : ''} ${x?.ok ? '' : 'disabled'} aria-label="Chọn dòng ${r.line}"></td>
      <td class="mut">${r.line}</td>
      <td><b>${cell(r.name)}</b>${r.industry ? `<div class="xs mut">${esc(r.industry)}</div>` : ''}</td>
      <td>${cell(r.contactName)}${r.contactTitle ? `<div class="xs mut">${esc(r.contactTitle)}</div>` : ''}</td>
      <td style="white-space:nowrap">${cell(r.phone)}</td>
      <td>${cell(r.email)}</td>
      <td>${rowStatuses(r).map(k => chip(statusDef(k).n, statusDef(k).c)).join(' ')}
        ${r.statusRaw ? `<div class="xs mut">file: ${esc(r.statusRaw)}</div>` : ''}</td>
      <td class="imp-note">${cell(r.note)}</td>
      <td>${verdict(x)}</td>
    </tr>`;
  }).join('');

  const statusOptions = (cur) => CUSTOMER_STATUSES.map(s => `<option value="${s.k}" ${s.k === cur ? 'selected' : ''}>${esc(s.n)}</option>`).join('');
  const submitLabel = () => `Lưu ${selected.size} khách hàng vào hệ thống`;

  const { root } = modal({
    title: 'Xem trước danh sách khách hàng',
    titleIcon: 'fileSpreadsheet',
    wide: 'xl',
    html: `
      <div class="sm mut mb">${esc(file.name)} · ${rows.length} dòng khách hàng</div>
      <div class="row wrap mb" style="gap:6px">
        ${chip(counts.ok + ' hợp lệ', 'green')}
        ${counts.dup ? chip(counts.dup + ' trùng — sẽ bỏ qua', 'amber') : ''}
        ${counts.err ? chip(counts.err + ' lỗi — sửa trong file rồi nhập lại', 'red') : ''}
      </div>

      <div class="grid g2">
        ${lead ? `<label class="f"><span>Sale phụ trách cả danh sách</span><select data-owner>${sales.map(salesTeamOption)
          .map(o => `<option value="${esc(o.v)}" ${o.v === ownerId ? 'selected' : ''}>${esc(o.n)}</option>`).join('')}</select></label>` : ''}
        <label class="f"><span>Nguồn khách hàng</span><select data-source>
          <option value="">— chưa rõ —</option>${LEAD_SOURCES.map(s => `<option value="${esc(s.v)}">${esc(s.n)}</option>`).join('')}</select></label>
      </div>

      ${toConfirm.size ? `<div class="card mb">
        <div class="b sm">Quy đổi trạng thái trong file</div>
        <div class="xs mut mb">Các chữ dưới đây không trùng tên trạng thái của app — chọn trạng thái tương ứng.</div>
        ${[...toConfirm].map(([k, t]) => `<label class="f imp-map"><span>"${esc(t.raw)}" · ${t.count} dòng</span>
          <select data-map="${esc(k)}">${statusOptions(statusMap.get(k))}</select></label>`).join('')}
      </div>` : ''}

      <div class="scroll-x imp-wrap">
        <table class="tbl imp-tbl">
          <thead><tr>
            <th><input type="checkbox" data-all ${selected.size ? 'checked' : ''} aria-label="Chọn tất cả dòng hợp lệ"></th>
            <th>Dòng</th><th>Doanh nghiệp</th><th>Người liên hệ</th><th>SĐT</th><th>Email</th><th>Trạng thái</th><th>Ghi chú</th><th>Kiểm tra</th>
          </tr></thead>
          <tbody data-body>${bodyHtml()}</tbody>
        </table>
      </div>
      <div class="xs mut mt">Khách trùng (theo tên hoặc SĐT) luôn bị bỏ qua để giữ quyền ĐKKH của sale đang chăm sóc.
        ĐKKH của khách mới tính từ hôm nay. Người liên hệ trong file được lưu là người liên hệ chính.</div>`,
    submitText: submitLabel(),
    onSubmit: async () => {
      if (!selected.size) { toast('Chưa chọn dòng nào để lưu', 'err'); return false; }
      const picked = rows.filter(r => selected.has(r.line));
      const res = await post('/customers/import', {
        rows: picked.map(r => payloadRow(r, statusMap)),
        ownerId: lead ? ownerId : undefined,
        nguonKhachHang: source || undefined,
      });
      if (res.created) after();
      showResult(picked, res);
    },
  });

  const body = root.querySelector('[data-body]');
  const submitBtn = root.querySelector('button[type=submit]');
  const all = root.querySelector('[data-all]');
  const sync = () => {
    submitBtn.textContent = submitLabel();
    all.checked = selected.size > 0 && selected.size === counts.ok;
    all.indeterminate = selected.size > 0 && selected.size < counts.ok;
  };
  body.onchange = (e) => {
    const line = Number(e.target.dataset.row);
    if (!line) return;
    if (e.target.checked) selected.add(line); else selected.delete(line);
    sync();
  };
  all.onchange = () => {
    rows.forEach(r => { if (result.get(r.line)?.ok) { if (all.checked) selected.add(r.line); else selected.delete(r.line); } });
    body.innerHTML = bodyHtml();
    sync();
  };
  root.querySelectorAll('[data-map]').forEach(s => s.onchange = () => { statusMap.set(s.dataset.map, s.value); body.innerHTML = bodyHtml(); });
  const ownerSel = root.querySelector('[data-owner]');
  if (ownerSel) { ownerId = ownerSel.value; ownerSel.onchange = () => { ownerId = ownerSel.value; }; }
  root.querySelector('[data-source]').onchange = (e) => { source = e.target.value; };
  sync();
}

/** Bước 3 — kết quả: danh sách khách vừa tạo (bấm vào để mở chi tiết) + các dòng bị bỏ qua. */
function showResult(picked, res) {
  const byLine = new Map(picked.map(r => [r.line, r]));
  const created = res.results.filter(x => x.ok && x.id);
  const skipped = res.results.filter(x => !x.ok);
  modal({
    title: created.length ? `Đã lưu ${created.length} khách hàng` : 'Chưa lưu được khách hàng nào',
    titleIcon: created.length ? 'circleCheck' : 'triangleAlert',
    wide: true,
    html: `
      ${created.length ? `<div class="sm mut mb">Khách đã vào CRM và đứng đầu danh sách. Bấm tên khách để mở chi tiết.</div>
      <div class="card mb">${created.map(x => {
        const r = byLine.get(x.line) || {};
        return `<a class="item" href="#/crm/${esc(x.id)}">
          <div class="grow"><div class="t">${esc(r.name)}</div>
            <div class="d">${[r.contactName, r.phone, r.email].filter(Boolean).map(esc).join(' · ') || 'Chưa có thông tin liên hệ'}</div></div>
        </a>`;
      }).join('')}</div>` : ''}
      ${skipped.length ? `<div class="note red sm">${skipped.length} dòng không được lưu (có thể vừa có người đăng ký trùng):
        <ul style="margin:6px 0 0;padding-left:18px">${skipped.map(x => `<li>Dòng ${esc(x.line)} — ${esc(byLine.get(x.line)?.name || '')}:
          ${esc(x.error || (x.duplicate?.inFileLine ? 'trùng dòng ' + x.duplicate.inFileLine : 'đã có trong hệ thống'))}</li>`).join('')}</ul></div>` : ''}`,
    submitText: 'Đóng',
    onSubmit: () => {},
  });
}
