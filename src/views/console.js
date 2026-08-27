import { get, post, patch } from '../api.js';
import { state, salesUsers, isAdmin } from '../state.js';
import { esc, money, mount, chip, bar, empty, stat, toast, modal, fmtDate, bindTabs } from '../ui.js';
import { stageName, STAGES, TERMINAL_STAGES, QUOTE_STATUS, CONTRACT_STATUS, roleLabel, PIP_STATUS, gradeTone, APPROVAL_TONE } from '../const.js';
import { icon } from '../icons.js';
import { canDecide, canDecideContract, bindApprovalActions } from './saleskit.js';

let tab = 'overview';
/* HCNS chỉ xét duyệt báo giá/hợp đồng/hồ sơ thầu — không có nhiệm vụ quản lý đội sales
 * (KPI, PIP, phễu, cảnh báo SLA...), nên Console của HCNS gộp cả 3 loại vào đúng 1 danh sách
 * "Hồ sơ cần duyệt" thay vì tách tab — không cần chuyển qua lại giữa 3 chỗ để rà soát. */
const isHR = () => state.me?.role === 'hr';

export async function render(el) {
  const load = async () => {
    const [t, p, deals] = await Promise.all([get('/team'), get('/pip'), isHR() ? get('/deals') : Promise.resolve({ items: [] })]);
    const pendingTenders = (deals.items || []).filter(x => x.process_type === 'dau_thau' && x.stage === 'cho_duyet_ho_so');
    return { ...t, pips: p.items || [], pendingTenders };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>${isHR() ? 'Console HCNS' : 'Console Trưởng phòng'}</h2>
      <p>${isHR() ? 'Xét duyệt báo giá · hợp đồng · hồ sơ dự thầu' : 'Giám sát đội · hoạt động vs định mức · phễu · cảnh báo · duyệt giá · KPI & PIP'}</p></div>
  </div>

  <div class="grid g3 mb">
    ${isHR() ? `
      ${stat('Báo giá chờ duyệt', d.pendingQuotes.length, 'Cần TPKD/Admin xử lý các vòng khác', 'amber')}
      ${stat('Hợp đồng chờ duyệt', d.pendingContracts.length, 'Vòng 2 do HCNS phụ trách', 'blue')}
      ${stat('Hồ sơ thầu chờ duyệt', d.pendingTenders.length, 'Giám đốc duyệt trước khi nộp', 'red')}
    ` : `
      ${stat('Pipeline kỳ vọng', money(d.totals.pipeline), d.totals.openCount + ' deal đang mở', 'red')}
      ${stat('Doanh thu đã ký', money(d.totals.won), 'Luỹ kế toàn đội', 'blue')}
      ${stat('Cảnh báo', d.alerts.length, d.alerts.filter(a => a.level === 'danger').length + ' nghiêm trọng', d.alerts.length ? 'amber' : '')}
    `}
  </div>

  ${isHR() ? '' : `<div class="seg mb">
    <button data-tab="overview" class="${tab === 'overview' ? 'on' : ''}">Tổng quan đội</button>
    <button data-tab="funnel" class="${tab === 'funnel' ? 'on' : ''}">Phễu</button>
    <button data-tab="alerts" class="${tab === 'alerts' ? 'on' : ''}">Cảnh báo (${d.alerts.length})</button>
    <button data-tab="approve" class="${tab === 'approve' ? 'on' : ''}">Duyệt giá (${d.pendingQuotes.length})</button>
    <button data-tab="approveContracts" class="${tab === 'approveContracts' ? 'on' : ''}">Duyệt hợp đồng (${d.pendingContracts.length})</button>
    <button data-tab="pip" class="${tab === 'pip' ? 'on' : ''}">KPI & PIP</button>
  </div>`}

  ${isHR() ? `<div class="sec-title">Hồ sơ cần duyệt</div>${mergedApproval(d)}` : ''}

  ${!isHR() && tab === 'overview' ? `<div class="card">${d.members.map(m => m.role === 'sales' ? `<div class="item">
      <div class="dot-i">${icon(m.kpi.total >= 80 ? 'star' : m.kpi.total >= 60 ? 'smile' : 'triangleAlert')}</div>
      <div class="grow"><div class="t">${esc(m.name)} ${chip(m.kpi.grade, gradeTone(m.kpi.total))}</div>
        <div class="d xs mut">${esc(m.title || roleLabel(m))}</div>
        <div class="d">DT ${money(m.metrics.revenue)}/${money(m.metrics.target_revenue)} · pipeline ${money(m.pipeline)} · ${m.metrics.wonN} deal chốt</div>
        <div class="mt">${bar(m.metrics.newContacts, m.metrics.quota_contacts_month)}</div>
        <div class="d xs">Liên hệ mới ${m.metrics.newContacts}/${m.metrics.quota_contacts_month} · báo cáo ${m.metrics.reports} (${m.metrics.lateReports} trễ) · ${m.overdueDeals} deal quá SLA</div></div>
      <div class="right"><b>${m.kpi.total}</b>
        <div class="mt"><button class="btn sm" data-score="${esc(m.id)}">Chấm KPI</button></div>
        <div class="mt"><button class="btn sm" data-pip="${esc(m.id)}">PIP</button></div></div>
    </div>` : `<div class="item">
      <div class="dot-i">${icon(m.role === 'manager' ? 'award' : 'shieldCheck')}</div>
      <div class="grow"><div class="t">${esc(m.name)} ${chip(roleLabel(m), 'blue')}</div>
        <div class="d xs mut">${esc(m.title || roleLabel(m))}</div>
        <div class="d">Hoạt động ${m.metrics.activities} lượt · ${m.metrics.activeDays}/${m.metrics.workdays} ngày có mặt · báo cáo ${m.metrics.reports} (${m.metrics.lateReports} trễ)</div></div>
    </div>`).join('')}</div>` : ''}

  ${!isHR() && tab === 'funnel' ? `<div class="card">${d.funnel.map(f => `<div class="mb">
      <div class="badge-line"><span class="sm">${esc(stageName(f.stage))}</span><span class="sm b">${f.count} deal · ${money(f.value)}</span></div>
      ${bar(f.count, Math.max(...d.funnel.map(x => x.count)) || 1)}</div>`).join('')}
      <div class="xs mut">Tỷ lệ chuyển đổi Lead → Chốt: ${convRate(d.funnel)}%</div></div>` : ''}

  ${!isHR() && tab === 'alerts' ? (d.alerts.length ? `<div class="card">${d.alerts.map(a => `<div class="item">
      <div class="dot-i">${icon(a.level === 'danger' ? 'siren' : 'triangleAlert')}</div>
      <div class="grow"><div class="t">${esc(a.text)}</div><div class="d xs">${esc(a.type)}</div></div>
      <a class="btn sm" href="${esc(a.link)}">Xem</a></div>`).join('')}</div>` : empty('circleCheck', 'Không có cảnh báo nào.')) : ''}

  ${!isHR() && tab === 'approve' ? (d.pendingQuotes.length ? `<div class="card">${d.pendingQuotes.map(q => `<div class="item">
      <div class="dot-i">${icon('banknote')}</div>
      <div class="grow"><div class="t">${esc(q.title)}</div>
        <div class="d">${esc(q.customer_name || '')} · ${esc(q.owner_name || '')} · CK ${q.discount_pct}%</div>
        <div class="d xs">Gốc ${money(q.subtotal)} → ${money(q.total)} · ${esc(QUOTE_STATUS[q.status]?.n || q.status)}</div></div>
      <div class="right">${canDecide(q) ? `<button class="btn sm amber" data-ok="${esc(q.id)}">Duyệt</button>
        <div class="mt"><button class="btn sm" data-revise="${esc(q.id)}">Yêu cầu điều chỉnh</button></div>` : `<span class="xs mut">Chờ ${q.status === 'pending_v1' ? 'TPKD' : 'Giám đốc'} duyệt</span>`}</div>
    </div>`).join('')}</div>` : empty('circleCheck', 'Không có báo giá chờ duyệt.')) : ''}

  ${!isHR() && tab === 'approveContracts' ? (d.pendingContracts.length ? `<div class="card">${d.pendingContracts.map(c => `<div class="item">
      <div class="dot-i">${icon('penLine')}</div>
      <div class="grow"><div class="t">${esc(c.title)}</div>
        <div class="d">${esc(c.owner_name || '')}</div>
        <div class="d xs">Giá trị ${money(c.value)} · ${esc(CONTRACT_STATUS[c.status]?.n || c.status)}</div></div>
      <div class="right">${canDecideContract(c) ? `<button class="btn sm amber" data-ok-contract="${esc(c.id)}">Duyệt</button>
        <div class="mt"><button class="btn sm" data-revise-contract="${esc(c.id)}">Yêu cầu điều chỉnh</button></div>` : `<span class="xs mut">Chờ ${c.status === 'pending_v1' ? 'TPKD' : 'HCNS'} duyệt</span>`}</div>
    </div>`).join('')}</div>` : empty('circleCheck', 'Không có hợp đồng chờ duyệt.')) : ''}

  ${!isHR() && tab === 'pip' ? `<button class="btn block mb" data-newpip>+ Mở PIP 30-60-90 ngày</button>
    ${d.pips.length ? `<div class="card">${d.pips.map(p => `<div class="item">
      <div class="dot-i">${icon('clipboardList')}</div>
      <div class="grow"><div class="t">${esc(p.user_name || '')} · PIP ${esc(p.phase)} ngày</div>
        <div class="d">${esc(p.goal)}</div>
        <div class="d xs">${fmtDate(p.start_at)} → ${fmtDate(p.end_at)} · ${esc(p.metric || '')}</div></div>
      <div class="right">${chip(PIP_STATUS[p.status]?.n, PIP_STATUS[p.status]?.c)}
        <div class="mt"><button class="btn sm" data-pipst="${esc(p.id)}">Kết luận</button></div></div>
    </div>`).join('')}</div>` : empty('clipboardList', 'Chưa có PIP nào.')}` : ''}`;

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelectorAll('[data-score]').forEach(b => b.onclick = () => modal({
      title: 'Chấm KPI kỳ ' + d.period,
      fields: [{ name: 'note', label: 'Nhận xét của Trưởng phòng', type: 'textarea', rows: 3, required: true }],
      submitText: 'Chốt điểm & gửi thông báo',
      onSubmit: async (v) => { const r = await post('/kpi', { userId: b.dataset.score, period: d.period, note: v.note }); toast('Đã chốt KPI: ' + r.kpi.total + ' điểm (' + r.kpi.grade + ')', 'ok'); render(el); },
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
        <div class="d xs">Gốc ${money(q.subtotal)} → ${money(q.total)} · ${esc(QUOTE_STATUS[q.status]?.n || q.status)}</div></div>
      <div class="right">${canDecide(q) ? `<button class="btn sm amber" data-ok="${esc(q.id)}">Duyệt</button>
        <div class="mt"><button class="btn sm" data-revise="${esc(q.id)}">Yêu cầu điều chỉnh</button></div>` : `<span class="xs" style="color:${t.quote.color}">Chờ ${q.status === 'pending_v1' ? 'TPKD' : 'Giám đốc'} duyệt</span>`}</div>
    </div>`),
    ...d.pendingContracts.map(c => `<div class="item">
      <div class="dot-i" style="background:transparent;color:${t.contract.color};border:1.5px solid ${t.contract.color}">${icon('penLine')}</div>
      <div class="grow"><div class="t">${chip('Hợp đồng', t.contract.chip)} ${esc(c.title)}</div>
        <div class="d">${esc(c.owner_name || '')}</div>
        <div class="d xs">Giá trị ${money(c.value)} · ${esc(CONTRACT_STATUS[c.status]?.n || c.status)}</div></div>
      <div class="right">${canDecideContract(c) ? `<button class="btn sm amber" data-ok-contract="${esc(c.id)}">Duyệt</button>
        <div class="mt"><button class="btn sm" data-revise-contract="${esc(c.id)}">Yêu cầu điều chỉnh</button></div>` : `<span class="xs" style="color:${t.contract.color}">Chờ ${c.status === 'pending_v1' ? 'TPKD' : 'HCNS'} duyệt</span>`}</div>
    </div>`),
    ...d.pendingTenders.map(x => `<div class="item">
      <div class="dot-i" style="background:transparent;color:${t.tender.color};border:1.5px solid ${t.tender.color}">${icon('trophy')}</div>
      <div class="grow"><div class="t">${chip('Hồ sơ thầu', t.tender.chip)} ${esc(x.title)}</div>
        <div class="d">${esc(x.customer_name || '')} · ${esc(x.owner_name || '')}</div>
        <div class="d xs">Giá trị ${money(x.value)} · ${esc(stageName(x.stage))}</div></div>
      <div class="right">${isAdmin() ? `<button class="btn sm amber" data-ok-tender="${esc(x.id)}">Duyệt hồ sơ</button>` : `<span class="xs" style="color:${t.tender.color}">Chờ Giám đốc duyệt</span>`}</div>
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
      { name: 'userId', label: 'Nhân sự', type: 'select', value: userId, options: salesUsers().map(u => ({ v: u.id, n: u.name })) },
      { name: 'phase', label: 'Giai đoạn', type: 'select', options: [{ v: '30', n: '30 ngày' }, { v: '60', n: '60 ngày' }, { v: '90', n: '90 ngày' }] },
      { name: 'goal', label: 'Mục tiêu cải thiện', type: 'textarea', rows: 3, required: true, placeholder: 'VD: đạt tối thiểu 8 liên hệ mới/ngày, nộp báo cáo đúng hạn 100%…' },
      { name: 'metric', label: 'Chỉ số đo lường', placeholder: 'daily_contacts>=8; report_on_time=100%' },
    ],
    submitText: 'Mở PIP',
    onSubmit: async (v) => { await post('/pip', v); toast('Đã mở PIP & thông báo nhân sự', 'ok'); after(); },
  });
}
