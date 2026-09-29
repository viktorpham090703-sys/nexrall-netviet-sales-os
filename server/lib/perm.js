import { HttpError, wsBucket } from './util.js';
import { getSetting } from './settings.js';

/**
 * Phân quyền 3 lớp: theo CẤP (phạm vi dữ liệu — vẫn do scope()/need() ở từng route quyết định),
 * theo TÍNH NĂNG (bật/tắt từng tính năng cho từng tài khoản) và theo THAO TÁC (Xem · Thêm · Sửa ·
 * Xoá · Tải tài liệu cho từng cấp × tính năng).
 *
 * Đây là lớp chặn BỔ SUNG, chạy trước mọi router (server.js): chỉ có thể THU HẸP quyền mà các route
 * vốn đã cho, không bao giờ mở rộng. Admin/BGĐ luôn toàn quyền.
 *
 * Tắt một tính năng (hoặc bỏ quyền "Xem") = ẩn khỏi menu + chặn mọi thao tác ghi của tính năng đó.
 * KHÔNG chặn đọc: nhiều màn khác đọc chung dữ liệu (Trang chủ đọc cơ hội, form giao việc đọc danh sách
 * cơ hội…), chặn đọc sẽ làm hỏng những màn không liên quan.
 */
export const FEATURES = [
  ['pipeline', 'Phễu bán hàng'], ['crm', 'Hồ sơ khách hàng'], ['prospect', 'Tìm khách & Thầu'], ['plans', 'Phương án KD'],
  ['saleskit', 'Tài liệu bán hàng'], ['tasks', 'Giao việc'], ['training', 'Đào tạo'], ['reports', 'Báo cáo'],
  ['kpi', 'KPI · Hoa hồng'], ['ai', 'AI trợ lý'], ['accounts', 'Quản trị tài khoản'],
];
export const OPS = ['Xem', 'Thêm', 'Sửa', 'Xoá', 'Tải tài liệu'];

/* Chuỗi 7 cấp + nhánh HCNS. `role` = vai trò tài khoản hiện có trong hệ thống; null = cấp mới chưa có
 * vai trò (Giám đốc bộ phận, Trưởng nhóm, Thực tập — sẽ thêm ở đợt sau). */
export const LEVELS = [
  ['admin', 'Admin', 'admin', 'Toàn công ty · lọc theo bộ phận, nhóm, chi nhánh', 'Thêm / sửa / xoá / dừng hoạt động bất kỳ tài khoản; cấp quyền cho mọi tài khoản'],
  ['bod', 'Ban Giám đốc', 'admin', 'Toàn công ty', 'Xem mọi báo cáo; duyệt cấp cao (Giám đốc chuyên môn); giao chỉ tiêu cho bộ phận'],
  ['gdbp', 'Giám đốc bộ phận', null, 'Dữ liệu, báo cáo của các phòng trong bộ phận', 'Giao chỉ tiêu, giao việc, nhắc nhở, thông báo'],
  ['tp', 'Trưởng phòng', 'manager', 'Dữ liệu, báo cáo của nhân viên trong phòng', 'Giao chỉ tiêu, giao việc, nhắc nhở; duyệt báo giá dưới ngưỡng'],
  ['tn', 'Trưởng nhóm', null, 'Dữ liệu, báo cáo của thành viên nhóm', 'Giao việc, nhắc nhở, thông báo trong nhóm'],
  ['nv', 'Nhân viên', 'sales', 'Chỉ dữ liệu của chính mình', 'Làm việc trên khách, cơ hội, việc của mình'],
  ['tts', 'Thực tập / Thử việc', null, 'Chỉ dữ liệu của chính mình', 'Chỉ xem và thêm khách của mình; không xoá, không tải tài liệu'],
  ['hcns', 'HCNS (nhánh riêng)', 'hr', 'Hồ sơ nhân sự', 'Tạo / sửa / xoá tài khoản; duyệt hợp đồng vòng 2; không xem số liệu kinh doanh'],
];
export const ROLE_LEVEL = { admin: 'admin', manager: 'tp', sales: 'nv', hr: 'hcns' };

/** Tính năng mặc định theo vai trò — khớp menu hiện có của từng vai trò. */
export function defaultFeat(role) {
  const all = Object.fromEntries(FEATURES.map(([k]) => [k, true]));
  if (role === 'admin') return all;
  if (role === 'hr') return Object.fromEntries(FEATURES.map(([k]) => [k, ['prospect', 'training', 'accounts'].includes(k)]));
  return { ...all, accounts: false };
}

