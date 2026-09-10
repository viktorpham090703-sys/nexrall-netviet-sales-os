import { get, post, patch } from './api.js';
import { state, isAdmin } from './state.js';

/* Vòng duyệt mà chính người đang thao tác là người duyệt sẽ được máy chủ bỏ qua — xem
 * skippedRounds() ở server/routes/deals.js. Ở đây chỉ dùng để viết đúng chữ trên nút và gợi ý,
 * máy chủ mới là nơi quyết định trạng thái thật. */
const isManager = () => state.me?.role === 'manager';
import { esc, money, vnd, chip, empty, fmtDate, toast, modal } from './ui.js';
import { QUOTE_STATUS, CONTRACT_STATUS } from './const.js';
import { aiModal } from './aiPref.js';
import { icon } from './icons.js';

/**
 * Chứng từ bán hàng dùng chung: BÁO GIÁ (nv_quotes) và HỢP ĐỒNG (nv_contracts).
 *
 * Trước đây toàn bộ phần này nằm trong views/saleskit.js và được console.js/activity.js import
 * ngược lại từ đó. Từ khi báo giá & hợp đồng chuyển sang "Phương án kinh doanh" (views/plans.js),
 * saleskit.js chỉ còn bảng gói dịch vụ + hoa hồng Partner — nên phần dùng chung tách ra module
 * trung lập này để 3 màn hình (Phương án, Console đội, Lịch & Hoạt động) cùng dùng một bản logic,
 * không màn nào phải import view của màn khác.
 */

/** true nếu người đang xem có quyền duyệt vòng của báo giá `q` (V1=TPKD/Admin, V2=Admin/BGĐ —
 * vai trò Giám đốc đã sáp nhập vào Admin, không còn tách riêng). */
export const canDecide = (q) => (q.status === 'pending_v1' && ['manager', 'admin'].includes(state.me.role))
  || (q.status === 'pending_v2' && state.me.role === 'admin');
/** Tương tự canDecide nhưng cho hợp đồng — vòng 2 là HCNS (hr) thay vì Giám đốc. */
export const canDecideContract = (c) => (c.status === 'pending_v1' && ['manager', 'admin'].includes(state.me.role))
  || (c.status === 'pending_v2' && ['hr', 'admin'].includes(state.me.role));
/** true nếu vòng hiện tại của chứng từ đang bị yêu cầu điều chỉnh và người xem là chủ chứng từ. */
export const needsResubmit = (q) => q.owner_id === state.me.id
  && ((q.status === 'pending_v1' && q.v1_decision === 'revise') || (q.status === 'pending_v2' && q.v2_decision === 'revise'));

/* ================= Dòng danh sách ================= */

export function quoteItem(q) {
  const revise = needsResubmit(q);
  return `<div class="item">
      <div class="dot-i">${icon('fileText')}</div>
      <div class="grow"><div class="t">${esc(q.title)}</div>
        <div class="d">${esc(q.customer_name || '')}${q.owner_name ? ' · ' + esc(q.owner_name) : ''} · ${fmtDate(q.created_at)}</div>
        <div class="d xs">Gốc ${money(q.subtotal)} → CK ${q.discount_pct}% → <b>${vnd(q.total)}</b> · HH ${vnd(q.commission)}</div>
        <div class="row wrap mt" style="gap:6px">${chip(QUOTE_STATUS[q.status]?.n, QUOTE_STATUS[q.status]?.c)}</div>
        ${revise ? `<div class="sm mt" style="color:var(--red)">✏️ ${esc((q.status === 'pending_v1' ? q.v1_note : q.v2_note) || 'Cần điều chỉnh lại báo giá.')}</div>` : ''}
      </div>
      <div class="right">
        <button class="btn sm" data-view="${esc(q.id)}">Xem</button>
        <div class="mt"><button class="btn sm" data-aiq="${esc(q.id)}">${icon('bot', 14)} AI</button></div>
        <div class="mt"><button class="btn sm" data-docs="${esc(q.id)}">${icon('fileText', 14)} Tài liệu</button></div>
        ${revise ? `<div class="mt"><button class="btn sm amber" data-resubmit="${esc(q.id)}">Sửa & gửi lại</button></div>` : ''}
        ${canDecide(q) ? `<div class="mt"><button class="btn sm amber" data-ok="${esc(q.id)}">Duyệt</button></div>
          <div class="mt"><button class="btn sm" data-revise="${esc(q.id)}">Yêu cầu điều chỉnh</button></div>` : ''}
      </div></div>`;
}

