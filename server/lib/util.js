export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const now = () => Math.floor(Date.now() / 1000);
export const uid = (p = 'id') => p + '_' + crypto.randomUUID().slice(0, 12);
export const DAY = 86400;

export async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

/** Match method + path pattern (":param" segments). Returns params object or null. */
export function match(ctx, method, pattern) {
  if (ctx.request.method !== method) return null;
  const p = ctx.url.pathname.split('/').filter(Boolean);
  const q = pattern.split('/').filter(Boolean);
  if (p.length !== q.length) return null;
  const params = {};
  for (let i = 0; i < q.length; i++) {
    if (q[i][0] === ':') params[q[i].slice(1)] = decodeURIComponent(p[i]);
    else if (q[i] !== p[i]) return null;
  }
  return params;
}

/* Giám đốc (director) đã sáp nhập vào Admin/BGĐ — admin vừa duyệt vòng 1 khi cần vừa là người
 * duyệt vòng 2 báo giá. hr (HCNS) vẫn là vai trò riêng, duyệt vòng 2 hợp đồng — xếp chung nhóm
 * "lead" với manager/admin để hưởng cùng quyền xem đội/nav sẵn có; việc DUYỆT VÒNG NÀO thì gate
 * riêng bằng role cụ thể ngay tại API duyệt, không trộn vào đây. */
export const isLead = (me) => !!me && LEAD_ROLES.includes(me.role);
export const LEAD_ROLES = ['manager', 'admin', 'hr'];

export function need(ctx, roles) {
  if (!ctx.me) throw new HttpError(401, 'Chưa đăng nhập');
  if (roles && !roles.includes(ctx.me.role)) throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này');
  return ctx.me;
}

/** Thêm/khoá tài khoản, đổi vai trò, đặt/reset mật khẩu nhân sự khác — không phải mọi role='admin'
 * đều được làm việc này (xem cột can_manage_accounts trên nv_users, migration 32). */
export function needAccountManage(ctx) {
  need(ctx, ['admin']);
  if (!ctx.me.can_manage_accounts) throw new HttpError(403, 'Tài khoản Admin của bạn không có quyền quản lý tài khoản nhân sự khác');
  return ctx.me;
}

/**
 * "Workspace" (demo/chính thức) của actor: 1 = demo, 0 = chính thức. Nguồn sự thật DUY NHẤT
 * cho quy tắc bucket này — mọi nơi cần lọc theo workspace phải gọi qua đây (hoặc wsScope/
 * sameWorkspaceUser/inSameWorkspace bên dưới), không tự viết `me.is_demo ? 1 : 0` lại lần nữa,
 * vì mỗi bản sao thủ công là một chỗ có thể bị bỏ sót khi thêm route mới.
 */
export const wsBucket = (me) => (me?.is_demo ? 1 : 0);

/** Điều kiện SQL giới hạn cột `col` (chứa user id) vào đúng workspace của actor — dùng cho các
 * truy vấn liệt kê không đi qua scope() (audit log, danh sách nhân sự, cấu hình, leaderboard…). */
export function wsScope(ctx, col) {
  return { sql: ` AND ${col} IN (SELECT id FROM nv_users WHERE is_demo=?)`, args: [wsBucket(ctx.me)] };
}

/**
 * Data scope: sales chỉ thấy dữ liệu của mình; TP/Admin thấy dữ liệu của CẢ WORKSPACE
 * (đội của họ) — nhưng bị giới hạn trong đúng workspace demo/chính thức của chính họ
 * (theo cột is_demo trên nv_users), để dữ liệu mẫu demo không lẫn vào dữ liệu thật và
 * ngược lại. "Workspace" ở đây tái dùng is_demo có sẵn thay vì thêm organization_id mới.
 */
export function scope(ctx, col = 'owner_id') {
  if (isLead(ctx.me)) {
    const ws = wsScope(ctx, col);
    const u = ctx.url.searchParams.get('userId');
    if (u && u !== 'all') return { sql: ` AND ${col} = ?` + ws.sql, args: [u, ...ws.args] };
    return ws;
  }
  return { sql: ` AND ${col} = ?`, args: [ctx.me.id] };
}

/** Bản ghi có user_id=`userId` có cùng workspace với actor không — dùng để chặn thao tác lên
 * bản ghi đã tồn tại (KPI, hoa hồng, PIP…) do 1 user khác sở hữu, không tin `col` phía SQL. */
