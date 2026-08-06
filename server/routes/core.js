import { json, match, need, uid, now, DAY, readBody, audit, isLead, startOfDay, todayKey, monthKey } from '../lib/util.js';
import { getConfig, computeKpi } from '../lib/kpi.js';

export async function coreRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* --- Bootstrap: danh sách tài khoản demo + người đang đăng nhập --- */
  if ((p = match(ctx, 'GET', '/api/bootstrap'))) {
    const { results: users } = await env.DB.prepare('SELECT id,name,email,role,title FROM nv_users WHERE active=1 ORDER BY CASE role WHEN "admin" THEN 1 WHEN "manager" THEN 2 ELSE 3 END, name').all();
    const cfg = await getConfig(env, ctx.me?.id);
    let unread = 0;
    if (ctx.me) unread = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_notifications WHERE user_id=? AND read=0').bind(ctx.me.id).first('n')) || 0;
    return json({ users, me: ctx.me || null, config: cfg, unread });
  }

  /* --- "Đăng nhập" demo: chọn tài khoản --- */
  if ((p = match(ctx, 'POST', '/api/session'))) {
    const b = await readBody(ctx.request);
    const u = await env.DB.prepare('SELECT id,name,email,role,title FROM nv_users WHERE id=? AND active=1').bind(String(b.userId || '')).first();
    if (!u) return json({ error: 'Tài khoản không tồn tại' }, 404);
    await audit(env, u.id, 'login', 'user', u.id, { via: 'demo-picker' });
    return json({ me: u });
  }

  /* --- Cockpit ngày --- */
  if ((p = match(ctx, 'GET', '/api/cockpit'))) {
    need(ctx);
    const me = ctx.me;
    const t = now(), sod = startOfDay(t);
    const cfg = await getConfig(env, me.id);
    const D = env.DB;
    const todayAct = await D.prepare('SELECT COUNT(*) n, SUM(CASE WHEN type="call" THEN 1 ELSE 0 END) c, SUM(CASE WHEN type="meeting" OR type="demo" THEN 1 ELSE 0 END) m FROM nv_activities WHERE user_id=? AND happened_at>=?').bind(me.id, sod).first();
    const todayDC = Number(await D.prepare('SELECT COUNT(*) n FROM nv_daily_contacts WHERE user_id=? AND created_at>=?').bind(me.id, sod).first('n')) || 0;
    const { results: tasks } = await D.prepare("SELECT t.*, u.name assigner_name FROM nv_tasks t LEFT JOIN nv_users u ON u.id=t.assigner_id WHERE t.user_id=? AND t.status!='done' ORDER BY CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.due_at").bind(me.id).all();
    const sla = cfg.sla_days || {};
    const { results: deals } = await D.prepare("SELECT d.*, c.name customer_name FROM nv_deals d LEFT JOIN nv_customers c ON c.id=d.customer_id WHERE d.owner_id=? AND d.status='open' ORDER BY d.last_activity_at ASC").bind(me.id).all();
    const risky = deals.filter(d => (t - (d.last_activity_at || 0)) > (sla[d.stage] || 5) * DAY)
      .map(d => ({ ...d, idleDays: Math.floor((t - (d.last_activity_at || 0)) / DAY) }));
    const reportToday = await D.prepare("SELECT id FROM nv_daily_reports WHERE user_id=? AND kind='day' AND period=?").bind(me.id, todayKey()).first();
    const { results: notis } = await D.prepare('SELECT * FROM nv_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 6').bind(me.id).all();
    const kpi = await computeKpi(env, me, monthKey());
    const pipeline = deals.reduce((s, d) => s + (d.value || 0) * (d.probability || 0) / 100, 0);

    const reminders = [];
    if (todayDC < (cfg.quota_daily_contacts || 8)) reminders.push({ level: 'warn', text: `Còn thiếu ${(cfg.quota_daily_contacts || 8) - todayDC} liên hệ mới để đạt định mức hôm nay.`, link: '#/activities' });
    if (risky.length) reminders.push({ level: 'danger', text: `${risky.length} deal vượt SLA – nguy cơ nguội, cần chăm ngay.`, link: '#/pipeline' });
    const pendingAssign = tasks.filter(x => x.assigner_id && !x.accepted_at);
    if (pendingAssign.length) reminders.push({ level: 'warn', text: `${pendingAssign.length} việc được giao chưa xác nhận nhận việc (SLA ${cfg.task_accept_sla_min || 120} phút).`, link: '#/tasks' });
    if (!reportToday && new Date().getUTCHours() >= 8) reminders.push({ level: 'info', text: 'Chưa nộp báo cáo cuối ngày (EOD).', link: '#/reports' });
    if (!reminders.length) reminders.push({ level: 'ok', text: 'Bạn đang bám sát kế hoạch. Giữ nhịp nhé!', link: '#/pipeline' });

    return json({
      greeting: greet(), today: todayKey(),
      quota: {
        contacts: { done: todayDC, target: cfg.quota_daily_contacts || 8 },
        calls: { done: Number(todayAct.c) || 0, target: cfg.quota_calls || 25 },
        meetings: { done: Number(todayAct.m) || 0, target: cfg.quota_meetings || 2 },
      },
      activitiesToday: Number(todayAct.n) || 0,
      tasks: tasks.slice(0, 6), taskCount: tasks.length,
      risky: risky.slice(0, 5), riskyCount: risky.length,
      pipeline, openDeals: deals.length,
      reportSubmitted: !!reportToday,
      kpi: { total: kpi.total, grade: kpi.grade, performance: kpi.performance, discipline: kpi.discipline, proactive: kpi.proactive },
      notifications: notis, reminders,
    });
  }

  /* --- Thông báo --- */
  if ((p = match(ctx, 'GET', '/api/notifications'))) {
    need(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM nv_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(ctx.me.id).all();
    return json({ items: results || [] });
  }
  if ((p = match(ctx, 'POST', '/api/notifications/read'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    if (b.id) await env.DB.prepare('UPDATE nv_notifications SET read=1 WHERE id=? AND user_id=?').bind(String(b.id), ctx.me.id).run();
    else await env.DB.prepare('UPDATE nv_notifications SET read=1 WHERE user_id=?').bind(ctx.me.id).run();
    return json({ ok: true });
  }

  /* --- Chống chụp màn: ghi log --- */
  if ((p = match(ctx, 'POST', '/api/audit/screen'))) {
    const b = await readBody(ctx.request);
    await audit(env, ctx.me?.id, 'screen_capture_suspect', 'screen', String(b.view || '').slice(0, 60), { reason: String(b.reason || '').slice(0, 80), ua: (ctx.request.headers.get('user-agent') || '').slice(0, 120) });
    return json({ ok: true });
  }
  if ((p = match(ctx, 'GET', '/api/audit'))) {
    need(ctx, ['admin', 'manager']);
    const { results } = await env.DB.prepare('SELECT a.*, u.name user_name FROM nv_audit_logs a LEFT JOIN nv_users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 120').all();
    return json({ items: results || [] });
  }

  /* --- Cron: nhắc SLA / việc quá hạn / báo cáo --- */
  if ((p = match(ctx, 'GET', '/api/__cron'))) {
    const t = now();
    const notify = [];
    const { results: overdueTasks } = await env.DB.prepare("SELECT t.*, u.name FROM nv_tasks t JOIN nv_users u ON u.id=t.user_id WHERE t.status!='done' AND t.due_at IS NOT NULL AND t.due_at < ? AND t.due_at > ?").bind(t, t - 2 * DAY).all();
    for (const task of overdueTasks || []) {
      notify.push({ userId: task.user_id, title: '⏰ Việc quá hạn', body: task.title, data: { link: '#/tasks' } });
    }
    return json({ notify, email: [] });
  }

  return null;
}

function greet() {
  const h = (new Date().getUTCHours() + 7) % 24;
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}