export function contractItem(c) {
  const revise = needsResubmit(c);
  return `<div class="item">
      <div class="dot-i">${icon('penLine')}</div>
      <div class="grow"><div class="t">${esc(c.title)}</div>
        <div class="d">${esc(c.customer_name || '')}${c.owner_name ? ' · ' + esc(c.owner_name) : ''} · ${fmtDate(c.created_at)}</div>
        <div class="d xs">Giá trị: <b>${vnd(c.value)}</b></div>
        <div class="row wrap mt" style="gap:6px">${chip(CONTRACT_STATUS[c.status]?.n, CONTRACT_STATUS[c.status]?.c)}</div>
        ${revise ? `<div class="sm mt" style="color:var(--red)">✏️ ${esc((c.status === 'pending_v1' ? c.v1_note : c.v2_note) || 'Cần điều chỉnh lại hợp đồng.')}</div>` : ''}
      </div>
      <div class="right">
        <button class="btn sm" data-view-contract="${esc(c.id)}">Xem</button>
        <div class="mt"><button class="btn sm" data-docs-contract="${esc(c.id)}">${icon('fileText', 14)} Tài liệu</button></div>
        ${revise ? `<div class="mt"><button class="btn sm amber" data-resubmit-contract="${esc(c.id)}">Sửa & gửi lại</button></div>` : ''}
        ${canDecideContract(c) ? `<div class="mt"><button class="btn sm amber" data-ok-contract="${esc(c.id)}">Duyệt</button></div>
          <div class="mt"><button class="btn sm" data-revise-contract="${esc(c.id)}">Yêu cầu điều chỉnh</button></div>` : ''}
      </div></div>`;
}

/* ================= Modal xem chi tiết ================= */

export function viewQuoteModal(q) {
  let items = [];
  try { items = JSON.parse(q.items || '[]'); } catch (e) { items = []; }
  modal({
    title: q.title, submitText: 'Đóng', onSubmit: () => true,
    html: `<div class="sm mut mb">${esc(q.customer_name || '')} · ${fmtDate(q.created_at)}</div>
      <table class="tbl"><tr><th>Hạng mục</th><th class="right">SL</th><th class="right">Đơn giá</th></tr>
      ${items.map(i => `<tr><td>${esc(i.name)}</td><td class="right">${i.qty}</td><td class="right">${vnd(i.price)}</td></tr>`).join('')}
      </table>
      <div class="mt sm">Tạm tính: <b>${vnd(q.subtotal)}</b></div>
      <div class="sm">Chiết khấu: <b>${q.discount_pct}%</b></div>
      <div class="sm">Thành tiền: <b style="color:#F59E0B">${vnd(q.total)}</b></div>
      <div class="sm">Hoa hồng dự kiến: <b>${vnd(q.commission)}</b></div>
      ${q.v1_note ? `<div class="sm mt">Ghi chú V1: ${esc(q.v1_note)}</div>` : ''}
      ${q.v2_note ? `<div class="sm mt">Ghi chú V2: ${esc(q.v2_note)}</div>` : ''}`,
  });
}

