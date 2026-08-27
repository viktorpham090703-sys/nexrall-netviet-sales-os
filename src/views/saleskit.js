import { get, post, patch } from '../api.js';
import { state, isLead } from '../state.js';
import { esc, money, vnd, mount, chip, empty, fmtDate, toast, modal, stat, bindTabs } from '../ui.js';
import { QUOTE_STATUS, CONTRACT_STATUS } from '../const.js';
import { aiModal } from '../aiPref.js';
import { icon } from '../icons.js';

let tab = 'catalog';

/** true nếu người đang xem có quyền duyệt vòng của báo giá `q` (V1=TPKD/Admin, V2=Admin/BGĐ —
 * vai trò Giám đốc đã sáp nhập vào Admin, không còn tách riêng).
 * Export để console.js (Console đội) dùng chung, tránh lệch điều kiện giữa 2 nơi hiện nút duyệt. */
export const canDecide = (q) => (q.status === 'pending_v1' && ['manager', 'admin'].includes(state.me.role))
  || (q.status === 'pending_v2' && state.me.role === 'admin');
/** Tương tự canDecide nhưng cho hợp đồng — vòng 2 là HCNS (hr) thay vì Giám đốc. */
export const canDecideContract = (c) => (c.status === 'pending_v1' && ['manager', 'admin'].includes(state.me.role))
  || (c.status === 'pending_v2' && ['hr', 'admin'].includes(state.me.role));
/** true nếu vòng hiện tại của báo giá `q` đang bị yêu cầu điều chỉnh và người xem là chủ báo giá. */
const needsResubmit = (q) => q.owner_id === state.me.id
  && ((q.status === 'pending_v1' && q.v1_decision === 'revise') || (q.status === 'pending_v2' && q.v2_decision === 'revise'));
const needsResubmitContract = needsResubmit; // cùng logic, khác tên cho rõ ngữ cảnh khi đọc code

