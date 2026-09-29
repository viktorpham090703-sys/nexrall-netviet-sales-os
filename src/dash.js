/* Trang chủ cá nhân & Bảng điều hành đội dạng biểu đồ, tính từ dữ liệu THẬT của máy chủ
 * (/api/kpi, /api/team, /api/deals, /api/activities). */
import { STAGES, TERMINAL_STAGES, stageName } from './const.js';
import { personName } from './i18n.js';
import { chartCard, legend, bullets, hbars, columns, cumLine, shortMoney, num, SERIES, STATUS } from './charts.js';

const DAY = 86400;
export function monthInfo() {
  const d = new Date();
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const start = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
  return { today: d.getDate(), days, start, pace: Math.round(d.getDate() / days * 100), month: d.getMonth() + 1 };
}

/** Doanh thu đã chốt lũy kế theo ngày trong tháng. */
function cumRevenue(deals) {
  const M = monthInfo();
  const byDay = new Array(M.days).fill(0);
  (deals || []).filter(x => x.status === 'won' && x.won_at >= M.start).forEach(x => {
    const i = Math.min(M.days - 1, Math.floor((x.won_at - M.start) / DAY));
    if (i >= 0) byDay[i] += Number(x.value) || 0;
  });
  let s = 0;
  return byDay.map((v, i) => { s += v; return { label: `${i + 1}/${M.month}`, v: i < M.today ? s : null }; });
}

const ACT_GROUPS = [
  ['Cuộc gọi', ['call']], ['Gặp mặt & trình diễn', ['meeting', 'demo']], ['Email & Zalo', ['email', 'zalo']], ['Khác', ['other']],
];
/** Hoạt động 14 ngày gần nhất, cột chồng theo loại. */
function activityCols(items) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const t0 = Math.floor(now.getTime() / 1000) - 13 * DAY;
  const cols = Array.from({ length: 14 }, (_, i) => {
    const d = new Date((t0 + i * DAY) * 1000);
    return { label: `${d.getDate()}/${d.getMonth() + 1}`, parts: [0, 0, 0, 0] };
  });
  (items || []).forEach(a => {
    const i = Math.floor((a.happened_at - t0) / DAY);
    if (i < 0 || i > 13) return;
    const g = ACT_GROUPS.findIndex(([, ks]) => ks.includes(a.type));
    cols[i].parts[g < 0 ? 3 : g]++;
  });
  return cols;
}
const actSeries = ACT_GROUPS.map(([n], i) => [n, SERIES[i]]);

/** Cơ hội đang mở theo giai đoạn (giá trị). */
function openByStage(deals) {
  return STAGES.filter(s => !TERMINAL_STAGES.includes(s.k)).map(s => {
    const arr = (deals || []).filter(d => d.status === 'open' && d.stage === s.k);
    return { label: stageName(s.k), value: arr.reduce((a, d) => a + (Number(d.value) || 0), 0), n: arr.length };
  }).filter(r => r.n).map(r => ({ ...r, right: `${shortMoney(r.value)} · ${r.n}`, tip: `${r.label}: ${r.n} cơ hội · ${shortMoney(r.value)}` }));
}

/* ---------- Trang chủ cá nhân ---------- */
export function personalCharts({ metrics: m, deals, acts }) {
  const M = monthInfo();
  const kpi = m ? bullets([
    { label: 'Doanh thu ký mới', value: m.revenue, target: m.target_revenue, fmt: shortMoney },
    { label: 'Cơ hội chốt', value: m.wonN, target: m.target_deals },
    { label: 'Liên hệ mới', value: m.newContacts, target: m.quota_contacts_month },
    { label: 'Giá trị phễu kỳ vọng', value: m.pipeline, target: m.target_pipeline, fmt: shortMoney },
  ], { pace: M.pace }) : '';
  return `<div class="cv-row">
      ${chartCard(`KPI tháng ${M.month} · tỉ lệ hoàn thành tới ngày ${M.today}/${M.days}`, 'Đã đạt tới hôm nay so với KPI được giao', kpi)}
      ${chartCard('Doanh thu ký mới lũy kế trong tháng', 'Đường xanh: thực tế · đường xám: tiến độ cần đạt',
        cumLine(cumRevenue(deals), m ? m.target_revenue : 0, { fmt: shortMoney }),
        legend([['Thực tế', SERIES[0], 'line'], ['Tiến độ cần đạt', '#9CA3AF', 'line']]))}
    </div>
    <div class="cv-row">
      ${chartCard('Hoạt động 14 ngày gần nhất', 'Số lượt ghi nhận mỗi ngày theo loại', columns(activityCols(acts), actSeries), legend(actSeries))}
      ${chartCard('Cơ hội đang mở theo giai đoạn', 'Giá trị và số cơ hội', hbars(openByStage(deals), { fmt: shortMoney }))}
    </div>`;
}

