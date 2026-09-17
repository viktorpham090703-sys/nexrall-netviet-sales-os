import { state, logout } from '../state.js';
import { esc, initials, toast } from '../ui.js';
import { roleLabel } from '../const.js';
import { icon } from '../icons.js';

export async function render(el) {
  const me = state.me;
  el.innerHTML = `<div class="page-head"><div class="grow"><h2>Tài khoản</h2><p>Thông tin đăng nhập & đăng xuất</p></div></div>
  <div class="card row" style="gap:11px">
    <div class="avatar" style="width:44px;height:44px">${esc(initials(me.name))}</div>
    <div class="grow"><div class="b">${esc(me.name)}</div>
      <div class="sm mut">${esc(roleLabel(me))} · ${esc(me.email || '')}</div></div>
  </div>
  ${installCard()}
  <div data-push-card>${pushLoadingCard()}</div>
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

  // Thẻ thông báo đẩy nạp RIÊNG, sau khi trang đã hiện: kiểm tra Service Worker/trạng thái có thể mất vài
  // giây (hoặc lỗi) — không được làm trắng cả màn Tài khoản trong lúc chờ.
  loadPushCard(el);

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

const pushLoadingCard = () => `<div class="card mt"><div class="item"><div class="dot-i">${icon('bell')}</div>
  <div class="grow"><div class="t">Thông báo đẩy</div><div class="d">Đang kiểm tra trạng thái…</div></div></div></div>`;

async function loadPushCard(el) {
  const slot = el.querySelector('[data-push-card]');
  if (!slot) return;
  const pwa = window.nvPWA;
  let status = null, error = null;
  if (pwa && !pwa.pushUnsupportedReason()) {
    try { status = await pwa.pushStatus(); } catch (e) { error = e; }
  }
  if (!slot.isConnected) return;               // đã rời trang trong lúc chờ
  if (error && error.sessionExpired) return;   // app đang đưa về màn đăng nhập (src/app.js)
  slot.innerHTML = pushCard(status, error);
  bindPushCard(el, slot, status);
}

function bindPushCard(el, slot, status) {
  const pwa = window.nvPWA;
  const act = (sel, fn) => slot.querySelectorAll(sel).forEach((b) => { b.onclick = async () => {
    b.disabled = true;
    try { await fn(b); } catch (e) { if (!e.sessionExpired) toast(e.message || 'Có lỗi xảy ra', 'err'); }
    if (slot.isConnected) loadPushCard(el);
  }; });

  act('[data-push-retry]', async () => {});
  // Hỏi quyền CHỈ trong sự kiện bấm này — không bao giờ tự hỏi lúc tải trang.
  act('[data-enable-push]', async () => { await pwa.enablePush(); toast('Đã bật thông báo trên thiết bị này.', 'ok'); });
  act('[data-disable-push]', async () => { await pwa.disablePush(); toast('Đã tắt thông báo trên thiết bị này.', 'ok'); });
  act('[data-remove-push]', async (b) => { await pwa.removePushSubscription(b.dataset.removePush); toast('Đã gỡ thiết bị khỏi thông báo.', 'ok'); });
  act('[data-test-push]', async () => {
    const r = await pwa.testPush({ title: 'NetViet Sales OS', body: 'Push Notification đang hoạt động.', link: '/#/cockpit', tag: 'salesos-push-test' });
    const extra = [r.removed ? `${r.removed} thiết bị hết hạn đã được gỡ` : '', r.failed ? `${r.failed} thiết bị không nhận` : ''].filter(Boolean).join(', ');
    toast(`Đã gửi thông báo thử tới ${r.sent}/${r.total} thiết bị${extra ? ' (' + extra + ')' : ''}.`, r.failed ? '' : 'ok');
  });
}

/** Hướng dẫn mở lại quyền khi người dùng đã bấm "Chặn" — trình duyệt không cho web tự hỏi lại. */
const deniedHelp = () => `<div class="note red mt">
  <div class="b">Quyền thông báo đang bị chặn</div>
  <ul class="sm" style="margin:6px 0 0;padding-left:18px;line-height:1.55">
    <li><b>Máy tính (Chrome/Edge):</b> bấm biểu tượng cài đặt trang cạnh thanh địa chỉ → Thông báo → Cho phép, rồi tải lại trang.</li>
    <li><b>Android:</b> Cài đặt → Ứng dụng → NetViet Sales (hoặc Chrome) → Thông báo → Bật.</li>
    <li><b>iPhone/iPad:</b> Cài đặt → Thông báo → NetViet Sales → Cho phép thông báo.</li>
  </ul></div>`;

function pushCard(status, error) {
  const pwa = window.nvPWA;
  const head = (chipHtml, desc) => `<div class="item"><div class="dot-i">${icon('bell')}</div><div class="grow"><div class="t">Thông báo đẩy</div>
    <div class="d">${desc}</div></div>${chipHtml}</div>`;

  if (!pwa) return `<div class="card mt">${head('', 'Trình duyệt này chưa hỗ trợ thông báo đẩy.')}</div>`;
  const unsupported = pwa.pushUnsupportedReason();
  if (unsupported) return `<div class="card mt">${head('<span class="chip">Không hỗ trợ</span>', esc(unsupported))}</div>`;
  if (error) {
    return `<div class="card mt">${head('<span class="chip red">Lỗi</span>', 'Không kiểm tra được trạng thái thông báo: ' + esc(error.message || 'lỗi không xác định'))}
      <div class="row mt"><button class="btn sm" data-push-retry>Thử lại</button></div></div>`;
  }
  if (!status.configured) {
    return `<div class="card mt">${head('<span class="chip amber">Chưa cấu hình</span>', 'Push chưa được cấu hình trên máy chủ. Liên hệ quản trị viên.')}</div>`;
  }

  const subscriptions = status.subscriptions || [];
  const enabled = !!status.currentDeviceSubscribed;
  const denied = status.permission === 'denied';
  const chipHtml = enabled ? '<span class="chip blue">Đã bật</span>' : denied ? '<span class="chip red">Bị chặn</span>' : '<span class="chip">Chưa bật</span>';
  const permText = status.permission === 'granted' ? 'Đã cho phép' : denied ? 'Đã bị chặn' : 'Chưa cho phép';

  return `<div class="card mt">
    ${head(chipHtml, `Nhận nhắc việc và hoạt động quan trọng — kể cả khi app đang đóng. Quyền trên máy này: ${esc(permText)}.`)}
    ${denied && !enabled ? deniedHelp() : ''}
    <div class="row wrap mt" style="gap:7px">
      ${enabled ? '<button class="btn sm" data-disable-push>Tắt trên thiết bị này</button>'
        : denied ? '' : '<button class="btn primary sm" data-enable-push>Bật thông báo</button>'}
      ${subscriptions.length ? '<button class="btn sm" data-test-push>Gửi thử</button>' : ''}
    </div>
    ${subscriptions.length ? `<div class="xs mut mt">Thiết bị đã đăng ký (${subscriptions.length}):</div><div class="mt">${subscriptions.map(s => `<div class="item"><div class="grow"><div class="sm">${esc(deviceLabel(s))}</div><div class="xs mut">Cập nhật ${new Date(Number(s.updated_at) * 1000).toLocaleDateString('vi-VN')}</div></div><button class="btn sm" data-remove-push="${esc(s.id)}">Gỡ</button></div>`).join('')}</div>` : ''}
  </div>`;
}

function deviceLabel(subscription) {
  const platform = { ios: 'iPhone / iPad', android: 'Android', macos: 'Mac', windows: 'Windows', other: 'Thiết bị khác' }[subscription.platform] || 'Thiết bị khác';
  return `${platform} · ${String(subscription.user_agent || 'Trình duyệt').slice(0, 72)}`;
}
