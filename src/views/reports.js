import { get, post } from '../api.js';
import { esc, money, mount, chip, empty, toast, modal, stat, fmtDT } from '../ui.js';
import { roleLabel } from '../const.js';
import { icon } from '../icons.js';
import { initScrollFx } from '../scrollFx.js';

const pageRange = (page, pageSize, total) => {
  if (!total) return '0/0';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return `${from}-${to}/${total}`;
};

// TPKD/Admin xem lịch sử báo cáo của NHIỀU nhân sự cùng lúc — trước đây xếp card chồng dọc từng
// người phải cuộn rất dài. Nhớ nhân sự đang xem qua tab để chỉ hiện đúng 1 card tại 1 thời điểm.
let activeReportUser = null;
// Kỳ báo cáo đang xem (ngày · tuần · tháng) — cả 3 đều tự tổng hợp, nộp riêng từng kỳ.
let rpTab = 'day';

export async function render(el) {
  const load = () => get('/reports');

  const drawSection = (s) => {
    const maxPage = Math.max(1, Math.ceil(s.total / s.pageSize));
    return `<div class="card mt">
      <div class="row"><div class="grow b">${esc(s.userName)}</div>${chip(roleLabel({ id: s.userId, role: s.role, title: s.title }))}</div>
      ${s.items.length ? s.items.map(r => `<div class="item">
        <div class="dot-i">${icon(r.kind === 'week' ? 'calendar' : r.kind === 'month' ? 'calendarDays' : 'notepadText')}</div>
        <div class="grow"><div class="t">${r.kind === 'week' ? 'Báo cáo tuần' : r.kind === 'month' ? 'Tổng hợp tháng' : 'EOD'} ${esc(r.period)}</div>
          <div class="d xs mut">Nộp lúc ${fmtDT(r.submitted_at)}</div>
          <div class="d">${r.calls} gọi · ${r.meetings} gặp · ${r.new_contacts} liên hệ mới · ${r.deals_moved} deal chuyển GĐ${r.revenue ? ' · DT ' + money(r.revenue) : ''}</div>
          ${r.highlight ? `<div class="d xs">${icon('lightbulb', 12)} ${esc(r.highlight)}</div>` : ''}
          ${r.blocker ? `<div class="d xs">${icon('construction', 12)} ${esc(r.blocker)}</div>` : ''}</div>
        ${r.late ? chip('Trễ hạn', 'red') : chip('Đúng hạn', 'green')}
      </div>`).join('') : empty('notepadText', 'Chưa có báo cáo nào.')}
      ${s.total ? `<div class="row mt" style="gap:8px;justify-content:flex-end;align-items:center">
        <span class="xs mut">${pageRange(s.page, s.pageSize, s.total)}</span>
        <button class="btn sm" data-pg="${esc(s.userId)}" data-dir="prev" ${s.page <= 1 ? 'disabled' : ''}>‹</button>
        <button class="btn sm" data-pg="${esc(s.userId)}" data-dir="next" ${s.page >= maxPage ? 'disabled' : ''}>›</button>
      </div>` : ''}
    </div>`;
  };

  /* Một khối số liệu tự tổng hợp — dùng chung cho cả 3 kỳ (ngày · tuần · tháng) để 3 tab không
     trôi lệch nhau về cách trình bày và về việc mục nào được tính vào đâu. */
  const draftCard = (label, dr, submitted, kind, deadlineHour, extra = '') => `<div class="card">
    <div class="row wrap"><div class="grow b">${esc(label)} (${esc(dr.period)})</div>
      ${chip('Tự tổng hợp', 'green')}
      ${submitted ? chip('Đã nộp', 'green') : chip(kind === 'day' ? 'Chưa nộp · hạn ' + deadlineHour + 'h' : 'Chưa nộp', 'amber')}</div>
    <div class="grid g4 mt">
      ${stat('Cuộc gọi', dr.calls)}${stat('Gặp/Demo', dr.meetings)}
      ${stat('Liên hệ mới', dr.new_contacts)}${stat('Tương tác với khách', dr.customer_touches)}
    </div>
    <div class="grid g4 mt">
      ${stat('Deal chuyển GĐ', dr.deals_moved)}${stat('Deal chốt', dr.won_deals)}
      ${stat('Báo giá gửi đi', dr.quotes_sent)}${stat('Doanh thu ký', money(dr.revenue))}
    </div>
    ${extra}
    <button class="btn primary block mt" data-post="${kind}">${submitted ? 'Cập nhật báo cáo' : 'Xác nhận & nộp báo cáo'}</button>
  </div>`;

  /* Biểu đồ 7 ngày — cho thấy nhịp làm việc trong tuần chứ không chỉ một cục tổng. Cột cuối là
     hôm nay, tô hổ phách để mắt bắt được ngay điểm hiện tại. */
  const sparkline = (trend) => {
    const max = Math.max(1, ...trend.map(x => x.activities));
    return `<div class="spark mt">${trend.map((x, i) => `<div class="col${i === trend.length - 1 ? ' today' : ''}">
      <div class="cv">${x.activities}</div>
      <div class="bx" style="height:${Math.round(x.activities / max * 62)}px"></div>
      <div class="cl">${esc(x.date.slice(8) + '/' + x.date.slice(5, 7))}</div>
    </div>`).join('')}</div>
    <div class="xs mut mt">Số hoạt động ghi nhận theo ngày · cột cuối là hôm nay</div>`;
  };

  const draw = (d) => `
    <div class="page-head">
      <div class="grow"><h2>Báo cáo</h2>
        <p>Ngày · tuần · tháng tự tổng hợp từ dữ liệu thêm mới và cập nhật — bạn chỉ bổ sung phần định tính</p></div>
    </div>

    <div class="note mb">Toàn bộ số định lượng do hệ thống <b>tự đếm</b> từ hoạt động đã ghi, khách thêm mới,
      deal chuyển giai đoạn và báo giá gửi đi — không sửa tay được, nên số trong báo cáo luôn khớp dữ liệu gốc.</div>

    <div class="seg mb">
      <button data-rp="day" class="${rpTab === 'day' ? 'on' : ''}">Báo cáo ngày</button>
      <button data-rp="week" class="${rpTab === 'week' ? 'on' : ''}">Báo cáo tuần</button>
      <button data-rp="month" class="${rpTab === 'month' ? 'on' : ''}">Tổng hợp tháng</button>
    </div>

    ${rpTab === 'day' ? draftCard('Báo cáo hôm nay', d.draft, d.submittedToday, 'day', d.deadlineHour,
      `<div class="sm mut mt">Định mức ngày: liên hệ mới ${d.draft.new_contacts}/${d.quota.contacts_day} ·
        gọi ${d.draft.calls}/${d.quota.calls_day} · gặp ${d.draft.meetings}/${d.quota.meetings_day}</div>`)
      : rpTab === 'week' ? draftCard('Báo cáo tuần', d.weekDraft, d.submittedWeek, 'week', d.deadlineHour, sparkline(d.trend || []))
        : draftCard('Tổng hợp tháng', d.monthDraft, d.submittedMonth, 'month', d.deadlineHour)}

    <div class="sec-title">Lịch sử báo cáo</div>
    ${drawHistory(d)}`;

  // Nhiều nhân sự (TPKD/Admin) → chuyển sang tab chọn từng người thay vì xếp chồng dọc; 1 nhân sự
  // (Sales chỉ thấy chính mình) → hiện thẳng card, không cần tab.
  const drawHistory = (d) => {
    if (!d.sections.length) return empty('notepadText', 'Chưa có nhân sự nào để hiển thị.');
    if (d.sections.length === 1) return drawSection(d.sections[0]);
    const activeId = d.sections.some(s => s.userId === activeReportUser) ? activeReportUser : d.sections[0].userId;
    return `<div class="seg mb">${d.sections.map(s => `<button data-report-tab="${esc(s.userId)}" class="${s.userId === activeId ? 'on' : ''}">${esc(s.userName)}</button>`).join('')}</div>
      ${drawSection(d.sections.find(s => s.userId === activeId))}`;
  };

  // Vẽ lại tại chỗ (không qua mount()) khi chuyển tab nhân sự / đổi trang lịch sử — phải tự gọi lại
  // initScrollFx() vì đây là innerHTML MỚI, IntersectionObserver cũ (từ mount()) không còn theo dõi
  // được các phần tử .fade-in vừa tạo (vd. các ô "stat" ở khối "Báo cáo hôm nay"), nếu quên sẽ bị
  // kẹt opacity:0 y hệt lỗi đã gặp ở Cockpit.
  const redraw = (d) => { el.innerHTML = draw(d); initScrollFx(el); bind(d); };

  const bind = (d) => {
    el.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => { rpTab = b.dataset.rp; redraw(d); });
    el.querySelector('[data-post]').onclick = (e) => openForm(e.currentTarget.dataset.post, () => render(el));
    el.querySelectorAll('[data-report-tab]').forEach(btn => btn.onclick = () => {
      activeReportUser = btn.dataset.reportTab;
      redraw(d);
    });
    el.querySelectorAll('[data-pg]').forEach(btn => btn.onclick = async () => {
      const userId = btn.dataset.pg;
      const s = d.sections.find(x => x.userId === userId);
      if (!s) return;
      const maxPage = Math.max(1, Math.ceil(s.total / s.pageSize));
      const newPage = btn.dataset.dir === 'prev' ? s.page - 1 : s.page + 1;
      if (newPage < 1 || newPage > maxPage) return;
      const r = await get(`/reports?userId=${encodeURIComponent(userId)}&page=${newPage}`);
      Object.assign(s, r);
      redraw(d);
    });
  };

  await mount(el, load, draw, bind);
}

