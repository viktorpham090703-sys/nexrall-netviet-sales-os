import { state, logout } from '../state.js';
import { esc, initials, toast } from '../ui.js';
import { roleLabel } from '../const.js';

export async function render(el) {
  const me = state.me;
  let push = null;
  try { push = await window.nvPWA?.pushStatus?.(); } catch (e) { /* card shows a safe retry state */ }
  el.innerHTML = `<div class="page-head"><div class="grow"><h2>Tài khoản</h2><p>Thông tin đăng nhập & đăng xuất</p></div></div>
  <div class="card row" style="gap:11px">
    <div class="avatar" style="width:44px;height:44px">${esc(initials(me.name))}</div>
    <div class="grow"><div class="b">${esc(me.name)}</div>
      <div class="sm mut">${esc(roleLabel(me))} · ${esc(me.email || '')}</div></div>
  </div>
  ${installCard()}
  ${pushCard(push)}
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

  const enablePush = el.querySelector('[data-enable-push]');
  if (enablePush) enablePush.onclick = async () => {
    enablePush.disabled = true;
    try { await window.nvPWA.enablePush(); toast('Đã bật thông báo trên thiết bị này.', 'ok'); }
    catch (e) { toast(e.message || 'Không thể bật thông báo.', 'err'); }
    render(el);
  };
  const disablePush = el.querySelector('[data-disable-push]');
  if (disablePush) disablePush.onclick = async () => {
    disablePush.disabled = true;
    try { await window.nvPWA.disablePush(); toast('Đã tắt thông báo trên thiết bị này.', 'ok'); }
    catch (e) { toast(e.message || 'Không thể tắt thông báo.', 'err'); }
    render(el);
  };
  const testPush = el.querySelector('[data-test-push]');
  if (testPush) testPush.onclick = async () => {
    testPush.disabled = true;
    try { await window.nvPWA.testPush(); toast('Đã gửi thông báo thử đến các thiết bị đang bật.', 'ok'); }
    catch (e) { toast(e.message || 'Không gửi được thông báo thử.', 'err'); }
    testPush.disabled = false;
  };
  el.querySelectorAll('[data-remove-push]').forEach((button) => { button.onclick = async () => {
    button.disabled = true;
    try { await window.nvPWA.removePushSubscription(button.dataset.removePush); toast('Đã gỡ thiết bị khỏi thông báo.', 'ok'); }
    catch (e) { toast(e.message || 'Không thể gỡ thiết bị.', 'err'); }
    render(el);
  }; });

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

function pushCard(status) {
  const pwa = window.nvPWA;
  if (!pwa?.pushSupported?.()) return `<div class="card mt"><div class="b">Thông báo đẩy</div><div class="sm mut mt">Trình duyệt này chưa hỗ trợ thông báo đẩy.</div></div>`;
  const permission = Notification.permission === 'granted' ? 'Đã cho phép' : Notification.permission === 'denied' ? 'Đã bị chặn trong trình duyệt' : 'Chưa được cho phép';
  if (!status) return `<div class="card mt"><div class="b">Thông báo đẩy</div><div class="sm mut mt">Chưa kiểm tra được trạng thái. Hãy thử tải lại trang.</div></div>`;
  if (!status.configured) return `<div class="card mt"><div class="b">Thông báo đẩy</div><div class="sm mut mt">Máy chủ chưa hoàn tất cấu hình thông báo đẩy.</div></div>`;
  const subscriptions = status.subscriptions || [];
  const enabled = !!status.currentDeviceSubscribed;
  return `<div class="card mt">
    <div class="item"><div class="dot-i">🔔</div><div class="grow"><div class="t">Thông báo đẩy</div>
      <div class="d">Nhận nhắc việc và hoạt động quan trọng. Quyền trình duyệt: ${esc(permission)}.</div></div>
      ${enabled ? '<span class="chip blue">Đang bật</span>' : '<span class="chip">Đang tắt</span>'}</div>
    <div class="row wrap mt" style="gap:7px">
      ${enabled ? '<button class="btn sm" data-disable-push>Tắt trên thiết bị này</button>' : '<button class="btn primary sm" data-enable-push>Bật thông báo</button>'}
      ${subscriptions.length ? '<button class="btn sm" data-test-push>Gửi thử</button>' : ''}
    </div>
    ${subscriptions.length ? `<div class="xs mut mt">Thiết bị đã đăng ký (${subscriptions.length}):</div><div class="mt">${subscriptions.map(s => `<div class="item"><div class="grow"><div class="sm">${esc(deviceLabel(s))}</div><div class="xs mut">Cập nhật ${new Date(Number(s.updated_at) * 1000).toLocaleDateString('vi-VN')}</div></div><button class="btn sm" data-remove-push="${esc(s.id)}">Gỡ</button></div>`).join('')}</div>` : ''}
  </div>`;
}

function deviceLabel(subscription) {
  const platform = { ios: 'iPhone / iPad', android: 'Android', macos: 'Mac', windows: 'Windows', other: 'Thiết bị khác' }[subscription.platform] || 'Thiết bị khác';
  return `${platform} · ${String(subscription.user_agent || 'Trình duyệt').slice(0, 72)}`;
}
