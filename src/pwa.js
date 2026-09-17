import { del, get, post } from './api.js';

/* Lớp PWA — hoàn toàn tách rời app: không đụng vào state, routing hay giao diện nghiệp vụ. Nếu trình
 * duyệt không hỗ trợ (hoặc đăng ký lỗi), app vẫn chạy y hệt như một website bình thường.
 *
 * Gồm: (1) đăng ký service worker + kiểm tra bản mới mỗi khi app quay lại foreground (bản cài trên
 * điện thoại hầu như không bao giờ "tải lại trang", nên không thể trông chờ vào lượt điều hướng);
 * (2) bắt sự kiện cài đặt của Chrome/Android để mục Tài khoản hiện nút "Cài ứng dụng" đúng lúc, thay
 * vì thanh nhắc tự động lặp lại của trình duyệt; (3) dải báo mất mạng.
 *
 * Muốn gỡ PWA: xoá thẻ <script src="/src/pwa.js"> trong index.html là xong — views/more.js đã
 * kiểm tra window.nvPWA trước khi dùng.
 */
const isStandalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // chặn thanh nhắc tự động của Chrome; app tự hiện nút ở mục Tài khoản
  installEvent = e;
  window.dispatchEvent(new Event('nv:pwa-installable'));
});
window.addEventListener('appinstalled', () => { installEvent = null; });

window.nvPWA = {
  isStandalone,
  isIOS,
  canPrompt: () => !!installEvent,
  /** Mở hộp thoại cài của Chrome; trả 'accepted' | 'dismissed' | null (không có gì để hỏi). */
  prompt: async () => {
    if (!installEvent) return null;
    const ev = installEvent;
    installEvent = null;       // mỗi sự kiện chỉ prompt() được đúng 1 lần
    ev.prompt();
    const r = await ev.userChoice;
    return r && r.outcome;
  },
  pushSupported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  /** Vì sao máy này chưa bật được thông báo đẩy (null = hỗ trợ). iPhone/iPad chỉ có Web Push trong bản
   * đã cài lên Màn hình chính (iOS/iPadOS 16.4+) — Safari thường không có PushManager. */
  pushUnsupportedReason: () => {
    if (window.nvPWA.pushSupported()) return null;
    if (isIOS() && !isStandalone()) {
      return 'Trên iPhone/iPad, hãy cài app vào Màn hình chính (Safari → Chia sẻ → Thêm vào MH chính), mở app từ icon rồi bật thông báo tại đây. Cần iOS 16.4 trở lên.';
    }
    if (!('serviceWorker' in navigator)) return 'Trình duyệt này không hỗ trợ Service Worker nên không nhận được thông báo đẩy.';
    return 'Trình duyệt này chưa hỗ trợ thông báo đẩy.';
  },
  /** Trạng thái đẩy của tài khoản + máy này. Gọi API qua src/api.js (Bearer nv_session_token) như mọi màn khác. */
  pushStatus: async () => {
    let local = null;
    if (window.nvPWA.pushSupported()) {
      try { local = await (await swReady()).pushManager.getSubscription(); } catch (e) { local = null; }
    }
    const status = await get('/push/status' + (local ? '?endpoint=' + encodeURIComponent(local.endpoint) : ''));
    // "Đang bật" chỉ khi trình duyệt CÓ subscription VÀ máy chủ đã lưu nó cho đúng tài khoản này.
    status.currentDeviceSubscribed = !!local && status.currentDevice === true;
    status.permission = 'Notification' in window ? Notification.permission : 'unsupported';
    return status;
  },
  /** CHỈ gọi từ sự kiện bấm/chạm của người dùng: iOS/Safari bắt buộc có thao tác người dùng mới cho hỏi
   * quyền, và app không tự hỏi quyền lúc tải trang. */
  enablePush: async () => {
    const unsupported = window.nvPWA.pushUnsupportedReason();
    if (unsupported) throw pushError('unsupported', unsupported);
    // Hỏi quyền NGAY, trước mọi await khác: Safari/iOS chỉ cho hỏi trong khoảnh khắc ngay sau cú chạm —
    // chờ một lệnh gọi mạng xong mới hỏi thì hộp thoại có thể không hiện. (Nút "Bật thông báo" chỉ hiện
    // khi máy chủ đã báo configured, nên không hỏi quyền vô ích.)
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'denied') throw pushError('denied', 'Quyền thông báo đang bị chặn. Hãy cho phép lại trong cài đặt trình duyệt / điện thoại rồi thử lại.');
    if (permission !== 'granted') throw pushError('dismissed', 'Bạn chưa cho phép thông báo.');
    const status = await get('/push/status');
    if (!status.configured || !status.vapidPublicKey) throw pushError('not-configured', 'Push chưa được cấu hình trên máy chủ.');

    const registration = await swReady();
    const serverKey = base64urlToUint8Array(status.vapidPublicKey);
    let subscription = await registration.pushManager.getSubscription();
    // Subscription cũ tạo bằng cặp VAPID KHÁC (máy chủ đã đổi khoá) sẽ bị dịch vụ push từ chối mãi mãi
    // → huỷ và đăng ký lại bằng khoá hiện tại.
    if (subscription && !sameKey(subscription.options && subscription.options.applicationServerKey, serverKey)) {
      try { await subscription.unsubscribe(); } catch (e) { /* đăng ký lại bên dưới */ }
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
    }
    await post('/push/subscribe', subscription.toJSON());
    return window.nvPWA.pushStatus();
  },
  /** Tắt trên MÁY NÀY: xoá bản ghi trên máy chủ (của chính tài khoản) rồi huỷ subscription trình duyệt. */
  disablePush: async () => {
    if (!window.nvPWA.pushSupported()) return;
    const registration = await swReady(4000);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    try { await del('/push/subscribe?endpoint=' + encodeURIComponent(subscription.endpoint)); }
    catch (e) { if (e.status !== 404) throw e; }   // 404: máy chủ vốn không còn bản ghi — vẫn huỷ ở trình duyệt
    await subscription.unsubscribe();
  },
  removePushSubscription: async (id) => del('/push/subscribe?id=' + encodeURIComponent(id)),
  /** payload tuỳ chọn {title, body, link, tag}; máy chủ chỉ gửi tới thiết bị của CHÍNH tài khoản đang đăng nhập. */
  testPush: async (payload = {}) => post('/push/test', payload),
};

