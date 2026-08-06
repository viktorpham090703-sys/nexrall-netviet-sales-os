import { get, post, patch } from '../api.js';
import { isLead } from '../state.js';
import { esc, money, vnd, mount, chip, empty, fmtDate, toast, modal, stat } from '../ui.js';
import { aiModal } from '../aiPref.js';

let tab = 'catalog';

export async function render(el) {
  const load = async () => {
    const [p, q, c, d] = await Promise.all([get('/products'), get('/quotes'), get('/customers'), get('/deals')]);
    return { products: p.items || [], threshold: p.discountThreshold, quotes: q.items || [], customers: c.items || [], deals: d.items || [] };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>Sales Kit & Báo giá</h2><p>Bảng gói dịch vụ · tính giá + hoa hồng · proposal · cảnh báo chiết khấu > ${d.threshold}%</p></div>
    <div class="right"><button class="btn primary sm" data-new>+ Báo giá</button>
      <div class="mt"><button class="btn sm" data-aiprop>🤖 AI soạn proposal</button></div></div>
  </div>

  <div class="seg mb">
    <button data-tab="catalog" class="${tab === 'catalog' ? 'on' : ''}">Gói dịch vụ</button>
    <button data-tab="quotes" class="${tab === 'quotes' ? 'on' : ''}">Báo giá (${d.quotes.length})</button>
    ${isLead() ? `<button data-tab="approve" class="${tab === 'approve' ? 'on' : ''}">Chờ duyệt (${d.quotes.filter(q => q.status === 'pending').length})</button>` : ''}
  </div>

  ${tab === 'catalog' ? ['TVC/Video', 'Gameshow', 'Xây kênh'].map(line => {
    const arr = d.products.filter(p => p.line === line);
    if (!arr.length) return '';
    return `<div class="sec-title">${esc(line)}</div><div class="card">${arr.map(p => `<div class="item">
      <div class="dot-i">${line === 'Gameshow' ? '🎬' : line === 'Xây kênh' ? '📈' : '🎥'}</div>
      <div class="grow"><div class="t">${esc(p.name)}</div>
        <div class="d">${esc(p.description || '')}</div>
        <div class="row wrap mt" style="gap:6px">${chip(vnd(p.price) + '/' + p.unit, 'blue')}
          ${chip('HH ' + p.commission_rate + '%', 'green')}${chip('CK tối đa ' + p.max_discount + '%', 'amber')}</div></div>
      <button class="btn sm" data-calc="${esc(p.id)}">Tính giá</button></div>`).join('')}</div>`;
  }).join('') : ''}

  ${tab === 'quotes' || tab === 'approve' ? (() => {
    const arr = tab === 'approve' ? d.quotes.filter(q => q.status === 'pending') : d.quotes;
    return arr.length ? `<div class="card">${arr.map(q => `<div class="item">
      <div class="dot-i">📄</div>
      <div class="grow"><div class="t">${esc(q.title)}</div>
        <div class="d">${esc(q.customer_name || '')}${q.owner_name ? ' · ' + esc(q.owner_name) : ''} · ${fmtDate(q.created_at)}</div>
        <div class="d xs">Gốc ${money(q.subtotal)} → CK ${q.discount_pct}% → <b>${vnd(q.total)}</b> · HH ${vnd(q.commission)}</div>
        <div class="row wrap mt" style="gap:6px">
          ${chip(q.status === 'approved' ? 'Đã duyệt' : q.status === 'pending' ? 'Chờ TP duyệt' : q.status === 'rejected' ? 'Từ chối' : 'Nháp',
            q.status === 'approved' ? 'green' : q.status === 'pending' ? 'amber' : q.status === 'rejected' ? 'red' : 'grey')}
          ${q.approve_note ? chip(q.approve_note, 'grey') : ''}</div></div>
      <div class="right">
        <button class="btn sm" data-view="${esc(q.id)}">Xem</button>
        <div class="mt"><button class="btn sm" data-aiq="${esc(q.id)}">🤖 AI</button></div>
        ${isLead() && q.status === 'pending' ? `<div class="mt"><button class="btn sm amber" data-ok="${esc(q.id)}">Duyệt</button></div>
          <div class="mt"><button class="btn sm" data-no="${esc(q.id)}">Từ chối</button></div>` : ''}
      </div></div>`).join('')}</div>` : empty('📄', 'Chưa có báo giá nào.');
  })() : ''}`;

  const bind = (d) => {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    el.querySelector('[data-new]').onclick = () => builder(d, null, () => render(el));
    el.querySelector('[data-aiprop]').onclick = () => aiModal({
      title: '🤖 AI soạn proposal',
      kind: 'proposal',
      promptLabel: 'Mô tả khách hàng & ngân sách',
      prompt: 'Khách hàng ngành FMCG, ngân sách 300 triệu, muốn TVC AI + chuỗi video viền TikTok cho Q4.',
    });
    el.querySelectorAll('[data-aiq]').forEach(b => b.onclick = () => {
      const q = d.quotes.find(x => x.id === b.dataset.aiq);
      aiModal({
        title: '🤖 AI thuyết minh báo giá',
        kind: 'proposal',
        promptLabel: 'Yêu cầu',
        prompt: `Viết phần thuyết minh giá trị cho báo giá "${q.title}" gửi ${q.customer_name || 'khách hàng'}.`,
        extra: `Tạm tính ${q.subtotal}đ, chiết khấu ${q.discount_pct}%, thành tiền ${q.total}đ.`,
      });
    });
    el.querySelectorAll('[data-calc]').forEach(b => b.onclick = () => builder(d, b.dataset.calc, () => render(el)));
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
      try { await patch('/quotes/' + b.dataset.ok, { status: 'approved', note: 'Duyệt bởi TP' }); toast('Đã duyệt báo giá', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-no]').forEach(b => b.onclick = () => modal({
      title: 'Từ chối báo giá', fields: [{ name: 'note', label: 'Lý do', required: true }],
      submitText: 'Từ chối', onSubmit: async (v) => { await patch('/quotes/' + b.dataset.no, { status: 'rejected', note: v.note }); toast('Đã từ chối', 'ok'); render(el); },
    }));
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
          <div class="sm">Hoa hồng dự kiến: <b>${vnd(q.commission)}</b></div>`,
      });
    });
  };

  await mount(el, load, draw, bind);
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
      { name: 'discountPct', label: 'Chiết khấu (%)', type: 'number', value: 0, hint: 'Vượt ' + d.threshold + '% sẽ tự đẩy Trưởng phòng duyệt' },
    ],
    submitText: 'Tạo báo giá',
    onSubmit: async (v) => {
      const items = [{ productId: v.productId, qty: Number(v.qty) || 1 }];
      if (v.productId2) items.push({ productId: v.productId2, qty: 1 });
      const r = await post('/quotes', { title: v.title, customerId: v.customerId, dealId: v.dealId, discountPct: Number(v.discountPct) || 0, items });
      toast(r.status === 'pending'
        ? `Chiết khấu vượt ngưỡng ${r.threshold}% → đã gửi TP duyệt`
        : `Đã tạo báo giá ${vnd(r.total)} · hoa hồng ${vnd(r.commission)}`, r.status === 'pending' ? 'err' : 'ok');
      tab = 'quotes';
      after();
    },
  });
}
