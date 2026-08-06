import { get, post } from '../api.js';
import { isLead } from '../state.js';
import { esc, money, mount, chip, empty, fmtDate, toast, modal, stat } from '../ui.js';

export async function render(el) {
  const load = () => get('/reports');

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
    ${d.items.length ? `<div class="card">${d.items.map(r => `<div class="item">
      <div class="dot-i">${r.kind === 'week' ? '📅' : '📝'}</div>
      <div class="grow"><div class="t">${r.kind === 'week' ? 'Báo cáo tuần' : 'EOD'} ${esc(r.period)}${isLead() ? ' · ' + esc(r.user_name || '') : ''}</div>
        <div class="d">${r.calls} gọi · ${r.meetings} gặp · ${r.new_contacts} liên hệ mới · ${r.deals_moved} deal chuyển GĐ${r.revenue ? ' · DT ' + money(r.revenue) : ''}</div>
        ${r.highlight ? `<div class="d xs">💡 ${esc(r.highlight)}</div>` : ''}
        ${r.blocker ? `<div class="d xs">🚧 ${esc(r.blocker)}</div>` : ''}</div>
      ${r.late ? chip('Trễ hạn', 'red') : chip('Đúng hạn', 'green')}
    </div>`).join('')}</div>` : empty('📝', 'Chưa có báo cáo nào.')}`;

  const bind = (d) => {
    el.querySelector('[data-submit]').onclick = () => openForm(d, 'day', () => render(el));
    el.querySelector('[data-week]').onclick = () => openForm(d, 'week', () => render(el));
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
