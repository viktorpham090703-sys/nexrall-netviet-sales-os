import { json, match, need, uid, now, DAY, readBody, audit, notify, isLead, startOfDay, todayKey, monthKey, wsScope, wsBucket, LEAD_ROLES } from '../lib/util.js';
import { getConfig, computeKpi, slaLimit, businessDaysElapsed } from '../lib/kpi.js';
import { createSession, destroySession, readToken, verifyPassword, hashPassword, DUMMY_PASSWORD_HASH } from '../lib/auth.js';
import { appMode } from '../lib/db.js';
import { computeRecord } from '../lib/record.js';
import { vPassword, vStrongPassword, vText, vPhone, vDateStr, vEmail } from '../lib/validate.js';
import { clientIp, loginRateLimited, recordLoginFailure, clearLoginAttempts } from '../lib/ratelimit.js';
import { autoSubmitOutstandingReports } from './work.js';
import { getSetting } from '../lib/settings.js';
import { effFeat, effOps, levelOf, FEATURES } from '../lib/perm.js';

/** Trần dung lượng ảnh đại diện sau khi client đã thu nhỏ — 320px vuông JPEG chỉ tầm 20-40KB,
 * 512KB là biên rộng rãi cho ảnh PNG/WEBP nhiều chi tiết mà vẫn không làm nặng /api/bootstrap. */
