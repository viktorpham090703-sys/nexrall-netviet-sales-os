import { get, post, patch } from '../api.js';
import { salesUsers } from '../state.js';
import { esc, money, mount, chip, bar, empty, stat, toast, modal, fmtDate } from '../ui.js';
import { stageName, STAGES } from '../const.js';

let tab = 'overview';

export async function render(el) {
  const load = async () => {
    const [t, p] = await Promise.all([get('/team'), get('/pip')]);
    return { ...t, pips: p.items || [] };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>Console Trưởng phòng</h2><p>Giám sát đội · hoạt động vs định mức · phễu · cảnh báo · duyệt giá · KPI & PIP</p></div>
  </div>

  <div class="grid g3 mb">
    ${stat('Pipeline kỳ vọng', money(d.totals.pipeline), d.totals.openCount + ' deal đang mở', 'red')}
    ${stat('Doanh thu đã ký', money(d.totals.won), 'Luỹ kế toàn đội', 'blue')}
    ${stat('Cảnh báo', d.alerts.length, d.alerts.filter(a => a.level === 'danger').length + ' nghiêm trọng', d.alerts.length ? 'amber' : '')}
  </div>

  <div class="seg mb">
    <button data-tab="overview" class="${tab === 'overview' ? 'on' : ''}">Tổng quan đội</button>
    <button data-tab="funnel" class="${tab === 'funnel' ? 'on' : ''}">Phễu</button>
    <button data-tab="alerts" class="${tab === 'alerts' ? 'on' : ''}">Cảnh báo (${d.alerts.length})</button>
    <button data-tab="approve" class="${tab === 'approve' ? 'on' : ''}">Duyệt giá (${d.pendingQuotes.length})</button>
    <button data-tab="pip" class="${tab === 'pip' ? 'on' : ''}">KPI & PIP</button>
  </div>

  ${tab === 'overview' ? `<div class="card">${d.members.map(m => `<div class="item">
      <div class="dot-i">${m.kpi.total >= 80 ? '🌟' : m.kpi.total >= 60 ? '🙂' : '⚠️'}</div>
      <div class="grow"><div class="t">${esc(m.name)} ${chip(m.kpi.grade, m.kpi.total >= 80 ? 'green' : m.kpi.total >= 60 ? 'amber' : 'red')}</div>
        <div class="d">DT ${money(m.metrics.revenue)}/${money(m.metrics.target_revenue)} · pipeline ${money(m.pipeline)} · ${m.metrics.wonN} deal chốt</div>
        <div class="mt">${bar(m.metrics.newContacts, m.metrics.quota_contacts_month)}</div>
        <div class="d xs">Liên hệ mới ${m.metrics.newContacts}/${m.metrics.quota_contacts_month} · báo cáo ${m.metrics.reports} (${m.metrics.lateReports} trễ) · ${m.overdueDeals} deal quá SLA</div></div>
      <div class="right"><b>${m.kpi.total}</b>
        <div class="mt"><button class="btn sm" data-score="${esc(m.id)}">Chấm KPI</button></div>
        <div class="mt"><button class="btn sm" data-pip="${esc(m.id)}">PIP</button></div></div>
    </div>`).join('')}</div>` : ''}

  ${tab === 'funnel' ? `<div class="card">${d.funnel.map(f => `<div class="mb">
      <div class="badge-line"><span class="sm">${esc(stageName(f.stage))}</span><span class="sm b">${f.count} deal · ${money(f.value)}</span></div>
      ${bar(f.count, Math.max(...d.funnel.map(x => x.count)) || 1)}</div>`).join('')}
      <div class="xs mut">Tỷ lệ chuyển đổi Lead → Chốt: ${convRate(d.funnel)}%</div></div>` : ''}

  ${tab === 'alerts' ? (d.alerts.length ? `<div class="card">${d.alerts.map(a => `<div class="item">
      <div class="dot-i">${a.level === 'danger' ? '🚨' : '⚠️'}</div>
      <div class="grow"><div class="t">${esc(a.text)}</div><div class="d xs">${esc(a.type)}</div></div>
      <a class="btn sm" href="${esc(a.link)}">Xem</a></div>`).join('')}</div>` : empty('✅', 'Không có cảnh báo nào.')) : ''}

  ${tab === 'approve' ? (d.pendingQuotes.length ? `<div class="card">${d.pendingQuotes.map(q => `<div class="item">
      <div class="dot-i">💸</div>
      <div class="grow"><div class="t">${esc(q.title)}</div>
        <div class="d">${esc(q.customer_name || '')} · ${esc(q.owner_name || '')} · CK ${q.discount_pct}%</div>
        <div class="d xs">Gốc ${money(q.subtotal)} → ${money(q.total)}</div></div>
      <div class="right"><button class="btn sm amber" data-ok="${esc(q.id)}">Duyệt</button>
        <div class="mt"><button class="btn sm" data-no="${esc(q.id)}">Từ chối</button></div></div>
    </div>`).join('')}</div>` : empty('✅', 'Không có báo giá chờ duyệt.')) : ''}

  ${tab === 'pip' ? `<button class="btn block mb" data-newpip>+ Mở PIP 30-60-90 ngày</button>
    ${d.pips.length ? `<div class="card">${d.pips.map(p => `<div class="item">
      <div class="dot-i">📋</div>
      <div class="grow"><div class="t">${esc(p.user_name || '')} · PIP ${esc(p.phase)} ngày</div>
        <div class="d">${esc(p.goal)}</div>
        <div class="d xs">${fmtDate(p.start_at)} → ${fmtDate(p.end_at)} · ${esc(p.metric || '')}</div></div>
      <div class="right">${chip(p.status === 'dat' ? 'Đạt' : p.status === 'khong_dat' ? 'Không đạt' : p.status === 'huy' ? 'Huỷ' : 'Đang chạy',
        p.status === 'dat' ? 'green' : p.status === 'khong_dat' ? 'red' : 'amber')}
        <div class="mt"><button class="btn sm" data-pipst="${esc(p.id)}">Kết luận</button></div></div>
    </div>`).join('')}</div>` : empty('📋', 'Chưa có PIP nào.')}` : ''}`;

  const bind = (d) => {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
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
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
      try { await patch('/quotes/' + b.dataset.ok, { status: 'approved', note: 'Duyệt bởi TP' }); toast('Đã duyệt', 'ok'); render(el); } catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-no]').forEach(b => b.onclick = () => modal({
      title: 'Từ chối báo giá', fields: [{ name: 'note', label: 'Lý do', required: true }], submitText: 'Từ chối',
      onSubmit: async (v) => { await patch('/quotes/' + b.dataset.no, { status: 'rejected', note: v.note }); toast('Đã từ chối', 'ok'); render(el); },
    }));
  };

  await mount(el, load, draw, bind);
}

const convRate = (f) => {
  const first = f[0]?.count || 0;
  const won = (f.find(x => x.stage === 'chot')?.count || 0) + (f.find(x => x.stage === 'trien_khai')?.count || 0);
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
