import { get, post, patch } from '../api.js';
import { state, isLead, salesTeamUsers, salesTeamOption } from '../state.js';
import { esc, money, mount, chip, empty, rel, fmtDate, fmtDT, toast, modal, initials, stat } from '../ui.js';
import {
  SERVICES, ACT_TYPES, actIcon, actName, stageName, LEAD_SOURCES, leadSourceName, CUSTOMER_SCALE_OPTIONS,
  CUSTOMER_STATUSES, statusDef, saleStatuses, tenderStatuses, DKKH_TONE, dkkhLabel,
} from '../const.js';
import { aiModal } from '../aiPref.js';
import { icon } from '../icons.js';

/* Bộ lọc danh sách khách hàng (yêu cầu bổ sung: lọc theo sale phụ trách và theo các trường thông
 * tin khách hàng). Giữ ở module scope để không mất lựa chọn khi vào xem chi tiết rồi quay lại. */
let filter = { q: '', owner: '', statuses: [], industry: '', scale: '', source: '', dkkh: '' };
let crmTab = 'customers';

const filterQuery = () => {
  const qs = new URLSearchParams();
  if (filter.q) qs.set('q', filter.q);
  if (filter.owner) qs.set('userId', filter.owner);
  if (filter.statuses.length) qs.set('status', filter.statuses.join(','));
  if (filter.industry) qs.set('industry', filter.industry);
  if (filter.scale) qs.set('scale', filter.scale);
  if (filter.source) qs.set('source', filter.source);
  if (filter.dkkh) qs.set('dkkh', filter.dkkh);
  const s = qs.toString();
  return s ? '?' + s : '';
};
const activeFilterCount = () =>
  [filter.q, filter.owner, filter.industry, filter.scale, filter.source, filter.dkkh].filter(Boolean).length + filter.statuses.length;

/** Chip trạng thái của 1 khách — vẽ hết, vì việc khách mang nhiều trạng thái cùng lúc chính là
 * thông tin cần thấy (đã mua hàng nhưng vẫn đang được chào gói tiếp theo). */
const statusChips = (c) => (c.statuses || []).map(k => chip(statusDef(k).n, statusDef(k).c)).join(' ');

/** Chip ĐKKH + số ngày còn lại. */
const dkkhChip = (dk) => chip(dkkhLabel(dk), (DKKH_TONE[dk?.kind] || DKKH_TONE.locked).c);

