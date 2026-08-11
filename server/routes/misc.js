import { json, match, need, uid, now, readBody, isLead, audit, notify, num, str, wsScope, wsBucket, sameWorkspaceUser } from '../lib/util.js';
import { askAI, AI_TASKS, providerStatus, pickProvider, testProvider } from '../lib/ai.js';
import { getConfig } from '../lib/kpi.js';
import { vEmail, vPhone, vText, vPassword } from '../lib/validate.js';
import { hashPassword, newSetupToken, hashSetupToken } from '../lib/auth.js';

const SETUP_TOKEN_TTL = 48 * 3600; // 48 giờ — đủ để nhân sự nhận link qua Zalo/Slack rồi đặt mật khẩu

export async function miscRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Đào tạo ================= */
  if ((p = match(ctx, 'GET', '/api/trainings'))) {
    need(ctx);
    // Xem tiến độ của người khác chỉ khi CÙNG workspace — id khác workspace/không hợp lệ rơi về
    // chính người xem (không lộ tiến độ đào tạo của nhân sự thật cho tài khoản demo, và ngược lại).
    const targetUser = isLead(ctx.me) && url.searchParams.get('userId')
      ? await sameWorkspaceUser(env, ctx, url.searchParams.get('userId')) : null;
    const target = targetUser ? targetUser.id : ctx.me.id;
    const { results } = await env.DB.prepare(`SELECT t.*, tp.status prog_status, tp.progress, tp.completed_at
      FROM nv_trainings t LEFT JOIN nv_training_progress tp ON tp.training_id=t.id AND tp.user_id=?
      ORDER BY t.required DESC, t.category`).bind(target).all();
    let team = [];
    if (isLead(ctx.me)) {
      // Chỉ liệt kê tiến độ đào tạo của sales CÙNG workspace — không lộ tên nhân sự thật cho
      // tài khoản demo (và ngược lại) qua danh sách "team" của tab Đào tạo.
      const ws = wsScope(ctx, 'u.id');
      const { results: r2 } = await env.DB.prepare(`SELECT u.id,u.name, COUNT(tp.id) total, SUM(CASE WHEN tp.status='completed' THEN 1 ELSE 0 END) done
        FROM nv_users u LEFT JOIN nv_training_progress tp ON tp.user_id=u.id WHERE u.role='sales'${ws.sql} GROUP BY u.id,u.name`).bind(...ws.args).all();
      team = r2 || [];
    }
    return json({ items: results || [], team, targetUserId: target });
  }

  if ((p = match(ctx, 'POST', '/api/trainings/progress'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    if (!b.trainingId) return json({ error: 'Thiếu bài học' }, 400);
    const t = now();
    const status = ['assigned', 'in_progress', 'completed'].includes(b.status) ? b.status : 'in_progress';
    const prog = status === 'completed' ? 100 : num(b.progress, 30);
    const ex = await env.DB.prepare('SELECT id FROM nv_training_progress WHERE user_id=? AND training_id=?').bind(ctx.me.id, String(b.trainingId)).first();
    if (ex) await env.DB.prepare('UPDATE nv_training_progress SET status=?,progress=?,completed_at=?,updated_at=? WHERE id=?')
      .bind(status, prog, status === 'completed' ? t : null, t, ex.id).run();
    else await env.DB.prepare('INSERT INTO nv_training_progress (id,user_id,training_id,status,progress,assigned_by,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(uid('tp'), ctx.me.id, String(b.trainingId), status, prog, null, status === 'completed' ? t : null, t).run();
    return json({ ok: true });
  }

  if ((p = match(ctx, 'POST', '/api/trainings/assign'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    if (!b.userId || !b.trainingId) return json({ error: 'Thiếu nhân sự hoặc bài học' }, 400);
    const target = await sameWorkspaceUser(env, ctx, b.userId);
    if (!target) return json({ error: 'Không tìm thấy nhân sự' }, 404);
    const t = now();
    const ex = await env.DB.prepare('SELECT id FROM nv_training_progress WHERE user_id=? AND training_id=?').bind(target.id, String(b.trainingId)).first();
    if (!ex) await env.DB.prepare('INSERT INTO nv_training_progress (id,user_id,training_id,status,progress,assigned_by,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(uid('tp'), target.id, String(b.trainingId), 'assigned', 0, ctx.me.id, t).run();
    await notify(env, target.id, { type: 'training', title: '🎓 Bạn được giao khoá học bắt buộc', body: 'Vào mục Đào tạo để hoàn thành.', link: '#/training', level: 'warn' });
    return json({ ok: true });
  }

  if ((p = match(ctx, 'POST', '/api/trainings/new'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    if (!b.title || !b.url) return json({ error: 'Thiếu tiêu đề hoặc link video' }, 400);
    const id = uid('tr');
    await env.DB.prepare('INSERT INTO nv_trainings (id,title,category,url,duration_min,role_target,required,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, str(b.title, 160), str(b.category, 40) || 'Kỹ năng', str(b.url, 300), num(b.durationMin, 15), b.roleTarget === 'manager' ? 'manager' : 'sales', b.required ? 1 : 0, str(b.description, 500), now()).run();
    return json({ id });
  }

  /* ================= AI ================= */
  if ((p = match(ctx, 'GET', '/api/ai/tasks'))) {
    need(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM nv_ai_interactions WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(ctx.me.id).all();
    return json({ tasks: AI_TASKS, history: results || [], providers: providerStatus(env), active: pickProvider(env, 'auto').key });
  }

  if ((p = match(ctx, 'GET', '/api/ai/providers'))) {
    need(ctx);
    return json({ providers: providerStatus(env), active: pickProvider(env, 'auto').key });
  }

  if ((p = match(ctx, 'POST', '/api/ai/test'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    const r = await testProvider(env, String(b.provider || 'gemini'));
    await audit(env, ctx.me.id, 'ai_test', 'ai_provider', String(b.provider || ''), { ok: !!r.ok });
    return json(r, r.ok ? 200 : (r.missingSecret ? 503 : 502));
  }

  if ((p = match(ctx, 'POST', '/api/ai/chat'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const prompt = str(b.prompt, 1500) || '';
    if (!prompt && !b.kind) return json({ error: 'Vui lòng nhập nội dung' }, 400);
    const { results: products } = await env.DB.prepare('SELECT id,name,line,unit,price,commission_rate,max_discount,description FROM nv_products WHERE active=1').all();
    let customerName = null;
    if (b.customerId) customerName = (await env.DB.prepare('SELECT name FROM nv_customers WHERE id=?').bind(String(b.customerId)).first())?.name || null;
    const res = await askAI(env, {
      kind: b.kind, prompt, provider: b.provider,
      context: { products: products || [], userName: ctx.me.name, customerName, extra: str(b.extra, 800) || null },
    });
    await env.DB.prepare('INSERT INTO nv_ai_interactions (id,user_id,kind,prompt,response,created_at) VALUES (?,?,?,?,?,?)')
      .bind(uid('ai'), ctx.me.id, res.kind + (res.mock ? '' : '·' + res.provider), prompt.slice(0, 500), res.text.slice(0, 4000), now()).run();
    return json({ ...res, providers: providerStatus(env) });
  }

  /* ================= Cấu hình / Quản trị ================= */
  if ((p = match(ctx, 'GET', '/api/config'))) {
    need(ctx);
    const targetId = url.searchParams.get('userId') || null;
    // Chỉ hiện bản ĐANG hiệu lực; lịch sử vẫn nằm trong bảng để truy vết. Ngưỡng riêng theo user
    // chỉ hiện nếu user đó cùng workspace (demo/chính thức) với người xem — bản ghi chung
    // (user_id NULL) áp dụng cho mọi workspace nên luôn hiện.
    const ws = wsScope(ctx, 'user_id');
    const { results } = await env.DB.prepare(
      `SELECT * FROM nv_kpi_config WHERE valid_to IS NULL AND (user_id IS NULL OR (1=1${ws.sql})) ORDER BY user_id IS NULL DESC, ckey`)
      .bind(...ws.args).all();
    const eff = await getConfig(env, targetId);
    return json({ rows: results || [], effective: eff });
  }

  if ((p = match(ctx, 'POST', '/api/config'))) {
    need(ctx, ['admin', 'manager']);
    const b = await readBody(ctx.request);
    if (!b.key) return json({ error: 'Thiếu khoá cấu hình' }, 400);
    const userId = b.userId ? String(b.userId) : null;
    const value = typeof b.value === 'object' ? JSON.stringify(b.value) : String(b.value ?? '');
    const t = now();
    // Versioning: KHÔNG ghi đè bản cũ — đóng hiệu lực bản đang chạy rồi thêm bản mới.
    // Nhờ vậy KPI của kỳ đã qua vẫn tính theo ngưỡng đúng thời điểm đó.
    const ex = await env.DB.prepare(
      'SELECT id FROM nv_kpi_config WHERE ckey=? AND valid_to IS NULL AND ' + (userId ? 'user_id=?' : 'user_id IS NULL'))
      .bind(...(userId ? [String(b.key), userId] : [String(b.key)])).first();
    if (ex) await env.DB.prepare('UPDATE nv_kpi_config SET valid_to=? WHERE id=?').bind(t, ex.id).run();
    await env.DB.prepare('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at,valid_from,valid_to) VALUES (?,?,?,?,?,?,NULL)')
      .bind(uid('cfg'), userId, String(b.key), value, t, t).run();
    await audit(env, ctx.me.id, 'update_config', 'kpi_config', String(b.key), { userId, value: value.slice(0, 60) });
    try { await env.SHARED_KV?.delete('cfg:global'); } catch (e) { /* noop */ }
    return json({ ok: true });
  }

  if ((p = match(ctx, 'GET', '/api/users'))) {
    need(ctx, ['admin', 'manager']);
    // Chỉ liệt kê nhân sự CÙNG workspace (demo/chính thức) với người xem — tài khoản demo (mật
    // khẩu công khai trên màn đăng nhập) không được thấy tên/thông tin nhân sự chính thức thật.
    const { results } = await env.DB.prepare('SELECT id,name,email,role,title,phone,active,created_at FROM nv_users WHERE is_demo=? ORDER BY role, name').bind(wsBucket(ctx.me)).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/users'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    const uName = vText(b.name, 'Tên nhân sự', { max: 80, required: true, min: 2 });
    const uEmail = vEmail(b.email);
    // Mật khẩu: cho phép bỏ trống — Admin dùng liên kết thiết lập mật khẩu (setup-link) thay vì
    // tự gõ mật khẩu cho nhân sự, để không phải biết mật khẩu thật của họ.
    const uPassword = vPassword(b.password, 'Mật khẩu', { required: false });
    if (uEmail) {
      const dup = await env.DB.prepare('SELECT id FROM nv_users WHERE LOWER(email)=?').bind(uEmail.toLowerCase()).first();
      if (dup) return json({ error: `Email ${uEmail} đã được dùng cho tài khoản khác.` }, 409);
    }
    const id = uid('u');
    const passwordHash = uPassword ? await hashPassword(uPassword) : null;
    // Tài khoản mới kế thừa workspace của người tạo — Admin demo tạo thì vẫn là demo, Admin
    // chính thức tạo thì là chính thức. Không để lẫn 2 workspace ngay từ lúc tạo tài khoản.
    await env.DB.prepare('INSERT INTO nv_users (id,name,email,role,title,phone,active,created_at,password_hash,is_demo) VALUES (?,?,?,?,?,?,1,?,?,?)')
      .bind(id, uName, uEmail, ['sales', 'manager', 'admin'].includes(b.role) ? b.role : 'sales', str(b.title, 80), vPhone(b.phone), now(), passwordHash, wsBucket(ctx.me)).run();
    await audit(env, ctx.me.id, 'create', 'user', id, { name: b.name });
    return json({ id });
  }

  if ((p = match(ctx, 'PATCH', '/api/users/:id'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    const u = await env.DB.prepare('SELECT * FROM nv_users WHERE id=?').bind(p.id).first();
    // Coi như "không tồn tại" nếu khác workspace — Admin demo không được sửa/khoá tài khoản
    // chính thức thật (và ngược lại), kể cả khi biết đúng mã nhân viên.
    if (!u || wsBucket(u) !== wsBucket(ctx.me)) return json({ error: 'Không tìm thấy người dùng' }, 404);
    // Mật khẩu: bỏ trống = giữ nguyên, có nhập mới = đặt lại (dùng cho cả cấp tài khoản chính thức lần đầu)
    const newPassword = vPassword(b.password, 'Mật khẩu', { required: false });
    const passwordHash = newPassword ? await hashPassword(newPassword) : u.password_hash;
    await env.DB.prepare('UPDATE nv_users SET name=?,email=?,role=?,title=?,active=?,password_hash=? WHERE id=?')
      .bind(b.name != null ? str(b.name, 80) : u.name, b.email != null ? str(b.email, 120) : u.email,
        ['sales', 'manager', 'admin'].includes(b.role) ? b.role : u.role, b.title != null ? str(b.title, 80) : u.title,
        b.active != null ? (b.active ? 1 : 0) : u.active, passwordHash, p.id).run();
    await audit(env, ctx.me.id, 'update', 'user', p.id, { passwordReset: !!newPassword });
    return json({ ok: true });
  }

  /* ---- Liên kết thiết lập mật khẩu (dùng 1 lần) ----
     Cùng cơ chế phục vụ cả cấp tài khoản lần đầu (purpose=invite) lẫn quên mật khẩu
     (purpose=reset). App chưa có hạ tầng gửi email nên Admin tự gửi link qua kênh nội bộ. */
  if ((p = match(ctx, 'POST', '/api/users/:id/setup-link'))) {
    need(ctx, ['admin']);
    const u = await env.DB.prepare('SELECT id, is_demo FROM nv_users WHERE id=?').bind(p.id).first();
    // QUAN TRỌNG: chặn Admin demo tạo link đặt mật khẩu cho tài khoản chính thức (và ngược lại) —
    // nếu không, Admin demo (mật khẩu công khai) có thể tự cấp mật khẩu mới để CHIẾM tài khoản thật.
    if (!u || wsBucket(u) !== wsBucket(ctx.me)) return json({ error: 'Không tìm thấy người dùng' }, 404);
    const b = await readBody(ctx.request);
    const purpose = b.purpose === 'reset' ? 'reset' : 'invite';
    const token = newSetupToken();
    const t = now();
    await env.DB.prepare('INSERT INTO nv_password_setup_tokens (token_hash,user_id,purpose,created_by,expires_at,created_at) VALUES (?,?,?,?,?,?)')
      .bind(await hashSetupToken(token), p.id, purpose, ctx.me.id, t + SETUP_TOKEN_TTL, t).run();
    await audit(env, ctx.me.id, 'create_setup_link', 'user', p.id, { purpose });
    // Token gốc CHỈ xuất hiện trong response này — không log, không lưu lại ở đâu khác.
    return json({ token });
  }

  const setupTokenErr = () => json({ error: 'Liên kết không hợp lệ hoặc đã hết hạn' }, 400);

  if ((p = match(ctx, 'GET', '/api/setup-token/:token'))) {
    const row = await env.DB.prepare(
      `SELECT s.purpose, s.expires_at, s.used_at, u.name FROM nv_password_setup_tokens s
       JOIN nv_users u ON u.id = s.user_id WHERE s.token_hash=?`).bind(await hashSetupToken(p.token)).first();
    if (!row || row.used_at || Number(row.expires_at) < now()) return setupTokenErr();
    return json({ name: row.name, purpose: row.purpose });
  }

  if ((p = match(ctx, 'POST', '/api/setup-token/:token'))) {
    const tokenHash = await hashSetupToken(p.token);
    const row = await env.DB.prepare(
      'SELECT user_id, purpose, expires_at, used_at FROM nv_password_setup_tokens WHERE token_hash=?').bind(tokenHash).first();
    if (!row || row.used_at || Number(row.expires_at) < now()) return setupTokenErr();
    const b = await readBody(ctx.request);
    const password = vPassword(b.password, 'Mật khẩu', { required: true });
    const passwordHash = await hashPassword(password);
    const t = now();
    await env.DB.prepare('UPDATE nv_users SET password_hash=? WHERE id=?').bind(passwordHash, row.user_id).run();
    await env.DB.prepare('UPDATE nv_password_setup_tokens SET used_at=? WHERE token_hash=?').bind(t, tokenHash).run();
    // Huỷ mọi phiên hiện có của user — chặn chiếm quyền tài khoản nếu link bị lộ trước khi được dùng.
    await env.DB.prepare('DELETE FROM nv_sessions WHERE user_id=?').bind(row.user_id).run();
    await audit(env, row.user_id, 'password_set_via_link', 'user', row.user_id, { purpose: row.purpose });
    return json({ ok: true });
  }

  return null;
}
