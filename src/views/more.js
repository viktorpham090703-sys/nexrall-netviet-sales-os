import { state, logout } from '../state.js';
import { esc, initials } from '../ui.js';
import { ROLE_NAME } from '../const.js';

const LINKS = [
  ['#/activities', '🗓️', 'Lịch & Hoạt động', 'Ghi log, call log, nhắc việc'],
  ['#/tasks', '📥', 'Việc & Giao việc', 'Việc được giao, SLA nhận việc'],
  ['#/reports', '📝', 'Báo cáo EOD & Tuần', 'Nộp 1 chạm, tự tổng hợp'],
  ['#/kpi', '🏆', 'KPI & Hoa hồng', 'Thẻ điểm 100đ, leaderboard, PIP'],
  ['#/prospect', '🔎', 'Tìm khách & Thầu', '7 kênh nguồn, AI chấm lead'],
  ['#/saleskit', '📄', 'Sales Kit & Báo giá', 'Bảng giá, tính hoa hồng'],
  ['#/training', '🎓', 'Đào tạo', 'Lộ trình học theo vai trò'],
  ['#/ai', '🤖', 'AI Trợ lý', 'Soạn email, xử lý từ chối'],
];

export async function render(el) {
  const me = state.me;
  el.innerHTML = `<div class="page-head"><div class="grow"><h2>Thêm</h2><p>Tất cả tính năng NetViet Sales OS</p></div></div>
  <div class="card row" style="gap:11px">
    <div class="avatar" style="width:44px;height:44px">${esc(initials(me.name))}</div>
    <div class="grow"><div class="b">${esc(me.name)}</div>
      <div class="sm mut">${esc(ROLE_NAME[me.role] || me.role)} · ${esc(me.email || '')}</div></div>
    <button class="btn sm" data-logout>Đổi tài khoản</button>
  </div>
  <div class="sec-title">Tính năng</div>
  <div class="card">${LINKS.map(l => `<a class="item" href="${l[0]}">
      <div class="dot-i">${l[1]}</div>
      <div class="grow"><div class="t">${esc(l[2])}</div><div class="d">${esc(l[3])}</div></div>
      <span class="mut">›</span></a>`).join('')}</div>
  <div class="xs mut mt">NetViet Sales OS · bản demo dữ liệu mẫu · AI hỗ trợ <b>Google Gemini</b> & <b>Anthropic Claude</b> (nhập API key trong Secrets là chạy ngay, chưa có key thì dùng AI mẫu offline) · các tích hợp còn lại (quét thầu, tổng đài, Zalo/email, e-sign, kế toán) đang ở chế độ mock.</div>`;

  el.querySelector('[data-logout]').onclick = () => {
    logout();
    location.hash = '#/login';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
}
