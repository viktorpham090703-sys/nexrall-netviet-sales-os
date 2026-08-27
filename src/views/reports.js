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

export async function render(el) {
  const load = () => get('/reports');

  const drawSection = (s) => {
    const maxPage = Math.max(1, Math.ceil(s.total / s.pageSize));
    return `<div class="card mt">
      <div class="row"><div class="grow b">${esc(s.userName)}</div>${chip(roleLabel({ id: s.userId, role: s.role }))}</div>
      ${s.items.length ? s.items.map(r => `<div class="item">
        <div class="dot-i">${icon(r.kind === 'week' ? 'calendar' : 'notepadText')}</div>
        <div class="grow"><div class="t">${r.kind === 'week' ? 'Báo cáo tuần' : 'EOD'} ${esc(r.period)}</div>
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

  const draw = (d) => `
    <div class="page-head">
      <div class="grow"><h2>Báo cáo EOD & Tuần</h2>
        <p>Số liệu tự tổng hợp từ hoạt động — bạn chỉ bổ sung phần định tính, nộp 1 chạm</p></div>
    </div>

    <div class="card">
      <div class="row"><div class="grow b">Báo cáo hôm nay (${esc(d.draft.period)})</div>
        ${d.submittedToday ? chip('Đã nộp', 'green') : chip('Chưa nộp · hạn ' + d.deadlineHour + 'h', 'amber')}</div>
      <div class="grid g4 mt">
        ${stat('Cuộc gọi', d.draft.calls)}${stat('Gặp/Demo', d.draft.meetings)}
        ${stat('Liên hệ mới', d.draft.new_contacts)}${stat('Deal chuyển GĐ', d.draft.deals_moved)}
      </div>
      <div class="sm mut mt">Doanh thu ký hôm nay: <b>${money(d.draft.revenue)}</b> · tổng ${d.draft.activities} hoạt động</div>
      <button class="btn primary block mt" data-submit>${d.submittedToday ? 'Cập nhật báo cáo hôm nay' : 'Nộp báo cáo cuối ngày (1 chạm)'}</button>
      <button class="btn block mt" data-week>Nộp báo cáo tuần</button>
    </div>

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
    el.querySelector('[data-submit]').onclick = () => openForm(d, 'day', () => render(el));
    el.querySelector('[data-week]').onclick = () => openForm(d, 'week', () => render(el));
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

function openForm(d, kind, after) {
  const now = new Date();
  const week = now.getUTCFullYear() + '-W' + String(Math.ceil(((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)).padStart(2, '0');
  modal({
    title: kind === 'week' ? 'Báo cáo tuần' : 'Báo cáo cuối ngày (EOD)',
    html: `<div class="sm mut mb">Số liệu định lượng đã tự tổng hợp từ hoạt động đã ghi — không cần nhập lại.</div>`,
    fields: [
      { name: 'highlight', label: 'Điểm nổi bật / kết quả đạt được', type: 'textarea', rows: 2, required: true },
      { name: 'blocker', label: 'Khó khăn cần hỗ trợ', type: 'textarea', rows: 2 },
      { name: 'plan', label: kind === 'week' ? 'Kế hoạch tuần tới' : 'Kế hoạch ngày mai', type: 'textarea', rows: 2 },
    ],
    submitText: 'Nộp báo cáo',
    onSubmit: async (v) => {
      const r = await post('/reports', {
        ...v, kind, period: kind === 'week' ? week : d.draft.period,
        calls: d.draft.calls, meetings: d.draft.meetings, newContacts: d.draft.new_contacts,
        dealsMoved: d.draft.deals_moved, revenue: d.draft.revenue,
      });
      toast(r.late ? 'Đã nộp — ghi nhận TRỄ HẠN' : 'Đã nộp báo cáo đúng hạn 🎉', r.late ? 'err' : 'ok');
      after();
    },
  });
}
