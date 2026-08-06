import { json, match, need, uid, now, DAY, readBody, scope, isLead, audit, notify, num, str, todayKey, monthKey } from '../lib/util.js';
import { computeKpi, saveKpi, getConfig } from '../lib/kpi.js';

export async function workRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Task / Giao việc ================= */
  if ((p = match(ctx, 'GET', '/api/tasks'))) {
    need(ctx);
    const s = scope(ctx, 't.user_id');
    const { results } = await env.DB.prepare(`SELECT t.*, u.name user_name, a.name assigner_name, d.title deal_title
      FROM nv_tasks t LEFT JOIN nv_users u ON u.id=t.user_id LEFT JOIN nv_users a ON a.id=t.assigner_id LEFT JOIN nv_deals d ON d.id=t.deal_id
      WHERE 1=1${s.sql} ORDER BY CASE t.status WHEN 'done' THEN 2 ELSE 1 END, CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.due_at`).bind(...s.args).all();
    const t = now();
    const items = (results || []).map(x => ({
      ...x,
      overdue: x.status !== 'done' && x.due_at && x.due_at < t,
      acceptOverdue: !!x.assigner_id && !x.accepted_at && x.status !== 'done' && (t - x.created_at) > (x.accept_sla_min || 120) * 60,
    }));
    return json({ items });
  }

  if ((p = match(ctx, 'POST', '/api/tasks'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    if (!b.title) return json({ error: 'Vui lòng nhập tên công việc' }, 400);
    const assignTo = b.userId && isLead(ctx.me) ? String(b.userId) : ctx.me.id;
    const isAssignment = assignTo !== ctx.me.id;
    const cfg = await getConfig(env, assignTo);
    const t = now(), id = uid('tk');
    await env.DB.prepare('INSERT INTO nv_tasks (id,user_id,assigner_id,title,detail,type,priority,status,deal_id,customer_id,due_at,accept_sla_min,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, assignTo, isAssignment ? ctx.me.id : null, str(b.title, 160), str(b.detail, 800), isAssignment ? 'assignment' : 'task',
        ['high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium', 'todo', str(b.dealId, 40), str(b.customerId, 40),
        num(b.dueAt, t + DAY), num(b.acceptSlaMin, cfg.task_accept_sla_min || 120), t).run();
    if (isAssignment) {
      await notify(env, assignTo, { type: 'assignment', title: '📌 Bạn được giao việc mới', body: b.title, link: '#/tasks', level: 'warn' });
      await audit(env, ctx.me.id, 'assign_task', 'task', id, { to: assignTo });
    }
    return json({ id });
  }

  if ((p = match(ctx, 'PATCH', '/api/tasks/:id'))) {
    need(ctx);
    const task = await env.DB.prepare('SELECT * FROM nv_tasks WHERE id=?').bind(p.id).first();
    if (!task) return json({ error: 'Không tìm thấy công việc' }, 404);
    if (!isLead(ctx.me) && task.user_id !== ctx.me.id) return json({ error: 'Không có quyền' }, 403);
    const b = await readBody(ctx.request);
    const t = now();
    const status = ['todo', 'in_progress', 'done'].includes(b.status) ? b.status : task.status;
    const accepted = b.accept ? (task.accepted_at || t) : task.accepted_at;
    await env.DB.prepare('UPDATE nv_tasks SET status=?,accepted_at=?,done_at=?,detail=?,priority=?,due_at=? WHERE id=?')
      .bind(status, accepted, status === 'done' ? (task.done_at || t) : null,
        b.detail != null ? str(b.detail, 800) : task.detail,
        ['high', 'medium', 'low'].includes(b.priority) ? b.priority : task.priority,
        b.dueAt != null ? num(b.dueAt, task.due_at) : task.due_at, p.id).run();
    if (status === 'done' && task.assigner_id) {
      await notify(env, task.assigner_id, { type: 'assignment', title: '✅ Việc đã hoàn thành', body: task.title, link: '#/console', level: 'info' });
    }
    return json({ ok: true });
  }

  /* ================= Báo cáo EOD / tuần ================= */
  if ((p = match(ctx, 'GET', '/api/reports'))) {
    need(ctx);
    const s = scope(ctx, 'r.user_id');
    const { results } = await env.DB.prepare(`SELECT r.*, u.name user_name FROM nv_daily_reports r LEFT JOIN nv_users u ON u.id=r.user_id
      WHERE 1=1${s.sql} ORDER BY r.period DESC, r.submitted_at DESC LIMIT 60`).bind(...s.args).all();
    // Số liệu tự tổng hợp cho hôm nay
    const sod = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
    const a = await env.DB.prepare('SELECT COUNT(*) n, SUM(CASE WHEN type="call" THEN 1 ELSE 0 END) c, SUM(CASE WHEN type IN ("meeting","demo") THEN 1 ELSE 0 END) m FROM nv_activities WHERE user_id=? AND happened_at>=?').bind(ctx.me.id, sod).first();
    const dc = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_daily_contacts WHERE user_id=? AND created_at>=?').bind(ctx.me.id, sod).first('n')) || 0;
    const moved = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_deals WHERE owner_id=? AND stage_changed_at>=?').bind(ctx.me.id, sod).first('n')) || 0;
    const rev = Number(await env.DB.prepare("SELECT COALESCE(SUM(value),0) v FROM nv_deals WHERE owner_id=? AND status='won' AND won_at>=?").bind(ctx.me.id, sod).first('v')) || 0;
    const today = todayKey();
    const cfg = await getConfig(env, ctx.me.id);
    return json({
      items: results || [],
      draft: { period: today, calls: Number(a.c) || 0, meetings: Number(a.m) || 0, new_contacts: dc, deals_moved: moved, revenue: rev, activities: Number(a.n) || 0 },
      submittedToday: (results || []).some(r => r.user_id === ctx.me.id && r.kind === 'day' && r.period === today),
      deadlineHour: cfg.report_deadline_hour || 18,
    });
  }

  if ((p = match(ctx, 'POST', '/api/reports'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const kind = b.kind === 'week' ? 'week' : 'day';
    const period = str(b.period, 20) || todayKey();
    const cfg = await getConfig(env, ctx.me.id);
    const hourVN = (new Date().getUTCHours() + 7) % 24;
    const late = kind === 'day' && (period < todayKey() || hourVN >= (cfg.report_deadline_hour || 18) + 3) ? 1 : 0;
    const exist = await env.DB.prepare('SELECT id FROM nv_daily_reports WHERE user_id=? AND kind=? AND period=?').bind(ctx.me.id, kind, period).first();
    if (exist) {
      await env.DB.prepare('UPDATE nv_daily_reports SET calls=?,meetings=?,new_contacts=?,deals_moved=?,revenue=?,highlight=?,blocker=?,plan=?,submitted_at=? WHERE id=?')
        .bind(num(b.calls), num(b.meetings), num(b.newContacts), num(b.dealsMoved), num(b.revenue), str(b.highlight, 800), str(b.blocker, 800), str(b.plan, 800), now(), exist.id).run();
      return json({ id: exist.id, updated: true });
    }
    const id = uid('rp');
    await env.DB.prepare('INSERT INTO nv_daily_reports (id,user_id,kind,period,calls,meetings,new_contacts,deals_moved,revenue,highlight,blocker,plan,late,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, ctx.me.id, kind, period, num(b.calls), num(b.meetings), num(b.newContacts), num(b.dealsMoved), num(b.revenue),
        str(b.highlight, 800), str(b.blocker, 800), str(b.plan, 800), late, now()).run();
    return json({ id, late });
  }

  /* ================= KPI ================= */
  if ((p = match(ctx, 'GET', '/api/kpi'))) {
    need(ctx);
    const period = url.searchParams.get('period') || monthKey();
    const targetId = url.searchParams.get('userId');
    const uidTarget = (isLead(ctx.me) && targetId) ? targetId : ctx.me.id;
    const user = await env.DB.prepare('SELECT id,name,role FROM nv_users WHERE id=?').bind(uidTarget).first();
    if (!user) return json({ error: 'Không tìm thấy nhân sự' }, 404);
    const k = await computeKpi(env, user, period);
    const saved = await env.DB.prepare('SELECT manager_note FROM nv_kpi_scores WHERE user_id=? AND period=?').bind(uidTarget, period).first();
    const { results: comms } = await env.DB.prepare('SELECT c.*, d.title deal_title FROM nv_commissions c LEFT JOIN nv_deals d ON d.id=c.deal_id WHERE c.user_id=? AND c.period=? ORDER BY c.created_at DESC').bind(uidTarget, period).all();
    return json({ kpi: k, managerNote: saved?.manager_note || '', commissions: comms || [] });
  }

  if ((p = match(ctx, 'POST', '/api/kpi'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    const user = await env.DB.prepare('SELECT id,name FROM nv_users WHERE id=?').bind(String(b.userId || '')).first();
    if (!user) return json({ error: 'Không tìm thấy nhân sự' }, 404);
    const k = await computeKpi(env, user, str(b.period, 10) || monthKey());
    await saveKpi(env, k, str(b.note, 500));
    await notify(env, user.id, { type: 'kpi', title: 'TP đã chấm KPI kỳ ' + k.period, body: 'Tổng điểm ' + k.total + ' – xếp loại ' + k.grade, link: '#/kpi', level: 'info' });
    return json({ ok: true, kpi: k });
  }

  if ((p = match(ctx, 'GET', '/api/leaderboard'))) {
    need(ctx);
    const period = url.searchParams.get('period') || monthKey();
    const cacheKey = 'lb:' + period;
    try {
      const hit = await env.SHARED_KV?.get(cacheKey, 'json');
      if (hit) return json({ items: hit, cached: true });
    } catch (e) { /* KV optional */ }
    const { results: users } = await env.DB.prepare("SELECT id,name,role FROM nv_users WHERE role='sales' AND active=1").all();
    const items = [];
    for (const u of users || []) {
      const k = await computeKpi(env, u, period);
      items.push({ userId: u.id, name: u.name, total: k.total, grade: k.grade, revenue: k.metrics.revenue, wonN: k.metrics.wonN, newContacts: k.metrics.newContacts });
    }
    items.sort((a, b) => b.total - a.total);
    try { await env.SHARED_KV?.put(cacheKey, JSON.stringify(items), { expirationTtl: 60 }); } catch (e) { /* noop */ }
    return json({ items });
  }

  if ((p = match(ctx, 'GET', '/api/commissions'))) {
    need(ctx);
    const s = scope(ctx, 'c.user_id');
    const { results } = await env.DB.prepare(`SELECT c.*, d.title deal_title, u.name user_name FROM nv_commissions c
      LEFT JOIN nv_deals d ON d.id=c.deal_id LEFT JOIN nv_users u ON u.id=c.user_id WHERE 1=1${s.sql} ORDER BY c.created_at DESC LIMIT 100`).bind(...s.args).all();
    return json({ items: results || [] });
  }

  /* ================= PIP ================= */
  if ((p = match(ctx, 'GET', '/api/pip'))) {
    need(ctx);
    const s = scope(ctx, 'p.user_id');
    const { results } = await env.DB.prepare(`SELECT p.*, u.name user_name, m.name manager_name FROM nv_pip_records p
      LEFT JOIN nv_users u ON u.id=p.user_id LEFT JOIN nv_users m ON m.id=p.manager_id WHERE 1=1${s.sql} ORDER BY p.created_at DESC`).bind(...s.args).all();
    return json({ items: results || [] });
  }
  if ((p = match(ctx, 'POST', '/api/pip'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    if (!b.userId || !b.goal) return json({ error: 'Thiếu nhân sự hoặc mục tiêu' }, 400);
    const phase = ['30', '60', '90'].includes(String(b.phase)) ? String(b.phase) : '30';
    const t = now(), id = uid('pip');
    await env.DB.prepare('INSERT INTO nv_pip_records (id,user_id,manager_id,phase,goal,metric,start_at,end_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, String(b.userId), ctx.me.id, phase, str(b.goal, 600), str(b.metric, 300), t, t + Number(phase) * DAY, 'dang_chay', t).run();
    await notify(env, String(b.userId), { type: 'pip', title: 'Bạn được đưa vào chương trình cải thiện ' + phase + ' ngày', body: str(b.goal, 120), link: '#/kpi', level: 'danger' });
    return json({ id });
  }
  if ((p = match(ctx, 'PATCH', '/api/pip/:id'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    const st = ['dang_chay', 'dat', 'khong_dat', 'huy'].includes(b.status) ? b.status : 'dang_chay';
    const r = await env.DB.prepare('UPDATE nv_pip_records SET status=?, result_note=? WHERE id=?').bind(st, str(b.note, 500), p.id).run();
    if (!r.meta?.changes) return json({ error: 'Không tìm thấy bản ghi PIP' }, 404);
    return json({ ok: true });
  }

  /* ================= Console Trưởng phòng ================= */
  if ((p = match(ctx, 'GET', '/api/team'))) {
    need(ctx, ['manager', 'admin']);
    const period = url.searchParams.get('period') || monthKey();
    const t = now();
    const { results: users } = await env.DB.prepare("SELECT id,name,role,title FROM nv_users WHERE role='sales' AND active=1 ORDER BY name").all();
    const cfg = await getConfig(env);
    const sla = cfg.sla_days || {};
    const { results: deals } = await env.DB.prepare("SELECT d.*, c.name customer_name, u.name owner_name FROM nv_deals d LEFT JOIN nv_customers c ON c.id=d.customer_id LEFT JOIN nv_users u ON u.id=d.owner_id").all();
    const members = [];
    for (const u of users || []) {
      const k = await computeKpi(env, u, period);
      const mine = (deals || []).filter(d => d.owner_id === u.id);
      const overdue = mine.filter(d => d.status === 'open' && (t - (d.last_activity_at || 0)) > ((sla[d.stage] || 5) * DAY));
      members.push({
        ...u, kpi: { total: k.total, grade: k.grade, performance: k.performance, discipline: k.discipline, proactive: k.proactive },
        metrics: k.metrics, overdueDeals: overdue.length,
        pipeline: mine.filter(d => d.status === 'open').reduce((s, d) => s + d.value * d.probability / 100, 0),
      });
    }
    const funnel = ['lead_moi', 'tiep_can', 'nhu_cau', 'bao_gia', 'dam_phan', 'chot', 'trien_khai'].map(st => {
      const arr = (deals || []).filter(d => d.stage === st);
      return { stage: st, count: arr.length, value: arr.reduce((s, d) => s + (d.value || 0), 0) };
    });
    const alerts = [];
    (deals || []).forEach(d => {
      if (d.status === 'open' && (t - (d.last_activity_at || 0)) > ((sla[d.stage] || 5) * DAY)) {
        alerts.push({ level: 'danger', type: 'sla', text: `Deal "${d.title}" (${d.owner_name}) đã ${Math.floor((t - d.last_activity_at) / DAY)} ngày không hoạt động.`, link: '#/pipeline' });
      }
    });
    const { results: pendingQuotes } = await env.DB.prepare("SELECT q.*, u.name owner_name, c.name customer_name FROM nv_quotes q LEFT JOIN nv_users u ON u.id=q.owner_id LEFT JOIN nv_customers c ON c.id=q.customer_id WHERE q.status='pending' ORDER BY q.created_at DESC").all();
    (pendingQuotes || []).forEach(q => alerts.push({ level: 'warn', type: 'approval', text: `Báo giá "${q.title}" chiết khấu ${q.discount_pct}% chờ duyệt (${q.owner_name}).`, link: '#/saleskit' }));
    const { results: lateTasks } = await env.DB.prepare("SELECT t.*, u.name user_name FROM nv_tasks t LEFT JOIN nv_users u ON u.id=t.user_id WHERE t.status!='done' AND t.assigner_id IS NOT NULL AND t.accepted_at IS NULL").all();
    (lateTasks || []).forEach(x => {
      if ((t - x.created_at) > (x.accept_sla_min || 120) * 60) alerts.push({ level: 'danger', type: 'assignment', text: `${x.user_name} chưa nhận việc "${x.title}" quá SLA — cần leo thang.`, link: '#/tasks' });
    });
    const missing = [];
    for (const u of users || []) {
      const r = await env.DB.prepare("SELECT id FROM nv_daily_reports WHERE user_id=? AND kind='day' AND period=?").bind(u.id, todayKey(-1)).first();
      if (!r) missing.push(u.name);
    }
    if (missing.length) alerts.push({ level: 'warn', type: 'report', text: 'Chưa nộp báo cáo hôm qua: ' + missing.join(', '), link: '#/reports' });

    const totals = {
      pipeline: (deals || []).filter(d => d.status === 'open').reduce((s, d) => s + d.value * d.probability / 100, 0),
      won: (deals || []).filter(d => d.status === 'won').reduce((s, d) => s + d.value, 0),
      openCount: (deals || []).filter(d => d.status === 'open').length,
    };
    return json({ period, members, funnel, alerts, totals, pendingQuotes: pendingQuotes || [] });
  }

  return null;
}
