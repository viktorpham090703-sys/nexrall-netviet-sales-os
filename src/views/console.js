import { get, post, patch } from '../api.js';
import { state, salesUsers, isAdmin } from '../state.js';
import { esc, money, mount, chip, bar, empty, stat, toast, modal, fmtDate, bindTabs, rel } from '../ui.js';
import { stageName, STAGES, TERMINAL_STAGES, QUOTE_STATUS, CONTRACT_STATUS, roleLabel, roleDefaultLabel, PIP_STATUS, gradeTone, APPROVAL_TONE } from '../const.js';
import { icon } from '../icons.js';
import { canDecide, canDecideContract, bindApprovalActions } from '../salesDocs.js';
import { t as tr, tf, personName, jobTitle } from '../i18n.js';
import { teamCharts, hrCharts } from '../dash.js';

let tab = 'overview';
/* HCNS chỉ xét duyệt báo giá/hợp đồng/hồ sơ thầu — không có nhiệm vụ quản lý đội sales
 * (KPI, PIP, phễu, cảnh báo SLA...), nên Console của HCNS gộp cả 3 loại vào đúng 1 danh sách
 * "Hồ sơ cần duyệt" thay vì tách tab — không cần chuyển qua lại giữa 3 chỗ để rà soát. */
const isHR = () => state.me?.role === 'hr';

