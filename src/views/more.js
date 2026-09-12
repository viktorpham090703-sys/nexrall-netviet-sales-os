import { state, logout } from '../state.js';
import { esc, initials, toast } from '../ui.js';
import { roleLabel } from '../const.js';

export async function render(el) {
  const me = state.me;
  el.innerHTML = `<div class="page-head"><div class="grow"><h2>Tài khoản</h2><p>Thông tin đăng nhập & đăng xuất</p></div></div>
  <div class="card row" style="gap:11px">
    <div class="avatar" style="width:44px;height:44px">${esc(initials(me.name))}</div>
    <div class="grow"><div class="b">${esc(me.name)}</div>
      <div class="sm mut">${esc(roleLabel(me))} · ${esc(me.email || '')}</div></div>
  </div>
  ${installCard()}
  <button class="btn block mt" data-logout>Đăng xuất</button>
  <div class="xs mut mt">NetViet Sales OS · bản demo dữ liệu mẫu · AI hỗ trợ <b>Google Gemini</b> & <b>Anthropic Claude</b> (nhập API key trong Secrets là chạy ngay, chưa có key thì dùng AI mẫu offline) · các tích hợp còn lại (quét thầu, tổng đài, Zalo/email, e-sign, kế toán) đang ở chế độ mock.</div>`;

  const inst = el.querySelector('[data-install]');
  if (inst) inst.onclick = async () => {
    inst.disabled = true;
    const outcome = await window.nvPWA.prompt();
    if (outcome === 'accepted') toast('Đã cài ứng dụng lên màn hình chính', 'ok');
    render(el);
  };
  // Chrome/Android chỉ báo "cài được" sau khi trang tải xong một lúc — nếu đang mở trang này thì vẽ lại
  // để nút cài hiện ra, không bắt người dùng tải lại.
  if (!installableHooked) {
    installableHooked = true;
    window.addEventListener('nv:pwa-installable', () => { if (el.isConnected && location.hash.startsWith('#/more')) render(el); });
  }

  el.querySelector('[data-logout]').onclick = async () => {
    await logout();
    location.hash = '#/login';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
}

let installableHooked = false;

/* Hướng dẫn / nút cài app lên màn hình chính — lớp PWA (src/pwa.js) cung cấp window.nvPWA. Không có
 * lớp đó (hoặc đã chạy ở chế độ cài đặt) thì không hiện gì: không nhắc cài lặp đi lặp lại. */
function installCard() {
  const pwa = window.nvPWA;
  if (!pwa || pwa.isStandalone()) return '';
  if (pwa.canPrompt()) {
    return `<div class="card mt">
      <div class="b">Cài ứng dụng lên màn hình chính</div>
      <div class="sm mut mt">Mở nhanh như app, chạy toàn màn hình, không cần Google Play. Đăng nhập và dữ liệu giống hệt bản web.</div>
      <button class="btn primary sm mt" data-install>Cài ứng dụng</button>
    </div>`;
  }
  if (pwa.isIOS()) {
    return `<div class="card mt">
      <div class="b">Cài lên màn hình chính iPhone / iPad</div>
      <ol class="sm mut mt" style="padding-left:18px;margin:0;line-height:1.6">
        <li>Mở trang này bằng <b>Safari</b> (Chrome/Zalo trên iOS không có mục này).</li>
        <li>Chạm nút <b>Chia sẻ</b> (ô vuông có mũi tên đi lên).</li>
        <li>Chọn <b>Thêm vào MH chính</b> → <b>Thêm</b>.</li>
      </ol>
    </div>`;
  }
  return '';
}
