import { state, logout } from '../state.js';
import { esc, initials } from '../ui.js';
import { roleLabel } from '../const.js';

export async function render(el) {
  const me = state.me;
  el.innerHTML = `<div class="page-head"><div class="grow"><h2>Tài khoản</h2><p>Thông tin đăng nhập & đăng xuất</p></div></div>
  <div class="card row" style="gap:11px">
    <div class="avatar" style="width:44px;height:44px">${esc(initials(me.name))}</div>
    <div class="grow"><div class="b">${esc(me.name)}</div>
      <div class="sm mut">${esc(roleLabel(me))} · ${esc(me.email || '')}</div></div>
  </div>
  <button class="btn block mt" data-logout>Đăng xuất</button>
  <div class="xs mut mt">NetViet Sales OS · bản demo dữ liệu mẫu · AI hỗ trợ <b>Google Gemini</b> & <b>Anthropic Claude</b> (nhập API key trong Secrets là chạy ngay, chưa có key thì dùng AI mẫu offline) · các tích hợp còn lại (quét thầu, tổng đài, Zalo/email, e-sign, kế toán) đang ở chế độ mock.</div>`;

  el.querySelector('[data-logout]').onclick = async () => {
    await logout();
    location.hash = '#/login';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
}