export function viewContractModal(c) {
  modal({
    title: c.title, submitText: 'Đóng', onSubmit: () => true,
    html: `<div class="sm mut mb">${esc(c.customer_name || '')}${c.deal_title ? ' · ' + esc(c.deal_title) : ''} · ${fmtDate(c.created_at)}</div>
      <div class="sm">Giá trị hợp đồng: <b style="color:#F59E0B">${vnd(c.value)}</b></div>
      ${c.payment_schedule ? `<div class="sm mt">Tiến độ thanh toán: ${esc(c.payment_schedule)}</div>` : ''}
      ${c.penalty_terms ? `<div class="sm mt">Điều khoản phạt vi phạm: ${esc(c.penalty_terms)}</div>` : ''}
      ${c.note ? `<div class="sm mt">Ghi chú: ${esc(c.note)}</div>` : ''}
      ${c.v1_note ? `<div class="sm mt">Ghi chú V1: ${esc(c.v1_note)}</div>` : ''}
      ${c.v2_note ? `<div class="sm mt">Ghi chú V2: ${esc(c.v2_note)}</div>` : ''}`,
  });
}

/* ================= Duyệt / trả lại ================= */

/** Wire nút Duyệt/Yêu cầu điều chỉnh — dùng chung cho báo giá & hợp đồng, và cho cả plans.js,
 * console.js (Console đội) lẫn activity.js, tránh lặp lại nhiều bản logic giống hệt nhau. `path`
 * là 'quotes' hoặc 'contracts' — 2 loại nút dùng ATTRIBUTE RIÊNG ([data-ok]/[data-revise] cho báo
 * giá, [data-ok-contract]/[data-revise-contract] cho hợp đồng, khớp quy ước
 * data-view/data-view-contract ở trên) để 2 lần gọi hàm này (1 cho mỗi path) không tranh nhau ghi
 * đè onclick của cùng 1 nút — trước đây cả 2 loại cùng dùng [data-ok], lần gọi 'contracts' luôn
 * ghi đè lần gọi 'quotes' khiến nút Duyệt báo giá lại gọi nhầm PATCH /api/contracts/:id
 * (404 "Không tìm thấy hợp đồng"). */
export function bindApprovalActions(el, path, after) {
  const label = path === 'contracts' ? 'hợp đồng' : 'báo giá';
  const okAttr = path === 'contracts' ? 'ok-contract' : 'ok';
  const reviseAttr = path === 'contracts' ? 'revise-contract' : 'revise';
  el.querySelectorAll(`[data-${okAttr}]`).forEach(b => b.onclick = async () => {
    try { await patch(`/${path}/` + b.dataset[path === 'contracts' ? 'okContract' : 'ok'], { decision: 'approved' }); toast('Đã duyệt ' + label, 'ok'); after(); }
    catch (e) { toast(e.message, 'err'); }
  });
  el.querySelectorAll(`[data-${reviseAttr}]`).forEach(b => b.onclick = () => modal({
    title: 'Yêu cầu điều chỉnh ' + label, fields: [{ name: 'note', label: 'Ghi chú cho sale', required: true }],
    submitText: 'Gửi yêu cầu điều chỉnh',
    onSubmit: async (v) => {
      try {
        const id = b.dataset[path === 'contracts' ? 'reviseContract' : 'revise'];
        await patch(`/${path}/` + id, { decision: 'revise', note: v.note }); toast('Đã gửi yêu cầu điều chỉnh', 'ok'); after();
      } catch (e) { toast(e.message, 'err'); return false; }
    },
  }));
}

/**
 * Wire TOÀN BỘ nút của quoteItem/contractItem trong một lần gọi — Xem · AI · Tài liệu · Sửa & gửi
 * lại · Duyệt · Yêu cầu điều chỉnh. Màn nào vẽ danh sách chứng từ chỉ cần gọi đúng hàm này thay vì
 * chép lại 6 vòng querySelectorAll. `d` cần `quotes`, `contracts` và `products` (để mở lại công cụ
 * tính giá khi sửa & trình lại báo giá).
 */