export async function render(el, params) {
  if (params && params.id) return detail(el, params.id);

  const load = async () => {
    const [cRes, pRes, claimRes] = await Promise.all([
      get('/customers' + filterQuery()),
      get('/partners'),
      // Khách hết hạn ĐKKH của sale khác — quyền "sale khác được phép ĐKKH khách đó" chỉ có ý
      // nghĩa với sales; TP/Admin đã nhìn thấy toàn đội nên không cần tab này.
      isLead() ? Promise.resolve({ items: [] }) : get('/customers?claimable=1'),
    ]);
    return { items: cRes.items || [], sales: cRes.sales || [], partners: pRes.items || [], claimable: claimRes.items || [] };
  };

  const draw = (d) => {
    const industries = [...new Set(d.items.map(c => c.industry).filter(Boolean))].sort();
    const expiring = d.items.filter(c => c.dkkh?.kind === 'expiring').length;
    const expired = d.items.filter(c => c.dkkh?.kind === 'expired').length;
    const nFilters = activeFilterCount();
    const sel = (name, label, value, options) => `<label class="f"><span>${esc(label)}</span>
      <select data-f="${name}">${options.map(o => {
      const v = typeof o === 'string' ? o : o.v, n = typeof o === 'string' ? o : o.n;
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(n)}</option>`;
    }).join('')}</select></label>`;

    return `
    <div class="page-head">
      <div class="grow"><h2>CRM 360°</h2>
        <p>${d.items.length} khách hàng ${isLead() ? 'toàn đội' : 'của bạn'} · trạng thái theo quy trình · ĐKKH 1 tháng</p></div>
      <div class="right"><button class="btn primary sm" data-add>+ Khách hàng</button>
        <div class="mt"><button class="btn sm" data-addpartner>+ Partner</button></div></div>
    </div>

    <div class="grid g3 mb">
      ${stat('Khách đang quản lý', d.items.length, nFilters ? nFilters + ' bộ lọc đang bật' : 'Không lọc', 'blue')}
      ${stat('ĐKKH sắp hết hạn', expiring, 'Còn ≤ 5 ngày — gia hạn hoặc đẩy ký', expiring ? 'amber' : '')}
      ${stat('ĐKKH đã hết hạn', expired, 'Sale khác được phép nhận', expired ? 'red' : '')}
    </div>

    <div class="seg mb">
      <button data-crmtab="customers" class="${crmTab === 'customers' ? 'on' : ''}">Khách hàng</button>
      ${!isLead() ? `<button data-crmtab="claimable" class="${crmTab === 'claimable' ? 'on' : ''}">Khách có thể nhận (${d.claimable.length})</button>` : ''}
      <button data-crmtab="partners" class="${crmTab === 'partners' ? 'on' : ''}">Partner (${d.partners.length})</button>
    </div>

    ${crmTab === 'customers' ? `
    <div class="card mb">
      <div class="row mb"><div class="grow b sm">Bộ lọc khách hàng</div>
        ${nFilters ? `<button class="btn sm ghost" data-clearf>Xoá lọc (${nFilters})</button>` : ''}</div>
      <input placeholder="Tìm theo tên, ngành hoặc số điện thoại…" value="${esc(filter.q)}" data-q class="mb">
      <div class="grid g3">
        ${isLead() ? sel('owner', 'Sale phụ trách', filter.owner, [{ v: '', n: 'All' }, ...d.sales.map(salesTeamOption)]) : ''}
        ${sel('industry', 'Ngành hàng', filter.industry, [{ v: '', n: 'All' }, ...industries.map(i => ({ v: i, n: i }))])}
        ${sel('scale', 'Quy mô', filter.scale, [{ v: '', n: 'All' }, ...CUSTOMER_SCALE_OPTIONS.map(s => ({ v: s, n: s }))])}
        ${sel('source', 'Nguồn khách hàng', filter.source, [{ v: '', n: 'All' }, ...LEAD_SOURCES.map(s => ({ v: s.v, n: s.n }))])}
        ${sel('dkkh', 'Tình trạng ĐKKH', filter.dkkh, [{ v: '', n: 'All' }, { v: 'expiring', n: 'Sắp hết hạn (≤5 ngày)' }, { v: 'expired', n: 'Đã hết hạn' }, ...(isLead() ? [{ v: 'mine', n: 'Do tôi phụ trách' }] : [])])}
      </div>
      <div class="sec-title" style="margin-top:12px">Trạng thái — quy trình bán hàng</div>
      <div class="row wrap" style="gap:5px">${saleStatuses().map(s => statusFilterBtn(s)).join('')}</div>
      <div class="sec-title">Trạng thái — quy trình đấu thầu</div>
      <div class="row wrap" style="gap:5px">${tenderStatuses().map(s => statusFilterBtn(s)).join('')}</div>
    </div>

    ${d.items.length ? `<div class="card">${d.items.map(c => customerRow(c)).join('')}</div>`
        : empty('folderOpen', 'Chưa có khách hàng nào khớp bộ lọc.')}
    ` : crmTab === 'claimable' ? `
    <div class="note mb sm">Khách đã <b>quá hạn ĐKKH 1 tháng</b> mà sale phụ trách chưa ký hợp đồng và không tái đăng ký.
      Bạn được phép nhận về chăm sóc — sale cũ sẽ nhận được thông báo.</div>
    ${d.claimable.length ? `<div class="card">${d.claimable.map(c => `<div class="item">
        <div class="avatar" style="border-radius:11px">${esc(initials(c.name))}</div>
        <div class="grow"><div class="t">${esc(c.name)}</div>
          <div class="d">${esc(c.industry || 'Chưa phân ngành')} · đang thuộc ${esc(c.owner_name || '—')}</div>
          <div class="d xs">Hết hạn ĐKKH ${fmtDate(c.dkkh.expiresAt)} · tương tác gần nhất ${rel(c.last_touch_at)}</div>
          <div class="mt">${statusChips(c)}</div></div>
        <button class="btn sm amber" data-claim="${esc(c.id)}">Nhận khách</button>
      </div>`).join('')}</div>` : empty('handshake', 'Không có khách nào đang hết hạn ĐKKH để nhận.')}
    ` : `
    ${d.partners.length ? `<div class="card">${d.partners.map(pt => `<div class="item">
        <div class="dot-i">${icon('handshake')}</div>
        <div class="grow"><div class="t">${esc(pt.name)}</div>
          <div class="d">${esc(pt.phone || '—')}${pt.email ? ' · ' + esc(pt.email) : ''} · phụ trách ${esc(pt.sale_name || '—')}</div>
          ${pt.note ? `<div class="d xs">${esc(pt.note)}</div>` : ''}</div>
        <button class="btn sm" data-editpartner="${esc(pt.id)}">Sửa</button>
      </div>`).join('')}</div>` : empty('handshake', 'Chưa có partner nào — thêm partner để gán làm nguồn khách hàng.')}
    `}`;
  };

  const bind = (d) => {
    const q = el.querySelector('[data-q]');
    let tmr;
    if (q) q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { filter.q = q.value; render(el); }, 350); };
    el.querySelectorAll('[data-f]').forEach(s => s.onchange = () => { filter[s.dataset.f] = s.value; render(el); });
    el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
      const k = b.dataset.st;
      filter.statuses = filter.statuses.includes(k) ? filter.statuses.filter(x => x !== k) : [...filter.statuses, k];
      render(el);
    });
    const clear = el.querySelector('[data-clearf]');
    if (clear) clear.onclick = () => { filter = { q: '', owner: '', statuses: [], industry: '', scale: '', source: '', dkkh: '' }; render(el); };
    el.querySelectorAll('[data-crmtab]').forEach(b => b.onclick = () => { crmTab = b.dataset.crmtab; render(el); });

    el.querySelectorAll('[data-renew]').forEach(b => b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        const r = await post('/customers/' + b.dataset.renew + '/dkkh/renew', {});
        toast(`Đã tái ĐKKH — giữ thêm ${r.dkkh.daysLeft} ngày.`, 'ok');
        render(el);
      } catch (err) { toast(err.message, 'err'); }
    });
    el.querySelectorAll('[data-claim]').forEach(b => b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        await post('/customers/' + b.dataset.claim + '/dkkh/claim', {});
        toast('Đã nhận khách — ĐKKH mới bắt đầu từ hôm nay.', 'ok');
        render(el);
      } catch (err) { toast(err.message, 'err'); }
    });

    el.querySelector('[data-add]').onclick = () => customerModal(null, d, () => render(el));
    el.querySelector('[data-addpartner]').onclick = () => partnerModal(null, () => render(el));
    el.querySelectorAll('[data-editpartner]').forEach(b => b.onclick = () => partnerModal(d.partners.find(x => x.id === b.dataset.editpartner), () => render(el)));
  };
  await mount(el, load, draw, bind);
}

const statusFilterBtn = (s) => `<button class="btn sm ${filter.statuses.includes(s.k) ? 'amber' : ''}" data-st="${esc(s.k)}">${esc(s.n)}</button>`;

/** Một dòng khách hàng trong danh sách — trạng thái (nhiều), ĐKKH và nút gia hạn nằm cùng chỗ. */
function customerRow(c) {
  const dk = c.dkkh || {};
  return `<div class="item">
    <a class="avatar" style="border-radius:11px" href="#/crm/${esc(c.id)}">${esc(initials(c.name))}</a>
    <div class="grow" style="min-width:0">
      <a class="t" href="#/crm/${esc(c.id)}" style="display:block">${esc(c.name)}</a>
      <div class="d">${esc(c.industry || 'Chưa phân ngành')} · ${c.open_deals} deal mở · đã ký ${money(c.won_value)}</div>
      <div class="d xs">Tương tác gần nhất: ${rel(c.last_touch_at)}${c.nguon_khach_hang ? ' · ' + esc(leadSourceName(c.nguon_khach_hang)) : ''}</div>
      ${isLead() ? `<div class="d xs mt">Sales phụ trách: <b>${esc(c.owner_name || 'Chưa gán')}</b></div>` : ''}
      <div class="row wrap mt" style="gap:4px">${statusChips(c)}</div>
    </div>
    <div class="right">
      ${dkkhChip(dk)}
      ${dk.kind && dk.kind !== 'locked' ? `<div class="xs mut mt">Hạn ${fmtDate(dk.expiresAt)}</div>
      <div class="mt"><button class="btn sm" data-renew="${esc(c.id)}">Gia hạn ĐKKH</button></div>` : ''}
    </div>
  </div>`;
}

async function detail(el, id) {
  const load = async () => {
    const [d, plans] = await Promise.all([get('/customers/' + id), get('/plans?customerId=' + encodeURIComponent(id))]);
    return { ...d, plans: plans.items || [] };
  };
  const draw = (d) => {
    const c = d.customer;
    const dk = c.dkkh || {};
    return `<div class="page-head">
      <a class="btn sm" href="#/crm">${icon('arrowLeft', 15)}</a>
      <div class="grow"><h2>${esc(c.name)}</h2>
        <p>${esc(c.industry || '—')} · ${esc(c.scale || 'Chưa rõ quy mô')} <button class="btn sm" data-scale style="padding:1px 6px;margin-left:4px">${icon('pencil', 11)}</button> · nguồn ${esc(leadSourceName(c.nguon_khach_hang))}</p></div>
      <div class="right">${dkkhChip(dk)}</div>
    </div>

    <div class="card">
      <div class="row wrap"><div class="grow b sm">Trạng thái</div>
        <button class="btn sm" data-editstatus>Đổi trạng thái</button></div>
      <div class="row wrap mt" style="gap:5px">${statusChips(c) || '<span class="sm mut">Chưa gắn trạng thái nào.</span>'}</div>
      <div class="xs mut mt">Một khách có thể mang nhiều trạng thái cùng lúc — ví dụ vừa "Đã mua hàng" vừa "Chào hàng" gói tiếp theo.</div>
    </div>

    <div class="card mt">
      <div class="row wrap"><div class="grow b sm">Đăng ký khách hàng (ĐKKH)</div>${dkkhChip(dk)}</div>
      ${dk.kind === 'locked'
        ? '<div class="sm mut mt">Khách đã ký hợp đồng — quyền chăm sóc được giữ vĩnh viễn, không cần gia hạn.</div>'
        : `<div class="sm mut mt">Đăng ký ${fmtDate(dk.at)} · hết hạn ${fmtDate(dk.expiresAt)}${dk.count ? ` · đã tái đăng ký ${dk.count} lần` : ''}.
           ${dk.kind === 'expired'
            ? 'Đã quá hạn — sale khác được phép nhận khách này.'
            : `Còn ${dk.daysLeft} ngày. Quá hạn mà chưa ký hợp đồng, sale khác sẽ được phép nhận.`}</div>
           <button class="btn sm amber mt" data-renew>Tái ĐKKH thêm 30 ngày</button>`}
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

    <div class="sec-title">Phương án kinh doanh (${d.plans.length})</div>
    <div class="card">
      <div class="sm mut mb">Báo giá · Hợp đồng · Nghiệm thu · Thanh lý — lập chứng từ và trình duyệt ngay trong phương án, phản hồi quay lại đúng luồng đã trình.</div>
      ${d.plans.length ? d.plans.map(pl => `<a class="item" href="#/plans/${esc(pl.id)}">
        <div class="dot-i">${icon('clipboardList')}</div>
        <div class="grow"><div class="t">${esc(pl.title)}</div>
          <div class="d">${pl.approved_n}/4 hạng mục đã duyệt · cập nhật ${rel(pl.updated_at)}</div></div>
        <div class="right">${pl.revise_n ? chip(pl.revise_n + ' cần sửa', 'red') : ''}${pl.pending_n ? chip(pl.pending_n + ' chờ duyệt', 'amber') : ''}</div>
      </a>`).join('') : '<div class="sm mut">Chưa có phương án nào.</div>'}
      <button class="btn sm primary mt" data-addplan>+ Tạo phương án kinh doanh</button>
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
    const renew = el.querySelector('[data-renew]');
    if (renew) renew.onclick = async () => {
      try {
        const r = await post('/customers/' + id + '/dkkh/renew', {});
        toast(`Đã tái ĐKKH — giữ thêm ${r.dkkh.daysLeft} ngày.`, 'ok');
        detail(el, id);
      } catch (e) { toast(e.message, 'err'); }
    };
    el.querySelector('[data-editstatus]').onclick = () => statusModal(d.customer, () => detail(el, id));
    el.querySelector('[data-addplan]').onclick = () => modal({
      title: 'Tạo phương án kinh doanh',
      html: '<div class="sm mut mb">Hệ thống tạo sẵn 4 hạng mục: Báo giá · Hợp đồng · Nghiệm thu · Thanh lý. Báo giá và hợp đồng lập bằng chứng từ thật ngay tại bước 1 và bước 2.</div>',
      fields: [
        { name: 'title', label: 'Tên phương án', required: true, value: 'Phương án ' + d.customer.name },
        { name: 'dealId', label: 'Gắn cơ hội (tuỳ chọn)', type: 'select', options: [{ v: '', n: '— không —' }, ...d.deals.map(x => ({ v: x.id, n: x.title }))] },
        { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
      ],
      submitText: 'Tạo phương án',
      onSubmit: async (v) => {
        const r = await post('/plans', { ...v, customerId: id });
        toast('Đã tạo phương án kinh doanh', 'ok');
        location.hash = '#/plans/' + r.id;
      },
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
      extra: `Ngành: ${d.customer.industry || 'chưa rõ'}; trạng thái: ${(d.customer.statuses || []).map(k => statusDef(k).n).join(', ') || 'chưa rõ'}; dịch vụ đã dùng: ${d.customer.services || 'chưa có'}`,
    }));
  };
  await mount(el, load, draw, bind);
}

