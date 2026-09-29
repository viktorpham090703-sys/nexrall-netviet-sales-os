import { json, match, need, needAccountManage, uid, now, readBody, isLead, audit, notify, num, str, wsScope, wsBucket, sameWorkspaceUser, requireSameWorkspaceUser, LEAD_ROLES, HttpError, scope } from '../lib/util.js';
import { askAI, AI_TASKS, providerStatus, pickProvider, testProvider, translateToEnglish } from '../lib/ai.js';
import { getConfig } from '../lib/kpi.js';
import { vEmail, vPhone, vText, vPassword, vStrongPassword, vEmployeeCode } from '../lib/validate.js';
import { hashPassword, newSetupToken, hashSetupToken } from '../lib/auth.js';
import { computeRecord } from '../lib/record.js';
import { vapidConfigError, sendPushToUser, ensurePushSchema } from '../lib/push.js';
import { mySetting } from '../lib/settings.js';

const SETUP_TOKEN_TTL = 48 * 3600; // 48 giờ — đủ để nhân sự nhận link qua Zalo/Slack rồi đặt mật khẩu

/** Những gì chuyển sang người nhận bàn giao khi nhân sự nghỉ việc — khớp đúng các câu UPDATE ở /offboard. */
const HANDOVER_COUNTS = {
  customers: 'SELECT COUNT(*) n FROM nv_customers WHERE owner_id=?',
  leads: 'SELECT COUNT(*) n FROM nv_leads WHERE owner_id=?',
  deals: "SELECT COUNT(*) n FROM nv_deals WHERE owner_id=? AND status='open'",
  tasks: "SELECT COUNT(*) n FROM nv_tasks WHERE user_id=? AND status!='done'",
  partners: 'SELECT COUNT(*) n FROM nv_partners WHERE sale_phu_trach_id=?',
  tenders: "SELECT COUNT(*) n FROM nv_tender_leads WHERE assigned_to=? AND status='new'",
};

/** Đăng xuất ngay mọi thiết bị, thu hồi khoá API chạy dưới tên người này và link đặt mật khẩu chưa dùng. */
async function cutAccess(env, userId) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM nv_sessions WHERE user_id=?').bind(userId),
    env.DB.prepare('UPDATE nv_api_keys SET active=0,revoked_at=? WHERE acts_as=? AND active=1').bind(now(), userId),
    env.DB.prepare('DELETE FROM nv_password_setup_tokens WHERE user_id=? AND used_at IS NULL').bind(userId),
  ]);
}