export async function render(el) {
  const load = async () => {
    const none = Promise.resolve({ items: [] });
    // /deals nạp 1 lần dùng cho cả hồ sơ thầu chờ duyệt (HCNS) lẫn biểu đồ doanh thu đội (TP/BGĐ).
    const [t, p, deals, noti, acts] = await Promise.all([
      get('/team'), get('/pip'), get('/deals').catch(() => ({ items: [] })),
      get('/notifications?limit=5').catch(() => ({ items: [] })),
      isHR() ? none : get('/activities?days=14').catch(() => ({ items: [] })),
    ]);
    const pendingTenders = (deals.items || []).filter(x => x.process_type === 'dau_thau' && x.stage === 'cho_duyet_ho_so');
    return { ...t, pips: p.items || [], pendingTenders, notis: noti.items || [], allDeals: isHR() ? [] : deals.items || [], acts: acts.items || [] };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>${isHR() ? tr('Console HCNS') : tr('Console Trưởng phòng')}</h2>
      <p>${isHR() ? tr('Xét duyệt báo giá · hợp đồng · hồ sơ dự thầu') : tr('Giám sát đội · hoạt động vs định mức · phễu · cảnh báo · duyệt giá · KPI & PIP')}</p></div>
  </div>

  <div class="grid g3 mb">
    ${isHR() ? `
      ${stat('Báo giá chờ duyệt', d.pendingQuotes.length, tr('Cần TPKD/Admin xử lý các vòng khác'), 'amber')}
      ${stat('Hợp đồng chờ duyệt', d.pendingContracts.length, tr('Vòng 2 do HCNS phụ trách'), 'blue')}
      ${stat('Hồ sơ thầu chờ duyệt', d.pendingTenders.length, tr('Giám đốc duyệt trước khi nộp'), 'red')}
    ` : `
      ${stat('Pipeline kỳ vọng', money(d.totals.pipeline), d.totals.openCount + ' ' + tr('deal đang mở'), 'red')}
      ${stat('Doanh thu đã ký', money(d.totals.won), tr('Luỹ kế toàn đội'), 'blue')}
      ${stat('Cảnh báo', d.alerts.length, d.alerts.filter(a => a.level === 'danger').length + ' ' + tr('nghiêm trọng'), d.alerts.length ? 'amber' : '')}
    `}
  </div>

  ${isHR() ? hrCharts(d) : teamCharts({ team: d, deals: d.allDeals, acts: d.acts })}
  <div class="grid g2 mb dm-grid">
    ${isHR() ? '' : `<div class="card"><div class="row"><b>${icon('siren', 15)} ${tr('Cảnh báo quan trọng')}</b><span class="grow"></span>${chip(d.alerts.filter(a => a.level === 'danger').length + ' ' + tr('nghiêm trọng'), 'red')}</div>
      ${(d.alerts || []).slice(0, 4).map(a => `<div class="item"><div class="dot-i">${icon(a.level === 'danger' ? 'siren' : 'triangleAlert')}</div><div class="grow"><div class="t">${esc(a.text || a.title || '')}</div></div>${a.link ? `<a class="btn sm" href="${esc(a.link)}">${tr('Xử lý')}</a>` : ''}</div>`).join('') || empty('circleCheck', 'Không có cảnh báo.')}</div>`}
    <div class="card"><div class="row"><b>${icon('bell', 15)} ${tr('Thông báo cá nhân')}</b><span class="grow"></span><a class="btn sm" href="#/thong-bao">${tr('Xem tất cả')}</a></div>
      ${d.notis.map(n => `<a class="item" href="#/thong-bao/${esc(n.id)}"><div class="dot-i">${icon(n.level === 'danger' ? 'siren' : n.level === 'warn' ? 'triangleAlert' : 'bell')}</div><div class="grow"><div class="t">${esc(n.title)}</div><div class="d xs">${rel(n.created_at)}</div></div></a>`).join('') || empty('bell', 'Chưa có thông báo.')}</div>
  </div>

  ${isHR() ? '' : `<div class="seg mb">
    <button data-tab="overview" class="${tab === 'overview' ? 'on' : ''}">${tr('Tổng quan đội')}</button>
    <button data-tab="funnel" class="${tab === 'funnel' ? 'on' : ''}">${tr('Phễu')}</button>
    <button data-tab="alerts" class="${tab === 'alerts' ? 'on' : ''}">${tr('Cảnh báo')} (${d.alerts.length})</button>
    <button data-tab="approve" class="${tab === 'approve' ? 'on' : ''}">${tr('Duyệt giá')} (${d.pendingQuotes.length})</button>
    <button data-tab="approveContracts" class="${tab === 'approveContracts' ? 'on' : ''}">${tr('Duyệt hợp đồng')} (${d.pendingContracts.length})</button>
    <button data-tab="pip" class="${tab === 'pip' ? 'on' : ''}">KPI & PIP</button>
  </div>`}

  ${isHR() ? `<div class="sec-title">${tr('Hồ sơ cần duyệt')}</div>${mergedApproval(d)}` : ''}

  ${!isHR() && tab === 'overview' ? `<div class="card">${d.members.map(m => m.role === 'sales' ? `<div class="item">
      <div class="dot-i">${icon(m.kpi.total >= 80 ? 'star' : m.kpi.total >= 60 ? 'smile' : 'triangleAlert')}</div>
      <div class="grow"><div class="t">${esc(personName(m.name))} ${chip(m.kpi.grade, gradeTone(m.kpi.total))}</div>
        <div class="d xs mut">${esc(roleLabel(m))}</div>
        <div class="d">DT ${money(m.metrics.revenue)}/${money(m.metrics.target_revenue)} · pipeline ${money(m.pipeline)} · ${m.metrics.wonN} ${tr('deal chốt')}</div>
        <div class="mt">${bar(m.metrics.newContacts, m.metrics.quota_contacts_month)}</div>
        <div class="d xs">${tr('Liên hệ mới')} ${m.metrics.newContacts}/${m.metrics.quota_contacts_month} · ${tr('báo cáo')} ${m.metrics.reports} (${m.metrics.lateReports} ${tr('trễ')}) · ${m.overdueDeals} ${tr('deal quá SLA')}</div></div>
      <div class="right"><b>${m.kpi.total}</b>
        <div class="mt"><button class="btn sm" data-score="${esc(m.id)}">${tr('Chấm KPI')}</button></div>
        <div class="mt"><button class="btn sm" data-pip="${esc(m.id)}">PIP</button></div></div>
    </div>` : `<div class="item">
      <div class="dot-i">${icon(m.role === 'manager' ? 'award' : 'shieldCheck')}</div>
      <div class="grow"><div class="t">${esc(personName(m.name))} ${chip(roleDefaultLabel(m), 'blue')}</div>
        ${jobTitle(m.title, () => '') ? `<div class="d xs mut">${esc(jobTitle(m.title, () => ''))}</div>` : ''}
        <div class="d">${tr('Hoạt động')} ${m.metrics.activities} ${tr('lượt')} · ${m.metrics.activeDays}/${m.metrics.workdays} ${tr('ngày có mặt')} · ${tr('báo cáo')} ${m.metrics.reports} (${m.metrics.lateReports} ${tr('trễ')})</div></div>
    </div>`).join('')}</div>` : ''}

  ${!isHR() && tab === 'funnel' ? `<div class="card">${d.funnel.map(f => `<div class="mb">
      <div class="badge-line"><span class="sm">${esc(stageName(f.stage))}</span><span class="sm b">${f.count} deal · ${money(f.value)}</span></div>
      ${bar(f.count, Math.max(...d.funnel.map(x => x.count)) || 1)}</div>`).join('')}
      <div class="xs mut">${tr('Tỷ lệ chuyển đổi Lead → Chốt:')} ${convRate(d.funnel)}%</div></div>` : ''}

  ${!isHR() && tab === 'alerts' ? (d.alerts.length ? `<div class="card">${d.alerts.map(a => `<div class="item">
      <div class="dot-i">${icon(a.level === 'danger' ? 'siren' : 'triangleAlert')}</div>
      <div class="grow"><div class="t">${esc(a.text)}</div><div class="d xs">${esc(a.type)}</div></div>
      <a class="btn sm" href="${esc(a.link)}">${tr('Xem')}</a></div>`).join('')}</div>` : empty('circleCheck', 'Không có cảnh báo nào.')) : ''}

  ${!isHR() && tab === 'approve' ? (d.pendingQuotes.length ? `<div class="card">${d.pendingQuotes.map(q => `<div class="item">
      <div class="dot-i">${icon('banknote')}</div>
      <div class="grow"><div class="t">${esc(q.title)}</div>
        <div class="d">${esc(q.customer_name || '')} · ${esc(q.owner_name || '')} · CK ${q.discount_pct}%</div>
        <div class="d xs">${tr('Gốc')} ${money(q.subtotal)} → ${money(q.total)} · ${esc(QUOTE_STATUS[q.status]?.n || q.status)}</div></div>
      <div class="right">${canDecide(q) ? `<button class="btn sm amber" data-ok="${esc(q.id)}">${tr('Duyệt')}</button>
        <div class="mt"><button class="btn sm" data-revise="${esc(q.id)}">${tr('Yêu cầu điều chỉnh')}</button></div>` : `<span class="xs mut">${tr('Chờ')} ${q.status === 'pending_v1' ? 'TPKD' : tr('Giám đốc')} ${tr('duyệt')}</span>`}</div>
    </div>`).join('')}</div>` : empty('circleCheck', 'Không có báo giá chờ duyệt.')) : ''}

  ${!isHR() && tab === 'approveContracts' ? (d.pendingContracts.length ? `<div class="card">${d.pendingContracts.map(c => `<div class="item">
      <div class="dot-i">${icon('penLine')}</div>
      <div class="grow"><div class="t">${esc(c.title)}</div>
        <div class="d">${esc(c.owner_name || '')}</div>
        <div class="d xs">${tr('Giá trị')} ${money(c.value)} · ${esc(CONTRACT_STATUS[c.status]?.n || c.status)}</div></div>
      <div class="right">${canDecideContract(c) ? `<button class="btn sm amber" data-ok-contract="${esc(c.id)}">${tr('Duyệt')}</button>
        <div class="mt"><button class="btn sm" data-revise-contract="${esc(c.id)}">${tr('Yêu cầu điều chỉnh')}</button></div>` : `<span class="xs mut">${tr('Chờ')} ${c.status === 'pending_v1' ? 'TPKD' : 'HCNS'} ${tr('duyệt')}</span>`}</div>
    </div>`).join('')}</div>` : empty('circleCheck', 'Không có hợp đồng chờ duyệt.')) : ''}

  ${!isHR() && tab === 'pip' ? `<button class="btn block mb" data-newpip>+ ${tr('Mở PIP 30-60-90 ngày')}</button>
    ${d.pips.length ? `<div class="card">${d.pips.map(p => `<div class="item">
      <div class="dot-i">${icon('clipboardList')}</div>
      <div class="grow"><div class="t">${esc(p.user_name || '')} · PIP ${esc(p.phase)} ${tr('ngày')}</div>
        <div class="d">${esc(p.goal)}</div>
        <div class="d xs">${fmtDate(p.start_at)} → ${fmtDate(p.end_at)} · ${esc(p.metric || '')}</div></div>
      <div class="right">${chip(PIP_STATUS[p.status]?.n, PIP_STATUS[p.status]?.c)}
        <div class="mt"><button class="btn sm" data-pipst="${esc(p.id)}">${tr('Kết luận')}</button></div></div>
    </div>`).join('')}</div>` : empty('clipboardList', 'Chưa có PIP nào.')}` : ''}`;

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelectorAll('[data-score]').forEach(b => b.onclick = () => modal({
      title: tf(() => 'Chấm KPI kỳ ' + d.period, () => 'Score KPI for period ' + d.period),
      fields: [{ name: 'note', label: 'Nhận xét của Trưởng phòng', type: 'textarea', rows: 3, required: true }],
      submitText: 'Chốt điểm & gửi thông báo',
      onSubmit: async (v) => {
        const r = await post('/kpi', { userId: b.dataset.score, period: d.period, note: v.note });
        toast(tf(() => 'Đã chốt KPI: ' + r.kpi.total + ' điểm (' + tr(r.kpi.grade) + ')', () => 'KPI finalized: ' + r.kpi.total + ' points (' + tr(r.kpi.grade) + ')'), 'ok');
        render(el);
      },
    }));
    el.querySelectorAll('[data-pip]').forEach(b => b.onclick = () => newPip(b.dataset.pip, () => render(el)));
    const np = el.querySelector('[data-newpip]');
    if (np) np.onclick = () => newPip('', () => render(el));
    el.querySelectorAll('[data-pipst]').forEach(b => b.onclick = () => modal({
      title: 'Kết luận PIP',
      fields: [{ name: 'status', label: 'Kết quả', type: 'select', options: [{ v: 'dang_chay', n: 'Đang chạy' }, { v: 'dat', n: 'Đạt' }, { v: 'khong_dat', n: 'Không đạt' }, { v: 'huy', n: 'Huỷ' }] },
      { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 }],
      submitText: 'Lưu', onSubmit: async (v) => { await patch('/pip/' + b.dataset.pipst, v); toast('Đã cập nhật PIP', 'ok'); render(el); },
    }));
    bindApprovalActions(el, 'quotes', () => render(el));
    bindApprovalActions(el, 'contracts', () => render(el));
    el.querySelectorAll('[data-ok-tender]').forEach(b => b.onclick = async () => {
      try { await patch('/deals/' + b.dataset.okTender, { stage: 'da_nop_ho_so' }); toast('Đã duyệt hồ sơ dự thầu', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
  };

  await mount(el, load, draw, bind);
}

/* Gộp báo giá + hợp đồng + hồ sơ thầu vào 1 danh sách duy nhất cho HCNS — mỗi dòng gắn nhãn loại
 * hồ sơ, tái dùng đúng điều kiện canDecide/canDecideContract/isAdmin và các data-attribute đã có
 * (data-ok/-revise/-ok-contract/-revise-contract/-ok-tender) để không phải viết lại bind(). */
const mergedApproval = (d) => {
  const t = APPROVAL_TONE;
  const rows = [
    ...d.pendingQuotes.map(q => `<div class="item">
      <div class="dot-i" style="background:transparent;color:${t.quote.color};border:1.5px solid ${t.quote.color}">${icon('banknote')}</div>
      <div class="grow"><div class="t">${chip('Báo giá', t.quote.chip)} ${esc(q.title)}</div>
        <div class="d">${esc(q.customer_name || '')} · ${esc(q.owner_name || '')} · CK ${q.discount_pct}%</div>
        <div class="d xs">${tr('Gốc')} ${money(q.subtotal)} → ${money(q.total)} · ${esc(QUOTE_STATUS[q.status]?.n || q.status)}</div></div>
      <div class="right">${canDecide(q) ? `<button class="btn sm amber" data-ok="${esc(q.id)}">${tr('Duyệt')}</button>
        <div class="mt"><button class="btn sm" data-revise="${esc(q.id)}">${tr('Yêu cầu điều chỉnh')}</button></div>` : `<span class="xs" style="color:${t.quote.color}">${tr('Chờ')} ${q.status === 'pending_v1' ? 'TPKD' : tr('Giám đốc')} ${tr('duyệt')}</span>`}</div>
    </div>`),
    ...d.pendingContracts.map(c => `<div class="item">
      <div class="dot-i" style="background:transparent;color:${t.contract.color};border:1.5px solid ${t.contract.color}">${icon('penLine')}</div>
      <div class="grow"><div class="t">${chip('Hợp đồng', t.contract.chip)} ${esc(c.title)}</div>
        <div class="d">${esc(c.owner_name || '')}</div>
        <div class="d xs">${tr('Giá trị')} ${money(c.value)} · ${esc(CONTRACT_STATUS[c.status]?.n || c.status)}</div></div>
      <div class="right">${canDecideContract(c) ? `<button class="btn sm amber" data-ok-contract="${esc(c.id)}">${tr('Duyệt')}</button>
        <div class="mt"><button class="btn sm" data-revise-contract="${esc(c.id)}">${tr('Yêu cầu điều chỉnh')}</button></div>` : `<span class="xs" style="color:${t.contract.color}">${tr('Chờ')} ${c.status === 'pending_v1' ? 'TPKD' : 'HCNS'} ${tr('duyệt')}</span>`}</div>
    </div>`),
    ...d.pendingTenders.map(x => `<div class="item">
      <div class="dot-i" style="background:transparent;color:${t.tender.color};border:1.5px solid ${t.tender.color}">${icon('trophy')}</div>
      <div class="grow"><div class="t">${chip('Hồ sơ thầu', t.tender.chip)} ${esc(x.title)}</div>
        <div class="d">${esc(x.customer_name || '')} · ${esc(x.owner_name || '')}</div>
        <div class="d xs">${tr('Giá trị')} ${money(x.value)} · ${esc(stageName(x.stage))}</div></div>
      <div class="right">${isAdmin() ? `<button class="btn sm amber" data-ok-tender="${esc(x.id)}">${tr('Duyệt hồ sơ')}</button>` : `<span class="xs" style="color:${t.tender.color}">${tr('Chờ Giám đốc duyệt')}</span>`}</div>
    </div>`),
  ];
  return rows.length ? `<div class="card">${rows.join('')}</div>` : empty('circleCheck', 'Không có hồ sơ nào chờ duyệt.');
};

const convRate = (f) => {
  const won = TERMINAL_STAGES.reduce((s, k) => s + (f.find(x => x.stage === k)?.count || 0), 0);
  const total = f.reduce((s, x) => s + x.count, 0) || 1;
  return Math.round(won / total * 100);
};

function newPip(userId, after) {
  modal({
    title: 'Mở chương trình cải thiện (PIP)',
    fields: [
      { name: 'userId', label: 'Nhân sự', type: 'select', value: userId, options: salesUsers().map(u => ({ v: u.id, n: personName(u.name) })) },
      { name: 'phase', label: 'Giai đoạn', type: 'select', options: [{ v: '30', n: '30 ngày' }, { v: '60', n: '60 ngày' }, { v: '90', n: '90 ngày' }] },
      { name: 'goal', label: 'Mục tiêu cải thiện', type: 'textarea', rows: 3, required: true, placeholder: 'VD: đạt tối thiểu 8 liên hệ mới/ngày, nộp báo cáo đúng hạn 100%…' },
      { name: 'metric', label: 'Chỉ số đo lường', placeholder: 'daily_contacts>=8; report_on_time=100%' },
    ],
    submitText: 'Mở PIP',
    onSubmit: async (v) => { await post('/pip', v); toast('Đã mở PIP & thông báo nhân sự', 'ok'); after(); },
  });
}