/** Chọn trạng thái — nhiều lựa chọn, nên dùng checkbox trong `html` thay vì field select của
 * modal() (FormData chỉ giữ được 1 giá trị cho các input trùng tên). */
function statusModal(c, after) {
  const cur = new Set(c.statuses || []);
  const group = (title, list) => `<div class="sec-title">${esc(title)}</div>
    <div class="row wrap" style="gap:6px">${list.map(s => `<label class="chip ${cur.has(s.k) ? s.c : 'grey'}" style="cursor:pointer;padding:5px 10px">
      <input type="checkbox" name="st" value="${esc(s.k)}" ${cur.has(s.k) ? 'checked' : ''} style="margin-right:5px;vertical-align:middle">${esc(s.n)}</label>`).join('')}</div>`;
  modal({
    title: 'Trạng thái khách hàng',
    wide: true,
    html: `<div class="sm mut mb">Chọn tất cả trạng thái đang đúng với khách này — được chọn nhiều.</div>
      ${group('Quy trình bán hàng', saleStatuses())}
      ${group('Quy trình đấu thầu', tenderStatuses())}`,
    submitText: 'Lưu trạng thái',
    onSubmit: async (_v, root) => {
      const statuses = [...root.querySelectorAll('input[name=st]:checked')].map(i => i.value);
      if (!statuses.length) { toast('Chọn ít nhất 1 trạng thái', 'err'); return false; }
      await patch('/customers/' + c.id, { statuses });
      toast('Đã cập nhật trạng thái', 'ok');
      after();
    },
  });
}

