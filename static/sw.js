/* Service worker của NetViet Sales OS (bản cài lên màn hình chính iPhone/Android).
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

const VERSION = 'v5';
const CACHE = `nv-static-${VERSION}`;

/* Vỏ app: đủ để mở được giao diện khi mất mạng. Không có dữ liệu người dùng nào ở đây —
 * index.html là khung rỗng, mọi dữ liệu đều nạp qua /api sau khi đăng nhập.
 * Các module JS cũng nằm trong danh sách: app.js import tĩnh toàn bộ views, thiếu một tệp là cả
 * app không lên được — chỉ dựa vào cache lúc chạy thì lượt mở đầu tiên (trước khi service worker
 * kiểm soát trang) không kịp lưu gì, mất mạng ngay sau đó là màn hình trắng. Tệp nào không có
 * (đổi tên, xoá) chỉ bị bỏ qua, không làm hỏng lần cài. */
const SHELL = [
  '/',
  '/styles/main.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/src/app.js', '/src/pwa.js', '/src/api.js', '/src/state.js', '/src/ui.js', '/src/const.js', '/src/icons.js',
  '/src/scrollFx.js', '/src/aiPref.js', '/src/salesDocs.js', '/src/create.js', '/src/customerImport.js', '/src/xlsx.js',
  '/src/views/login.js', '/src/views/setPassword.js', '/src/views/cockpit.js', '/src/views/crm.js',
  '/src/views/pipeline.js', '/src/views/activity.js', '/src/views/tasks.js', '/src/views/reports.js',
  '/src/views/kpi.js', '/src/views/ai.js', '/src/views/prospect.js', '/src/views/saleskit.js',
  '/src/views/console.js', '/src/views/training.js', '/src/views/admin.js', '/src/views/more.js',
  '/src/views/profile.js', '/src/views/plans.js',
];

/* Điều hướng: mạng quá chậm (sóng yếu) thì sau chừng này ms lấy vỏ đã cache thay vì màn trắng chờ
 * mãi — app lên rồi tự gọi /api, và lớp api.js đã có thông báo lỗi kết nối riêng. */
const NAV_TIMEOUT_MS = 8000;

const CACHEABLE = /\.(?:js|mjs|css|png|jpg|jpeg|svg|ico|webp|woff2?|webmanifest)$/i;

const OFFLINE_HTML = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>NetViet Sales OS</title>
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

// ===== Web Push =====

/** Chỉ mở route NỘI BỘ của app. Nhận cả "#/plans/…" (link của thông báo nghiệp vụ) lẫn "/#/cockpit";
 * URL khác origin, "//host", "javascript:"… đều rơi về Cockpit. Trả về URL tuyệt đối cùng origin. */
function appUrl(raw) {
  const fallback = new URL('/#/cockpit', self.location.origin).href;
  let text = typeof raw === 'string' ? raw.trim() : '';
  if (text.startsWith('#/')) text = '/' + text;
  try {
    const u = new URL(text, self.location.origin);
    if (u.origin !== self.location.origin || u.pathname !== '/' || !u.hash.startsWith('#/')) return fallback;
    return u.href;
  } catch (e) { return fallback; }
}

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {
      title: 'NetViet Sales OS',
      body: event.data ? event.data.text() : 'Bạn có thông báo mới.',
    };
  }

  const title = typeof data.title === 'string' && data.title ? data.title : 'NetViet Sales OS';
  const url = appUrl(typeof data.data?.url === 'string' ? data.data.url : data.url);

  const options = {
    body: typeof data.body === 'string' ? data.body : 'Bạn có thông báo mới.',
    icon: typeof data.icon === 'string' ? data.icon : '/icons/icon-192.png',
    badge: typeof data.badge === 'string' ? data.badge : '/icons/icon-192.png',
    data: { url },
    tag: typeof data.tag === 'string' && data.tag ? data.tag : 'netviet-sales-os',
    timestamp: Number.isFinite(Number(data.timestamp)) ? Number(data.timestamp) : Date.now(),
    renotify: true,
  };

  // LUÔN hiện notification của hệ điều hành — KỂ CẢ khi Sales OS đang mở và đang được dùng. Cố ý không
  // có nhánh "app đang mở thì bỏ qua": người dùng có thể đang ở màn khác, và subscription đăng ký với
  // userVisibleOnly:true bắt buộc mỗi push phải hiện ra thông báo.
  // Song song đó báo cho các cửa sổ app đang mở để cập nhật số thông báo chưa đọc (không kèm dữ liệu).
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => list.forEach((c) => c.postMessage({ type: 'nv:push', tag: options.tag })))
      .catch(() => {}),
  ]));
});


self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = appUrl(event.notification.data?.url);
  const target = new URL(targetUrl);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const appClients = clients.filter((c) => {
        try { return new URL(c.url).origin === self.location.origin; } catch (e) { return false; }
      });

      // App đã mở → dùng lại đúng cửa sổ đó (không mở tab dư): đưa lên foreground rồi đổi route.
      // focus() đi TRƯỚC: trình duyệt chỉ cho focus trong khoảnh khắc ngay sau cú bấm, chờ navigate()
      // xong mới focus thì có thể đã quá hạn và bị từ chối.
      for (const client of appClients) {
        if (!('focus' in client)) continue;
        let focused;
        try { focused = await client.focus(); } catch (e) { continue; }   // không focus được → thử cửa sổ kế tiếp
        const win = focused || client;
        let routed = false;
        if ('navigate' in win) {
          // Cùng trang, chỉ khác hash → navigate() đổi hash, app bắt hashchange và vẽ màn tương ứng.
          try { routed = !!(await win.navigate(target.href)); } catch (e) { routed = false; }
        }
        // navigate() không có (một số bản Safari) hoặc bị từ chối (cửa sổ chưa do SW này điều khiển)
        // → nhờ chính trang đổi hash (src/pwa.js lắng nghe 'nv:navigate').
        if (!routed) win.postMessage({ type: 'nv:navigate', url: '/' + target.hash });
        return;
      }

      // App chưa mở → mở Sales OS đúng route.
      if (self.clients.openWindow) {
        await self.clients.openWindow(target.href);
      }
    })()
  );
});



/** Ra mạng trước; hỏng mạng mới lấy bản đã lưu. Chỉ lưu phản hồi 200 cùng origin.
 * `timeoutMs` (chỉ dùng cho điều hướng): quá hạn mà đã có bản cache thì trả cache, chưa có thì
 * vẫn đợi mạng — không bao giờ trả lỗi sớm hơn so với không có service worker. */
async function networkFirst(request, fallbackKey, timeoutMs) {
  const cache = await caches.open(CACHE);
  const fromCache = async () => (await cache.match(request)) || (fallbackKey ? await cache.match(fallbackKey) : null);
  const net = fetch(request).then((res) => {
    if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  });
  try {
    if (timeoutMs) {
      const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
      const first = await Promise.race([net, timer]);
      if (first !== 'timeout') return first;
      const hit = await fromCache();
      if (hit) { net.catch(() => {}); return hit; }
    }
    return await net;
  } catch (err) {
    const hit = await fromCache();
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
    event.respondWith(networkFirst(req, '/', NAV_TIMEOUT_MS).catch(() => offlineResponse()));
    return;
  }

  if (CACHEABLE.test(url.pathname)) {
    event.respondWith(networkFirst(req, null));
  }
});
