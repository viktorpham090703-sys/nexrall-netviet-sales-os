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

export const isLead = (me) => !!me && (me.role === 'manager' || me.role === 'admin');

export function need(ctx, roles) {
  if (!ctx.me) throw new HttpError(401, 'Chưa đăng nhập');
  if (roles && !roles.includes(ctx.me.role)) throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này');
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

export function todayKey(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}
export function monthKey(ts) {
  const d = ts ? new Date(ts * 1000) : new Date();
  return d.toISOString().slice(0, 7);
}
export function startOfDay(ts = Date.now() / 1000) {
  const d = new Date(ts * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
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
