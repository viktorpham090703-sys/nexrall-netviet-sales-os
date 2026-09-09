/* Lớp PWA — hoàn toàn tách rời app: chỉ đăng ký service worker, không đụng vào state,
 * routing hay giao diện. Nếu trình duyệt không hỗ trợ (hoặc đăng ký lỗi), app vẫn chạy
 * y hệt như một website bình thường.
 *
 * Muốn gỡ PWA: xoá thẻ <script src="/src/pwa.js"> trong index.html là xong.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[PWA] Không đăng ký được service worker:', err));
  });
}
