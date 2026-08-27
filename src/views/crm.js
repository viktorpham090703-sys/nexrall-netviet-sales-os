import { get, post, patch } from '../api.js';
import { state, isLead, assigneeField } from '../state.js';
import { esc, money, mount, chip, empty, rel, fmtDT, toast, modal, initials } from '../ui.js';
import { TEMPS, SERVICES, ACT_TYPES, actIcon, actName, stageName, LEAD_SOURCES, leadSourceName, CUSTOMER_SCALE_OPTIONS } from '../const.js';
import { aiModal } from '../aiPref.js';
import { icon } from '../icons.js';

let filter = { q: '', temp: '' };
let crmTab = 'customers';

export async function render(el, params) {
  if (params && params.id) return detail(el, params.id);

  const load = async () => {
    const [cRes, pRes] = await Promise.all([
      get('/customers?q=' + encodeURIComponent(filter.q) + (filter.temp ? '&temp=' + filter.temp : '')),
      get('/partners'),
    ]);
    return { items: cRes.items || [], partners: pRes.items || [] };
  };

  const draw = (d) => `
    <div class="page-head">
      <div class="grow"><h2>CRM 360°</h2><p>${d.items.length} khách hàng ${isLead() ? 'toàn đội' : 'của bạn'} · phân loại nóng / ấm / nguội</p></div>
      <div class="right"><button class="btn primary sm" data-add>+ Khách hàng</button>
        <div class="mt"><button class="btn sm" data-addpartner>+ Partner</button></div></div>
    </div>

    <div class="seg mb">
      <button data-crmtab="customers" class="${crmTab === 'customers' ? 'on' : ''}">Khách hàng</button>
      <button data-crmtab="partners" class="${crmTab === 'partners' ? 'on' : ''}">Partner (${d.partners.length})</button>
    </div>

    ${crmTab === 'customers' ? `
    <input placeholder="Tìm theo tên hoặc ngành…" value="${esc(filter.q)}" data-q class="mb">
    <div class="seg mb">
      ${['', 'hot', 'warm', 'cold'].map(t => `<button data-temp="${t}" class="${filter.temp === t ? 'on' : ''}">${t ? TEMPS[t].n : 'Tất cả'}</button>`).join('')}
    </div>
    ${d.items.length ? `<div class="card">${d.items.map(c => `
      <a class="item" href="#/crm/${esc(c.id)}">
        <div class="avatar" style="border-radius:11px">${esc(initials(c.name))}</div>
        <div class="grow"><div class="t">${esc(c.name)}</div>
          <div class="d">${esc(c.industry || 'Chưa phân ngành')} · ${c.open_deals} deal mở · đã ký ${money(c.won_value)}</div>
          <div class="d xs">Tương tác gần nhất: ${rel(c.last_touch_at)}${isLead() ? ' · phụ trách ' + esc(c.owner_name || '—') : ''}${c.nguon_khach_hang ? ' · ' + esc(leadSourceName(c.nguon_khach_hang)) : ''}</div></div>
        <div class="right">${chip(TEMPS[c.temp]?.n || c.temp, TEMPS[c.temp]?.c)}</div>
      </a>`).join('')}</div>` : empty('folderOpen', 'Chưa có khách hàng nào khớp bộ lọc.')}
    ` : `
    ${d.partners.length ? `<div class="card">${d.partners.map(pt => `<div class="item">
        <div class="dot-i">${icon('handshake')}</div>
        <div class="grow"><div class="t">${esc(pt.name)}</div>
          <div class="d">${esc(pt.phone || '—')}${pt.email ? ' · ' + esc(pt.email) : ''} · phụ trách ${esc(pt.sale_name || '—')}</div>
          ${pt.note ? `<div class="d xs">${esc(pt.note)}</div>` : ''}</div>
        <button class="btn sm" data-editpartner="${esc(pt.id)}">Sửa</button>
      </div>`).join('')}</div>` : empty('handshake', 'Chưa có partner nào — thêm partner để gán làm nguồn khách hàng.')}
    `}`;

  const bind = (d) => {
    const q = el.querySelector('[data-q]');
    let tmr;
    if (q) q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { filter.q = q.value; render(el); }, 350); };
    el.querySelectorAll('[data-temp]').forEach(b => b.onclick = () => { filter.temp = b.dataset.temp; render(el); });
    el.querySelectorAll('[data-crmtab]').forEach(b => b.onclick = () => { crmTab = b.dataset.crmtab; render(el); });
    el.querySelector('[data-add]').onclick = () => modal({
      title: 'Thêm khách hàng',
      fields: [
        { name: 'name', label: 'Tên công ty', required: true },
        { name: 'industry', label: 'Ngành hàng' },
        { name: 'scale', label: 'Quy mô', type: 'select', options: [{ v: '', n: '— chưa rõ —' }, ...CUSTOMER_SCALE_OPTIONS] },
        { name: 'phone', label: 'Điện thoại' }, { name: 'email', label: 'Email' },
        { name: 'temp', label: 'Phân loại', type: 'select', options: [{ v: 'hot', n: 'Nóng' }, { v: 'warm', n: 'Ấm' }, { v: 'cold', n: 'Nguội' }] },
        { name: 'nguonKhachHang', label: 'Nguồn khách hàng', type: 'select', options: [{ v: '', n: '— chưa rõ —' }, ...LEAD_SOURCES] },
        { name: 'partnerId', label: 'Partner (nếu nguồn là Partner)', type: 'select', options: [{ v: '', n: '— không —' }, ...d.partners.map(pt => ({ v: pt.id, n: pt.name }))] },
        ...(isLead() ? [assigneeField('ownerId')] : []),
        { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
      ],
      onSubmit: async (v) => { await post('/customers', v); toast('Đã thêm khách hàng', 'ok'); render(el); },
    });
    el.querySelector('[data-addpartner]').onclick = () => partnerModal(null, () => render(el));
    el.querySelectorAll('[data-editpartner]').forEach(b => b.onclick = () => partnerModal(d.partners.find(x => x.id === b.dataset.editpartner), () => render(el)));
  };
  await mount(el, load, draw, bind);
}