export function bindDocActions(el, d, after) {
  const quotes = d.quotes || [], contracts = d.contracts || [];
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const q = quotes.find(x => x.id === b.dataset.view);
    if (q) viewQuoteModal(q);
  });
  el.querySelectorAll('[data-view-contract]').forEach(b => b.onclick = () => {
    const c = contracts.find(x => x.id === b.dataset.viewContract);
    if (c) viewContractModal(c);
  });
  el.querySelectorAll('[data-aiq]').forEach(b => b.onclick = () => {
    const q = quotes.find(x => x.id === b.dataset.aiq);
    if (!q) return;
    aiModal({
      title: 'AI thuyết minh báo giá', titleIcon: 'bot',
      kind: 'proposal',
      promptLabel: 'Yêu cầu',
      prompt: `Viết phần thuyết minh giá trị cho báo giá "${q.title}" gửi ${q.customer_name || 'khách hàng'}.`,
      extra: `Tạm tính ${q.subtotal}đ, chiết khấu ${q.discount_pct}%, thành tiền ${q.total}đ.`,
    });
  });
  el.querySelectorAll('[data-docs]').forEach(b => b.onclick = () => {
    const q = quotes.find(x => x.id === b.dataset.docs);
    documentsModal('quote', b.dataset.docs, q?.title || 'Báo giá');
  });
  el.querySelectorAll('[data-docs-contract]').forEach(b => b.onclick = () => {
    const c = contracts.find(x => x.id === b.dataset.docsContract);
    documentsModal('contract', b.dataset.docsContract, c?.title || 'Hợp đồng');
  });
  el.querySelectorAll('[data-resubmit]').forEach(b => b.onclick = () => {
    const q = quotes.find(x => x.id === b.dataset.resubmit);
    if (q) resubmitQuoteBuilder(d, q, after);
  });
  el.querySelectorAll('[data-resubmit-contract]').forEach(b => b.onclick = () => {
    const c = contracts.find(x => x.id === b.dataset.resubmitContract);
    if (c) resubmitContractBuilder(c, after);
  });
  bindApprovalActions(el, 'quotes', after);
  bindApprovalActions(el, 'contracts', after);
}

/* ================= Tài liệu đính kèm ================= */

/** Modal xem/tải lên tài liệu đính kèm (báo giá/hợp đồng) — sau khi tải lên, AI đọc file và liệt
 * kê thông tin chính ngay trong danh sách, không cần rời màn hình. `kind` là 'quote' hoặc
 * 'contract' — dùng để ghép đúng tham số quoteId/contractId khi gọi API. */
