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
  pushStatus: async () => {
    const status = await get('/push/status');
    if (window.nvPWA.pushSupported()) {
      try {
        const registration = await navigator.serviceWorker.ready;
        status.currentDeviceSubscribed = !!(await registration.pushManager.getSubscription());
      } catch (e) { status.currentDeviceSubscribed = false; }
    }
    return status;
  },
  /** Must only be called from a click/tap handler: iOS requires a user gesture for permission. */
  enablePush: async () => {
    if (!window.nvPWA.pushSupported()) throw new Error('Trình duyệt này chưa hỗ trợ thông báo đẩy.');
    const status = await get('/push/status');
    if (!status.configured || !status.vapidPublicKey) throw new Error('Thông báo đẩy chưa được cấu hình trên máy chủ.');
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Bạn chưa cho phép thông báo trong trình duyệt.');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64urlToUint8Array(status.vapidPublicKey),
    });
    await post('/push/subscribe', subscription.toJSON());
    return window.nvPWA.pushStatus();
  },
  disablePush: async () => {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await del('/push/subscribe?endpoint=' + encodeURIComponent(subscription.endpoint));
      await subscription.unsubscribe();
    }
  },
  removePushSubscription: async (id) => del('/push/subscribe?id=' + encodeURIComponent(id)),
  testPush: async () => post('/push/test', {}),
};

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
