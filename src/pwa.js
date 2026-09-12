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
};

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