/** Thêm khách hàng mới — trạng thái ban đầu chọn được ngay, mặc định "Khách mới". */
/**
 * Thêm khách hàng, kèm cảnh báo trùng/deal registration NGAY KHI GÕ.
 *
 * Trước đây cảnh báo chỉ xuất hiện dưới dạng toast lúc bấm Lưu, mà toast sống 3.2 giây độc lập với
 * ô nhập: đổi sang tên khách khác thì cảnh báo cũ vẫn nằm đó nhắc tên khách trước — đọc như thể
 * khách mới cũng đang bị trùng. Nay cảnh báo là một khối gắn ngay dưới ô "Tên công ty", tự cập
 * nhật theo tên/điện thoại đang gõ và biến mất ngay khi không còn trùng.
 */
function customerModal(c, d, after) {
  const { root } = modal({
    title: 'Thêm khách hàng',
    fields: [
      { name: 'name', label: 'Tên công ty', required: true },
      { name: 'industry', label: 'Ngành hàng' },
      { name: 'scale', label: 'Quy mô', type: 'select', options: [{ v: '', n: '— chưa rõ —' }, ...CUSTOMER_SCALE_OPTIONS] },
      { name: 'phone', label: 'Điện thoại' }, { name: 'email', label: 'Email' },
      { name: 'status', label: 'Trạng thái ban đầu', type: 'select', options: CUSTOMER_STATUSES.map(s => ({ v: s.k, n: s.n })) },
      { name: 'nguonKhachHang', label: 'Nguồn khách hàng', type: 'select', options: [{ v: '', n: '— chưa rõ —' }, ...LEAD_SOURCES] },
      { name: 'partnerId', label: 'Partner (nếu nguồn là Partner)', type: 'select', options: [{ v: '', n: '— không —' }, ...d.partners.map(pt => ({ v: pt.id, n: pt.name }))] },
      ...(isLead() ? [{ name: 'ownerId', label: 'Sale phụ trách', type: 'select', options: d.sales.map(salesTeamOption) }] : []),
      { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
    ],
    onSubmit: async (v) => {
      await post('/customers', { ...v, statuses: [v.status] });
      toast('Đã thêm khách hàng — ĐKKH bắt đầu tính từ hôm nay', 'ok');
      after();
    },
  });

  bindDuplicateWarning(root);
}

/**
 * Gắn khối cảnh báo trùng khách vào modal và giữ nó luôn khớp với nội dung đang gõ.
 * Hỏi máy chủ (GET /api/customers/check-duplicate) chứ không dò trong danh sách đang hiển thị:
 * sales chỉ thấy khách CỦA MÌNH, mà ca cần cảnh báo nhất lại đúng là khách do sale khác giữ.
 */
function bindDuplicateWarning(root, excludeId) {
  const nameEl = root.querySelector('[name="name"]');
  const phoneEl = root.querySelector('[name="phone"]');
  if (!nameEl) return;

  const warn = document.createElement('div');
  warn.className = 'note red mb';
  warn.style.display = 'none';
  warn.style.marginTop = '8px';
  nameEl.closest('label').insertAdjacentElement('afterend', warn);

  // `seq` chống câu trả lời về trễ: gõ tên A rồi đổi sang tên B, nếu phản hồi của A về sau phản
  // hồi của B thì cảnh báo lại hiện tên A — đúng cái lỗi "cảnh báo nhắc khách cũ" cần dẹp.
  let seq = 0, timer;
  const hide = () => { warn.style.display = 'none'; warn.innerHTML = ''; };

  const check = async () => {
    const name = (nameEl.value || '').trim();
    const phone = ((phoneEl && phoneEl.value) || '').trim();
    // Dưới 2 ký tự thì chính máy chủ cũng không nhận (vText min 2) — không hỏi cho phí.
    if (name.length < 2 && !phone) return hide();
    const mine = ++seq;
    let r;
    try {
      const qs = new URLSearchParams({ name, phone });
      if (excludeId) qs.set('excludeId', excludeId);
      r = await get('/customers/check-duplicate?' + qs.toString());
    } catch (e) { if (mine === seq) hide(); return; }
    if (mine !== seq) return;

    const dup = r.duplicate;
    if (!dup) return hide();
    warn.style.display = '';
    warn.innerHTML = `${dup.mine
      ? `Khách <b>${esc(dup.name)}</b> đã có trong danh sách của bạn.`
      : `Khách <b>${esc(dup.name)}</b> đã được <b>${esc(dup.ownerName || 'sales khác')}</b> đăng ký.
         Vui lòng trao đổi trước khi tiếp cận (deal registration).`}
      ${dup.matchedPhone ? '<div class="xs mut mt">Trùng theo <b>số điện thoại</b>, không phải theo tên.</div>' : ''}`;
  };

  const schedule = () => { clearTimeout(timer); timer = setTimeout(check, 400); };
  nameEl.addEventListener('input', schedule);
  if (phoneEl) phoneEl.addEventListener('input', schedule);
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
      ...(isLead() ? [{
        name: 'saleId', label: 'Sale phụ trách (cố định)', type: 'select', value: pt?.sale_phu_trach_id || '',
        options: salesTeamUsers().map(salesTeamOption),
      }] : []),
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