export async function documentsModal(kind, id, label) {
  const paramKey = kind + 'Id';
  const load = async () => { try { return (await get(`/documents?${paramKey}=${id}`)).items || []; } catch (e) { return []; } };

  const listHTML = (items) => items.length ? items.map(doc => `<div class="item">
      <div class="dot-i">${icon('fileText')}</div>
      <div class="grow"><div class="t">${esc(doc.filename)}</div>
        <div class="d xs">${fmtDate(doc.created_at)} · ${Math.round((doc.size || 0) / 1024)} KB${doc.status === 'mock' ? ' · <span style="color:var(--red)">chưa phân tích được (thiếu API key AI)</span>' : ''}</div>
        ${doc.ai_summary ? `<div class="ai-bubble mt xs">${esc(doc.ai_summary)}</div>` : ''}
      </div>
      <a class="btn sm" href="/api/documents/${esc(doc.id)}/file" target="_blank" rel="noopener">Xem file</a>
    </div>`).join('') : empty('fileText', 'Chưa có tài liệu nào được đính kèm.');

  const { root } = modal({
    title: 'Tài liệu đính kèm — ' + label, titleIcon: 'fileText', wide: true,
    submitText: 'Đóng', onSubmit: () => true,
    html: `<div data-doclist>${await load().then(listHTML)}</div>
      <div class="row mt" style="gap:8px">
        <input type="file" data-docfile accept=".pdf,image/png,image/jpeg,image/webp" class="grow">
        <button type="button" class="btn primary sm" data-docupload>${icon('bot', 14)} Tải lên & AI phân tích</button>
      </div>
      <div class="xs mut mt">Chỉ nhận file PDF hoặc ảnh (PNG/JPG/WEBP), tối đa 8MB.</div>`,
  });

  root.querySelector('[data-docupload]').onclick = async () => {
    const input = root.querySelector('[data-docfile]');
    const file = input.files[0];
    if (!file) { toast('Chọn file trước đã', 'err'); return; }
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast('Chỉ hỗ trợ PDF hoặc ảnh PNG/JPG/WEBP', 'err'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('File vượt quá 8MB', 'err'); return; }
    const btn = root.querySelector('[data-docupload]');
    btn.disabled = true;
    btn.innerHTML = `${icon('loaderCircle', 14, { class: 'spin' })} Đang tải lên & AI phân tích…`;
    try {
      const dataBase64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = () => rej(new Error('Không đọc được file'));
        r.readAsDataURL(file);
      });
      const body = { filename: file.name, mime: file.type, dataBase64 };
      body[paramKey] = id;
      const r2 = await post('/documents', body);
      toast(r2.notice || 'Đã tải lên & phân tích tài liệu', r2.notice ? 'err' : 'ok');
      root.querySelector('[data-doclist]').innerHTML = listHTML(await load());
      input.value = '';
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('bot', 14)} Tải lên & AI phân tích`;
    }
  };
}

/* ================= Lập & trình lại chứng từ ================= */

/**
 * Công cụ tính giá & tạo báo giá.
 * `preset` cho phép mở từ TRONG một phương án kinh doanh: khách hàng và cơ hội đã biết sẵn nên bỏ
 * hẳn 2 ô chọn đó (`lockTarget`) và gửi kèm `planId` để báo giá gắn đúng vào bước 1 của phương án.
 * Mở từ tab "Báo giá" phẳng thì không truyền preset — vẫn tạo được báo giá KHÔNG thuộc phương án
 * nào, đúng như trước đây.
 */
export function quoteBuilder(d, preset = {}, after) {
  const opts = d.products.map(p => ({ v: p.id, n: p.name + ' — ' + money(p.price) }));
  const target = preset.lockTarget ? [] : [
    { name: 'customerId', label: 'Khách hàng', type: 'select', value: preset.customerId || '', options: [{ v: '', n: '— chọn —' }, ...d.customers.map(c => ({ v: c.id, n: c.name }))] },
    { name: 'dealId', label: 'Gắn deal', type: 'select', value: preset.dealId || '', options: [{ v: '', n: '— không —' }, ...d.deals.map(x => ({ v: x.id, n: x.title }))] },
  ];
  modal({
    title: 'Công cụ tính giá & tạo báo giá',
    wide: true,
    html: preset.lockTarget && preset.customerName
      ? `<div class="note mb">Báo giá này gắn vào phương án <b>${esc(preset.planTitle || '')}</b> — khách hàng ${esc(preset.customerName)}.</div>` : '',
    fields: [
      { name: 'title', label: 'Tiêu đề báo giá', value: 'Báo giá dịch vụ NetViet' },
      ...target,
      { name: 'productId', label: 'Gói dịch vụ', type: 'select', value: preset.productId || '', options: opts },
      { name: 'qty', label: 'Số lượng', type: 'number', value: 1 },
      { name: 'productId2', label: 'Gói thứ hai (tuỳ chọn)', type: 'select', options: [{ v: '', n: '— không —' }, ...opts] },
      { name: 'discountPct', label: 'Chiết khấu (%)', type: 'number', value: 0,
        hint: isAdmin() ? 'Bạn là Admin/BGĐ — báo giá duyệt thẳng, không qua vòng nào.'
          : isManager() ? 'Vượt ' + d.threshold + '% sẽ đẩy thẳng Giám đốc duyệt (V2) — bỏ vòng 1 vì bạn là TPKD.'
            : 'Vượt ' + d.threshold + '% sẽ tự đẩy TPKD duyệt (vòng 1)' },
    ],
    submitText: 'Tạo báo giá',
    onSubmit: async (v) => {
      const items = [{ productId: v.productId, qty: Number(v.qty) || 1 }];
      if (v.productId2) items.push({ productId: v.productId2, qty: 1 });
      const r = await post('/quotes', {
        title: v.title,
        customerId: preset.lockTarget ? preset.customerId : v.customerId,
        dealId: preset.lockTarget ? (preset.dealId || '') : v.dealId,
        planId: preset.planId || '',
        discountPct: Number(v.discountPct) || 0,
        items,
      });
      const pending = ['pending_v1', 'pending_v2'].includes(r.status);
      toast(pending
        ? `Chiết khấu vượt ngưỡng ${r.threshold}% → đã gửi ${r.status === 'pending_v1' ? 'TPKD duyệt (V1)' : 'Giám đốc duyệt (V2)'}`
        : `Đã tạo báo giá ${vnd(r.total)} · hoa hồng ${vnd(r.commission)}${r.status === 'approved' ? ' · duyệt thẳng' : ''}`,
        pending ? 'err' : 'ok');
      after(r);
    },
  });
}

/** Sửa & trình lại báo giá bị yêu cầu điều chỉnh — chỉ sửa gói/chiết khấu, giữ nguyên khách
 * hàng/deal/phương án đã gắn (không đổi được ở bước này). */
export function resubmitQuoteBuilder(d, q, after) {
  let items = [];
  try { items = JSON.parse(q.items || '[]'); } catch (e) { items = []; }
  const opts = d.products.map(p => ({ v: p.id, n: p.name + ' — ' + money(p.price) }));
  modal({
    title: 'Sửa & trình lại: ' + q.title,
    wide: true,
    fields: [
      { name: 'title', label: 'Tiêu đề báo giá', value: q.title },
      { name: 'productId', label: 'Gói dịch vụ', type: 'select', value: items[0]?.productId || '', options: opts },
      { name: 'qty', label: 'Số lượng', type: 'number', value: items[0]?.qty || 1 },
      { name: 'productId2', label: 'Gói thứ hai (tuỳ chọn)', type: 'select', value: items[1]?.productId || '', options: [{ v: '', n: '— không —' }, ...opts] },
      { name: 'discountPct', label: 'Chiết khấu (%)', type: 'number', value: q.discount_pct },
    ],
    submitText: 'Gửi lại',
    onSubmit: async (v) => {
      const newItems = [{ productId: v.productId, qty: Number(v.qty) || 1 }];
      if (v.productId2) newItems.push({ productId: v.productId2, qty: 1 });
      try {
        await patch('/quotes/' + q.id, { title: v.title, discountPct: Number(v.discountPct) || 0, items: newItems });
        toast('Đã gửi lại báo giá để duyệt.', 'ok');
        after();
      } catch (e) { toast(e.message, 'err'); return false; }
    },
  });
}

/** Lập hợp đồng sản xuất — bắt buộc qua đủ 2 vòng duyệt (TPKD→HCNS), không có ngưỡng bỏ qua như
 * báo giá. Có thể gắn deal/báo giá đã duyệt để tham chiếu, nhưng không bắt buộc. `preset` hoạt
 * động giống quoteBuilder: mở từ trong phương án thì khoá sẵn khách hàng/cơ hội và gắn planId. */
export function contractBuilder(d, preset = {}, after) {
  const approvedQuotes = (d.quotes || []).filter(q => q.status === 'approved'
    && (!preset.lockTarget || !preset.customerId || q.customer_id === preset.customerId));
  const target = preset.lockTarget ? [] : [
    { name: 'customerId', label: 'Khách hàng', type: 'select', value: preset.customerId || '', options: [{ v: '', n: '— chọn —' }, ...d.customers.map(c => ({ v: c.id, n: c.name }))] },
    { name: 'dealId', label: 'Gắn deal', type: 'select', value: preset.dealId || '', options: [{ v: '', n: '— không —' }, ...d.deals.map(x => ({ v: x.id, n: x.title }))] },
  ];
  modal({
    title: 'Lập hợp đồng sản xuất',
    wide: true,
    html: preset.lockTarget && preset.customerName
      ? `<div class="note mb">Hợp đồng này gắn vào phương án <b>${esc(preset.planTitle || '')}</b> — khách hàng ${esc(preset.customerName)}.</div>` : '',
    fields: [
      { name: 'title', label: 'Tên hợp đồng', value: 'Hợp đồng dịch vụ NetViet' },
      ...target,
      { name: 'quoteId', label: 'Dựa trên báo giá đã duyệt', type: 'select', options: [{ v: '', n: '— không —' }, ...approvedQuotes.map(q => ({ v: q.id, n: q.title + ' — ' + vnd(q.total) }))] },
      { name: 'value', label: 'Giá trị hợp đồng (đ)', type: 'number', value: 50000000 },
      { name: 'paymentSchedule', label: 'Tiến độ thanh toán', type: 'textarea', rows: 2, placeholder: 'VD: 50% tạm ứng, 50% sau nghiệm thu' },
      { name: 'penaltyTerms', label: 'Điều khoản phạt vi phạm', type: 'textarea', rows: 2, placeholder: 'VD: Phạt 0.1%/ngày chậm tiến độ, tối đa 8%' },
      { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
    ],
    submitText: isAdmin() ? 'Lập hợp đồng' : isManager() ? 'Gửi HCNS duyệt (V2)' : 'Gửi TPKD duyệt (V1)',
    onSubmit: async (v) => {
      const r = await post('/contracts', {
        ...v,
        customerId: preset.lockTarget ? preset.customerId : v.customerId,
        dealId: preset.lockTarget ? (preset.dealId || '') : v.dealId,
        planId: preset.planId || '',
        value: Number(v.value) || 0,
      });
      toast(r.status === 'approved' ? 'Đã lập hợp đồng — duyệt thẳng, không qua vòng nào.'
        : r.status === 'pending_v2' ? 'Đã lập hợp đồng — gửi HCNS duyệt (V2), đã bỏ vòng 1.'
          : 'Đã lập hợp đồng — gửi TPKD duyệt (V1)', 'ok');
      after();
    },
  });
}

/** Sửa & trình lại hợp đồng bị yêu cầu điều chỉnh — giữ nguyên khách hàng/deal/báo giá đã gắn. */
export function resubmitContractBuilder(c, after) {
  modal({
    title: 'Sửa & trình lại: ' + c.title,
    wide: true,
    fields: [
      { name: 'title', label: 'Tên hợp đồng', value: c.title },
      { name: 'value', label: 'Giá trị hợp đồng (đ)', type: 'number', value: c.value },
      { name: 'paymentSchedule', label: 'Tiến độ thanh toán', type: 'textarea', rows: 2, value: c.payment_schedule || '' },
      { name: 'penaltyTerms', label: 'Điều khoản phạt vi phạm', type: 'textarea', rows: 2, value: c.penalty_terms || '' },
      { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2, value: c.note || '' },
    ],
    submitText: 'Gửi lại',
    onSubmit: async (v) => {
      try {
        await patch('/contracts/' + c.id, { ...v, value: Number(v.value) || 0 });
        toast('Đã gửi lại hợp đồng để duyệt.', 'ok');
        after();
      } catch (e) { toast(e.message, 'err'); return false; }
    },
  });
}