async function detail(el, id) {
  const load = () => get('/customers/' + id);
  const draw = (d) => {
    const c = d.customer;
    return `<div class="page-head">
      <a class="btn sm" href="#/crm">${icon('arrowLeft', 15)}</a>
      <div class="grow"><h2>${esc(c.name)}</h2>
        <p>${esc(c.industry || '—')} · ${esc(c.scale || 'Chưa rõ quy mô')} <button class="btn sm" data-scale style="padding:1px 6px;margin-left:4px">${icon('pencil', 11)}</button> · nguồn ${esc(c.source || '—')}</p></div>
      ${chip(TEMPS[c.temp]?.n || c.temp, TEMPS[c.temp]?.c)}
    </div>

    <div class="grid g3">
      ${['hot', 'warm', 'cold'].map(t => `<button class="btn sm ${c.temp === t ? 'amber' : ''}" data-temp="${t}">${TEMPS[t].n}</button>`).join('')}
    </div>

    <div class="card mt">
      <div class="row wrap sm"><div class="grow">${icon('phone', 14)} ${esc(c.phone || '—')}</div><div>${icon('mail', 14)} ${esc(c.email || '—')}</div></div>
      <div class="sm mut mt">${esc(c.note || 'Chưa có ghi chú.')}</div>
      <div class="row mt" style="gap:8px">
        <button class="btn sm grow" data-act>+ Ghi hoạt động</button>
        <button class="btn sm grow" data-deal>+ Tạo deal</button>
        <button class="btn sm grow" data-contact>+ Người liên hệ</button>
      </div>
    </div>

    <div class="sec-title">Gợi ý AI: cross-sell & tái ký</div>
    <div class="card">${d.suggestions.length ? d.suggestions.map(s => `<div class="item">
        <div class="dot-i">${icon(s.type === 're-sign' ? 'repeat' : s.type === 'warm-up' ? 'thermometer' : 'lightbulb')}</div>
        <div class="grow"><div class="t">${esc(s.text)}</div></div>
        <button class="btn sm" data-aidraft="${esc(s.text)}">Soạn</button>
      </div>`).join('') : empty('bot', 'Chưa có gợi ý.')}</div>

    <div class="sec-title">Người liên hệ (${d.contacts.length})</div>
    <div class="card">${d.contacts.length ? d.contacts.map(ct => `<div class="item">
        <div class="dot-i">${icon('user')}</div><div class="grow"><div class="t">${esc(ct.name)} ${ct.is_primary ? chip('Chính', 'amber') : ''}</div>
        <div class="d">${esc(ct.title || '')} · ${esc(ct.phone || '')} · ${esc(ct.email || '')}</div></div></div>`).join('') : empty('users', 'Chưa có người liên hệ.')}</div>

    <div class="sec-title">Cơ hội (${d.deals.length})</div>
    <div class="card">${d.deals.length ? d.deals.map(dl => `<div class="item">
        <div class="dot-i">${icon(dl.status === 'won' ? 'trophy' : 'trendingUp')}</div>
        <div class="grow"><div class="t">${esc(dl.title)}</div>
        <div class="d">${stageName(dl.stage)} · ${money(dl.value)} · xác suất ${dl.probability}%</div></div>
        <a class="btn sm" href="#/pipeline">Pipeline</a></div>`).join('') : empty('trendingUp', 'Chưa có cơ hội nào.')}</div>

    <div class="sec-title">Dòng thời gian tương tác</div>
    <div class="card"><div class="tl">${d.activities.length ? d.activities.map(a => `<div class="ev">
        <div class="b sm">${actIcon(a.type)} ${esc(a.subject || actName(a.type))}</div>
        <div class="xs mut">${fmtDT(a.happened_at)} · ${esc(a.user_name || '')}${a.outcome ? ' · ' + esc(a.outcome) : ''}</div>
        ${a.note ? `<div class="sm mut">${esc(a.note)}</div>` : ''}
      </div>`).join('') : empty('clock', 'Chưa có tương tác nào.')}</div></div>`;
  };

  const bind = (d) => {
    el.querySelectorAll('[data-temp]').forEach(b => b.onclick = async () => {
      try { await patch('/customers/' + id, { temp: b.dataset.temp }); toast('Đã cập nhật phân loại', 'ok'); detail(el, id); }
      catch (e) { toast(e.message, 'err'); }
    });
    el.querySelector('[data-scale]').onclick = () => modal({
      title: 'Sửa quy mô khách hàng',
      fields: [{ name: 'scale', label: 'Quy mô', type: 'select', value: d.customer.scale || '', options: [{ v: '', n: '— chưa rõ —' }, ...CUSTOMER_SCALE_OPTIONS] }],
      submitText: 'Lưu', onSubmit: async (v) => { await patch('/customers/' + id, { scale: v.scale }); toast('Đã cập nhật quy mô', 'ok'); detail(el, id); },
    });
    el.querySelector('[data-act]').onclick = () => logActivity({ customerId: id }, () => detail(el, id));
    el.querySelector('[data-contact]').onclick = () => modal({
      title: 'Thêm người liên hệ',
      fields: [{ name: 'name', label: 'Họ tên', required: true }, { name: 'title', label: 'Chức danh' },
      { name: 'phone', label: 'Điện thoại' }, { name: 'email', label: 'Email' }],
      onSubmit: async (v) => { await post('/contacts', { ...v, customerId: id }); toast('Đã thêm', 'ok'); detail(el, id); },
    });
    el.querySelector('[data-deal]').onclick = () => modal({
      title: 'Tạo cơ hội mới',
      fields: [{ name: 'title', label: 'Tên cơ hội', required: true },
      { name: 'service', label: 'Dịch vụ', type: 'select', options: SERVICES },
      { name: 'value', label: 'Giá trị (đ)', type: 'number', value: 50000000 }],
      onSubmit: async (v) => { await post('/deals', { ...v, customerId: id }); toast('Đã tạo cơ hội', 'ok'); detail(el, id); },
    });
    el.querySelectorAll('[data-aidraft]').forEach(b => b.onclick = () => aiModal({
      title: 'AI soạn nội dung tiếp cận', titleIcon: 'bot',
      kind: 'email',
      customerId: id,
      promptLabel: 'Gợi ý cho AI',
      prompt: `${d.customer.name} — ${b.dataset.aidraft}`,
      extra: `Ngành: ${d.customer.industry || 'chưa rõ'}; phân loại: ${d.customer.temp}; dịch vụ đã dùng: ${d.customer.services || 'chưa có'}`,
    }));
  };
  await mount(el, load, draw, bind);
}

