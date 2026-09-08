/**
 * Cổng API — cho app ngoài (trước hết là app làm báo giá của NetViet) đọc/ghi dữ liệu Sales OS.
 *
 * Cách hoạt động: request tới `/api/v1/<đường dẫn>` mang theo `Authorization: Bearer <khoá>`.
 * Khoá được tra ra một TÀI KHOẢN THẬT (`acts_as`), rồi request được viết lại thành `/api/<đường
 * dẫn>` và chạy qua ĐÚNG các router sẵn có của app.
 *
 * Vì sao đi đường vòng thay vì viết SQL riêng cho từng endpoint: mọi lớp kiểm tra đang chạy đúng
 * của app (validate đầu vào, trần chiết khấu, luồng duyệt 2 vòng, scope theo workspace, audit
 * log) được áp dụng y hệt cho app ngoài mà không phải chép lại — chép lại là cách chắc chắn nhất
 * để hai đường vào cùng một nghiệp vụ trôi lệch nhau theo thời gian.
 *
 * Chốt chặn: ALLOWLIST bên dưới. Khoá API chỉ chạm được đúng các đường dẫn liệt kê ở đó —
 * thêm route mới cho app KHÔNG tự động mở ra ngoài Internet.
 */
import { json, match, need, uid, now, readBody, audit, str, wsBucket, needAccountManage } from '../lib/util.js';
import { sha256Hex } from '../lib/auth.js';
import { vText } from '../lib/validate.js';

/**
 * Đường dẫn khoá API được phép gọi, dạng [method, mẫu đường dẫn].
 * Mẫu dùng cùng cú pháp với match(): đoạn bắt đầu bằng ":" là tham số.
 * Chỉ mở những gì app báo giá thật sự cần — không mở người dùng, KPI, hoa hồng, báo cáo nhân sự.
 */
const ALLOWLIST = [
  ['GET', '/api/customers'],
  ['GET', '/api/customers/:id'],
  ['GET', '/api/partners'],
  ['GET', '/api/products'],
  ['GET', '/api/deals'],
  ['GET', '/api/quotes'],
  ['POST', '/api/quotes'],
  ['GET', '/api/contracts'],
];

/** Tiền tố nhận diện khoá — giúp người dùng phân biệt khoá của hệ thống này khi dán vào app khác. */
const KEY_PREFIX = 'nv_live_';
const PREFIX_SHOWN = 12; // "nv_live_" + 4 ký tự đầu, đủ để nhận ra khoá nào mà không lộ khoá

/** Sinh khoá API ngẫu nhiên 256-bit. Chỉ hiện đúng 1 lần lúc tạo, CSDL chỉ giữ bản băm. */
function newApiKey() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return KEY_PREFIX + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Đọc khoá API từ header. Khác readToken() của phiên đăng nhập vì khoá có dấu gạch dưới. */
function readApiKey(request) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9_]+)$/i.exec(h.trim());
  return m && m[1].startsWith(KEY_PREFIX) ? m[1] : null;
}

/** Đường dẫn `path` có nằm trong allowlist với `method` không. */
function isAllowed(method, path) {
  const parts = path.split('/').filter(Boolean);
  return ALLOWLIST.some(([m, pattern]) => {
    if (m !== method) return false;
    const q = pattern.split('/').filter(Boolean);
    if (q.length !== parts.length) return false;
    return q.every((seg, i) => seg[0] === ':' || seg === parts[i]);
  });
}

/**
 * Xử lý request qua cổng API. Trả về Response nếu đường dẫn thuộc cổng, null nếu không phải
 * (để server.js chạy tiếp các router thường).
 *
 * `runRouters` được truyền vào từ server.js thay vì import trực tiếp — tránh vòng lặp import
 * (server.js → gateway.js → các router → ...) và giữ gateway không phụ thuộc danh sách router.
 */
