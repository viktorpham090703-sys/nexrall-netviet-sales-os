/**
 * Xác thực bằng mật khẩu + phiên (session token).
 *
 * Trước đây danh tính chỉ là header `X-Actor-Id` — ai cũng đoán được id và
 * chiếm quyền admin. Nay đăng nhập phải đúng mật khẩu, sau đó đổi lấy một
 * token ngẫu nhiên 256-bit qua POST /api/session, token được lưu ở CSDL và có hạn.
 */
import { now } from './util.js';

export const SESSION_TTL = 12 * 60 * 60; // 12 giờ
const PBKDF2_ITER = 100000;

function toHex(buf) { return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function fromHex(hex) { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b; }

/** Băm mật khẩu bằng PBKDF2-SHA256, trả về chuỗi "iterations:saltHex:hashHex". */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
  return `${PBKDF2_ITER}:${toHex(salt)}:${toHex(bits)}`;
}

/** So khớp mật khẩu với chuỗi đã băm. Trả về false nếu định dạng không hợp lệ. */
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [iterStr, saltHex, hashHex] = String(stored).split(':');
  const iterations = Number(iterStr);
  if (!iterations || !saltHex || !hashHex) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' }, key, 256);
  const got = toHex(bits);
  if (got.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

/** Băm "giả" cố định (không phải mật khẩu thật của ai) — dùng để verifyPassword() vẫn chạy đủ
 * vòng lặp PBKDF2 ngay cả khi định danh không khớp tài khoản nào, để thời gian phản hồi của
 * POST /api/session không tố cáo việc tài khoản có tồn tại hay không (timing side-channel). */
export const DUMMY_PASSWORD_HASH = `${PBKDF2_ITER}:${'0'.repeat(32)}:${'0'.repeat(64)}`;

/** Sinh token ngẫu nhiên không đoán được. */
function newToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Sinh token cho link thiết lập mật khẩu (mời tài khoản / quên mật khẩu) — ngẫu nhiên 256-bit như newToken(). */
export function newSetupToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

/** Băm token thiết lập mật khẩu bằng SHA-256 để lưu vào CSDL — token gốc không bao giờ chạm CSDL. */
export async function hashSetupToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(digest);
}

/** Tạo phiên mới cho user, dọn luôn phiên hết hạn. */
export async function createSession(env, userId, ua) {
  const t = now();
  const token = newToken();
  await env.DB.prepare('INSERT INTO nv_sessions (token,user_id,created_at,expires_at,ua) VALUES (?,?,?,?,?)')
    .bind(token, userId, t, t + SESSION_TTL, (ua || '').slice(0, 200)).run();
  try { await env.DB.prepare('DELETE FROM nv_sessions WHERE expires_at < ?').bind(t).run(); } catch (e) { /* noop */ }
  return { token, expiresAt: t + SESSION_TTL };
}

/** Huỷ 1 phiên (đăng xuất). */
export async function destroySession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM nv_sessions WHERE token=?').bind(token).run();
}

/** Đọc token từ header Authorization: Bearer <token>. */
export function readToken(request) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9]+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Xác định người dùng đang thao tác từ token.
 * Trả null nếu không có token / token sai / hết hạn / tài khoản bị khoá.
 */
export async function resolveActor(request, env) {
  const token = readToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.name, u.email, u.role, u.title, u.created_at, u.is_demo, u.must_change_password, u.can_manage_accounts
     FROM nv_sessions s JOIN nv_users u ON u.id = s.user_id
     WHERE s.token = ? AND u.active = 1`).bind(token).first();
  if (!row) return null;
  if (Number(row.expires_at) < now()) {
    await destroySession(env, token);
    return null;
  }
  // Gia hạn trượt: còn dưới 1/4 thời gian thì đẩy hạn ra
  if (Number(row.expires_at) - now() < SESSION_TTL / 4) {
    try { await env.DB.prepare('UPDATE nv_sessions SET expires_at=? WHERE token=?').bind(now() + SESSION_TTL, token).run(); } catch (e) { /* noop */ }
  }
  // is_demo xác định "workspace" (demo hay chính thức) — dùng để giới hạn phạm vi nhìn thấy
  // dữ liệu của TP/Admin trong scope(), không để dữ liệu mẫu demo lẫn vào dữ liệu thật và ngược lại.
  return {
    id: row.id, name: row.name, email: row.email, role: row.role, title: row.title, created_at: row.created_at,
    is_demo: !!row.is_demo, must_change_password: !!row.must_change_password, can_manage_accounts: !!row.can_manage_accounts, _token: token,
  };
}