/** Modal ghi hoạt động — dùng lại ở nhiều màn */
export function logActivity(preset, after) {
  modal({
    title: 'Ghi nhận hoạt động',
    fields: [
      { name: 'type', label: 'Loại hoạt động', type: 'select', options: ACT_TYPES.map(a => ({ v: a.k, n: a.n })) },
      { name: 'subject', label: 'Tiêu đề', required: true, placeholder: 'VD: Gọi chào gói TVC AI' },
      { name: 'outcome', label: 'Kết quả', type: 'select', options: ['Tích cực', 'Cần theo dõi', 'Hẹn gặp lại', 'Chưa có nhu cầu', 'Từ chối'] },
      { name: 'duration', label: 'Thời lượng (phút)', type: 'number', value: 10 },
      { name: 'note', label: 'Nội dung trao đổi', type: 'textarea', rows: 3 },
    ],
    submitText: 'Lưu hoạt động',
    onSubmit: async (v) => {
      await post('/activities', { ...v, ...preset });
      toast('Đã ghi hoạt động — tự tính vào KPI & báo cáo', 'ok');
      if (after) after();
    },
  });
}

/** Thêm/sửa Partner — đối tác hợp tác bán hàng (mục 2 quy trình vận hành PKD). Partner không truy
 * cập CRM trực tiếp, sale phụ trách nhập hộ dữ liệu ở đây. */
function partnerModal(pt, after) {
  modal({
    title: pt ? 'Sửa partner' : 'Thêm partner',
    fields: [
      { name: 'name', label: 'Tên partner', required: true, value: pt?.name || '' },
      { name: 'phone', label: 'Điện thoại', value: pt?.phone || '' },
      { name: 'email', label: 'Email', value: pt?.email || '' },
      ...(isLead() ? [{ ...assigneeField('saleId'), label: 'Sale phụ trách (cố định)', value: pt?.sale_phu_trach_id || '' }] : []),
      { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2, value: pt?.note || '' },
    ],
    submitText: pt ? 'Lưu' : 'Thêm partner',
    onSubmit: async (v) => {
      if (pt) await patch('/partners/' + pt.id, v);
      else await post('/partners', v);
      toast(pt ? 'Đã cập nhật partner' : 'Đã thêm partner', 'ok');
      after();
    },
  });
}
