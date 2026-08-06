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

/** Data scope: sales chỉ thấy dữ liệu của mình. */
export function scope(ctx, col = 'owner_id') {
  if (isLead(ctx.me)) {
    const u = ctx.url.searchParams.get('userId');
    if (u && u !== 'all') return { sql: ` AND ${col} = ?`, args: [u] };
    return { sql: '', args: [] };
  }
  return { sql: ` AND ${col} = ?`, args: [ctx.me.id] };
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
