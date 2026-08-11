import { json, match, need, uid, now, DAY, readBody, scope, isLead, audit, notify, num, str, todayKey, monthKey, wsBucket, wsScope, sameWorkspaceUser, inSameWorkspace } from '../lib/util.js';
import { computeKpi, saveKpi, getConfig } from '../lib/kpi.js';
import { vCount, vMoney, vText, vFutureTs, vPeriod } from '../lib/validate.js';

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
    const taskTitle = vText(b.title, 'Tên công việc', { max: 160, required: true, min: 2 });
    // Chỉ gán được cho nhân sự CÙNG workspace (demo/chính thức) — id khác workspace/không active
    // coi như không gán, rơi về chính người tạo (fail-safe, không tin id client gửi lên).
    const assignee = b.userId && isLead(ctx.me) ? await sameWorkspaceUser(env, ctx, b.userId) : null;
    const assignTo = assignee ? assignee.id : ctx.me.id;
    const isAssignment = assignTo !== ctx.me.id;
    const cfg = await getConfig(env, assignTo);
    const t = now(), id = uid('tk');
    // vCount trả 0 cho cả "không nhập" lẫn "nhập 0" — dùng `!= null` để phân biệt "0 phút" (nhận
    // ngay) khỏi "không nhập" (dùng SLA mặc định), tránh `|| default` âm thầm ghi đè giá trị 0 hợp lệ.
    const acceptSla = b.acceptSlaMin != null ? vCount(b.acceptSlaMin, 'SLA nhận việc', { max: 10080 }) : (cfg.task_accept_sla_min || 120);
    await env.DB.prepare('INSERT INTO nv_tasks (id,user_id,assigner_id,title,detail,type,priority,status,deal_id,customer_id,due_at,accept_sla_min,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, assignTo, isAssignment ? ctx.me.id : null, taskTitle, str(b.detail, 800), isAssignment ? 'assignment' : 'task',
        ['high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium', 'todo', str(b.dealId, 40), str(b.customerId, 40),
        vFutureTs(b.dueAt, t + DAY, 'Hạn xử lý'), acceptSla, t).run();
    if (isAssignment) {
      await notify(env, assignTo, { type: 'assignment', title: '📌 Bạn được giao việc mới', body: taskTitle, link: '#/tasks', level: 'warn' });
      await audit(env, ctx.me.id, 'assign_task', 'task', id, { to: assignTo });
    }
    return json({ id });
  }

  if ((p = match(ctx, 'PATCH', '/api/tasks/:id'))) {
    need(ctx);
    // scope() vừa giới hạn sales chỉ sửa việc của chính mình, vừa giới hạn TP/Admin trong đúng
    // workspace (demo/chính thức) — không sửa/khoá được việc của nhân sự workspace khác.
    const s = scope(ctx, 'user_id');
    const task = await env.DB.prepare('SELECT * FROM nv_tasks WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!task) return json({ error: 'Không tìm thấy công việc' }, 404);
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

  /** Xoá việc — người nhận xoá được việc tự tạo; việc do cấp trên giao chỉ cấp trên mới xoá. */
  if ((p = match(ctx, 'DELETE', '/api/tasks/:id'))) {
    need(ctx);
    const s = scope(ctx, 'user_id');
    const task = await env.DB.prepare('SELECT * FROM nv_tasks WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!task) return json({ error: 'Không tìm thấy công việc' }, 404);
    if (task.assigner_id && !isLead(ctx.me)) return json({ error: 'Việc do cấp trên giao — bạn không thể xoá. Hãy nêu lý do hoàn trả.' }, 403);
    await env.DB.prepare('DELETE FROM nv_tasks WHERE id=?').bind(p.id).run();
    await audit(env, ctx.me.id, 'delete', 'task', p.id, { title: task.title });
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
      deadlineHour: cfg.report_deadline_hour || 17.5,
    });
  }

  if ((p = match(ctx, 'POST', '/api/reports'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const kind = b.kind === 'week' ? 'week' : 'day';
    const period = vPeriod(b.period, todayKey());
    const cfg = await getConfig(env, ctx.me.id);
    // Giờ VN dạng thập phân để so được mốc 17h30 (17.5)
    const d0 = new Date();
    const hourVN = ((d0.getUTCHours() + 7) % 24) + d0.getUTCMinutes() / 60;
    const late = kind === 'day' && (period < todayKey() || hourVN >= (cfg.report_deadline_hour || 17.5)) ? 1 : 0;
    const exist = await env.DB.prepare('SELECT id FROM nv_daily_reports WHERE user_id=? AND kind=? AND period=?').bind(ctx.me.id, kind, period).first();
    if (exist) {
      await env.DB.prepare('UPDATE nv_daily_reports SET calls=?,meetings=?,new_contacts=?,deals_moved=?,revenue=?,highlight=?,blocker=?,plan=?,submitted_at=? WHERE id=?')
        .bind(vCount(b.calls, 'Số cuộc gọi'), vCount(b.meetings, 'Số buổi gặp'), vCount(b.newContacts, 'Liên hệ mới'),
          vCount(b.dealsMoved, 'Deal chuyển giai đoạn'), vMoney(b.revenue, 'Doanh thu'),
          str(b.highlight, 800), str(b.blocker, 800), str(b.plan, 800), now(), exist.id).run();
      return json({ id: exist.id, updated: true });
    }
    const id = uid('rp');
    await env.DB.prepare('INSERT INTO nv_daily_reports (id,user_id,kind,period,calls,meetings,new_contacts,deals_moved,revenue,highlight,blocker,plan,late,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, ctx.me.id, kind, period, vCount(b.calls, 'Số cuộc gọi'), vCount(b.meetings, 'Số buổi gặp'),
        vCount(b.newContacts, 'Liên hệ mới'), vCount(b.dealsMoved, 'Deal chuyển giai đoạn'), vMoney(b.revenue, 'Doanh thu'),
        str(b.highlight, 800), str(b.blocker, 800), str(b.plan, 800), late, now()).run();
    return json({ id, late });
  }

  /* ================= KPI ================= */
  if ((p = match(ctx, 'GET', '/api/kpi'))) {
    need(ctx);
    const period = url.searchParams.get('period') || monthKey();
    const targetId = url.searchParams.get('userId');
    // Xem KPI/hoa hồng của người khác chỉ khi CÙNG workspace (demo/chính thức) — nếu không, coi
    // như không tìm thấy (không lộ KPI/note/hoa hồng của nhân sự thật cho tài khoản demo).
    let user;
    if (isLead(ctx.me) && targetId) {
      user = await sameWorkspaceUser(env, ctx, targetId);
      if (!user) return json({ error: 'Không tìm thấy nhân sự' }, 404);
    } else {
      user = await env.DB.prepare('SELECT id,name,role,created_at FROM nv_users WHERE id=?').bind(ctx.me.id).first();
    }
    const k = await computeKpi(env, user, period);
    const saved = await env.DB.prepare('SELECT manager_note FROM nv_kpi_scores WHERE user_id=? AND period=?').bind(user.id, period).first();
    const { results: comms } = await env.DB.prepare('SELECT c.*, d.title deal_title FROM nv_commissions c LEFT JOIN nv_deals d ON d.id=c.deal_id WHERE c.user_id=? AND c.period=? ORDER BY c.created_at DESC').bind(user.id, period).all();
    return json({ kpi: k, managerNote: saved?.manager_note || '', commissions: comms || [] });
  }

  if ((p = match(ctx, 'POST', '/api/kpi'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    const user = await sameWorkspaceUser(env, ctx, b.userId);
    if (!user) return json({ error: 'Không tìm thấy nhân sự' }, 404);
    const k = await computeKpi(env, user, str(b.period, 10) || monthKey());
    await saveKpi(env, k, str(b.note, 500));
    await notify(env, user.id, { type: 'kpi', title: 'TP đã chấm KPI kỳ ' + k.period, body: 'Tổng điểm ' + k.total + ' – xếp loại ' + k.grade, link: '#/kpi', level: 'info' });
    return json({ ok: true, kpi: k });
  }

  if ((p = match(ctx, 'GET', '/api/leaderboard'))) {
    need(ctx);
    const period = url.searchParams.get('period') || monthKey();
    // Bảng xếp hạng chỉ tính trong đúng workspace (demo/chính thức) của người xem — cache key
    // phải tách theo workspace, nếu không kết quả demo có thể bị trả nhầm cho tài khoản thật.
    const bucket = wsBucket(ctx.me);
    const cacheKey = 'lb:' + period + ':' + bucket;
    try {
      const hit = await env.SHARED_KV?.get(cacheKey, 'json');
      if (hit) return json({ items: hit, cached: true });
    } catch (e) { /* KV optional */ }
    const { results: users } = await env.DB.prepare("SELECT id,name,role FROM nv_users WHERE role='sales' AND active=1 AND is_demo=?").bind(bucket).all();
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

  /**
   * Đổi trạng thái chi hoa hồng (BL-11: hoa hồng chỉ chốt khi khách thanh toán đủ).
   * du_kien → da_duyet (đã xác nhận thanh toán) → da_chi (đã trả lương). Chỉ TP/Admin.
   */
  if ((p = match(ctx, 'PATCH', '/api/commissions/:id'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    const st = ['du_kien', 'da_duyet', 'da_chi', 'huy'].includes(b.status) ? b.status : null;
    if (!st) return json({ error: 'Trạng thái hoa hồng không hợp lệ' }, 400);
    const c = await env.DB.prepare('SELECT * FROM nv_commissions WHERE id=?').bind(p.id).first();
    if (!c || !(await inSameWorkspace(env, ctx, c.user_id))) return json({ error: 'Không tìm thấy bản ghi hoa hồng' }, 404);
    if (c.status === 'da_chi' && st !== 'da_chi') return json({ error: 'Hoa hồng đã chi không thể đổi trạng thái.' }, 409);
    if (st === 'da_duyet' || st === 'da_chi') {
      const d = await env.DB.prepare('SELECT status FROM nv_deals WHERE id=?').bind(c.deal_id).first();
      if (d?.status !== 'won') return json({ error: 'Chỉ duyệt/chi hoa hồng cho deal đã chốt.' }, 409);
    }
    await env.DB.prepare('UPDATE nv_commissions SET status=? WHERE id=?').bind(st, p.id).run();
    await audit(env, ctx.me.id, 'commission_status', 'commission', p.id, { from: c.status, to: st, amount: c.amount });
    if (st === 'da_chi') await notify(env, c.user_id, { type: 'kpi', title: '💰 Hoa hồng đã được chi', body: 'Số tiền ' + new Intl.NumberFormat('vi-VN').format(c.amount) + ' đ', link: '#/kpi', level: 'info' });
    return json({ ok: true });
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
    if (!b.goal) return json({ error: 'Thiếu mục tiêu' }, 400);
    const target = await sameWorkspaceUser(env, ctx, b.userId);
    if (!target) return json({ error: 'Không tìm thấy nhân sự' }, 404);
    const phase = ['30', '60', '90'].includes(String(b.phase)) ? String(b.phase) : '30';
    const t = now(), id = uid('pip');
    await env.DB.prepare('INSERT INTO nv_pip_records (id,user_id,manager_id,phase,goal,metric,start_at,end_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, target.id, ctx.me.id, phase, str(b.goal, 600), str(b.metric, 300), t, t + Number(phase) * DAY, 'dang_chay', t).run();
    await notify(env, target.id, { type: 'pip', title: 'Bạn được đưa vào chương trình cải thiện ' + phase + ' ngày', body: str(b.goal, 120), link: '#/kpi', level: 'danger' });
    return json({ id });
  }
  if ((p = match(ctx, 'PATCH', '/api/pip/:id'))) {
    need(ctx, ['manager', 'admin']);
    const pip = await env.DB.prepare('SELECT user_id FROM nv_pip_records WHERE id=?').bind(p.id).first();
    if (!pip || !(await inSameWorkspace(env, ctx, pip.user_id))) return json({ error: 'Không tìm thấy bản ghi PIP' }, 404);
    const b = await readBody(ctx.request);
    const st = ['dang_chay', 'dat', 'khong_dat', 'huy'].includes(b.status) ? b.status : 'dang_chay';
    await env.DB.prepare('UPDATE nv_pip_records SET status=?, result_note=? WHERE id=?').bind(st, str(b.note, 500), p.id).run();
    return json({ ok: true });
  }

  /* ================= Console Trưởng phòng ================= */
  if ((p = match(ctx, 'GET', '/api/team'))) {
    need(ctx, ['manager', 'admin']);
    const period = url.searchParams.get('period') || monthKey();
    const t = now();
    // Đội nhóm chỉ gồm sales CÙNG workspace (demo/chính thức) với TP/Admin đang xem — tránh
    // Console đội của tài khoản thật bị trộn số liệu mẫu demo, và ngược lại.
    const bucket = wsBucket(ctx.me);
    const { results: users } = await env.DB.prepare("SELECT id,name,role,title FROM nv_users WHERE role='sales' AND active=1 AND is_demo=? ORDER BY name").bind(bucket).all();
    const cfg = await getConfig(env);
    const sla = cfg.sla_days || {};
    const wsDeals = wsScope(ctx, 'd.owner_id');
    const { results: deals } = await env.DB.prepare(`SELECT d.*, c.name customer_name, u.name owner_name FROM nv_deals d LEFT JOIN nv_customers c ON c.id=d.customer_id LEFT JOIN nv_users u ON u.id=d.owner_id WHERE 1=1${wsDeals.sql}`).bind(...wsDeals.args).all();
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
    const wsQuotes = wsScope(ctx, 'q.owner_id');
    const { results: pendingQuotes } = await env.DB.prepare(`SELECT q.*, u.name owner_name, c.name customer_name FROM nv_quotes q LEFT JOIN nv_users u ON u.id=q.owner_id LEFT JOIN nv_customers c ON c.id=q.customer_id WHERE q.status='pending'${wsQuotes.sql} ORDER BY q.created_at DESC`).bind(...wsQuotes.args).all();
    (pendingQuotes || []).forEach(q => alerts.push({ level: 'warn', type: 'approval', text: `Báo giá "${q.title}" chiết khấu ${q.discount_pct}% chờ duyệt (${q.owner_name}).`, link: '#/saleskit' }));
    const wsTasks = wsScope(ctx, 't.user_id');
    const { results: lateTasks } = await env.DB.prepare(`SELECT t.*, u.name user_name FROM nv_tasks t LEFT JOIN nv_users u ON u.id=t.user_id WHERE t.status!='done' AND t.assigner_id IS NOT NULL AND t.accepted_at IS NULL${wsTasks.sql}`).bind(...wsTasks.args).all();
    (lateTasks || []).forEach(x => {
      if ((t - x.created_at) > (x.accept_sla_min || 120) * 60) alerts.push({ level: 'danger', type: 'assignment', text: `${x.user_name} chưa nhận việc "${x.title}" quá SLA — cần leo thang.`, link: '#/tasks' });
    });
    /* --- Cảnh báo PIP tự động (FR-M8-3): < ngưỡng% định mức liên hệ mới trong N ngày --- */
    const pipRatio = Number(cfg.pip_quota_ratio ?? 0.7);
    const pipWindow = Number(cfg.pip_window_days ?? 14);
    const winFrom = t - pipWindow * DAY;
    const wsPips = wsScope(ctx, 'user_id');
    const { results: openPips } = await env.DB.prepare(`SELECT user_id FROM nv_pip_records WHERE status='dang_chay'${wsPips.sql}`).bind(...wsPips.args).all();
    const onPip = new Set((openPips || []).map(x => x.user_id));
    for (const u of users || []) {
      if (onPip.has(u.id)) continue; // đang trong PIP rồi thì không cảnh báo lại
      const ucfg = await getConfig(env, u.id);
      const perDay = Number(ucfg.quota_daily_contacts || 8);
      const workdaysInWindow = Math.max(1, Math.round(pipWindow * 5 / 7));
      const expected = perDay * workdaysInWindow;
      const got = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_daily_contacts WHERE user_id=? AND created_at>=?')
        .bind(u.id, winFrom).first('n')) || 0;
      const pct = expected ? got / expected : 1;
      if (pct < pipRatio) {
        alerts.push({
          level: 'danger', type: 'pip',
          text: `${u.name} chỉ đạt ${Math.round(pct * 100)}% định mức liên hệ mới trong ${pipWindow} ngày (${got}/${expected}) — dưới ngưỡng ${Math.round(pipRatio * 100)}%, cần kích hoạt PIP.`,
          link: '#/console', userId: u.id,
        });
      }
    }

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
