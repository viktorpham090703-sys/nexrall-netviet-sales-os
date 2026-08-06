import { json, match, need, uid, now, readBody, isLead, audit, notify, num, str } from '../lib/util.js';
import { askAI, AI_TASKS, providerStatus, pickProvider, testProvider } from '../lib/ai.js';
import { getConfig } from '../lib/kpi.js';

export async function miscRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Đào tạo ================= */
  if ((p = match(ctx, 'GET', '/api/trainings'))) {
    need(ctx);
    const target = (isLead(ctx.me) && url.searchParams.get('userId')) || ctx.me.id;
    const { results } = await env.DB.prepare(`SELECT t.*, tp.status prog_status, tp.progress, tp.completed_at
      FROM nv_trainings t LEFT JOIN nv_training_progress tp ON tp.training_id=t.id AND tp.user_id=?
      ORDER BY t.required DESC, t.category`).bind(target).all();
    let team = [];
    if (isLead(ctx.me)) {
      const { results: r2 } = await env.DB.prepare(`SELECT u.id,u.name, COUNT(tp.id) total, SUM(CASE WHEN tp.status='completed' THEN 1 ELSE 0 END) done
        FROM nv_users u LEFT JOIN nv_training_progress tp ON tp.user_id=u.id WHERE u.role='sales' GROUP BY u.id,u.name`).all();
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
    const t = now();
    const ex = await env.DB.prepare('SELECT id FROM nv_training_progress WHERE user_id=? AND training_id=?').bind(String(b.userId), String(b.trainingId)).first();
    if (!ex) await env.DB.prepare('INSERT INTO nv_training_progress (id,user_id,training_id,status,progress,assigned_by,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(uid('tp'), String(b.userId), String(b.trainingId), 'assigned', 0, ctx.me.id, t).run();
    await notify(env, String(b.userId), { type: 'training', title: '🎓 Bạn được giao khoá học bắt buộc', body: 'Vào mục Đào tạo để hoàn thành.', link: '#/training', level: 'warn' });
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
    const { results } = await env.DB.prepare('SELECT * FROM nv_kpi_config ORDER BY user_id IS NULL DESC, ckey').all();
    const eff = await getConfig(env, targetId);
    return json({ rows: results || [], effective: eff });
  }

  if ((p = match(ctx, 'POST', '/api/config'))) {
    need(ctx, ['admin', 'manager']);
    const b = await readBody(ctx.request);
    if (!b.key) return json({ error: 'Thiếu khoá cấu hình' }, 400);
    const userId = b.userId ? String(b.userId) : null;
    const value = typeof b.value === 'object' ? JSON.stringify(b.value) : String(b.value ?? '');
    const ex = await env.DB.prepare('SELECT id FROM nv_kpi_config WHERE ckey=? AND ' + (userId ? 'user_id=?' : 'user_id IS NULL'))
      .bind(...(userId ? [String(b.key), userId] : [String(b.key)])).first();
    if (ex) await env.DB.prepare('UPDATE nv_kpi_config SET value=?,updated_at=? WHERE id=?').bind(value, now(), ex.id).run();
    else await env.DB.prepare('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,?,?,?,?)').bind(uid('cfg'), userId, String(b.key), value, now()).run();
    await audit(env, ctx.me.id, 'update_config', 'kpi_config', String(b.key), { userId, value: value.slice(0, 60) });
    try { await env.SHARED_KV?.delete('cfg:global'); } catch (e) { /* noop */ }
    return json({ ok: true });
  }

  if ((p = match(ctx, 'GET', '/api/users'))) {
    need(ctx, ['admin', 'manager']);
    const { results } = await env.DB.prepare('SELECT id,name,email,role,title,phone,active,created_at FROM nv_users ORDER BY role, name').all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/users'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    if (!b.name) return json({ error: 'Thiếu tên nhân sự' }, 400);
    const id = uid('u');
    await env.DB.prepare('INSERT INTO nv_users (id,name,email,role,title,phone,active,created_at) VALUES (?,?,?,?,?,?,1,?)')
      .bind(id, str(b.name, 80), str(b.email, 120), ['sales', 'manager', 'admin'].includes(b.role) ? b.role : 'sales', str(b.title, 80), str(b.phone, 30), now()).run();
    await audit(env, ctx.me.id, 'create', 'user', id, { name: b.name });
    return json({ id });
  }

  if ((p = match(ctx, 'PATCH', '/api/users/:id'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    const u = await env.DB.prepare('SELECT * FROM nv_users WHERE id=?').bind(p.id).first();
    if (!u) return json({ error: 'Không tìm thấy người dùng' }, 404);
    await env.DB.prepare('UPDATE nv_users SET name=?,email=?,role=?,title=?,active=? WHERE id=?')
      .bind(b.name != null ? str(b.name, 80) : u.name, b.email != null ? str(b.email, 120) : u.email,
        ['sales', 'manager', 'admin'].includes(b.role) ? b.role : u.role, b.title != null ? str(b.title, 80) : u.title,
        b.active != null ? (b.active ? 1 : 0) : u.active, p.id).run();
    await audit(env, ctx.me.id, 'update', 'user', p.id, {});
    return json({ ok: true });
  }

  return null;
}
