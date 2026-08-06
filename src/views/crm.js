import { get, post, patch } from '../api.js';
import { state, isLead, salesUsers } from '../state.js';
import { esc, money, mount, chip, empty, rel, fmtDT, toast, modal, initials } from '../ui.js';
import { TEMPS, SERVICES, ACT_TYPES, actIcon, actName, stageName } from '../const.js';
import { aiModal } from '../aiPref.js';

let filter = { q: '', temp: '' };

export async function render(el, params) {
  if (params && params.id) return detail(el, params.id);

  const load = () => get('/customers?q=' + encodeURIComponent(filter.q) + (filter.temp ? '&temp=' + filter.temp : ''));
  const draw = (d) => `
    <div class="page-head">
      <div class="grow"><h2>CRM 360°</h2><p>${d.items.length} khách hàng ${isLead() ? 'toàn đội' : 'của bạn'} · phân loại nóng / ấm / nguội</p></div>
      <button class="btn primary sm" data-add>+ Khách hàng</button>
    </div>
    <input placeholder="🔍 Tìm theo tên hoặc ngành…" value="${esc(filter.q)}" data-q class="mb">
    <div class="seg mb">
      ${['', 'hot', 'warm', 'cold'].map(t => `<button data-temp="${t}" class="${filter.temp === t ? 'on' : ''}">${t ? TEMPS[t].n : 'Tất cả'}</button>`).join('')}
    </div>
    ${d.items.length ? `<div class="card">${d.items.map(c => `
      <a class="item" href="#/crm/${esc(c.id)}">
        <div class="avatar" style="border-radius:11px">${esc(initials(c.name))}</div>
        <div class="grow"><div class="t">${esc(c.name)}</div>
          <div class="d">${esc(c.industry || 'Chưa phân ngành')} · ${c.open_deals} deal mở · đã ký ${money(c.won_value)}</div>
          <div class="d xs">Tương tác gần nhất: ${rel(c.last_touch_at)}${isLead() ? ' · phụ trách ' + esc(c.owner_name || '—') : ''}</div></div>
        <div class="right">${chip(TEMPS[c.temp]?.n || c.temp, TEMPS[c.temp]?.c)}</div>
      </a>`).join('')}</div>` : empty('🗂️', 'Chưa có khách hàng nào khớp bộ lọc.')}`;

  const bind = () => {
    const q = el.querySelector('[data-q]');
    let tmr;
    q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { filter.q = q.value; render(el); }, 350); };
    el.querySelectorAll('[data-temp]').forEach(b => b.onclick = () => { filter.temp = b.dataset.temp; render(el); });
    el.querySelector('[data-add]').onclick = () => modal({
      title: 'Thêm khách hàng',
      fields: [
        { name: 'name', label: 'Tên công ty', required: true },
        { name: 'industry', label: 'Ngành hàng' },
        { name: 'phone', label: 'Điện thoại' }, { name: 'email', label: 'Email' },
        { name: 'temp', label: 'Phân loại', type: 'select', options: [{ v: 'hot', n: 'Nóng' }, { v: 'warm', n: 'Ấm' }, { v: 'cold', n: 'Nguội' }] },
        ...(isLead() ? [{ name: 'ownerId', label: 'Giao cho', type: 'select', options: salesUsers().map(u => ({ v: u.id, n: u.name })) }] : []),
        { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
      ],
      onSubmit: async (v) => { await post('/customers', v); toast('Đã thêm khách hàng', 'ok'); render(el); },
    });
  };
  await mount(el, load, draw, bind);
}