/** Quyền thao tác MẶC ĐỊNH — phản ánh đúng những gì các route đang cho phép, để bảng phân quyền không
 * hứa quyền mà máy chủ không có (VD bảng giá chỉ Admin/BGĐ sửa được). */
export function defaultOps(lv, f) {
  if (['admin', 'bod'].includes(lv)) return [1, 1, 1, 1, 1];
  if (f === 'accounts') return lv === 'hcns' ? [1, 1, 1, 1, 1] : lv === 'tp' || lv === 'gdbp' ? [1, 0, 0, 0, 0] : [0, 0, 0, 0, 0];
  if (f === 'saleskit') return [1, 0, 0, 0, 1];
  if (lv === 'hcns') return f === 'training' ? [1, 1, 1, 1, 1] : f === 'prospect' ? [1, 1, 1, 0, 1] : f === 'plans' ? [1, 0, 1, 0, 1] : [0, 0, 0, 0, 0];
  if (lv === 'tts') return [1, f === 'crm' || f === 'tasks' || f === 'reports' ? 1 : 0, 0, 0, 0];
  return [1, 1, 1, 1, 1];
}

export const levelOf = (me) => ROLE_LEVEL[me?.role] || 'nv';

export function effFeat(perm, user) {
  return { ...defaultFeat(user.role), ...((perm.feat || {})[user.id] || {}) };
}
export function effOps(perm, lv, f) {
  const v = ((perm.ops || {})[lv] || {})[f];
  return Array.isArray(v) && v.length === 5 ? v.map(x => (x ? 1 : 0)) : defaultOps(lv, f);
}

/* Đường dẫn API → tính năng. Đường dẫn không có ở đây (phiên đăng nhập, thông báo, hồ sơ cá nhân,
 * hoạt động, thiết lập…) không chịu lớp chặn này. */
const PATH_FEATURE = [
  ['/api/deals', 'pipeline'], ['/api/daily-contacts', 'pipeline'],
  ['/api/customers', 'crm'], ['/api/leads', 'crm'], ['/api/partners', 'crm'], ['/api/contacts', 'crm'],
  ['/api/tenders', 'prospect'],
  ['/api/plans', 'plans'], ['/api/quotes', 'plans'], ['/api/contracts', 'plans'], ['/api/documents', 'plans'],
  ['/api/products', 'saleskit'], ['/api/product-lines', 'saleskit'], ['/api/templates', 'saleskit'],
  ['/api/tasks', 'tasks'],
  ['/api/trainings', 'training'],
  ['/api/reports', 'reports'],
  ['/api/kpi', 'kpi'], ['/api/commissions', 'kpi'], ['/api/pip', 'kpi'],
  ['/api/ai', 'ai'],
  ['/api/users', 'accounts'],
];
/* Đường dẫn nằm trong vùng một tính năng nhưng là quyền chung của mọi người — không chặn theo thao tác.
 * Đề xuất sản phẩm mới: nhân viên không sửa được bảng giá nhưng luôn được gửi đề xuất lên BGĐ. */
const EXEMPT = ['/api/products/propose'];
const featureOfPath = (path) => EXEMPT.includes(path) ? undefined
  : (PATH_FEATURE.find(([pre]) => path === pre || path.startsWith(pre + '/')) || [])[1];
/* Tải file gốc về máy — thao tác "Tải tài liệu". */
const isDownload = (method, path) => method === 'GET' && /\/(file|files\/[^/]+)$/.test(path);

/** Chặn request vượt quyền tính năng / thao tác. Gọi trước mọi router. */
export async function enforcePermissions(ctx) {
  const me = ctx.me;
  if (!me || me.role === 'admin') return;
  const path = ctx.url.pathname;
  const f = featureOfPath(path);
  if (!f) return;
  const method = ctx.request.method;
  const download = isDownload(method, path);
  if (method === 'GET' && !download) return;
  const perm = await getSetting(ctx.env, wsBucket(me), 'perm');
  const name = (FEATURES.find(x => x[0] === f) || [0, f])[1];
  if (!effFeat(perm, me)[f]) throw new HttpError(403, `Tài khoản của bạn chưa được cấp tính năng "${name}". Liên hệ Admin để được cấp quyền.`);
  const ops = effOps(perm, levelOf(me), f);
  const idx = download ? 4 : method === 'POST' ? 1 : method === 'DELETE' ? 3 : 2;
  if (!ops[0] || !ops[idx]) throw new HttpError(403, `Cấp của bạn chưa được quyền "${OPS[idx]}" ở tính năng "${name}".`);
}