export async function inSameWorkspace(env, ctx, userId) {
  if (!userId) return false;
  const row = await env.DB.prepare('SELECT is_demo FROM nv_users WHERE id=?').bind(String(userId)).first();
  return !!row && wsBucket(row) === wsBucket(ctx.me);
}

/** Tra 1 user ACTIVE cùng workspace với actor — dùng khi client gửi thẳng 1 id để GÁN việc/khách
 * hàng/deal/PIP (ownerId/userId/assignTo…). Trả về hàng {id,name,role,created_at,is_demo} nếu hợp
 * lệ, null nếu không tồn tại / đã khoá / khác workspace (fail-safe: không tin id client gửi lên). */
export async function sameWorkspaceUser(env, ctx, userId) {
  if (!userId) return null;
  const row = await env.DB.prepare('SELECT id,name,role,created_at,is_demo FROM nv_users WHERE id=? AND active=1').bind(String(userId)).first();
  if (!row || wsBucket(row) !== wsBucket(ctx.me)) return null;
  return row;
}

/** TP/Admin có thể gán bản ghi mới cho 1 người khác cùng workspace qua `requestedId`; nếu
 * không phải lead hoặc không gửi id, trả về null (gọi nơi dùng sẽ tự fallback về ctx.me.id). */
export async function resolveAssignableOwner(env, ctx, requestedId) {
  return isLead(ctx.me) && requestedId ? await sameWorkspaceUser(env, ctx, requestedId) : null;
}

/** Lấy user theo id, coi như 404 nếu không tồn tại hoặc khác workspace với actor — dùng để
 * chặn 1 Admin/TP thao tác lên tài khoản của workspace khác (demo vs. chính thức). */
export async function requireSameWorkspaceUser(env, ctx, id) {
  const row = await env.DB.prepare('SELECT * FROM nv_users WHERE id=?').bind(id).first();
  if (!row || wsBucket(row) !== wsBucket(ctx.me)) return null;
  return row;
}

/**
 * Lệch múi giờ vận hành: NetViet chạy theo giờ VN (UTC+7). Mọi mốc "ngày/tháng" nghiệp vụ —
 * định mức ngày (M1), kỳ báo cáo EOD & hạn 17h30 (M6), kỳ KPI/hoa hồng (M7) — phải cắt theo
 * giờ VN chứ không theo UTC. Trước đây các hàm dưới đây dùng UTC nên "hôm nay" chỉ đổi lúc
 * 07:00 giờ VN: báo cáo nộp lúc 6h sáng hôm sau vẫn bị ghi vào ngày hôm trước VÀ được tính
 * ĐÚNG HẠN dù đã quá mốc 17h30 hơn 12 tiếng (mất hiệu lực điểm kỷ luật KL01).
 */
export const TZ_OFFSET = 7 * 3600;

/** Ngày làm việc hiện tại theo giờ VN, dạng YYYY-MM-DD. `offset` tính bằng ngày. */
export function todayKey(offset = 0) {
  return new Date((now() + TZ_OFFSET + offset * 86400) * 1000).toISOString().slice(0, 10);
}
/** Tham số ?period= trên query string, mặc định về kỳ tháng hiện tại nếu không truyền. */
export const periodParam = (url) => url.searchParams.get('period') || monthKey();

/** Kỳ tháng theo giờ VN, dạng YYYY-MM. */
export function monthKey(ts) {
  const base = ts != null && ts !== '' ? Number(ts) : now();
  return new Date((base + TZ_OFFSET) * 1000).toISOString().slice(0, 7);
}
/** Mốc 00:00 giờ VN của ngày chứa `ts` — trả về epoch giây (UTC) để so với các cột thời gian. */
export function startOfDay(ts = now()) {
  const shifted = Math.floor(Number(ts)) + TZ_OFFSET;
  return shifted - ((shifted % 86400) + 86400) % 86400 - TZ_OFFSET;
}

export async function audit(env, userId, action, entity, entityId, meta) {
  try {
    await env.DB.prepare('INSERT INTO nv_audit_logs (id,user_id,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(uid('au'), userId || null, action, entity || null, entityId || null, meta ? JSON.stringify(meta) : null, now()).run();
  } catch (e) { console.error('audit', e); }
}

export async function notify(env, userId, { type, title, body, link, level }) {
  await env.DB.prepare('INSERT INTO nv_notifications (id,user_id,type,title,body,link,level,read,created_at) VALUES (?,?,?,?,?,?,?,0,?)')
    .bind(uid('nt'), userId, type || 'info', title, body || null, link || null, level || 'info', now()).run();
}

export const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
export const str = (v, max = 2000) => (v == null ? null : String(v).slice(0, max));