/** Không để workspace mất người cuối cùng có quyền quản lý tài khoản (không ai mở lại được). */
async function ensureAnotherAccountManager(env, ctx, userId) {
  const n = Number(await env.DB.prepare(
    "SELECT COUNT(*) n FROM nv_users WHERE role='admin' AND can_manage_accounts=1 AND active=1 AND deleted_at IS NULL AND is_demo=? AND id!=?")
    .bind(wsBucket(ctx.me), userId).first('n')) || 0;
  if (!n) throw new HttpError(400, 'Không thể dừng tài khoản quản trị cuối cùng còn quyền quản lý tài khoản.');
}

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
    // Hoàn thành bài giảng chỉ qua bài kiểm tra (POST /api/trainings/:id/quiz, đạt ≥ 80%) — không cho tự đánh dấu.
    if (b.status === 'completed') return json({ error: 'Bài giảng được ghi hoàn thành khi bạn làm bài kiểm tra đạt từ 80% ở mục Lộ trình đào tạo.' }, 409);
    const status = b.status === 'assigned' ? 'assigned' : 'in_progress';
    const prog = status === 'completed' ? 100 : num(b.progress, 30);
    const ex = await env.DB.prepare('SELECT id,status FROM nv_training_progress WHERE user_id=? AND training_id=?').bind(ctx.me.id, String(b.trainingId)).first();
    // Bấm xem lại video của bài đã đạt không được kéo bài đó về "đang học".
    if (ex && ex.status === 'completed') return json({ ok: true });
    if (ex) await env.DB.prepare('UPDATE nv_training_progress SET status=?,progress=?,completed_at=?,updated_at=? WHERE id=?')
      .bind(status, prog, status === 'completed' ? t : null, t, ex.id).run();
    else await env.DB.prepare('INSERT INTO nv_training_progress (id,user_id,training_id,status,progress,assigned_by,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(uid('tp'), ctx.me.id, String(b.trainingId), status, prog, null, status === 'completed' ? t : null, t).run();
    return json({ ok: true });
  }

  if ((p = match(ctx, 'POST', '/api/trainings/assign'))) {
    need(ctx, LEAD_ROLES);
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
    need(ctx, LEAD_ROLES);
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
    need(ctx, LEAD_ROLES);
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
    // Thiết lập AI trợ lý của công ty (Hệ thống › Thiết lập AI trợ lý).
    const aiCfg = await mySetting(ctx, 'ai');
    if (!aiCfg.on && ctx.me.role !== 'admin') return json({ error: 'AI trợ lý đang được Ban Giám đốc tạm tắt.' }, 403);
    const { results: products } = aiCfg.readKit
      ? await env.DB.prepare('SELECT id,name,line,unit,price,commission_rate,max_discount,description FROM nv_products WHERE active=1').all()
      : { results: [] };
    let customerName = null;
    if (b.customerId && aiCfg.readCrm) {
      // Chỉ đọc tên khách trong đúng phạm vi dữ liệu của người hỏi (nhân viên chỉ thấy khách của mình).
      const s = scope(ctx, 'owner_id');
      customerName = (await env.DB.prepare('SELECT name FROM nv_customers WHERE id=?' + s.sql).bind(String(b.customerId), ...s.args).first())?.name || null;
    }
    const provider = b.provider && b.provider !== 'auto' ? b.provider : aiCfg.provider;
    const res = await askAI(env, {
      kind: b.kind, prompt, provider, lang: ctx.request.headers.get('X-Lang'),
      context: { products: products || [], userName: ctx.me.name, customerName, extra: str(b.extra, 800) || null },
    });
    // Tắt "Lưu lịch sử hỏi đáp" vẫn ghi 1 dòng (để KPI "Dùng AI hỗ trợ" đếm đúng số lần dùng) nhưng bỏ nội dung.
    await env.DB.prepare('INSERT INTO nv_ai_interactions (id,user_id,kind,prompt,response,created_at) VALUES (?,?,?,?,?,?)')
      .bind(uid('ai'), ctx.me.id, res.kind + (res.mock ? '' : '·' + res.provider), aiCfg.history ? prompt.slice(0, 500) : '', aiCfg.history ? res.text.slice(0, 4000) : '', now()).run();
    return json({ ...res, providers: providerStatus(env) });
  }

  // ===== Dịch dữ liệu người dùng sang tiếng Anh (giao diện EN) =====
  // src/autoTranslate.js gửi các đoạn chữ tiếng Việt còn sót trên màn hình (tên deal, tên khách, ghi
  // chú… — thứ từ điển cố định không dịch được). Tra bảng nv_translations trước; chỉ đoạn CHƯA từng
  // dịch mới gọi AI, dịch xong lưu lại nên mỗi đoạn chỉ tốn AI đúng một lần cho cả hệ thống.
  // available=false khi chưa cấu hình API key AI nào → client ngừng hỏi lại trong phiên đó.
  if ((p = match(ctx, 'POST', '/api/i18n/translate'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const texts = [...new Set((Array.isArray(b.texts) ? b.texts : [])
      .map((s) => String(s == null ? '' : s).trim()).filter((s) => s && s.length <= 500))].slice(0, 60);
    const translations = {};
    if (!texts.length) return json({ translations, available: true });
    const { results } = await env.DB.prepare(`SELECT src,en FROM nv_translations WHERE src IN (${texts.map(() => '?').join(',')})`)
      .bind(...texts).all();
    for (const r of results || []) translations[r.src] = r.en;
    const missing = texts.filter((s) => !(s in translations));
    let available = true;
    if (missing.length) {
      try {
        const en = await translateToEnglish(env, missing);
        if (!en) available = false;
        else {
          const t = now();
          const stmts = [];
          missing.forEach((s, i) => {
            if (!en[i]) return;
            translations[s] = en[i];
            stmts.push(env.DB.prepare('INSERT OR REPLACE INTO nv_translations (src,en,created_at) VALUES (?,?,?)').bind(s, en[i], t));
          });
          if (stmts.length) await env.DB.batch(stmts);
        }
      } catch (e) {
        console.error('translate error', e && e.message);
        available = false;
      }
    }
    return json({ translations, available });
  }

  // ===== Web Push =====
  // Xác thực: need(ctx) — ctx.me lấy từ "Authorization: Bearer <nv_session_token>" (server/lib/auth.js),
  // đúng cơ chế của mọi API khác. Mọi truy vấn đều ràng buộc user_id = ctx.me.id: không đọc, xoá hay
  // gửi tới thiết bị của tài khoản khác.

  if ((p = match(ctx, 'POST', '/api/push/subscribe'))) {
    need(ctx);
    await ensurePushSchema(env);

    const b = await readBody(ctx.request);
    const endpoint = str(b.endpoint, 2000);
    const p256dh = str(b.keys?.p256dh, 500);
    const auth = str(b.keys?.auth, 500);

    let endpointUrl;
    try { endpointUrl = endpoint ? new URL(endpoint) : null; } catch (e) { endpointUrl = null; }
    if (!endpointUrl || endpointUrl.protocol !== 'https:' || !validKey(p256dh, 65) || !validKey(auth, 16)) {
      return json({ error: 'Subscription Push không hợp lệ' }, 400);
    }

    const t = now();

    // Cùng endpoint đăng ký lại → cập nhật (không tạo bản trùng). Endpoint chỉ trình duyệt đang giữ khoá
    // mới có, nên khi một tài khoản khác đăng nhập trên CHÍNH trình duyệt đó và bật thông báo, thiết bị
    // chuyển sang tài khoản đang đăng nhập — tài khoản cũ thôi nhận push trên máy không còn là của mình.
    await env.DB.prepare(`
      INSERT INTO nv_push_subscriptions
        (id, user_id, endpoint, p256dh, auth, user_agent, platform,
         created_at, updated_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        platform = excluded.platform,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at
    `).bind(
      uid('push'),
      ctx.me.id,
      endpointUrl.toString(),
      p256dh,
      auth,
      str(ctx.request.headers.get('user-agent'), 500),
      pushPlatform(ctx.request.headers.get('user-agent')),
      t,
      t,
      t
    ).run();

    const row = await env.DB.prepare('SELECT id FROM nv_push_subscriptions WHERE endpoint=? AND user_id=?').bind(endpointUrl.toString(), ctx.me.id).first();
    return json({ ok: true, id: row?.id || null });
  }

  if ((p = match(ctx, 'GET', '/api/push/status'))) {
    need(ctx);
    await ensurePushSchema(env);

    const { results } = await env.DB.prepare(`
      SELECT id, platform, user_agent, created_at, updated_at, last_used_at
      FROM nv_push_subscriptions
      WHERE user_id=?
      ORDER BY updated_at DESC
    `).bind(ctx.me.id).all();

    // ?endpoint=… (tuỳ chọn): trình duyệt hỏi "subscription đang có ở máy này đã được lưu cho CHÍNH tài
    // khoản này chưa?" — tránh hiện "Đang bật" khi trình duyệt có subscription nhưng máy chủ không có.
    const endpoint = str(url.searchParams.get('endpoint'), 2000);
    const currentDevice = endpoint
      ? !!(await env.DB.prepare('SELECT 1 FROM nv_push_subscriptions WHERE user_id=? AND endpoint=?').bind(ctx.me.id, endpoint).first())
      : null;

    const configError = vapidConfigError(env);
    return json({
      enabled: (results || []).length > 0,
      subscriptions: results || [],
      currentDevice,
      vapidPublicKey: configError ? null : env.VAPID_PUBLIC_KEY,   // chỉ khoá CÔNG KHAI; khoá riêng không bao giờ rời máy chủ
      configured: !configError,
      configError,
    });
  }

  if ((p = match(ctx, 'DELETE', '/api/push/subscribe'))) {
    need(ctx);
    await ensurePushSchema(env);

    const endpoint = str(url.searchParams.get('endpoint'), 2000);
    const id = str(url.searchParams.get('id'), 120);

    if (!endpoint && !id) {
      return json({ error: 'Thiếu subscription Push' }, 400);
    }

    const r = id
      ? await env.DB.prepare('DELETE FROM nv_push_subscriptions WHERE user_id=? AND id=?').bind(ctx.me.id, id).run()
      : await env.DB.prepare('DELETE FROM nv_push_subscriptions WHERE user_id=? AND endpoint=?').bind(ctx.me.id, endpoint).run();

    // 404 cả khi thiết bị thuộc tài khoản KHÁC — không tiết lộ là nó có tồn tại.
    if (!r.meta?.changes) return json({ error: 'Không tìm thấy thiết bị đã đăng ký thông báo' }, 404);
    return json({ ok: true, removed: r.meta.changes });
  }

  if ((p = match(ctx, 'POST', '/api/push/test'))) {
    need(ctx);
    const configError = vapidConfigError(env);
    if (configError) return json({ error: 'Push chưa được cấu hình trên máy chủ', configError }, 503);

    // Nội dung thử tuỳ chọn {title, body, link, tag} — đi qua safePushPayload() như mọi push khác
    // (cắt độ dài, link chỉ được là route nội bộ "#/…"). Chỉ gửi tới thiết bị của CHÍNH người gọi.
    // Truyền dữ liệu THÔ: sendPushToUser() → safePushPayload() đã làm sạch đúng 1 lần. Làm sạch trước ở đây
    // sẽ bị làm sạch lần hai trên object không còn trường `link` → mọi link bị đổi thành Cockpit.
    const b = await readBody(ctx.request);
    const result = await sendPushToUser(env, ctx.me.id, {
      title: str(b.title, 200) || 'NetViet Sales OS',
      body: str(b.body, 400) || 'Push Notification đang hoạt động.',
      link: str(b.link, 300) || '/#/cockpit',
      tag: str(b.tag, 120) || 'salesos-push-test',
    });

    if (!result.total) return json({ error: 'Tài khoản này chưa có thiết bị nào bật thông báo', ...result }, 404);
    if (result.sent) return json({ ok: true, ...result });
    if (result.removed && !result.failed) {
      return json({ error: 'Đăng ký thông báo trên thiết bị đã hết hạn và đã được gỡ; hãy bật lại thông báo', ...result }, 410);
    }
    return json({ error: 'Dịch vụ push không nhận thông báo cho các thiết bị đã đăng ký', ...result }, 502);
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
    need(ctx, LEAD_ROLES);
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
    need(ctx, LEAD_ROLES);
    // Chỉ liệt kê nhân sự CÙNG workspace (demo/chính thức) với người xem — tài khoản demo (mật
    // khẩu công khai trên màn đăng nhập) không được thấy tên/thông tin nhân sự chính thức thật.
    const { results } = await env.DB.prepare('SELECT id,name,email,role,title,phone,active,created_at,status_reason,status_changed_at,deleted_at FROM nv_users WHERE is_demo=? ORDER BY role, name').bind(wsBucket(ctx.me)).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/users'))) {
    needAccountManage(ctx);
    const b = await readBody(ctx.request);
    const uName = vText(b.name, 'Tên nhân sự', { max: 80, required: true, min: 2 });
    const id = vEmployeeCode(b.code);
    const uEmail = vEmail(b.email);
    // Mật khẩu: cho phép bỏ trống — Admin dùng liên kết thiết lập mật khẩu (setup-link) thay vì
    // tự gõ mật khẩu cho nhân sự, để không phải biết mật khẩu thật của họ.
    const uPassword = vPassword(b.password, 'Mật khẩu', { required: false });
    if (uEmail) {
      const dup = await env.DB.prepare('SELECT id FROM nv_users WHERE LOWER(email)=?').bind(uEmail.toLowerCase()).first();
      if (dup) return json({ error: `Email ${uEmail} đã được dùng cho tài khoản khác.` }, 409);
    }
    const dupId = await env.DB.prepare('SELECT id FROM nv_users WHERE UPPER(id)=?').bind(id).first();
    if (dupId) return json({ error: `Mã nhân viên ${id} đã được dùng cho tài khoản khác.` }, 409);
    const passwordHash = uPassword ? await hashPassword(uPassword) : null;
    // Tài khoản mới kế thừa workspace của người tạo — Admin demo tạo thì vẫn là demo, Admin
    // chính thức tạo thì là chính thức. Không để lẫn 2 workspace ngay từ lúc tạo tài khoản.
    // Admin đặt sẵn mật khẩu → Admin biết mật khẩu đó, nên buộc nhân sự đổi ở lần đăng nhập đầu.
    await env.DB.prepare('INSERT INTO nv_users (id,name,email,role,title,phone,active,created_at,password_hash,is_demo,must_change_password) VALUES (?,?,?,?,?,?,1,?,?,?,?)')
      .bind(id, uName, uEmail, ['sales', 'manager', 'admin', 'hr'].includes(b.role) ? b.role : 'sales', str(b.title, 80), vPhone(b.phone), now(), passwordHash, wsBucket(ctx.me), passwordHash ? 1 : 0).run();
    await audit(env, ctx.me.id, 'create', 'user', id, { name: b.name });
    return json({ id });
  }

  /* --- Admin sửa được Trạng thái (khoá/mở), Đặt lại mật khẩu, và Vai trò/Chức danh (phân công
     tổ chức) của nhân sự khác — nhưng KHÔNG được đụng tên/email/SĐT hay các trường hồ sơ cá nhân
     (ngày sinh, CCCD, địa chỉ, trường học, liên hệ khẩn cấp) của người khác nữa. Hồ sơ cá nhân giờ
     chỉ chính chủ tự sửa được qua trang "Hồ sơ nhân sự" (/api/account/profile) — kể cả Admin cũng
     chỉ XEM được phần đó, không sửa được. --- */
  if ((p = match(ctx, 'PATCH', '/api/users/:id'))) {
    needAccountManage(ctx);
    const b = await readBody(ctx.request);
    // Coi như "không tồn tại" nếu khác workspace — Admin demo không được sửa/khoá tài khoản
    // chính thức thật (và ngược lại), kể cả khi biết đúng mã nhân viên.
    const u = await requireSameWorkspaceUser(env, ctx, p.id);
    if (!u) return json({ error: 'Không tìm thấy người dùng' }, 404);
    if (u.deleted_at) return json({ error: 'Nhân sự đã nghỉ việc — hãy khôi phục trước khi chỉnh sửa.' }, 409);
    // Mật khẩu: bỏ trống = giữ nguyên, có nhập mới = đặt lại
    const newPassword = vPassword(b.password, 'Mật khẩu', { required: false });
    const passwordHash = newPassword ? await hashPassword(newPassword) : u.password_hash;
    const role = ['sales', 'manager', 'admin', 'hr'].includes(b.role) ? b.role : u.role;
    const title = b.title != null ? str(b.title, 80) : u.title;
    const active = b.active != null ? (b.active ? 1 : 0) : u.active;
    const statusChanged = active !== Number(u.active);
    if (statusChanged && !active) {
      if (p.id === ctx.me.id) return json({ error: 'Bạn không thể tự tạm dừng tài khoản của chính mình.' }, 400);
      await ensureAnotherAccountManager(env, ctx, p.id);
    }
    const reason = statusChanged ? (active ? null : vText(b.reason, 'Lý do tạm dừng', { max: 300, required: true })) : u.status_reason;
    await env.DB.prepare('UPDATE nv_users SET active=?,password_hash=?,role=?,title=?,status_reason=?,status_changed_at=? WHERE id=?')
      .bind(active, passwordHash, role, title, reason, statusChanged ? now() : u.status_changed_at, p.id).run();
    if (statusChanged && !active) await cutAccess(env, p.id);
    await audit(env, ctx.me.id, statusChanged ? (active ? 'resume_user' : 'suspend_user') : 'update', 'user', p.id,
      { passwordReset: !!newPassword, ...(statusChanged && !active ? { reason } : {}) });
    return json({ ok: true });
  }

  /* --- Nghỉ việc: đếm những gì nhân sự đang giữ để Admin chọn người nhận bàn giao --- */
  if ((p = match(ctx, 'GET', '/api/users/:id/holdings'))) {
    needAccountManage(ctx);
    const u = await requireSameWorkspaceUser(env, ctx, p.id);
    if (!u) return json({ error: 'Không tìm thấy người dùng' }, 404);
    const counts = {};
    for (const [k, sql] of Object.entries(HANDOVER_COUNTS)) {
      counts[k] = Number(await env.DB.prepare(sql).bind(p.id).first('n')) || 0;
    }
    return json({ counts });
  }

  /* --- Nghỉ việc = xoá MỀM: chuyển khách/lead/deal đang mở/việc chưa xong/partner sang người nhận
     bàn giao, cắt mọi quyền truy cập, ẩn khỏi danh sách. Deal đã chốt, hoa hồng, hợp đồng, báo giá
     và nhật ký giữ nguyên tên người cũ để lịch sử doanh thu & hoa hồng không bị sai lệch. --- */
  if ((p = match(ctx, 'POST', '/api/users/:id/offboard'))) {
    needAccountManage(ctx);
    const b = await readBody(ctx.request);
    const u = await requireSameWorkspaceUser(env, ctx, p.id);
    if (!u) return json({ error: 'Không tìm thấy người dùng' }, 404);
    if (u.deleted_at) return json({ error: 'Nhân sự này đã được đánh dấu nghỉ việc.' }, 409);
    if (p.id === ctx.me.id) return json({ error: 'Bạn không thể tự xoá tài khoản của chính mình.' }, 400);
    await ensureAnotherAccountManager(env, ctx, p.id);
    const reason = vText(b.reason, 'Lý do nghỉ việc', { max: 300, required: true });

    let held = 0;
    for (const sql of Object.values(HANDOVER_COUNTS)) held += Number(await env.DB.prepare(sql).bind(p.id).first('n')) || 0;
    let to = null;
    if (b.transferTo) {
      to = await requireSameWorkspaceUser(env, ctx, String(b.transferTo));
      if (!to || !to.active || to.deleted_at || to.id === p.id) return json({ error: 'Người nhận bàn giao không hợp lệ.' }, 400);
    } else if (held > 0) {
      return json({ error: 'Nhân sự này còn khách hàng/deal/công việc đang giữ — vui lòng chọn người nhận bàn giao.' }, 400);
    }

    const t = now();
    const stmts = [env.DB.prepare('UPDATE nv_users SET active=0,deleted_at=?,status_reason=?,status_changed_at=? WHERE id=?').bind(t, reason, t, p.id)];
    if (to) {
      stmts.push(
        env.DB.prepare('UPDATE nv_customers SET owner_id=?,updated_at=? WHERE owner_id=?').bind(to.id, t, p.id),
        env.DB.prepare('UPDATE nv_leads SET owner_id=? WHERE owner_id=?').bind(to.id, p.id),
        env.DB.prepare("UPDATE nv_deals SET owner_id=?,updated_at=? WHERE owner_id=? AND status='open'").bind(to.id, t, p.id),
        env.DB.prepare("UPDATE nv_tasks SET user_id=? WHERE user_id=? AND status!='done'").bind(to.id, p.id),
        env.DB.prepare('UPDATE nv_partners SET sale_phu_trach_id=?,updated_at=? WHERE sale_phu_trach_id=?').bind(to.id, t, p.id),
        env.DB.prepare("UPDATE nv_tender_leads SET assigned_to=? WHERE assigned_to=? AND status='new'").bind(to.id, p.id),
      );
    }
    await env.DB.batch(stmts);
    await cutAccess(env, p.id);
    await env.DB.prepare('DELETE FROM nv_push_subscriptions WHERE user_id=?').bind(p.id).run();
    if (to && held > 0) {
      await notify(env, to.id, {
        type: 'handover', title: `Nhận bàn giao từ ${u.name}`,
        body: `${u.name} đã nghỉ việc. Khách hàng, deal đang mở và công việc chưa xong đã được chuyển sang bạn.`, link: '#/crm', level: 'warn',
      });
    }
    await audit(env, ctx.me.id, 'offboard_user', 'user', p.id, { reason, transferTo: to ? to.id : null, held });
    return json({ ok: true });
  }

  /* --- Khôi phục nhân sự đã nghỉ việc về trạng thái Tạm dừng (Admin tự bấm cho làm lại sau).
     Những gì đã bàn giao KHÔNG tự chuyển ngược lại. --- */
  if ((p = match(ctx, 'POST', '/api/users/:id/restore'))) {
    needAccountManage(ctx);
    const u = await requireSameWorkspaceUser(env, ctx, p.id);
    if (!u || !u.deleted_at) return json({ error: 'Không tìm thấy nhân sự đã nghỉ việc' }, 404);
    await env.DB.prepare('UPDATE nv_users SET deleted_at=NULL,status_reason=?,status_changed_at=? WHERE id=?')
      .bind('Khôi phục sau khi nghỉ việc', now(), p.id).run();
    await audit(env, ctx.me.id, 'restore_user', 'user', p.id, {});
    return json({ ok: true });
  }

  /* --- Admin xem hồ sơ nhân sự (Thông tin cá nhân) của người khác — CHỈ ĐỌC, không có route
     sửa nào cho Admin ở đây; sửa chỉ có ở /api/account/profile do chính chủ gọi. --- */
  if ((p = match(ctx, 'GET', '/api/users/:id/profile'))) {
    needAccountManage(ctx);
    const u = await requireSameWorkspaceUser(env, ctx, p.id);
    if (!u) return json({ error: 'Không tìm thấy người dùng' }, 404);
    const profile = await env.DB.prepare(
      'SELECT id,name,email,role,title,phone,gender,birth_date,id_number,id_issue_date,id_issue_place,id_expiry,address,school,education_level,emergency_contact,sales_experience,past_positions FROM nv_users WHERE id=?')
      .bind(p.id).first();
    return json({ profile });
  }

  /* --- Admin xem Thành tích & Vi phạm của nhân sự — tính trực tiếp từ dữ liệu Sales OS, chỉ đọc. --- */
  if ((p = match(ctx, 'GET', '/api/users/:id/record'))) {
    needAccountManage(ctx);
    const u = await requireSameWorkspaceUser(env, ctx, p.id);
    if (!u) return json({ error: 'Không tìm thấy người dùng' }, 404);
    return json(await computeRecord(env, u));
  }

  /* ---- Liên kết thiết lập mật khẩu (dùng 1 lần) ----
     Cùng cơ chế phục vụ cả cấp tài khoản lần đầu (purpose=invite) lẫn quên mật khẩu
     (purpose=reset). App chưa có hạ tầng gửi email nên Admin tự gửi link qua kênh nội bộ. */
  if ((p = match(ctx, 'POST', '/api/users/:id/setup-link'))) {
    needAccountManage(ctx);
    // QUAN TRỌNG: chặn Admin demo tạo link đặt mật khẩu cho tài khoản chính thức (và ngược lại) —
    // nếu không, Admin demo (mật khẩu công khai) có thể tự cấp mật khẩu mới để CHIẾM tài khoản thật.
    const u = await requireSameWorkspaceUser(env, ctx, p.id);
    if (!u) return json({ error: 'Không tìm thấy người dùng' }, 404);
    if (u.deleted_at) return json({ error: 'Nhân sự đã nghỉ việc — không cấp liên kết đặt mật khẩu.' }, 409);
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
    const password = vStrongPassword(b.password, 'Mật khẩu');
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

/** Khoá của PushSubscription là base64url: p256dh = khoá P-256 raw 65 byte, auth = 16 byte. */
function validKey(value, bytes) {
  if (!value || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '') + '='.repeat((4 - value.replace(/=+$/, '').length % 4) % 4)).length === bytes;
  } catch (e) { return false; }
}

function pushPlatform(userAgent) {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  return 'other';
}
