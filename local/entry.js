// Vỏ bọc để chạy local.
// server.js chỉ export handle(request, env) cho nền tảng Nexrall gọi vào;
// Cloudflare Worker thì cần một default export có hàm fetch — file này nối hai thứ đó.
// KHÔNG sửa server.js, để bản local luôn giống hệt bản deploy.
import { handle } from '../server.js';

export default {
  fetch(request, env) {
    return handle(request, env);
  },
  // Lịch quét tự động — gọi lại chính route /api/__cron để dùng chung logic
  async scheduled(event, env, ctx) {
    // /api/__cron yêu cầu xác thực (khoá CRON_SECRET hoặc phiên TP/Admin) — bộ lập lịch
    // gửi kèm khoá để chạy được mà không cần tài khoản người dùng nào.
    ctx.waitUntil(handle(new Request('https://cron.local/api/__cron', {
      headers: { 'X-Cron-Key': env.CRON_SECRET || '' },
    }), env));
  },
};