const AVATAR_MAX_BYTES = 512 * 1024;

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
    const bucket = ctx.me ? wsBucket(ctx.me) : 1;
    const { results: users } = showUsers
      ? (await env.DB.prepare(`SELECT ${cols} FROM nv_users WHERE active=1 AND is_demo=? ORDER BY CASE role WHEN "admin" THEN 1 WHEN "manager" THEN 2 ELSE 3 END, name`).bind(bucket).all())
      : { results: [] };
    // Chưa có tài khoản nào (production vừa deploy, chưa cấu hình BOOTSTRAP_ADMIN_*) → cho client
    // biết để hiện đúng thông báo "Hệ thống chưa được khởi tạo" thay vì lỗi sai mật khẩu chung chung.
    const initialized = ctx.me ? true : (Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_users').first('n')) || 0) > 0;
    const cfg = await getConfig(env, ctx.me?.id);
    let unread = 0;
    if (ctx.me) unread = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_notifications WHERE user_id=? AND read=0').bind(ctx.me.id).first('n')) || 0;
    // Ảnh đại diện chỉ trả cho CHÍNH người đang đăng nhập (để sidebar/topbar vẽ được ngay), không
    // kèm vào danh sách `users` ở trên — mỗi ảnh là data URL vài chục KB, nhân với cả phòng kinh
    // doanh sẽ làm phình payload bootstrap vốn chạy ở mọi lần mở app.
    const me = ctx.me
      ? { ...ctx.me, avatar: (await env.DB.prepare('SELECT avatar FROM nv_users WHERE id=?').bind(ctx.me.id).first('avatar')) || null }
      : null;
    // Thiết lập hệ thống cần ngay lúc vẽ khung app: logo (cả màn đăng nhập), tính năng được cấp để
    // dựng menu, thiết lập AI trợ lý. Chưa đăng nhập chỉ nhận logo.
    const bucket2 = ctx.me ? wsBucket(ctx.me) : (mode === 'demo' ? 1 : 0);
    const brand = await getSetting(env, bucket2, 'brand');
    let settings = { brand };
    if (ctx.me) {
      const [perm, ai] = await Promise.all([getSetting(env, bucket2, 'perm'), getSetting(env, bucket2, 'ai')]);
      const lv = levelOf(ctx.me);
      settings = { brand, ai, perm: { level: lv, feat: effFeat(perm, ctx.me), ops: Object.fromEntries(FEATURES.map(([f]) => [f, effOps(perm, lv, f)])), threshold: perm.threshold } };
    }
    return json({ users, me, config: cfg, unread, mode, initialized, settings });
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
      'SELECT id,name,email,role,title,created_at,password_hash,must_change_password,can_manage_accounts FROM nv_users WHERE (UPPER(id)=UPPER(?) OR lower(email)=lower(?)) AND active=1')
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
    u.can_manage_accounts = !!u.can_manage_accounts;
    const s = await createSession(env, u.id, ctx.request.headers.get('user-agent'));
    await audit(env, u.id, 'login', 'user', u.id, { via: 'password' });
    return json({ me: u, token: s.token, expiresAt: s.expiresAt });
  }

  /* --- Tự đổi mật khẩu khi đang đăng nhập. Đổi thường (Cài đặt → Bảo mật) phải nhập đúng mật khẩu
     hiện tại — phiên bị bỏ quên trên máy dùng chung không đổi được mật khẩu để chiếm tài khoản. Luồng
     buộc đổi lần đầu (must_change_password) thì miễn, vì người dùng vừa đăng nhập bằng mật khẩu tạm. --- */
  if ((p = match(ctx, 'POST', '/api/account/password'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const password = vStrongPassword(b.password);
    if (!ctx.me.must_change_password) {
      const ip = clientIp(ctx.request);
      const rlKey = 'pwchange:' + ctx.me.id;
      if ((await loginRateLimited(env, rlKey, ip)).blocked) {
        return json({ error: 'Bạn đã nhập sai mật khẩu hiện tại quá nhiều lần. Vui lòng thử lại sau ít phút.' }, 429);
      }
      const row = await env.DB.prepare('SELECT password_hash FROM nv_users WHERE id=?').bind(ctx.me.id).first();
      if (!b.currentPassword || !row?.password_hash || !(await verifyPassword(String(b.currentPassword), row.password_hash))) {
        await recordLoginFailure(env, rlKey, ip);
        return json({ error: 'Mật khẩu hiện tại không đúng.' }, 400);
      }
      await clearLoginAttempts(env, rlKey, ip);
      if (String(b.currentPassword) === password) return json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' }, 400);
    }
    const hash = await hashPassword(password);
    await env.DB.prepare('UPDATE nv_users SET password_hash=?, must_change_password=0 WHERE id=?').bind(hash, ctx.me.id).run();
    // Huỷ mọi phiên khác — phòng trường hợp mật khẩu tạm đã bị lộ trước khi được đổi.
    await env.DB.prepare('DELETE FROM nv_sessions WHERE user_id=? AND token!=?').bind(ctx.me.id, ctx.me._token).run();
    await audit(env, ctx.me.id, 'password_changed', 'user', ctx.me.id, {});
    return json({ ok: true });
  }

  /* --- Thành tích & Vi phạm của CHÍNH mình — tính trực tiếp từ dữ liệu Sales OS (server/lib/record.js). --- */
  if ((p = match(ctx, 'GET', '/api/account/record'))) {
    need(ctx);
    const u = await env.DB.prepare('SELECT id,role,is_demo FROM nv_users WHERE id=?').bind(ctx.me.id).first();
    return json(await computeRecord(env, u));
  }

  /* --- Hồ sơ nhân sự tự khai: xem thông tin cá nhân của CHÍNH mình --- */
  if ((p = match(ctx, 'GET', '/api/account/profile'))) {
    need(ctx);
    const u = await env.DB.prepare(
      'SELECT id,name,email,role,title,phone,gender,birth_date,id_number,id_issue_date,id_issue_place,id_expiry,address,school,education_level,emergency_contact,sales_experience,past_positions,avatar FROM nv_users WHERE id=?')
      .bind(ctx.me.id).first();
    return json({ profile: u });
  }

  /* --- Hồ sơ nhân sự tự khai: cập nhật thông tin cá nhân của CHÍNH mình. Mọi trường đều tự sửa
     được, TRỪ Mã nhân viên (id — khoá chính, không đổi được) và role/title (phân quyền, vẫn chỉ
     Admin quản lý qua Quản trị). Email tự sửa được nhưng phải kiểm tra trùng vì đây cũng là định
     danh đăng nhập. --- */
  if ((p = match(ctx, 'PATCH', '/api/account/profile'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const name = vText(b.name, 'Họ và tên', { max: 120, required: true });
    const email = vEmail(b.email);
    if (email) {
      const dup = await env.DB.prepare('SELECT id FROM nv_users WHERE LOWER(email)=? AND id!=?').bind(email.toLowerCase(), ctx.me.id).first();
      if (dup) return json({ error: `Email ${email} đã được dùng cho tài khoản khác.` }, 409);
    }
    const phone = vPhone(b.phone);
    const birth_date = vDateStr(b.birth_date, 'Ngày sinh');
    const id_number = vText(b.id_number, 'Số CCCD', { max: 30 });
    const id_expiry = vDateStr(b.id_expiry, 'Hạn CCCD');
    const address = vText(b.address, 'Địa chỉ liên hệ', { max: 300 });
    const school = vText(b.school, 'Trường học', { max: 200 });
    const emergency_contact = vText(b.emergency_contact, 'Liên hệ khẩn cấp', { max: 200 });
    const gender = ['nam', 'nu', 'khac'].includes(b.gender) ? b.gender : null;
    const id_issue_date = vDateStr(b.id_issue_date, 'Ngày cấp CCCD');
    const id_issue_place = vText(b.id_issue_place, 'Nơi cấp CCCD', { max: 200 });
    const education_level = vText(b.education_level, 'Trình độ học vấn', { max: 60 });
    const sales_experience = vText(b.sales_experience, 'Kinh nghiệm sale', { max: 2000 });
    const past_positions = vText(b.past_positions, 'Chức vụ đã đảm nhiệm', { max: 2000 });
    await env.DB.prepare(
      `UPDATE nv_users SET name=?, email=?, phone=?, gender=?, birth_date=?, id_number=?, id_issue_date=?, id_issue_place=?, id_expiry=?, address=?, school=?, education_level=?, emergency_contact=?, sales_experience=?, past_positions=? WHERE id=?`)
      .bind(name, email, phone, gender, birth_date, id_number, id_issue_date, id_issue_place, id_expiry, address, school, education_level, emergency_contact, sales_experience, past_positions, ctx.me.id).run();
    await audit(env, ctx.me.id, 'profile_updated', 'user', ctx.me.id, {});
    return json({ ok: true });
  }

  /* --- Ảnh đại diện: tải lên / gỡ bỏ ảnh của CHÍNH mình. Client đã thu nhỏ ảnh về 320px vuông
     trước khi gửi (xem src/views/profile.js), ở đây chỉ nhận data URL và kiểm lại định dạng + dung
     lượng — không tin client đã cắt/nén đúng. --- */
  if ((p = match(ctx, 'POST', '/api/account/avatar'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const dataUrl = String(b.avatar || '').trim();
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return json({ error: 'Ảnh không hợp lệ. Chỉ nhận ảnh JPG, PNG hoặc WEBP.' }, 400);
    // Độ dài base64 ≈ 4/3 số byte gốc — quy về byte để so với hạn mức cho dễ hiểu.
    const bytes = Math.floor(m[2].length * 3 / 4);
    if (bytes > AVATAR_MAX_BYTES) return json({ error: 'Ảnh đại diện vượt quá 512KB sau khi xử lý. Hãy chọn ảnh khác.' }, 400);
    await env.DB.prepare('UPDATE nv_users SET avatar=? WHERE id=?').bind(dataUrl, ctx.me.id).run();
    await audit(env, ctx.me.id, 'avatar_updated', 'user', ctx.me.id, { size: bytes });
    return json({ ok: true, avatar: dataUrl });
  }

  if ((p = match(ctx, 'DELETE', '/api/account/avatar'))) {
    need(ctx);
    await env.DB.prepare('UPDATE nv_users SET avatar=NULL WHERE id=?').bind(ctx.me.id).run();
    await audit(env, ctx.me.id, 'avatar_removed', 'user', ctx.me.id, {});
    return json({ ok: true, avatar: null });
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
    const quota = await todayQuota(env, me.id, cfg, sod);
    const todayDC = quota.contacts.done;
    const { results: tasks } = await D.prepare("SELECT t.*, u.name assigner_name FROM nv_tasks t LEFT JOIN nv_users u ON u.id=t.assigner_id WHERE t.user_id=? AND t.status!='done' ORDER BY CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.due_at").bind(me.id).all();
    const { results: deals } = await D.prepare("SELECT d.*, c.name customer_name FROM nv_deals d LEFT JOIN nv_customers c ON c.id=d.customer_id WHERE d.owner_id=? AND d.status='open' ORDER BY d.last_activity_at ASC").bind(me.id).all();
    const risky = deals.filter(d => (t - (d.last_activity_at || 0)) > slaLimit(cfg, d.stage) * DAY)
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
    if (!reportToday && ((new Date().getUTCHours() + 7) % 24) >= 15) reminders.push({ level: 'info', text: 'Chưa nộp báo cáo cuối ngày (EOD).', link: '#/reports' });
    if (!reminders.length) reminders.push({ level: 'ok', text: 'Bạn đang bám sát kế hoạch. Giữ nhịp nhé!', link: '#/pipeline' });

    return json({
      greeting: greet(), today: todayKey(),
      quota: { contacts: quota.contacts, calls: quota.calls, meetings: quota.meetings, followups: quota.followups },
      activitiesToday: quota.activities,
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
    // ?limit (≤200) & ?before=<created_at> để trang Thông báo tải tiếp các thông báo cũ hơn.
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const before = Number(url.searchParams.get('before')) || 0;
    const { results } = await env.DB.prepare(
      `SELECT * FROM nv_notifications WHERE user_id=?${before ? ' AND created_at<?' : ''} ORDER BY created_at DESC LIMIT ?`)
      .bind(...(before ? [ctx.me.id, before, limit + 1] : [ctx.me.id, limit + 1])).all();
    const unread = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_notifications WHERE user_id=? AND read=0').bind(ctx.me.id).first('n')) || 0;
    const rows = results || [];
    return json({ items: rows.slice(0, limit), more: rows.length > limit, unread });
  }
  if ((p = match(ctx, 'POST', '/api/notifications/read'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    if (b.id) await env.DB.prepare('UPDATE nv_notifications SET read=1 WHERE id=? AND user_id=?').bind(String(b.id), ctx.me.id).run();
    else await env.DB.prepare('UPDATE nv_notifications SET read=1 WHERE user_id=?').bind(ctx.me.id).run();
    return json({ ok: true });
  }

  if ((p = match(ctx, 'GET', '/api/audit'))) {
    need(ctx, LEAD_ROLES);
    // Chỉ hiện log của nhân sự CÙNG workspace, cộng với log hệ thống không gắn user (vd cron_run) —
    // Admin demo không được thấy nhật ký hoạt động thật của nhân sự chính thức, và ngược lại.
    // Trả kèm u.role để phân biệt ngay trong danh sách hành động của Admin khác/TP/Sales — phục vụ
    // Ban TGĐ (HUONGNT, HAUNV) giám sát chéo cấp dưới, kể cả Admin khác, mà không cần tra thêm ở mục Người dùng.
    const ws = wsScope(ctx, 'a.user_id');
    const { results } = await env.DB.prepare(
      `SELECT a.*, u.name user_name, u.role user_role FROM nv_audit_logs a LEFT JOIN nv_users u ON u.id=a.user_id
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
    // Route này GHI THẬT vào nv_notifications + nv_audit_logs. Trước đây nó không kiểm tra gì cả,
    // nên bất kỳ ai biết đường dẫn đều gọi được từ Internet để bơm thông báo/leo thang giả và
    // làm phình CSDL. Nay chỉ chấp nhận: (a) bộ lập lịch của nền tảng — gửi kèm khoá bí mật
    // CRON_SECRET ở header X-Cron-Key, hoặc (b) TP/Admin gọi tay để kiểm thử.
    const cronKey = ctx.request.headers.get('x-cron-key') || '';
    const secret = env.CRON_SECRET || '';
    const bySecret = !!secret && cronKey === secret;
    if (!bySecret && !isLead(ctx.me)) {
      return json({ error: 'Không có quyền chạy tác vụ nền' }, 403);
    }
    const t = now();
    const since = t - 12 * 3600;
    const out = { sla: 0, escalation: 0, tasks: 0, reports: 0, autoReports: { day: 0, week: 0, month: 0 }, tenders: 0, pip: 0, quoteSla: 0, contractSla: 0,
      kpiProgress: 0, dueSoon: 0, meetings: 0, dealClose: 0, urgentApprovals: 0, approvalDigest: 0, salesAlert: 0, revenueAlert: 0 };

    // Hạn nộp thủ công là 17h; tới 18h Cron tự tổng hợp và nộp thay những tài khoản còn thiếu.
    // Chạy trước khối nhắc việc để tài khoản vừa được tự nộp không nhận thêm cảnh báo "trễ hạn".
    out.autoReports = await autoSubmitOutstandingReports(env, t);

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
    const { results: managers } = await env.DB.prepare("SELECT id,is_demo,role FROM nv_users WHERE role IN ('manager','admin') AND active=1").all();
    // Leo thang chỉ tới quản lý CÙNG workspace (demo/chính thức) với chủ deal/PIP — deal mẫu demo
    // không được làm phiền quản lý thật, và ngược lại.
    const managersFor = (ownerIsDemo) => (managers || []).filter(m => !!m.is_demo === !!ownerIsDemo);

    /* 1. Deal quá SLA → nhắc sales; quá gấp đôi SLA → leo thang lên TP (FR-M10-1) */
    const { results: deals } = await env.DB.prepare(
      "SELECT d.*, u.name owner_name, u.is_demo owner_is_demo FROM nv_deals d JOIN nv_users u ON u.id=d.owner_id WHERE d.status='open'").all();
    for (const d of deals || []) {
      const idle = (t - (d.last_activity_at || d.created_at)) / DAY;
      const limit = slaLimit(cfg, d.stage);
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
    const deadline = Number(cfg.report_deadline_hour || 17);
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

    /* 6. Báo giá chờ duyệt quá 1 ngày làm việc — nhắc đúng người đang cần duyệt (TPKD ở V1,
     * Admin/BGĐ ở V2 — vai trò Giám đốc đã sáp nhập vào Admin); quá 2 ngày làm việc thì leo thang
     * thêm cho Admin cùng workspace (bỏ qua nếu vòng đó chính Admin đã là người duyệt, tránh báo
     * trùng 2 lần cho cùng một người). */
    const { results: pendingQuotes } = await env.DB.prepare(
      "SELECT q.*, u.is_demo owner_is_demo FROM nv_quotes q JOIN nv_users u ON u.id=q.owner_id WHERE q.status IN ('pending_v1','pending_v2')").all();
    for (const q of pendingQuotes || []) {
      const since = q.status === 'pending_v2' ? (q.v1_decided_at || q.created_at) : q.created_at;
      const elapsed = businessDaysElapsed(since, t);
      if (elapsed < 1) continue;
      const round = q.status === 'pending_v1' ? 'V1' : 'V2';
      const approverRole = q.status === 'pending_v1' ? 'manager' : 'admin';
      const { results: approvers } = await env.DB.prepare('SELECT id FROM nv_users WHERE role=? AND active=1 AND is_demo=?').bind(approverRole, q.owner_is_demo ? 1 : 0).all();
      for (const a of approvers || []) {
        if (await push(a.id, { type: 'approval', title: `🔴 Báo giá chờ duyệt ${round} quá hạn`, body: q.title + ` – đã ${elapsed} ngày làm việc chưa xử lý.`, link: '#/plans', level: 'danger' })) out.quoteSla++;
      }
      if (elapsed >= 2 && approverRole !== 'admin') {
        const { results: admins } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='admin' AND active=1 AND is_demo=?").bind(q.owner_is_demo ? 1 : 0).all();
        for (const ad of admins || []) {
          if (await push(ad.id, { type: 'approval', title: `⚠️ Leo thang duyệt báo giá ${round}: ` + q.title, body: `Chờ duyệt ${round} đã ${elapsed} ngày làm việc (gấp đôi ngưỡng).`, link: '#/console', level: 'danger' })) out.quoteSla++;
        }
      }
    }

    /* 7. Hợp đồng chờ duyệt quá 1 ngày làm việc — nhắc TPKD ở V1, HCNS ở V2; quá 2 ngày làm việc
     * thì leo thang thêm cho Admin cùng workspace (cùng khuôn mẫu mục 6 ở trên cho báo giá). */
    const { results: pendingContracts } = await env.DB.prepare(
      "SELECT c.*, u.is_demo owner_is_demo FROM nv_contracts c JOIN nv_users u ON u.id=c.owner_id WHERE c.status IN ('pending_v1','pending_v2')").all();
    for (const c of pendingContracts || []) {
      const since = c.status === 'pending_v2' ? (c.v1_decided_at || c.created_at) : c.created_at;
      const elapsed = businessDaysElapsed(since, t);
      if (elapsed < 1) continue;
      const round = c.status === 'pending_v1' ? 'V1' : 'V2';
      const approverRole = c.status === 'pending_v1' ? 'manager' : 'hr';
      const { results: approvers } = await env.DB.prepare('SELECT id FROM nv_users WHERE role=? AND active=1 AND is_demo=?').bind(approverRole, c.owner_is_demo ? 1 : 0).all();
      for (const a of approvers || []) {
        if (await push(a.id, { type: 'approval', title: `🔴 Hợp đồng chờ duyệt ${round} quá hạn`, body: c.title + ` – đã ${elapsed} ngày làm việc chưa xử lý.`, link: '#/plans', level: 'danger' })) out.contractSla++;
      }
      if (elapsed >= 2) {
        const { results: admins } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='admin' AND active=1 AND is_demo=?").bind(c.owner_is_demo ? 1 : 0).all();
        for (const ad of admins || []) {
          if (await push(ad.id, { type: 'approval', title: `⚠️ Leo thang duyệt hợp đồng ${round}: ` + c.title, body: `Chờ duyệt ${round} đã ${elapsed} ngày làm việc (gấp đôi ngưỡng).`, link: '#/console', level: 'danger' })) out.contractSla++;
        }
      }
    }

    /* ================= 8–15: CẢNH BÁO THEO VAI TRÒ =================
     * Nhân viên: tiến độ KPI ngày, việc sắp đến hạn, lịch làm việc với khách, deal sắp đến ngày chốt.
     * Ban GĐ / Trưởng phòng: cần duyệt gấp, việc giao cho đội sắp đến hạn, cảnh báo chỉ số sale,
     * doanh thu tháng chậm tiến độ. Các mốc giờ tính theo giờ VN; Cron chạy 30 phút/lần nên mỗi mốc
     * rơi vào 2 lượt chạy — push() chống trùng theo tiêu đề trong 12 giờ nên chỉ gửi đúng 1 lần. */
    const vn = new Date((t + 7 * 3600) * 1000);
    const workday = vn.getUTCDay() !== 0;
    const sod = startOfDay(t);
    const fmtDay = (ts) => { const d = new Date((ts + 7 * 3600) * 1000); return `${fmtHM(ts)} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
    const { results: people } = await env.DB.prepare("SELECT id,name,role,is_demo FROM nv_users WHERE active=1").all();
    const salesIn = (ws) => (people || []).filter(u => u.role === 'sales' && !!u.is_demo === !!ws);
    const quotaCache = new Map();
    const quotaOf = async (u) => {
      if (!quotaCache.has(u.id)) quotaCache.set(u.id, await todayQuota(env, u.id, await getConfig(env, u.id), sod));
      return quotaCache.get(u.id);
    };
    const isCustomerWork = (task) => !!(task.customer_id || task.deal_id);

    /* 8. NHÂN VIÊN — tiến độ KPI ngày lúc 11h và 15h (ngày làm việc) */
    if (workday && (hourVN === 11 || hourVN === 15)) {
      for (const u of (people || []).filter(x => x.role === 'sales')) {
        const q = await quotaOf(u);
        const body = `Đạt ${q.pct}% định mức ngày — Liên hệ mới ${q.contacts.done}/${q.contacts.target} · Cuộc gọi ${q.calls.done}/${q.calls.target} · Gặp/Demo ${q.meetings.done}/${q.meetings.target} · Follow-up ${q.followups.done}/${q.followups.target}.`
          + (q.pct < 100 ? (hourVN === 15 ? ' Còn vài giờ để về đích, tăng tốc nhé!' : ' Giữ nhịp để đạt định mức trước cuối ngày.') : ' Đã đủ định mức — tuyệt vời!');
        if (await push(u.id, { type: 'kpi', title: `📊 Tiến độ KPI hôm nay – mốc ${hourVN}h`, body, link: '#/cockpit', level: q.pct >= 80 ? 'info' : q.pct >= 50 ? 'warn' : 'danger' })) out.kpiProgress++;
      }
    }

    /* 9. Việc SẮP đến hạn (mọi vai trò): còn ≤ 24 giờ → nhắc; còn ≤ 2 giờ → khẩn, báo cả người giao việc.
     * Việc gắn khách hàng/deal là "lịch làm việc với khách" — nhắc riêng ở mục 10, không nhắc 2 lần. */
    for (const task of tasks || []) {
      if (!task.due_at || task.due_at < t) continue;
      const left = task.due_at - t;
      if (left <= 2 * 3600) {
        if (!isCustomerWork(task) && await push(task.user_id, { type: 'task', title: '⏰ Còn dưới 2 giờ: ' + task.title, body: `Hạn ${fmtDay(task.due_at)} — hoàn thành hoặc cập nhật tiến độ ngay.`, link: '#/tasks', level: 'danger' })) out.dueSoon++;
        if (task.assigner_id && task.assigner_id !== task.user_id
          && await push(task.assigner_id, { type: 'task', title: '⏳ Việc đã giao sắp đến hạn: ' + task.title, body: `${task.user_name} chưa hoàn thành — hạn ${fmtDay(task.due_at)}.`, link: '#/console', level: 'warn' })) out.dueSoon++;
      } else if (left <= DAY && !isCustomerWork(task)) {
        if (await push(task.user_id, { type: 'task', title: '⏳ Việc sắp đến hạn: ' + task.title, body: `Hạn ${fmtDay(task.due_at)}.`, link: '#/tasks', level: 'warn' })) out.dueSoon++;
      }
    }

    /* 10. NHÂN VIÊN — lịch làm việc với khách (việc gắn khách hàng/deal có hạn): 8h sáng tóm tắt lịch
     * trong ngày; trước giờ hẹn ≤ 2 giờ nhắc từng lịch. */
    const { results: custTasks } = await env.DB.prepare(
      `SELECT t.id,t.user_id,t.title,t.due_at,c.name customer_name FROM nv_tasks t LEFT JOIN nv_customers c ON c.id=t.customer_id
       WHERE t.status!='done' AND (t.customer_id IS NOT NULL OR t.deal_id IS NOT NULL) AND t.due_at>=? AND t.due_at<? ORDER BY t.due_at`).bind(t, sod + DAY).all();
    const label = (x) => x.customer_name ? `${x.title} (${x.customer_name})` : x.title;
    if (hourVN === 8) {
      const byUser = new Map();
      for (const x of custTasks || []) byUser.set(x.user_id, [...(byUser.get(x.user_id) || []), x]);
      for (const [uid, list] of byUser) {
        if (await push(uid, { type: 'meeting', title: '📅 Lịch làm việc với khách hôm nay', body: `${list.length} lịch: ` + list.slice(0, 4).map(x => `${fmtHM(x.due_at)} ${label(x)}`).join(' · ') + (list.length > 4 ? ` · +${list.length - 4} lịch khác` : ''), link: '#/tasks', level: 'info' })) out.meetings++;
      }
    }
    for (const x of custTasks || []) {
      if (x.due_at - t <= 2 * 3600 && await push(x.user_id, { type: 'meeting', title: '📅 Sắp đến lịch làm việc với khách: ' + x.title, body: `Lúc ${fmtHM(x.due_at)}${x.customer_name ? ' với ' + x.customer_name : ''} — chuẩn bị tài liệu và xác nhận lại với khách.`, link: '#/tasks', level: 'warn' })) out.meetings++;
    }

    /* 11. Deal dự kiến chốt trong 3 ngày tới → nhắc chủ deal (mốc 9h) */
    if (hourVN === 9) {
      for (const d of deals || []) {
        if (d.expected_close_at && d.expected_close_at >= sod && d.expected_close_at < t + 3 * DAY
          && await push(d.owner_id, { type: 'deal', title: '🎯 Deal sắp đến ngày dự kiến chốt: ' + d.title, body: `Dự kiến chốt ${fmtDay(d.expected_close_at)} · giá trị ${fmtMoney(d.value)}. Chốt lịch gặp và xử lý vướng mắc cuối.`, link: '#/pipeline', level: 'warn' })) out.dealClose++;
      }
    }

    /* 12. BAN GĐ / TP — CẦN DUYỆT GẤP: hạng mục phương án chờ duyệt ≥ 4 giờ, nhắc đúng vai trò duyệt */
    const { results: pendingItems } = await env.DB.prepare(
      `SELECT i.*, bp.title plan_title, u.name owner_name, u.is_demo owner_is_demo FROM nv_plan_items i
       JOIN nv_business_plans bp ON bp.id=i.plan_id JOIN nv_users u ON u.id=bp.owner_id WHERE i.status='pending'`).all();
    const KIND = { bao_gia: 'Báo giá', hop_dong: 'Hợp đồng', nghiem_thu: 'Nghiệm thu', thanh_ly: 'Thanh lý' };
    for (const it of pendingItems || []) {
      const waited = t - (it.submitted_at || it.updated_at || it.created_at);
      if (waited < 4 * 3600) continue;
      for (const a of managersFor(it.owner_is_demo).filter(m => m.role === it.approver_role)) {
        if (await push(a.id, { type: 'approval', title: '🔴 Cần duyệt gấp: ' + it.plan_title, body: `${KIND[it.kind] || it.kind} do ${it.owner_name} trình đã chờ ${Math.floor(waited / 3600)} giờ.`, link: '#/plans/' + it.plan_id, level: 'danger' })) out.urgentApprovals++;
      }
    }

    /* 13. BAN GĐ / TP — tóm tắt việc đang chờ mình duyệt lúc 9h và 14h */
    if (workday && (hourVN === 9 || hourVN === 14)) {
      for (const m of managers || []) {
        const ws = m.is_demo ? 1 : 0;
        const qs = m.role === 'manager' ? 'pending_v1' : 'pending_v2';
        const nQ = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_quotes q JOIN nv_users u ON u.id=q.owner_id WHERE q.status=? AND u.is_demo=?').bind(qs, ws).first('n')) || 0;
        const nC = m.role === 'manager' ? Number(await env.DB.prepare("SELECT COUNT(*) n FROM nv_contracts c JOIN nv_users u ON u.id=c.owner_id WHERE c.status='pending_v1' AND u.is_demo=?").bind(ws).first('n')) || 0 : 0;
        const nP = (pendingItems || []).filter(it => it.approver_role === m.role && !!it.owner_is_demo === !!m.is_demo).length;
        const total = nQ + nC + nP;
        if (!total) continue;
        const parts = [nQ && `${nQ} báo giá`, nC && `${nC} hợp đồng`, nP && `${nP} hạng mục phương án`].filter(Boolean).join(' · ');
        if (await push(m.id, { type: 'approval', title: `🧾 Việc đang chờ bạn duyệt – mốc ${hourVN}h`, body: `${total} mục: ${parts}. Duyệt sớm để không chặn tiến độ của đội.`, link: '#/plans', level: total >= 5 ? 'danger' : 'warn' })) out.approvalDigest++;
      }
    }

    /* 14. BAN GĐ / TP — cảnh báo chỉ số sale lúc 16h ngày làm việc: sales dưới 50% định mức ngày */
    if (workday && hourVN === 16) {
      for (const ws of [0, 1]) {
        const team = salesIn(ws);
        if (!team.length) continue;
        const low = [];
        for (const u of team) { const q = await quotaOf(u); if (q.pct < 50) low.push(`${u.name} ${q.pct}%`); }
        if (!low.length) continue;
        for (const m of managersFor(ws)) {
          if (await push(m.id, { type: 'sales_alert', title: '📉 Cảnh báo chỉ số sale hôm nay', body: `${low.length}/${team.length} sales dưới 50% định mức ngày: ${low.join(', ')}.`, link: '#/console', level: low.length * 2 >= team.length ? 'danger' : 'warn' })) out.salesAlert++;
        }
      }
    }

    /* 15. BAN GĐ / TP — doanh thu tháng chậm tiến độ (9h thứ Hai và ngày 25): đã chốt < 70% mức lẽ
     * ra phải đạt nếu chia đều mục tiêu tháng theo ngày */
    const dom = vn.getUTCDate();
    if (hourVN === 9 && dom >= 5 && (vn.getUTCDay() === 1 || dom === 25)) {
      const monthStart = Math.floor(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) / 1000) - 7 * 3600;
      const daysInMonth = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 0)).getUTCDate();
      for (const ws of [0, 1]) {
        const team = salesIn(ws);
        if (!team.length) continue;
        let target = 0;
        for (const u of team) target += Number((await getConfig(env, u.id)).target_revenue) || 0;
        if (!target) continue;
        const won = Number(await env.DB.prepare("SELECT SUM(d.value) v FROM nv_deals d JOIN nv_users u ON u.id=d.owner_id WHERE d.status='won' AND d.won_at>=? AND u.is_demo=?").bind(monthStart, ws).first('v')) || 0;
        const expected = target * dom / daysInMonth;
        if (won >= expected * 0.7) continue;
        for (const m of managersFor(ws)) {
          if (await push(m.id, { type: 'sales_alert', title: `📉 Doanh thu tháng chậm tiến độ (ngày ${dom})`, body: `Đã chốt ${fmtMoney(won)} / mục tiêu ${fmtMoney(target)} (${Math.round(won / target * 100)}%) — lẽ ra ~${Math.round(dom / daysInMonth * 100)}% sau ${dom}/${daysInMonth} ngày.`, link: '#/reports', level: 'danger' })) out.revenueAlert++;
        }
      }
    }

    await audit(env, null, 'cron_run', 'system', null, out);
    // notify/email rỗng: thông báo đã được ghi thẳng vào nv_notifications ở trên (in-app),
    // không nhờ nền tảng gửi push/email hộ.
    return json({ ok: true, sent: out, at: t, notify: [], email: [] });
  }

  return null;
}

/** Định mức NGÀY của một nhân sự (liên hệ mới, cuộc gọi, gặp/demo, follow-up) — dùng chung cho
 * Cockpit và thông báo tiến độ KPI của Cron để hai nơi luôn ra cùng một con số. */
async function todayQuota(env, userId, cfg, sod) {
  // follow-up = hoạt động chăm sóc trên deal/khách ĐÃ có (email/zalo/other gắn deal), tách khỏi gọi & gặp
  const a = await env.DB.prepare(`SELECT COUNT(*) n,
      SUM(CASE WHEN type="call" THEN 1 ELSE 0 END) c,
      SUM(CASE WHEN type IN ("meeting","demo") THEN 1 ELSE 0 END) m,
      SUM(CASE WHEN type IN ("email","zalo") OR (type="other" AND deal_id IS NOT NULL) THEN 1 ELSE 0 END) f
    FROM nv_activities WHERE user_id=? AND happened_at>=?`).bind(userId, sod).first();
  const dc = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_daily_contacts WHERE user_id=? AND created_at>=?').bind(userId, sod).first('n')) || 0;
  const q = {
    contacts: { done: dc, target: cfg.quota_daily_contacts || 8 },
    calls: { done: Number(a.c) || 0, target: cfg.quota_calls || 25 },
    meetings: { done: Number(a.m) || 0, target: cfg.quota_meetings || 2 },
    followups: { done: Number(a.f) || 0, target: cfg.quota_followups || 10 },
  };
  const parts = [q.contacts, q.calls, q.meetings, q.followups];
  q.pct = Math.round(parts.reduce((s, x) => s + Math.min(1, x.done / (x.target || 1)), 0) / parts.length * 100);
  q.activities = Number(a.n) || 0;
  return q;
}

const fmtHM = (ts) => { const d = new Date((ts + 7 * 3600) * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const fmtMoney = (v) => (Math.round((v || 0) / 1e6)).toLocaleString('vi-VN') + ' tr';

function greet() {
  const h = (new Date().getUTCHours() + 7) % 24;
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}