export async function gatewayRoutes(ctx, runRouters) {
  const { env, url, request } = ctx;
  if (!url.pathname.startsWith('/api/v1/')) return null;

  const key = readApiKey(request);
  if (!key) return json({ error: 'Thiếu khoá API. Gửi header: Authorization: Bearer <khoá>' }, 401);

  const row = await env.DB.prepare(
    `SELECT k.*, u.id uid, u.name uname, u.email uemail, u.role urole, u.title utitle, u.created_at ucreated, u.is_demo uis_demo
     FROM nv_api_keys k JOIN nv_users u ON u.id = k.acts_as
     WHERE k.key_hash = ? AND k.active = 1 AND u.active = 1`).bind(await sha256Hex(key)).first();
  if (!row) return json({ error: 'Khoá API không hợp lệ hoặc đã bị thu hồi' }, 401);

  const target = '/api' + url.pathname.slice('/api/v1'.length);
  if (!isAllowed(request.method, target)) {
    return json({ error: `Khoá API không được phép gọi ${request.method} ${url.pathname}` }, 403);
  }

  // Đếm lượt gọi để màn Cổng API hiển thị app nào đang dùng bao nhiêu. Lỗi ghi đếm không được
  // làm hỏng chính request nghiệp vụ — bọc try/catch như audit().
  try {
    await env.DB.prepare('UPDATE nv_api_keys SET call_count=call_count+1, last_used_at=?, last_path=? WHERE id=?')
      .bind(now(), request.method + ' ' + target, row.id).run();
  } catch (e) { console.error('api key counter', e); }

  // Danh tính "như thể" tài khoản acts_as đang thao tác — cùng hình dạng object mà resolveActor()
  // trả về, để scope()/need()/audit() phía dưới hoạt động y hệt request từ giao diện.
  // can_manage_accounts luôn false: khoá API không bao giờ được đụng vào tài khoản nhân sự.
  const innerCtx = {
    request, env,
    url: new URL(url.origin + target + url.search),
    me: {
      id: row.uid, name: row.uname, email: row.uemail, role: row.urole, title: row.utitle,
      created_at: row.ucreated, is_demo: !!row.uis_demo,
      must_change_password: false, can_manage_accounts: false, _via_api_key: row.id,
    },
  };
  const res = await runRouters(innerCtx);
  if (res) return res;
  return json({ error: 'Không tìm thấy API: ' + url.pathname }, 404);
}

/**
 * Quản lý khoá API — chạy trong luồng phiên đăng nhập bình thường (không qua cổng).
 * Giới hạn ở Admin có quyền quản lý tài khoản: khoá API cho phép hành động DƯỚI DANH NGHĨA một
 * nhân sự, nên phải cùng mức quyền với việc tạo/sửa tài khoản nhân sự.
 */
export async function apiKeyRoutes(ctx) {
  const { env } = ctx;
  let p;

  if ((p = match(ctx, 'GET', '/api/api-keys'))) {
    needAccountManage(ctx);
    const { results } = await env.DB.prepare(
      `SELECT k.id,k.name,k.prefix,k.acts_as,k.active,k.call_count,k.last_used_at,k.last_path,k.created_at,k.revoked_at,
              u.name acts_as_name
       FROM nv_api_keys k LEFT JOIN nv_users u ON u.id=k.acts_as
       WHERE u.is_demo=? ORDER BY k.active DESC, k.created_at DESC`).bind(wsBucket(ctx.me)).all();
    return json({ items: results || [], allowlist: ALLOWLIST.map(([m, path]) => ({ method: m, path: '/api/v1' + path.slice('/api'.length) })) });
  }

  if ((p = match(ctx, 'POST', '/api/api-keys'))) {
    needAccountManage(ctx);
    const b = await readBody(ctx.request);
    const name = vText(b.name, 'Tên app', { max: 80, required: true, min: 2 });
    // Khoá chạy dưới danh nghĩa ai: mặc định chính người tạo. Chỉ nhận tài khoản CÙNG workspace
    // và đang hoạt động — không để khoá của workspace demo đọc được dữ liệu thật, và ngược lại.
    let actsAs = ctx.me.id;
    if (b.actsAs && b.actsAs !== ctx.me.id) {
      const u = await env.DB.prepare('SELECT id,is_demo FROM nv_users WHERE id=? AND active=1').bind(str(b.actsAs, 40)).first();
      if (!u || wsBucket(u) !== wsBucket(ctx.me)) return json({ error: 'Không tìm thấy nhân sự để gán khoá' }, 404);
      actsAs = u.id;
    }
    const key = newApiKey();
    const id = uid('ak');
    await env.DB.prepare('INSERT INTO nv_api_keys (id,name,key_hash,prefix,scopes,acts_as,created_by,active,call_count,created_at) VALUES (?,?,?,?,?,?,?,1,0,?)')
      .bind(id, name, await sha256Hex(key), key.slice(0, PREFIX_SHOWN), '[]', actsAs, ctx.me.id, now()).run();
    await audit(env, ctx.me.id, 'create', 'api_key', id, { name, actsAs });
    // `key` chỉ xuất hiện ở response này — không log, không lưu lại ở đâu khác.
    return json({ id, key, prefix: key.slice(0, PREFIX_SHOWN) });
  }

  if ((p = match(ctx, 'DELETE', '/api/api-keys/:id'))) {
    needAccountManage(ctx);
    const cur = await env.DB.prepare(
      'SELECT k.* FROM nv_api_keys k JOIN nv_users u ON u.id=k.acts_as WHERE k.id=? AND u.is_demo=?')
      .bind(p.id, wsBucket(ctx.me)).first();
    if (!cur) return json({ error: 'Không tìm thấy khoá' }, 404);
    // Thu hồi (active=0) chứ không xoá hàng — giữ lại tên app và số lượt đã gọi để truy vết sau này.
    await env.DB.prepare('UPDATE nv_api_keys SET active=0, revoked_at=? WHERE id=?').bind(now(), p.id).run();
    await audit(env, ctx.me.id, 'revoke', 'api_key', p.id, { name: cur.name });
    return json({ ok: true });
  }

  return null;
}
