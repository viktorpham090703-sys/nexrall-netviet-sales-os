import { get, post, del, setToken, sessionToken, clearLegacy } from './api.js';

export const state = {
  me: null,
  users: [],
  config: {},
  unread: 0,
  mode: 'production',
  initialized: true,
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

// Giám đốc (director) đã sáp nhập vào Admin/BGĐ. hr (HCNS) vẫn là vai trò duyệt vòng 2 hợp đồng
// riêng — xếp chung nhóm "lead" với manager/admin để hưởng cùng quyền xem đội/nav (khớp
// server/lib/util.js LEAD_ROLES).
export const isLead = () => !!state.me && ['manager', 'admin', 'hr'].includes(state.me.role);
export const isAdmin = () => state.me?.role === 'admin';
// Không phải mọi Admin đều được thêm/khoá tài khoản hay đổi mật khẩu nhân sự khác — xem
// can_manage_accounts (server/lib/db.js migration 32).
export const canManageAccounts = () => isAdmin() && !!state.me?.can_manage_accounts;
/** Ghi vai trò/chức danh vừa được Admin đổi vào state đang giữ trong bộ nhớ, để nhãn hiển thị
 * (roleLabel) đổi theo ngay — state.users/state.me chỉ được nạp lại ở /bootstrap, nếu không đồng
 * bộ tại chỗ thì sidebar và các bộ chọn vẫn hiện chức danh cũ cho tới khi tải lại trang. */
export function applyUserRole(id, { role, title } = {}) {
  const apply = (u) => {
    if (!u || u.id !== id) return;
    if (role) u.role = role;
    if (title != null) u.title = title;
  };
  state.users.forEach(apply);
  apply(state.me);
}
export const userName = (id) => (state.users.find(u => u.id === id) || {}).name || '—';
export const salesUsers = () => state.users.filter(u => u.role === 'sales');
/** Nhân sự TRỰC TIẾP giữ khách/partner/deal — rộng hơn salesUsers(): Trưởng phòng KD vừa quản lý
 * đội vừa tự đứng tên khách hàng và cơ hội của mình, nên phải có mặt ở bộ chọn "Sale phụ trách
 * (cố định)" của Partner và bộ lọc nhân sự của Pipeline. Khớp đúng danh sách đội mà máy chủ trả về
 * cho bộ lọc CRM (server/routes/crm.js: role IN sales/manager); máy chủ vốn đã nhận mọi tài khoản
 * cùng workspace ở resolveAssignableOwner()/scope(). Các bộ chọn còn lại ("Giao cho" công việc,
 * KPI, đào tạo, hoa hồng) giữ nguyên chỉ-sales vì đó là chỉ tiêu của nhân viên. */
export const salesTeamUsers = () => state.users.filter(u => u.role === 'sales' || u.role === 'manager');
/** Nhãn 1 dòng cho các bộ chọn dùng salesTeamUsers(): ghi rõ chức danh của Trưởng phòng để không
 * bị đọc nhầm thành "thêm một sale nữa". Nhận cả hàng user từ máy chủ (có sẵn cột `role`). */
export const salesTeamOption = (u) => ({ v: u.id, n: u.role === 'manager' ? `${u.name} (TPKD)` : u.name });
/** Trường "Giao cho" trong modal tạo mới — chỉ hiện với TP/Admin, ẩn với sales. Mặc định chỉ liệt
 * kê nhân viên sales; truyền `users` để mở rộng cho loại bản ghi mà Trưởng phòng cũng tự đứng tên
 * (deal — xem salesTeamUsers). */
export const assigneeField = (name, users = salesUsers()) => ({ name, label: 'Giao cho', type: 'select', options: users.map(salesTeamOption) });
export { sessionToken };