/* ---------- Bảng điều hành đội ---------- */
export function teamCharts({ team, deals, acts }) {
  const M = monthInfo();
  const sales = (team.members || []).filter(x => x.role === 'sales' && x.metrics);
  const sum = (k) => sales.reduce((s, x) => s + (Number(x.metrics[k]) || 0), 0);
  const kpiTeam = bullets([
    { label: 'Doanh thu đội', value: sum('revenue'), target: sum('target_revenue'), fmt: shortMoney },
    { label: 'Cơ hội chốt', value: sum('wonN'), target: sum('target_deals') },
    { label: 'Liên hệ mới', value: sum('newContacts'), target: sum('quota_contacts_month') },
  ], { pace: M.pace });
  const byMember = bullets(sales.map(x => ({ label: personName(x.name), value: x.metrics.revenue, target: x.metrics.target_revenue, fmt: shortMoney })), { pace: M.pace });
  const grade = (v) => v >= 80 ? 'ok' : v >= 60 ? 'warn' : 'bad';
  const kpiScore = hbars(sales.slice().sort((a, b) => b.kpi.total - a.kpi.total).map(x => ({
    label: personName(x.name), value: x.kpi.total, color: STATUS[grade(x.kpi.total)],
    right: `${Math.round(x.kpi.total)} điểm · ${x.kpi.grade}`, tip: `${personName(x.name)}: ${x.kpi.total} điểm — xếp loại ${x.kpi.grade}`,
  })), { max: 100, marks: [60, 80] });
  const funnel = hbars((team.funnel || []).filter(f => f.count).map(f => ({
    label: stageName(f.stage), value: f.value, right: `${shortMoney(f.value)} · ${f.count}`, tip: `${stageName(f.stage)}: ${f.count} cơ hội · ${shortMoney(f.value)}`,
  })), { fmt: shortMoney });
  const ALERT_TYPES = { sla: 'Cơ hội quá hạn chăm sóc', approval: 'Chờ duyệt', assignment: 'Chưa nhận việc', report: 'Báo cáo trễ', contact: 'Thiếu liên hệ mới' };
  const byType = {};
  (team.alerts || []).forEach(a => { const k = ALERT_TYPES[a.type] || 'Khác'; byType[k] = (byType[k] || 0) + 1; });
  const alertBars = hbars(Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: STATUS.bad, right: `${v} cảnh báo` })));
  return `<div class="cv-row">
      ${chartCard(`KPI đội tháng ${M.month} · tỉ lệ hoàn thành tới ngày ${M.today}/${M.days}`, 'Tổng của các nhân viên kinh doanh so với KPI được giao', kpiTeam)}
      ${chartCard('Doanh thu đội lũy kế trong tháng', 'Đường xanh: thực tế · đường xám: tiến độ cần đạt',
        cumLine(cumRevenue(deals), sum('target_revenue'), { fmt: shortMoney }),
        legend([['Thực tế', SERIES[0], 'line'], ['Tiến độ cần đạt', '#9CA3AF', 'line']]))}
    </div>
    <div class="cv-row">
      ${chartCard('Doanh thu từng nhân viên so với KPI giao', 'Màu thanh: xanh lá đúng tiến độ · cam hơi chậm · đỏ chậm tiến độ', byMember)}
      ${chartCard('Điểm KPI từng nhân viên', 'Vạch ở 60 điểm (tối thiểu) và 80 điểm (tốt)', kpiScore)}
    </div>
    <div class="cv-row">
      ${chartCard('Phễu bán hàng của đội', 'Giá trị và số cơ hội ở từng giai đoạn', funnel)}
      ${chartCard('Hoạt động của đội 14 ngày gần nhất', 'Số lượt ghi nhận mỗi ngày theo loại', columns(activityCols(acts), actSeries), legend(actSeries))}
    </div>
    ${Object.keys(byType).length ? `<div class="cv-row one">${chartCard('Cảnh báo theo loại', 'Bấm thẻ Cảnh báo bên dưới để xử lý từng mục', alertBars)}</div>` : ''}`;
}

/* ---------- Bảng điều hành HCNS ---------- */
export function hrCharts(d) {
  const rows = [
    { label: 'Báo giá chờ duyệt', value: (d.pendingQuotes || []).length, color: SERIES[1] },
    { label: 'Hợp đồng chờ duyệt', value: (d.pendingContracts || []).length, color: SERIES[0] },
    { label: 'Hồ sơ thầu chờ duyệt', value: (d.pendingTenders || []).length, color: SERIES[2] },
  ].map(r => ({ ...r, right: `${r.value} hồ sơ` }));
  return `<div class="cv-row one">${chartCard('Hồ sơ đang chờ duyệt', 'Theo loại hồ sơ', hbars(rows, { fmt: num }))}</div>`;
}