/**
 * Nộp báo cáo. Chỉ gửi lên phần ĐỊNH TÍNH — kỳ báo cáo và toàn bộ số liệu do server tự tổng hợp
 * lại tại thời điểm nộp. Trước đây client gửi kèm số liệu, khiến báo cáo tuần đem đúng số của
 * hôm nay đi nộp (sai kỳ) và về nguyên tắc còn sửa được số bằng cách gọi thẳng API.
 */
function openForm(kind, after) {
  const label = kind === 'month' ? 'tháng' : kind === 'week' ? 'tuần' : 'ngày';
  modal({
    title: kind === 'month' ? 'Tổng hợp tháng' : kind === 'week' ? 'Báo cáo tuần' : 'Báo cáo cuối ngày (EOD)',
    html: `<div class="sm mut mb">Số liệu định lượng của kỳ này đã được hệ thống tự tổng hợp — không cần nhập lại.</div>`,
    fields: [
      { name: 'highlight', label: 'Điểm nổi bật / kết quả đạt được', type: 'textarea', rows: 2, required: true },
      { name: 'blocker', label: 'Khó khăn cần hỗ trợ', type: 'textarea', rows: 2 },
      { name: 'plan', label: `Kế hoạch ${label} tới`, type: 'textarea', rows: 2 },
    ],
    submitText: 'Nộp báo cáo',
    onSubmit: async (v) => {
      const r = await post('/reports', { ...v, kind });
      toast(r.late ? 'Đã nộp — ghi nhận TRỄ HẠN' : 'Đã nộp báo cáo đúng hạn 🎉', r.late ? 'err' : 'ok');
      after();
    },
  });
}
