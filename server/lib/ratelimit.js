/**
 * Chống dò mật khẩu: đếm số lần đăng nhập SAI theo (định danh + IP) trong 1 cửa sổ thời gian.
 * Lưu ở D1 (bảng nv_login_attempts) thay vì SHARED_KV vì cần đọc-rồi-tăng chính xác trong cùng
 * 1 request — KV không có atomic increment nên dễ đếm thiếu khi nhiều request đua nhau tới.
 * Không cần TTL: cửa sổ tự hết hạn dựa vào window_start, hàng cũ tự "nguội" (không còn chặn)
 * dù chưa bị dọn — số hàng phát sinh tối đa bằng số cặp (định danh, IP) từng gõ sai, không đáng kể.
 */
import { now } from './util.js';

const WINDOW_SEC = 15 * 60; // 15 phút
const MAX_ATTEMPTS = 5;

const rlKey = (identifier, ip) => (String(identifier || '').trim().toLowerCase() + '|' + String(ip || '')).slice(0, 220);

/** Lấy IP client — Nexrall/Cloudflare Worker luôn tự gắn header cf-connecting-ip ở edge, client
 * KHÔNG ghi đè được header này. KHÔNG fallback sang x-forwarded-for: đó là header client tự gửi
 * được, nếu tin vào nó thì đổi 1 giá trị x-forwarded-for tuỳ ý mỗi request là né được khoá đăng
 * nhập (khoá tính theo định danh+IP). Thiếu cf-connecting-ip (vd chạy ngoài Cloudflare) → 'unknown'
 * dùng chung cho mọi request, vẫn khoá được vì gộp theo (định danh, 'unknown'). */
export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

/** Kiểm tra xem (định danh+IP) có đang bị khoá tạm do đăng nhập sai quá nhiều lần không. */
export async function loginRateLimited(env, identifier, ip) {
  const row = await env.DB.prepare('SELECT count, window_start FROM nv_login_attempts WHERE rl_key=?')
    .bind(rlKey(identifier, ip)).first();
  if (!row) return { blocked: false };
  const elapsed = now() - Number(row.window_start);
  if (elapsed >= WINDOW_SEC) return { blocked: false }; // cửa sổ cũ đã qua
  if (Number(row.count) >= MAX_ATTEMPTS) return { blocked: true, retryAfterSec: WINDOW_SEC - elapsed };
  return { blocked: false };
}

/** Ghi nhận 1 lần đăng nhập sai — tăng bộ đếm, hoặc mở cửa sổ mới nếu cửa sổ cũ đã hết hạn. */
export async function recordLoginFailure(env, identifier, ip) {
  const key = rlKey(identifier, ip);
  const t = now();
  const row = await env.DB.prepare('SELECT count, window_start FROM nv_login_attempts WHERE rl_key=?').bind(key).first();
  if (!row || t - Number(row.window_start) >= WINDOW_SEC) {
    await env.DB.prepare(
      'INSERT INTO nv_login_attempts (rl_key,count,window_start,updated_at) VALUES (?,1,?,?) ' +
      'ON CONFLICT(rl_key) DO UPDATE SET count=1,window_start=excluded.window_start,updated_at=excluded.updated_at')
      .bind(key, t, t).run();
  } else {
    await env.DB.prepare('UPDATE nv_login_attempts SET count=count+1, updated_at=? WHERE rl_key=?').bind(t, key).run();
  }
}

/** Đăng nhập đúng → xoá bộ đếm để không cộng dồn sang lần sau. */
export async function clearLoginAttempts(env, identifier, ip) {
  await env.DB.prepare('DELETE FROM nv_login_attempts WHERE rl_key=?').bind(rlKey(identifier, ip)).run();
}
