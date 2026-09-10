/* Service worker của "Phòng Kinh Doanh" (NetViet Sales OS).
 *
 * Nguyên tắc: đây CHỈ là lớp bọc thêm cho web app hiện tại — không đổi routing, không đổi
 * xác thực, không đổi dữ liệu. Website và bản cài lên màn hình chính dùng chung đúng một
 * front-end, một backend, một CSDL.
 *
 * Chiến lược cache (cố ý KHÔNG "cache everything"):
 *   - /api/*            → KHÔNG BAO GIỜ đụng tới. Toàn bộ dữ liệu kinh doanh, phiên đăng nhập,
 *                         token... đi thẳng ra mạng, không nằm trong Cache Storage.
 *   - method != GET     → bỏ qua (không cache thao tác ghi, không có hàng đợi offline).
 *   - khác origin       → bỏ qua (font Google… để trình duyệt tự lo).
 *   - điều hướng + tệp tĩnh (js/css/png/…) → NETWORK-FIRST: online luôn lấy bản mới nhất
 *                         (deploy xong là thấy ngay, không bị kẹt bản cũ); mất mạng mới
 *                         rơi về bản đã cache để vỏ app còn mở được.
 *
 * Vì src/*.js và styles/main.css không được đánh version theo nội dung, network-first là
 * lựa chọn bắt buộc: cache-first sẽ khiến người dùng chạy code cũ sau mỗi lần deploy.
 */

const VERSION = 'v2';
const CACHE = `nv-static-${VERSION}`;

/* Vỏ app: đủ để mở được giao diện khi mất mạng. Không có dữ liệu người dùng nào ở đây —
 * index.html là khung rỗng, mọi dữ liệu đều nạp qua /api sau khi đăng nhập. */
const SHELL = [
  '/',
  '/styles/main.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
];

const CACHEABLE = /\.(?:js|mjs|css|png|jpg|jpeg|svg|ico|webp|woff2?|webmanifest)$/i;

const OFFLINE_HTML = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Phòng Kinh Doanh</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
padding:24px;background:#F5F6F8;color:#222;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif}
div{max-width:340px;text-align:center}h1{font-size:17px;margin:0 0 8px}p{font-size:14px;color:#6B7280;line-height:1.5;margin:0 0 16px}
button{padding:10px 16px;border-radius:11px;border:1px solid #EF3B24;background:#EF3B24;color:#fff;font-weight:700;font-size:14px}</style>
</head><body><div><h1>Không thể kết nối máy chủ.</h1>
<p>Vui lòng kiểm tra kết nối mạng.</p>
<button onclick="location.reload()">Thử lại</button></div></body></html>`;

const offlineResponse = () => new Response(OFFLINE_HTML, {
  status: 503,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Từng tệp một: một tệp lỗi không được làm hỏng cả lần cài (khác với cache.addAll).
    await Promise.allSettled(SHELL.map(async (url) => {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('nv-static-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** Ra mạng trước; hỏng mạng mới lấy bản đã lưu. Chỉ lưu phản hồi 200 cùng origin. */
async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.status === 200 && res.type === 'basic') {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = (await cache.match(request)) || (fallbackKey ? await cache.match(fallbackKey) : null);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // font/CDN bên ngoài: không can thiệp
  if (url.pathname.startsWith('/api/')) return;      // dữ liệu & phiên đăng nhập: không cache

  if (req.mode === 'navigate') {
    // Toàn bộ điều hướng trong app chạy bằng hash (#/cockpit…), nên mọi lần mở app đều là "/".
    event.respondWith(networkFirst(req, '/').catch(() => offlineResponse()));
    return;
  }

  if (CACHEABLE.test(url.pathname)) {
    event.respondWith(networkFirst(req, null));
  }
});