async function detail(el, id) {
  const load = () => get('/customers/' + id);
  const draw = (d) => {
    const c = d.customer;
    return `<div class="page-head">
      <a class="btn sm" href="#/crm">←</a>
      <div class="grow"><h2>${esc(c.name)}</h2>
        <p>${esc(c.industry || '—')} · ${esc(c.scale || '')} · nguồn ${esc(c.source || '—')}</p></div>
      ${chip(TEMPS[c.temp]?.n || c.temp, TEMPS[c.temp]?.c)}
    </div>

    <div class="grid g3">
      ${['hot', 'warm', 'cold'].map(t => `<button class="btn sm ${c.temp === t ? 'amber' : ''}" data-temp="${t}">${TEMPS[t].n}</button>`).join('')}
    </div>

    <div class="card mt">
      <div class="row wrap sm"><div class="grow">📞 ${esc(c.phone || '—')}</div><div>✉️ ${esc(c.email || '—')}</div></div>
      <div class="sm mut mt">${esc(c.note || 'Chưa có ghi chú.')}</div>
      <div class="row mt" style="gap:8px">
        <button class="btn sm grow" data-act>+ Ghi hoạt động</button>
        <button class="btn sm grow" data-deal>+ Tạo deal</button>
        <button class="btn sm grow" data-contact>+ Người liên hệ</button>
      </div>
    </div>

    <div class="sec-title">Gợi ý AI: cross-sell & tái ký</div>
    <div class="card">${d.suggestions.length ? d.suggestions.map(s => `<div class="item">
        <div class="dot-i">${s.type === 're-sign' ? '🔁' : s.type === 'warm-up' ? '🌡️' : '💡'}</div>
        <div class="grow"><div class="t">${esc(s.text)}</div></div>
        <button class="btn sm" data-aidraft="${esc(s.text)}">Soạn</button>
      </div>`).join('') : empty('🤖', 'Chưa có gợi ý.')}</div>

    <div class="sec-title">Người liên hệ (${d.contacts.length})</div>
    <div class="card">${d.contacts.length ? d.contacts.map(ct => `<div class="item">
        <div class="dot-i">👤</div><div class="grow"><div class="t">${esc(ct.name)} ${ct.is_primary ? chip('Chính', 'amber') : ''}</div>
        <div class="d">${esc(ct.title || '')} · ${esc(ct.phone || '')} · ${esc(ct.email || '')}</div></div></div>`).join('') : empty('👥', 'Chưa có người liên hệ.')}</div>

    <div class="sec-title">Cơ hội (${d.deals.length})</div>
    <div class="card">${d.deals.length ? d.deals.map(dl => `<div class="item">
        <div class="dot-i">${dl.status === 'won' ? '🏆' : '📈'}</div>
        <div class="grow"><div class="t">${esc(dl.title)}</div>
        <div class="d">${stageName(dl.stage)} · ${money(dl.value)} · xác suất ${dl.probability}%</div></div>
        <a class="btn sm" href="#/pipeline">Pipeline</a></div>`).join('') : empty('📈', 'Chưa có cơ hội nào.')}</div>

    <div class="sec-title">Dòng thời gian tương tác</div>
    <div class="card"><div class="tl">${d.activities.length ? d.activities.map(a => `<div class="ev">
        <div class="b sm">${actIcon(a.type)} ${esc(a.subject || actName(a.type))}</div>
        <div class="xs mut">${fmtDT(a.happened_at)} · ${esc(a.user_name || '')}${a.outcome ? ' · ' + esc(a.outcome) : ''}</div>
        ${a.note ? `<div class="sm mut">${esc(a.note)}</div>` : ''}
      </div>`).join('') : empty('🕓', 'Chưa có tương tác nào.')}</div></div>`;
  };

  const bind = (d) => {
    el.querySelectorAll('[data-temp]').forEach(b => b.onclick = async () => {
      try { await patch('/customers/' + id, { temp: b.dataset.temp }); toast('Đã cập nhật phân loại', 'ok'); detail(el, id); }
      catch (e) { toast(e.message, 'err'); }
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
      title: '🤖 AI soạn nội dung tiếp cận',
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
      { name: 'type', label: 'Loại hoạt động', type: 'select', options: ACT_TYPES.map(a => ({ v: a.k, n: a.ic + ' ' + a.n })) },
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
