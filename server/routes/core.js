import { json, match, need, uid, now, DAY, readBody, audit, notify, isLead, startOfDay, todayKey, monthKey, wsScope } from '../lib/util.js';
import { getConfig, computeKpi } from '../lib/kpi.js';
import { createSession, destroySession, readToken, verifyPassword, hashPassword, DUMMY_PASSWORD_HASH } from '../lib/auth.js';
import { appMode, DEMO_PASSWORD } from '../lib/db.js';
import { vPassword } from '../lib/validate.js';
import { clientIp, loginRateLimited, recordLoginFailure, clearLoginAttempts } from '../lib/ratelimit.js';

export async function coreRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* --- Bootstrap: danh sách tài khoản để chọn + người đang đăng nhập ---
     KHÔNG trả email khi chưa đăng nhập (chống thu thập thông tin nhân sự). */
  if ((p = match(ctx, 'GET', '/api/bootstrap'))) {
    const mode = appMode(env);
    const cols = ctx.me ? 'id,name,email,role,title,must_change_password' : 'id,name,role,title';
    // Chưa đăng nhập: ở chế độ demo chỉ liệt kê tài khoản DEMO (is_demo=1) để gợi ý trên màn đăng
    // nhập; ở chế độ production KHÔNG trả bất kỳ tài khoản nào (không lộ danh tính nhân sự thật).
    // Đã đăng nhập: chỉ liệt kê nhân sự CÙNG workspace (demo/chính thức) với người xem — tài khoản
    // demo không được thấy tên nhân sự chính thức thật xuất hiện ở bất kỳ đâu trong app, và ngược lại.
    const showUsers = !!ctx.me || mode === 'demo';
    const bucket = ctx.me ? (ctx.me.is_demo ? 1 : 0) : 1;
    const { results: users } = showUsers
      ? (await env.DB.prepare(`SELECT ${cols} FROM nv_users WHERE active=1 AND is_demo=? ORDER BY CASE role WHEN "admin" THEN 1 WHEN "manager" THEN 2 ELSE 3 END, name`).bind(bucket).all())
      : { results: [] };
    // Chưa có tài khoản nào (production vừa deploy, chưa cấu hình BOOTSTRAP_ADMIN_*) → cho client
    // biết để hiện đúng thông báo "Hệ thống chưa được khởi tạo" thay vì lỗi sai mật khẩu chung chung.
    const initialized = ctx.me ? true : (Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_users').first('n')) || 0) > 0;
    const cfg = await getConfig(env, ctx.me?.id);
    let unread = 0;
    if (ctx.me) unread = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_notifications WHERE user_id=? AND read=0').bind(ctx.me.id).first('n')) || 0;
    return json({
      users, me: ctx.me || null, config: cfg, unread, mode, initialized,
      // Gợi ý mật khẩu demo chỉ do MÁY CHỦ trả — mã nguồn client production không chứa chuỗi mật khẩu nào.
      demoHint: (!ctx.me && mode === 'demo') ? DEMO_PASSWORD : undefined,
    });
  }

  /* --- Đăng nhập: xác thực mật khẩu rồi đổi lấy session token --- */
  if ((p = match(ctx, 'POST', '/api/session'))) {
    const b = await readBody(ctx.request);
    const identifier = String(b.identifier || b.userId || '').trim();
    const password = String(b.password || '');
    const ip = clientIp(ctx.request);
    const genericErr = () => json({ error: 'Email/Mã nhân viên hoặc mật khẩu không đúng' }, 401);
    if (!identifier || !password) return genericErr();

    // Tra tài khoản TRƯỚC khi kiểm tra khoá — để khoá theo id chuẩn hoá của tài khoản (nếu có)
    // thay vì theo chuỗi định danh thô: định danh có thể là email HOẶC mã nhân viên cho CÙNG 1
    // tài khoản, khoá theo chuỗi thô sẽ cho kẻ dò mật khẩu nhân đôi ngân sách thử (5 lần bằng
    // email + 5 lần nữa bằng mã nhân viên). Không tìm thấy tài khoản → khoá theo chính định danh
    // đã gõ (không có id nào khác để quy về).
    const u = await env.DB.prepare(
      'SELECT id,name,email,role,title,created_at,password_hash,must_change_password FROM nv_users WHERE (id=? OR lower(email)=lower(?)) AND active=1')
      .bind(identifier, identifier).first();
    const rlKey = u ? u.id : identifier.toLowerCase();

    // Chống dò mật khẩu: quá 5 lần sai trong 15 phút (theo định danh+IP) thì chặn tạm. Không lộ
    // việc tài khoản có tồn tại hay không — thông điệp giữ nguyên dạng chung chung.
    const rl = await loginRateLimited(env, rlKey, ip);
    if (rl.blocked) {
      const mins = Math.max(1, Math.ceil(rl.retryAfterSec / 60));
      return json({ error: `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau khoảng ${mins} phút.` }, 429);
    }

    // Luôn chạy verifyPassword (kể cả khi không có tài khoản, băm vào 1 giá trị giả cố định) để
    // thời gian phản hồi không tố cáo việc định danh có khớp tài khoản nào hay không.
    const ok = await verifyPassword(password, u ? u.password_hash : DUMMY_PASSWORD_HASH);
    if (!u || !ok) {
      await recordLoginFailure(env, rlKey, ip);
      await audit(env, null, 'login_failed', 'user', null, { identifier: identifier.slice(0, 80) });
      return genericErr();
    }
    await clearLoginAttempts(env, rlKey, ip);
    delete u.password_hash;
    const s = await createSession(env, u.id, ctx.request.headers.get('user-agent'));
    await audit(env, u.id, 'login', 'user', u.id, { via: 'password' });
    return json({ me: u, token: s.token, expiresAt: s.expiresAt });
  }

  /* --- Tự đổi mật khẩu khi đang đăng nhập (dùng cho cờ must_change_password buộc đổi lần đầu) --- */
  if ((p = match(ctx, 'POST', '/api/account/password'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const password = vPassword(b.password, 'Mật khẩu mới', { required: true });
    const hash = await hashPassword(password);
    await env.DB.prepare('UPDATE nv_users SET password_hash=?, must_change_password=0 WHERE id=?').bind(hash, ctx.me.id).run();
    // Huỷ mọi phiên khác — phòng trường hợp mật khẩu tạm đã bị lộ trước khi được đổi.
    await env.DB.prepare('DELETE FROM nv_sessions WHERE user_id=? AND token!=?').bind(ctx.me.id, ctx.me._token).run();
    await audit(env, ctx.me.id, 'password_changed', 'user', ctx.me.id, {});
    return json({ ok: true });
  }

  /* --- Đăng xuất: huỷ phiên --- */
  if ((p = match(ctx, 'DELETE', '/api/session'))) {
    const tok = readToken(ctx.request);
    if (tok) {
      if (ctx.me) await audit(env, ctx.me.id, 'logout', 'user', ctx.me.id, {});
      await destroySession(env, tok);
    }
    return json({ ok: true });
  }

  /* --- Cockpit ngày --- */
  if ((p = match(ctx, 'GET', '/api/cockpit'))) {
    need(ctx);
    const me = ctx.me;
    const t = now(), sod = startOfDay(t);
    const cfg = await getConfig(env, me.id);
    const D = env.DB;
    // follow-up = hoạt động chăm sóc trên deal/khách ĐÃ có (email/zalo/other gắn deal), tách khỏi gọi & gặp
    const todayAct = await D.prepare(`SELECT COUNT(*) n,
        SUM(CASE WHEN type="call" THEN 1 ELSE 0 END) c,
        SUM(CASE WHEN type IN ("meeting","demo") THEN 1 ELSE 0 END) m,
        SUM(CASE WHEN type IN ("email","zalo") OR (type="other" AND deal_id IS NOT NULL) THEN 1 ELSE 0 END) f
      FROM nv_activities WHERE user_id=? AND happened_at>=?`).bind(me.id, sod).first();
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
        followups: { done: Number(todayAct.f) || 0, target: cfg.quota_followups || 10 },
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
    // Chỉ hiện log của nhân sự CÙNG workspace, cộng với log hệ thống không gắn user (vd cron_run) —
    // Admin demo không được thấy nhật ký hoạt động thật của nhân sự chính thức, và ngược lại.
    const ws = wsScope(ctx, 'a.user_id');
    const { results } = await env.DB.prepare(
      `SELECT a.*, u.name user_name FROM nv_audit_logs a LEFT JOIN nv_users u ON u.id=a.user_id
       WHERE a.user_id IS NULL OR (1=1${ws.sql})
       ORDER BY a.created_at DESC LIMIT 120`).bind(...ws.args).all();
    return json({ items: results || [] });
  }

  /**
   * Cron: quét & GHI THẬT thông báo (M10). Nexrall/Wrangler gọi định kỳ.
   * Chống spam: mỗi loại sự kiện chỉ nhắc 1 lần trong 12 giờ (dựa trên nv_notifications).
   */
  // Nền tảng có thể gọi bằng POST (scheduler) hoặc GET (kiểm thử thủ công) → chấp nhận cả hai.
  if ((p = match(ctx, 'GET', '/api/__cron') || match(ctx, 'POST', '/api/__cron'))) {
    const t = now();
    const since = t - 12 * 3600;
    const out = { sla: 0, escalation: 0, tasks: 0, reports: 0, tenders: 0, pip: 0 };

    // Đã nhắc gì trong 12h qua? (khoá = type|link|title để không gửi trùng)
    const { results: recent } = await env.DB.prepare('SELECT user_id,type,title FROM nv_notifications WHERE created_at >= ?').bind(since).all();
    const sent = new Set((recent || []).map(n => n.user_id + '|' + n.type + '|' + n.title));
    const push = async (userId, o) => {
      const k = userId + '|' + o.type + '|' + o.title;
      if (sent.has(k)) return false;
      sent.add(k);
      await notify(env, userId, o);
      return true;
    };

    const cfg = await getConfig(env);
    const sla = cfg.sla_days || {};
    const { results: managers } = await env.DB.prepare("SELECT id,is_demo FROM nv_users WHERE role IN ('manager','admin') AND active=1").all();
    // Leo thang chỉ tới quản lý CÙNG workspace (demo/chính thức) với chủ deal/PIP — deal mẫu demo
    // không được làm phiền quản lý thật, và ngược lại.
    const managersFor = (ownerIsDemo) => (managers || []).filter(m => !!m.is_demo === !!ownerIsDemo);

    /* 1. Deal quá SLA → nhắc sales; quá gấp đôi SLA → leo thang lên TP (FR-M10-1) */
    const { results: deals } = await env.DB.prepare(
      "SELECT d.*, u.name owner_name, u.is_demo owner_is_demo FROM nv_deals d JOIN nv_users u ON u.id=d.owner_id WHERE d.status='open'").all();
    for (const d of deals || []) {
      const idle = (t - (d.last_activity_at || d.created_at)) / DAY;
      const limit = sla[d.stage] || 5;
      if (idle > limit) {
        if (await push(d.owner_id, { type: 'sla', title: '🔴 Deal quá SLA: ' + d.title, body: `Đã ${Math.floor(idle)} ngày không có hoạt động (SLA ${limit} ngày).`, link: '#/pipeline', level: 'danger' })) out.sla++;
      }
      if (idle > limit * 2) {
        for (const m of managersFor(d.owner_is_demo)) {
          if (await push(m.id, { type: 'sla', title: '⚠️ Leo thang SLA: ' + d.title, body: `${d.owner_name} để deal nguội ${Math.floor(idle)} ngày (gấp đôi SLA ${limit} ngày).`, link: '#/console', level: 'danger' })) out.escalation++;
        }
      }
    }

    /* 2. Việc quá hạn + việc chưa xác nhận tiếp nhận quá SLA (FR-M10-4, FR-M13-3) */
    const { results: tasks } = await env.DB.prepare(
      "SELECT t.*, u.name user_name FROM nv_tasks t JOIN nv_users u ON u.id=t.user_id WHERE t.status!='done'").all();
    for (const task of tasks || []) {
      if (task.due_at && task.due_at < t) {
        if (await push(task.user_id, { type: 'task', title: '⏰ Việc quá hạn: ' + task.title, body: 'Vui lòng cập nhật trạng thái.', link: '#/tasks', level: 'warn' })) out.tasks++;
      }
      if (task.assigner_id && !task.accepted_at && (t - task.created_at) > (task.accept_sla_min || 120) * 60) {
        if (await push(task.assigner_id, { type: 'assignment', title: '⚠️ Chưa nhận việc: ' + task.title, body: `${task.user_name} chưa xác nhận tiếp nhận quá SLA.`, link: '#/console', level: 'danger' })) out.escalation++;
      }
    }

    /* 3. Nhắc nộp báo cáo EOD trước hạn (FR-M10-2) */
    const hourVN = (new Date().getUTCHours() + 7) % 24;
    const deadline = Number(cfg.report_deadline_hour || 17.5);
    if (hourVN >= deadline - 1 && hourVN < deadline + 4) {
      const { results: sales } = await env.DB.prepare("SELECT id,name FROM nv_users WHERE role='sales' AND active=1").all();
      for (const u of sales || []) {
        const r = await env.DB.prepare("SELECT id FROM nv_daily_reports WHERE user_id=? AND kind='day' AND period=?").bind(u.id, todayKey()).first();
        if (!r) {
          const late = hourVN >= deadline;
          if (await push(u.id, { type: 'report', title: late ? '🔴 Báo cáo EOD đã trễ hạn' : '📝 Sắp đến hạn nộp báo cáo EOD', body: `Hạn nộp ${Math.floor(deadline)}h${deadline % 1 ? '30' : '00'}.`, link: '#/reports', level: late ? 'danger' : 'warn' })) out.reports++;
        }
      }
    }

    /* 4. Hạn nộp hồ sơ thầu sắp tới (FR-M10-3) */
    const { results: tenders } = await env.DB.prepare(
      "SELECT * FROM nv_tender_leads WHERE status='new' AND deadline_at IS NOT NULL AND deadline_at > ? AND deadline_at < ?").bind(t, t + 5 * DAY).all();
    for (const td of tenders || []) {
      const days = Math.ceil((td.deadline_at - t) / DAY);
      const targets = td.assigned_to ? [{ id: td.assigned_to }] : (managers || []);
      for (const m of targets) {
        if (await push(m.id, { type: 'tender', title: `📑 Hạn nộp thầu còn ${days} ngày`, body: td.title, link: '#/prospect', level: days <= 2 ? 'danger' : 'warn' })) out.tenders++;
      }
    }

    /* 5. Mốc PIP sắp đến hạn (FR-M10-4) */
    const { results: pips } = await env.DB.prepare(
      "SELECT p.*, u.name user_name, u.is_demo user_is_demo FROM nv_pip_records p JOIN nv_users u ON u.id=p.user_id WHERE p.status='dang_chay' AND p.end_at < ?").bind(t + 3 * DAY).all();
    for (const r of pips || []) {
      if (await push(r.user_id, { type: 'pip', title: '📌 Mốc PIP sắp đến hạn', body: r.goal, link: '#/kpi', level: 'danger' })) out.pip++;
      for (const m of managersFor(r.user_is_demo)) {
        if (await push(m.id, { type: 'pip', title: 'Mốc PIP của ' + r.user_name + ' sắp đến hạn', body: r.goal, link: '#/console', level: 'warn' })) out.pip++;
      }
    }

    await audit(env, null, 'cron_run', 'system', null, out);
    // notify/email rỗng: thông báo đã được ghi thẳng vào nv_notifications ở trên (in-app),
    // không nhờ nền tảng gửi push/email hộ.
    return json({ ok: true, sent: out, at: t, notify: [], email: [] });
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