export async function render(el) {
  const load = async () => {
    const [p, q, c, cus, d] = await Promise.all([get('/products'), get('/quotes'), get('/contracts'), get('/customers'), get('/deals')]);
    return { products: p.items || [], threshold: p.discountThreshold, quotes: q.items || [], contracts: c.items || [], customers: cus.items || [], deals: d.items || [] };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>Sales Kit & Báo giá</h2><p>Bảng gói dịch vụ · tính giá + hoa hồng · proposal · duyệt 2 vòng (TPKD→Giám đốc/HCNS)</p></div>
    <div class="right"><button class="btn primary sm" data-new>+ Báo giá</button>
      <div class="mt"><button class="btn sm" data-newcontract>+ Hợp đồng</button></div>
      <div class="mt"><button class="btn sm" data-aiprop>${icon('bot', 14)} AI soạn proposal</button></div></div>
  </div>

  <div class="seg mb">
    <button data-tab="catalog" class="${tab === 'catalog' ? 'on' : ''}">Gói dịch vụ</button>
    <button data-tab="quotes" class="${tab === 'quotes' ? 'on' : ''}">Báo giá (${d.quotes.length})</button>
    ${isLead() ? `<button data-tab="approve" class="${tab === 'approve' ? 'on' : ''}">Chờ duyệt giá (${d.quotes.filter(canDecide).length})</button>` : ''}
    <button data-tab="contracts" class="${tab === 'contracts' ? 'on' : ''}">Hợp đồng (${d.contracts.length})</button>
    ${isLead() ? `<button data-tab="approveContracts" class="${tab === 'approveContracts' ? 'on' : ''}">Chờ duyệt HĐ (${d.contracts.filter(canDecideContract).length})</button>` : ''}
  </div>

  ${tab === 'catalog' ? ['TVC/Video', 'Gameshow', 'Xây kênh'].map(line => {
    const arr = d.products.filter(p => p.line === line);
    if (!arr.length) return '';
    return `<div class="sec-title">${esc(line)}</div><div class="card">${arr.map(p => `<div class="item">
      <div class="dot-i">${icon(line === 'Gameshow' ? 'clapperboard' : line === 'Xây kênh' ? 'trendingUp' : 'video')}</div>
      <div class="grow"><div class="t">${esc(p.name)}</div>
        <div class="d">${esc(p.description || '')}</div>
        <div class="row wrap mt" style="gap:6px">${chip(vnd(p.price) + '/' + p.unit, 'blue')}
          ${chip('HH ' + p.commission_rate + '%', 'green')}${chip('CK tối đa ' + p.max_discount + '%', 'amber')}</div></div>
      <button class="btn sm" data-calc="${esc(p.id)}">Tính giá</button></div>`).join('')}</div>`;
  }).join('') : ''}

  ${tab === 'quotes' || tab === 'approve' ? (() => {
    const arr = tab === 'approve' ? d.quotes.filter(canDecide) : d.quotes;
    return arr.length ? `<div class="card">${arr.map(q => quoteItem(q)).join('')}</div>` : empty('fileText', 'Chưa có báo giá nào.');
  })() : ''}

  ${tab === 'contracts' || tab === 'approveContracts' ? (() => {
    const arr = tab === 'approveContracts' ? d.contracts.filter(canDecideContract) : d.contracts;
    return arr.length ? `<div class="card">${arr.map(c => contractItem(c)).join('')}</div>` : empty('penLine', 'Chưa có hợp đồng nào.');
  })() : ''}`;

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelector('[data-new]').onclick = () => builder(d, null, () => render(el));
    el.querySelector('[data-newcontract]').onclick = () => contractBuilder(d, null, () => render(el));
    el.querySelector('[data-aiprop]').onclick = () => aiModal({
      title: 'AI soạn proposal', titleIcon: 'bot',
      kind: 'proposal',
      promptLabel: 'Mô tả khách hàng & ngân sách',
      prompt: 'Khách hàng ngành FMCG, ngân sách 300 triệu, muốn TVC AI + chuỗi video viền TikTok cho Q4.',
    });
    el.querySelectorAll('[data-aiq]').forEach(b => b.onclick = () => {
      const q = d.quotes.find(x => x.id === b.dataset.aiq);
      aiModal({
        title: 'AI thuyết minh báo giá', titleIcon: 'bot',
        kind: 'proposal',
        promptLabel: 'Yêu cầu',
        prompt: `Viết phần thuyết minh giá trị cho báo giá "${q.title}" gửi ${q.customer_name || 'khách hàng'}.`,
        extra: `Tạm tính ${q.subtotal}đ, chiết khấu ${q.discount_pct}%, thành tiền ${q.total}đ.`,
      });
    });
    el.querySelectorAll('[data-calc]').forEach(b => b.onclick = () => builder(d, b.dataset.calc, () => render(el)));
    el.querySelectorAll('[data-docs]').forEach(b => b.onclick = () => {
      const q = d.quotes.find(x => x.id === b.dataset.docs);
      documentsModal('quote', b.dataset.docs, q?.title || 'Báo giá');
    });
    el.querySelectorAll('[data-docs-contract]').forEach(b => b.onclick = () => {
      const c = d.contracts.find(x => x.id === b.dataset.docsContract);
      documentsModal('contract', b.dataset.docsContract, c?.title || 'Hợp đồng');
    });
    el.querySelectorAll('[data-resubmit]').forEach(b => b.onclick = () => {
      const q = d.quotes.find(x => x.id === b.dataset.resubmit);
      resubmitBuilder(d, q, () => render(el));
    });
    el.querySelectorAll('[data-resubmit-contract]').forEach(b => b.onclick = () => {
      const c = d.contracts.find(x => x.id === b.dataset.resubmitContract);
      resubmitContractBuilder(c, () => render(el));
    });
    bindApprovalActions(el, 'quotes', () => render(el));
    bindApprovalActions(el, 'contracts', () => render(el));
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
      const q = d.quotes.find(x => x.id === b.dataset.view);
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
    });
    el.querySelectorAll('[data-view-contract]').forEach(b => b.onclick = () => {
      const c = d.contracts.find(x => x.id === b.dataset.viewContract);
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
    });
  };

  await mount(el, load, draw, bind);
}

function quoteItem(q) {
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

function contractItem(c) {
  const revise = needsResubmitContract(c);
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

/** Wire nút Duyệt/Yêu cầu điều chỉnh — dùng chung cho báo giá & hợp đồng, và cho cả saleskit.js lẫn
 * console.js (Console đội), tránh lặp lại nhiều bản logic giống hệt nhau. `path` là 'quotes' hoặc
 * 'contracts' — 2 loại nút dùng ATTRIBUTE RIÊNG ([data-ok]/[data-revise] cho báo giá,
 * [data-ok-contract]/[data-revise-contract] cho hợp đồng, khớp quy ước data-view/data-view-contract
 * đã dùng ở trên) để 2 lần gọi hàm này (1 cho mỗi path) không tranh nhau ghi đè onclick của cùng 1
 * nút — trước đây cả 2 loại cùng dùng [data-ok], lần gọi 'contracts' luôn ghi đè lần gọi 'quotes'
 * khiến nút Duyệt báo giá lại gọi nhầm PATCH /api/contracts/:id (404 "Không tìm thấy hợp đồng"). */
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

/** Modal xem/tải lên tài liệu đính kèm (báo giá/hợp đồng) — sau khi tải lên, AI đọc file và liệt
 * kê thông tin chính ngay trong danh sách, không cần rời màn hình. `kind` là 'quote' hoặc
 * 'contract' — dùng để ghép đúng tham số quoteId/contractId khi gọi API. */
async function documentsModal(kind, id, label) {
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

function builder(d, presetProduct, after) {
  const opts = d.products.map(p => ({ v: p.id, n: p.name + ' — ' + money(p.price) }));
  modal({
    title: 'Công cụ tính giá & tạo báo giá',
    wide: true,
    fields: [
      { name: 'title', label: 'Tiêu đề báo giá', value: 'Báo giá dịch vụ NetViet' },
      { name: 'customerId', label: 'Khách hàng', type: 'select', options: [{ v: '', n: '— chọn —' }, ...d.customers.map(c => ({ v: c.id, n: c.name }))] },
      { name: 'dealId', label: 'Gắn deal', type: 'select', options: [{ v: '', n: '— không —' }, ...d.deals.map(x => ({ v: x.id, n: x.title }))] },
      { name: 'productId', label: 'Gói dịch vụ', type: 'select', value: presetProduct || '', options: opts },
      { name: 'qty', label: 'Số lượng', type: 'number', value: 1 },
      { name: 'productId2', label: 'Gói thứ hai (tuỳ chọn)', type: 'select', options: [{ v: '', n: '— không —' }, ...opts] },
      { name: 'discountPct', label: 'Chiết khấu (%)', type: 'number', value: 0, hint: 'Vượt ' + d.threshold + '% sẽ tự đẩy TPKD duyệt (vòng 1)' },
    ],
    submitText: 'Tạo báo giá',
    onSubmit: async (v) => {
      const items = [{ productId: v.productId, qty: Number(v.qty) || 1 }];
      if (v.productId2) items.push({ productId: v.productId2, qty: 1 });
      const r = await post('/quotes', { title: v.title, customerId: v.customerId, dealId: v.dealId, discountPct: Number(v.discountPct) || 0, items });
      toast(r.status === 'pending_v1'
        ? `Chiết khấu vượt ngưỡng ${r.threshold}% → đã gửi TPKD duyệt (V1)`
        : `Đã tạo báo giá ${vnd(r.total)} · hoa hồng ${vnd(r.commission)}`, r.status === 'pending_v1' ? 'err' : 'ok');
      tab = 'quotes';
      after();
    },
  });
}

/** Sửa & trình lại báo giá bị yêu cầu điều chỉnh — chỉ sửa gói/chiết khấu, giữ nguyên khách
 * hàng/deal đã gắn (không đổi được ở bước này). */
function resubmitBuilder(d, q, after) {
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

/** Tạo hợp đồng sản xuất — bắt buộc qua đủ 2 vòng duyệt (TPKD→HCNS), không có ngưỡng bỏ qua như
 * báo giá. Có thể gắn deal/báo giá đã duyệt để tham chiếu, nhưng không bắt buộc. */
function contractBuilder(d, presetDealId, after) {
  const approvedQuotes = d.quotes.filter(q => q.status === 'approved');
  modal({
    title: 'Lập hợp đồng sản xuất',
    wide: true,
    fields: [
      { name: 'title', label: 'Tên hợp đồng', value: 'Hợp đồng dịch vụ NetViet' },
      { name: 'customerId', label: 'Khách hàng', type: 'select', options: [{ v: '', n: '— chọn —' }, ...d.customers.map(c => ({ v: c.id, n: c.name }))] },
      { name: 'dealId', label: 'Gắn deal', type: 'select', value: presetDealId || '', options: [{ v: '', n: '— không —' }, ...d.deals.map(x => ({ v: x.id, n: x.title }))] },
      { name: 'quoteId', label: 'Dựa trên báo giá đã duyệt', type: 'select', options: [{ v: '', n: '— không —' }, ...approvedQuotes.map(q => ({ v: q.id, n: q.title + ' — ' + vnd(q.total) }))] },
      { name: 'value', label: 'Giá trị hợp đồng (đ)', type: 'number', value: 50000000 },
      { name: 'paymentSchedule', label: 'Tiến độ thanh toán', type: 'textarea', rows: 2, placeholder: 'VD: 50% tạm ứng, 50% sau nghiệm thu' },
      { name: 'penaltyTerms', label: 'Điều khoản phạt vi phạm', type: 'textarea', rows: 2, placeholder: 'VD: Phạt 0.1%/ngày chậm tiến độ, tối đa 8%' },
      { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
    ],
    submitText: 'Gửi TPKD duyệt (V1)',
    onSubmit: async (v) => {
      await post('/contracts', { ...v, value: Number(v.value) || 0 });
      toast('Đã lập hợp đồng — gửi TPKD duyệt (V1)', 'ok');
      tab = 'contracts';
      after();
    },
  });
}

/** Sửa & trình lại hợp đồng bị yêu cầu điều chỉnh — giữ nguyên khách hàng/deal/báo giá đã gắn. */
function resubmitContractBuilder(c, after) {
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