/** navigator.serviceWorker.ready không bao giờ reject — Service Worker đăng ký lỗi (chặn cookie/bộ nhớ,
 * chế độ riêng tư…) thì nó treo mãi, kéo theo cả màn Tài khoản. Giới hạn thời gian và báo lỗi rõ ràng. */
function swReady(ms = 10000) {
  if (!('serviceWorker' in navigator)) return Promise.reject(pushError('no-sw', 'Trình duyệt không hỗ trợ Service Worker.'));
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(pushError('no-sw', 'Service Worker chưa sẵn sàng. Hãy tải lại trang rồi thử lại.')), ms)),
  ]);
}

function pushError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sameKey(a, b) {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

function base64urlToUint8Array(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('[PWA] Không đăng ký được service worker:', err));
  });

  /* Tin nhắn từ Service Worker (static/sw.js):
   *  - nv:navigate: bấm vào thông báo khi app đang mở mà trình duyệt không hỗ trợ client.navigate()
   *    → tự đổi route. Chỉ nhận route nội bộ "/#/…".
   *  - nv:push: vừa hiện một thông báo đẩy → app cập nhật số chưa đọc (src/app.js). */
  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'nv:navigate' && typeof msg.url === 'string' && /^\/#\/[^\s]*$/.test(msg.url)) {
      const hash = msg.url.slice(1);
      if (location.hash !== hash) location.hash = hash;
    } else if (msg.type === 'nv:push') {
      window.dispatchEvent(new Event('nv:push-received'));
    }
  });
}

/* Dải báo mất mạng: app là CRM cần máy chủ — không giả vờ chạy offline, chỉ nói rõ là đang mất kết
 * nối để không ai đọc nhầm màn hình đang xem là dữ liệu mới. */
const bar = document.createElement('div');
bar.className = 'net-bar';
bar.setAttribute('role', 'status');
bar.textContent = 'Mất kết nối mạng — dữ liệu trên màn hình có thể chưa cập nhật.';
bar.hidden = navigator.onLine !== false;
document.body.appendChild(bar);
window.addEventListener('online', () => { bar.hidden = true; });
window.addEventListener('offline', () => { bar.hidden = false; });
