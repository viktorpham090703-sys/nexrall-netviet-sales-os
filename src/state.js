import { get, post, del, setToken, sessionToken, clearLegacy } from './api.js';

export const state = {
  me: null,
  users: [],
  config: {},
  unread: 0,
  mode: 'production',
  initialized: true,
  demoHint: null,
};

export async function boot() {
  clearLegacy();
  const d = await get('/bootstrap');
  state.users = d.users || [];
  state.me = d.me || null;
  state.config = d.config || {};
  state.unread = d.unread || 0;
  state.mode = d.mode || 'production';
  state.initialized = d.initialized !== false;
  state.demoHint = d.demoHint || null;
  return state;
}

export async function login(identifier, password) {
  const d = await post('/session', { identifier, password });
  setToken(d.token);          // danh tính nằm ở token do máy chủ cấp, không phải id đoán được
  state.me = d.me;
  await boot();
  return state.me;
}

export async function logout() {
  try { await del('/session'); } catch (e) { /* phiên có thể đã hết hạn */ }
  setToken('');
  state.me = null;
  state.unread = 0;
  // Nạp lại bootstrap ở trạng thái CHƯA đăng nhập — bắt buộc, vì state.users lúc đang đăng nhập
  // chứa TOÀN BỘ tài khoản (kể cả tài khoản chính thức, để Admin quản trị được), không lọc is_demo.
  // Không gọi lại boot() ở đây thì màn đăng nhập sau khi "Đổi tài khoản" sẽ hiện nhầm danh sách cũ.
  await boot();
}

export const isLead = () => !!state.me && (state.me.role === 'manager' || state.me.role === 'admin');
export const isAdmin = () => state.me?.role === 'admin';
export const userName = (id) => (state.users.find(u => u.id === id) || {}).name || '—';
export const salesUsers = () => state.users.filter(u => u.role === 'sales');
export { sessionToken };
