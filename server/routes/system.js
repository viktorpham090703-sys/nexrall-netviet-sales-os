import { json, match, need, uid, now, readBody, scope, audit, str, isLead, wsBucket, wsScope, HttpError } from '../lib/util.js';
import { getSetting, setSetting, mySetting, DEFAULTS } from '../lib/settings.js';
import { FEATURES, OPS, LEVELS, ROLE_LEVEL, effFeat, effOps, levelOf } from '../lib/perm.js';
import { publicQuiz, gradeQuiz, orderLessons, PASS_PCT } from '../lib/quiz.js';

/* Phân hệ 6 · Hệ thống: cấu trúc (logo, mẫu biểu, chức danh), phân quyền, thiết lập AI trợ lý —
 * cùng các phần mới của Công việc (tài liệu đính kèm) và Đào tạo (lộ trình, bài kiểm tra). */

const MAX_FILE = 8 * 1024 * 1024;
const MAX_LOGO_CHARS = 600 * 1024;   // logo đã thu nhỏ ở trình duyệt (≤ 400px) — data URL vài chục KB
const MAX_ROAD_CHARS = 900 * 1024;   // ảnh lộ trình đã nén JPEG ở trình duyệt
const TEMPLATE_MIME = {
  'application/pdf': 'pdf',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
const TASK_FILE_MIME = { ...TEMPLATE_MIME, 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip' };
const TEMPLATE_KINDS = ['Báo giá', 'Hồ sơ năng lực công ty', 'Hợp đồng', 'Biên bản bàn giao', 'Khác'];
const ROAD_ROLES = ['sales', 'manager', 'admin', 'hr'];
const isImageDataUrl = (v) => typeof v === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v);

/** Giải mã file base64 gửi lên (cùng cách POST /api/documents). */
function decodeFile(b, allowed) {
  const mime = str(b.mime, 120) || '';
  if (!allowed[mime]) throw new HttpError(400, 'Định dạng tệp chưa được hỗ trợ');
  const base64 = String(b.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) throw new HttpError(400, 'Thiếu nội dung tệp');
  let bytes;
  try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch (e) { throw new HttpError(400, 'Nội dung tệp không hợp lệ'); }
  if (bytes.byteLength > MAX_FILE) throw new HttpError(400, 'Tệp vượt quá 8MB');
  return { mime, bytes, filename: (str(b.filename, 200) || 'tai-lieu').replace(/[\r\n"]/g, '') };
}
const fileResponse = (obj, mime, filename) => new Response(obj.body, {
  headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` },
});

/** Mô hình phân quyền trả về cho màn Phân quyền. Người không phải quản lý chỉ nhận phần của chính mình. */
async function permissionModel(ctx) {
  const perm = await mySetting(ctx, 'perm');
  const me = ctx.me;
  const canEdit = ['admin', 'hr'].includes(me.role);
  const opsMatrix = Object.fromEntries(LEVELS.map(([lv]) => [lv, Object.fromEntries(FEATURES.map(([f]) => [f, effOps(perm, lv, f)]))]));
  const base = {
    features: FEATURES, ops: OPS, threshold: perm.threshold || DEFAULTS.perm.threshold,
    myLevel: levelOf(me), myFeat: effFeat(perm, me), canEdit, canEditThreshold: me.role === 'admin',
  };
  if (!isLead(me)) {
    const lv = levelOf(me);
    return { ...base, levels: LEVELS.map(([k, n, role, scopeTxt, rights]) => ({ k, n, role, scope: scopeTxt, rights, users: [] })), opsMatrix: { [lv]: opsMatrix[lv] } };
  }
  const ws = wsScope(ctx, 'id');
  const { results: users } = await ctx.env.DB.prepare(`SELECT id,name,role,title FROM nv_users WHERE active=1 AND deleted_at IS NULL${ws.sql} ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'hr' THEN 3 ELSE 4 END, name`).bind(...ws.args).all();
  return {
    ...base,
    levels: LEVELS.map(([k, n, role, scopeTxt, rights]) => ({ k, n, role, scope: scopeTxt, rights,
      users: k === 'bod' ? [] : (users || []).filter(u => ROLE_LEVEL[u.role] === k).map(u => ({ id: u.id, name: u.name })) })),
    users: (users || []).map(u => ({ id: u.id, name: u.name, role: u.role, title: u.title, feat: effFeat(perm, u) })),
    opsMatrix,
  };
}

export async function systemRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Thiết lập chung ================= */
  if ((p = match(ctx, 'GET', '/api/settings'))) {
    need(ctx);
    const [brand, titles, ai] = await Promise.all([mySetting(ctx, 'brand'), mySetting(ctx, 'titles'), mySetting(ctx, 'ai')]);
    return json({ brand, titles, ai });
  }

  if ((p = match(ctx, 'PUT', '/api/settings/:key'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    const bucket = wsBucket(ctx.me);
    let value;
    if (p.key === 'brand') {
      if (b.logo != null && !(isImageDataUrl(b.logo) && b.logo.length <= MAX_LOGO_CHARS)) return json({ error: 'Logo phải là ảnh PNG/JPG/WEBP/SVG và nhỏ hơn 600KB' }, 400);
      value = b.logo ? { logo: b.logo } : {};
    } else if (p.key === 'titles') {
      const keys = ['1', '2', '3', '4', '5', '6', '7', 'hr'];
      value = Object.fromEntries(keys.map(k => [k, (Array.isArray(b[k]) ? b[k] : []).map(x => String(x || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)]));
    } else if (p.key === 'ai') {
      const cur = await getSetting(env, bucket, 'ai');
      value = { ...cur };
      for (const k of ['on', 'readCrm', 'readKit', 'intern', 'history']) if (b[k] != null) value[k] = !!b[k];
      if (b.provider != null) value.provider = str(b.provider, 20) || 'auto';
      if (Array.isArray(b.prompts)) value.prompts = b.prompts.map(x => String(x || '').trim().slice(0, 200)).filter(Boolean).slice(0, 12);
    } else if (/^road_(sales|manager|admin|hr)$/.test(p.key)) {
      if (b.image != null && !(isImageDataUrl(b.image) && b.image.length <= MAX_ROAD_CHARS)) return json({ error: 'Ảnh lộ trình phải là ảnh và nhỏ hơn 900KB sau khi nén' }, 400);
      value = b.image ? { image: b.image } : {};
    } else {
      return json({ error: 'Không có thiết lập này' }, 404);
    }
    await setSetting(env, bucket, p.key, value, ctx.me.id);
    await audit(env, ctx.me.id, 'update', 'setting', p.key, p.key === 'brand' || p.key.startsWith('road_') ? { changed: true } : value);
    return json({ ok: true, value: p.key.startsWith('road_') || p.key === 'brand' ? { changed: true } : value });
  }

  /* Ảnh lộ trình đào tạo của một vai trò — tách khỏi /api/settings để không nạp vài trăm KB ảnh mỗi lần. */
  if ((p = match(ctx, 'GET', '/api/settings/road/:role'))) {
    need(ctx);
    const role = ROAD_ROLES.includes(p.role) ? p.role : 'sales';
    return json(await mySetting(ctx, 'road_' + role));
  }

  /* ================= Phân quyền ================= */
  if ((p = match(ctx, 'GET', '/api/permissions'))) {
    need(ctx);
    return json(await permissionModel(ctx));
  }

  if ((p = match(ctx, 'PUT', '/api/permissions'))) {
    need(ctx, ['admin', 'hr']);
    const b = await readBody(ctx.request);
    const bucket = wsBucket(ctx.me);
    const perm = await getSetting(env, bucket, 'perm');
    const isAdminMe = ctx.me.role === 'admin';
    const featKeys = FEATURES.map(([f]) => f);
    const changed = [];
    if (b.feat && typeof b.feat === 'object') {
      const ids = Object.keys(b.feat).slice(0, 200);
      const ws = wsScope(ctx, 'id');
      const { results: rows } = ids.length
        ? await env.DB.prepare(`SELECT id,role FROM nv_users WHERE id IN (${ids.map(() => '?').join(',')})${ws.sql}`).bind(...ids, ...ws.args).all()
        : { results: [] };
      perm.feat = { ...(perm.feat || {}) };
      for (const u of rows || []) {
        // Tài khoản Admin luôn toàn quyền; HCNS không tự cấp quyền cho chính mình.
        if (u.role === 'admin' || (!isAdminMe && u.id === ctx.me.id)) continue;
        const src = b.feat[u.id] || {};
        perm.feat[u.id] = Object.fromEntries(featKeys.filter(f => f in src).map(f => [f, !!src[f]]));
      }
      changed.push('feat');
    }
    if (b.ops && typeof b.ops === 'object') {
      perm.ops = { ...(perm.ops || {}) };
      for (const [lv] of LEVELS) {
        if (!b.ops[lv]) continue;
        // Cấp Admin / BGĐ luôn toàn quyền; HCNS không sửa quyền của chính nhánh mình.
        if (lv === 'admin' || lv === 'bod' || (!isAdminMe && lv === 'hcns')) continue;
        perm.ops[lv] = { ...(perm.ops[lv] || {}) };
        for (const f of featKeys) {
          const arr = b.ops[lv][f];
          if (Array.isArray(arr) && arr.length === 5) perm.ops[lv][f] = arr.map(x => (x ? 1 : 0));
        }
      }
      changed.push('ops');
    }
    if (b.threshold != null) {
      if (!isAdminMe) return json({ error: 'Chỉ Admin / Ban Giám đốc đổi được ngưỡng duyệt' }, 403);
      const n = Math.round(Number(b.threshold));
      if (!(n >= 1000000 && n <= 100000000000)) return json({ error: 'Ngưỡng duyệt phải từ 1 triệu đồng trở lên' }, 400);
      perm.threshold = n;
      changed.push('threshold');
    }
    if (!changed.length) return json({ error: 'Không có gì để cập nhật' }, 400);
    await setSetting(env, bucket, 'perm', perm, ctx.me.id);
    await audit(env, ctx.me.id, 'update', 'permission', null, { changed, threshold: perm.threshold });
    return json({ ok: true, model: await permissionModel(ctx) });
  }

  /* ================= Mẫu biểu dùng chung ================= */
  if ((p = match(ctx, 'GET', '/api/templates'))) {
    need(ctx);
    const { results } = await env.DB.prepare(`SELECT t.id,t.kind,t.filename,t.mime,t.size,t.version,t.is_default,t.created_at,u.name uploaded_by_name
      FROM nv_templates t LEFT JOIN nv_users u ON u.id=t.uploaded_by WHERE t.uploaded_by IS NULL OR (1=1${wsScope(ctx, 't.uploaded_by').sql}) ORDER BY t.kind, t.created_at DESC`)
      .bind(wsBucket(ctx.me)).all();
    return json({ items: results || [], kinds: TEMPLATE_KINDS });
  }

  if ((p = match(ctx, 'POST', '/api/templates'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    const kind = TEMPLATE_KINDS.includes(b.kind) ? b.kind : 'Khác';
    const { mime, bytes, filename } = decodeFile(b, TEMPLATE_MIME);
    const ws = wsScope(ctx, 'uploaded_by');
    const same = Number(await env.DB.prepare(`SELECT COUNT(*) n FROM nv_templates WHERE kind=?${ws.sql}`).bind(kind, ...ws.args).first('n')) || 0;
    const id = uid('tpl'), key = `templates/${id}`;
    await env.DOCS.put(key, bytes, { httpMetadata: { contentType: mime } });
    await env.DB.prepare('INSERT INTO nv_templates (id,kind,filename,mime,size,r2_key,version,is_default,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, kind, filename, mime, bytes.byteLength, key, same + 1, same ? 0 : 1, ctx.me.id, now()).run();
    await audit(env, ctx.me.id, 'create', 'template', id, { kind, filename });
    return json({ id });
  }

  if ((p = match(ctx, 'PATCH', '/api/templates/:id'))) {
    need(ctx, ['admin']);
    const ws = wsScope(ctx, 'uploaded_by');
    const t = await env.DB.prepare(`SELECT * FROM nv_templates WHERE id=?${ws.sql}`).bind(p.id, ...ws.args).first();
    if (!t) return json({ error: 'Không tìm thấy mẫu' }, 404);
    await env.DB.batch([
      env.DB.prepare(`UPDATE nv_templates SET is_default=0 WHERE kind=?${ws.sql}`).bind(t.kind, ...ws.args),
      env.DB.prepare('UPDATE nv_templates SET is_default=1 WHERE id=?').bind(p.id),
    ]);
    await audit(env, ctx.me.id, 'set_default', 'template', p.id, { kind: t.kind });
    return json({ ok: true });
  }

  if ((p = match(ctx, 'DELETE', '/api/templates/:id'))) {
    need(ctx, ['admin']);
    const ws = wsScope(ctx, 'uploaded_by');
    const t = await env.DB.prepare(`SELECT * FROM nv_templates WHERE id=?${ws.sql}`).bind(p.id, ...ws.args).first();
    if (!t) return json({ error: 'Không tìm thấy mẫu' }, 404);
    try { await env.DOCS.delete(t.r2_key); } catch (e) { /* đã mất trên kho — vẫn xoá bản ghi */ }
    await env.DB.prepare('DELETE FROM nv_templates WHERE id=?').bind(p.id).run();
    // Xoá mẫu mặc định thì mẫu mới nhất còn lại cùng loại lên làm mặc định.
    if (t.is_default) {
      const next = await env.DB.prepare(`SELECT id FROM nv_templates WHERE kind=?${ws.sql} ORDER BY created_at DESC LIMIT 1`).bind(t.kind, ...ws.args).first();
      if (next) await env.DB.prepare('UPDATE nv_templates SET is_default=1 WHERE id=?').bind(next.id).run();
    }
    await audit(env, ctx.me.id, 'delete', 'template', p.id, { kind: t.kind, filename: t.filename });
    return json({ ok: true });
  }

  if ((p = match(ctx, 'GET', '/api/templates/:id/file'))) {
    need(ctx);
    const ws = wsScope(ctx, 'uploaded_by');
    const t = await env.DB.prepare(`SELECT * FROM nv_templates WHERE id=?${ws.sql}`).bind(p.id, ...ws.args).first();
    if (!t) return json({ error: 'Không tìm thấy mẫu' }, 404);
    const obj = await env.DOCS.get(t.r2_key);
    if (!obj) return json({ error: 'Tệp không còn trên kho lưu trữ' }, 404);
    return fileResponse(obj, t.mime, t.filename);
  }

  /* ================= Tài liệu đính kèm công việc ================= */
  const findTask = async (id) => {
    const s = scope(ctx, 'user_id');
    const task = await env.DB.prepare('SELECT * FROM nv_tasks WHERE id=?' + s.sql).bind(id, ...s.args).first();
    if (!task) throw new HttpError(404, 'Không tìm thấy công việc');
    return task;
  };

  if ((p = match(ctx, 'GET', '/api/tasks/:id/files'))) {
    need(ctx);
    await findTask(p.id);
    const { results } = await env.DB.prepare(`SELECT f.id,f.filename,f.mime,f.size,f.created_at,u.name owner_name FROM nv_task_files f
      LEFT JOIN nv_users u ON u.id=f.owner_id WHERE f.task_id=? ORDER BY f.created_at`).bind(p.id).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/tasks/:id/files'))) {
    need(ctx);
    const task = await findTask(p.id);
    const n = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_task_files WHERE task_id=?').bind(p.id).first('n')) || 0;
    if (n >= 20) return json({ error: 'Mỗi công việc đính kèm tối đa 20 tệp' }, 400);
    const { mime, bytes, filename } = decodeFile(await readBody(ctx.request), TASK_FILE_MIME);
    const id = uid('tf'), key = `tasks/${p.id}/${id}`;
    await env.DOCS.put(key, bytes, { httpMetadata: { contentType: mime } });
    await env.DB.prepare('INSERT INTO nv_task_files (id,task_id,owner_id,filename,mime,size,r2_key,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, p.id, ctx.me.id, filename, mime, bytes.byteLength, key, now()).run();
    await audit(env, ctx.me.id, 'upload', 'task_file', id, { task: task.id, filename });
    return json({ id });
  }

  if ((p = match(ctx, 'GET', '/api/tasks/:id/files/:fid'))) {
    need(ctx);
    await findTask(p.id);
    const f = await env.DB.prepare('SELECT * FROM nv_task_files WHERE id=? AND task_id=?').bind(p.fid, p.id).first();
    if (!f) return json({ error: 'Không tìm thấy tệp' }, 404);
    const obj = await env.DOCS.get(f.r2_key);
    if (!obj) return json({ error: 'Tệp không còn trên kho lưu trữ' }, 404);
    return fileResponse(obj, f.mime, f.filename);
  }

  if ((p = match(ctx, 'DELETE', '/api/tasks/:id/files/:fid'))) {
    need(ctx);
    const task = await findTask(p.id);
    const f = await env.DB.prepare('SELECT * FROM nv_task_files WHERE id=? AND task_id=?').bind(p.fid, p.id).first();
    if (!f) return json({ error: 'Không tìm thấy tệp' }, 404);
    // Người tải lên, hoặc cấp quản lý / người giao việc mới gỡ được tệp.
    if (f.owner_id !== ctx.me.id && !isLead(ctx.me) && task.assigner_id !== ctx.me.id) return json({ error: 'Chỉ người tải tệp lên mới gỡ được' }, 403);
    try { await env.DOCS.delete(f.r2_key); } catch (e) { /* noop */ }
    await env.DB.prepare('DELETE FROM nv_task_files WHERE id=?').bind(p.fid).run();
    await audit(env, ctx.me.id, 'delete', 'task_file', p.fid, { task: task.id, filename: f.filename });
    return json({ ok: true });
  }

  /* ================= Đào tạo: lộ trình tuần tự + bài kiểm tra ================= */
  const myPath = async (userId, role) => {
    const { results } = await env.DB.prepare(`SELECT t.*, tp.status prog_status, tp.best_score, tp.last_score, tp.watched_at, tp.completed_at
      FROM nv_trainings t LEFT JOIN nv_training_progress tp ON tp.training_id=t.id AND tp.user_id=?`).bind(userId).all();
    const L = orderLessons(results || [], role);
    const passed = (t) => t.prog_status === 'completed' || (t.best_score ?? -1) >= PASS_PCT;
    return L.map((t, i) => ({ ...t, passed: passed(t), unlocked: i === 0 || passed(L[i - 1]) }));
  };
  const upsertProgress = async (trainingId, fields) => {
    const t = now();
    const ex = await env.DB.prepare('SELECT * FROM nv_training_progress WHERE user_id=? AND training_id=?').bind(ctx.me.id, trainingId).first();
    const row = { status: 'in_progress', progress: 30, best_score: null, last_score: null, watched_at: null, completed_at: null, ...(ex || {}), ...fields };
    if (ex) await env.DB.prepare('UPDATE nv_training_progress SET status=?,progress=?,best_score=?,last_score=?,watched_at=?,completed_at=?,updated_at=? WHERE id=?')
      .bind(row.status, row.progress, row.best_score, row.last_score, row.watched_at, row.completed_at, t, ex.id).run();
    else await env.DB.prepare('INSERT INTO nv_training_progress (id,user_id,training_id,status,progress,best_score,last_score,watched_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(uid('tp'), ctx.me.id, trainingId, row.status, row.progress, row.best_score, row.last_score, row.watched_at, row.completed_at, t).run();
    return { ...row, existed: !!ex };
  };
  const findLesson = async (id) => {
    const L = await myPath(ctx.me.id, ctx.me.role);
    const i = L.findIndex(x => x.id === id);
    if (i < 0) throw new HttpError(404, 'Bài giảng không thuộc lộ trình của bạn');
    if (!L[i].unlocked) throw new HttpError(403, 'Bài này còn khoá — cần đạt bài kiểm tra của bài trước từ 80% trở lên');
    return { L, i, t: L[i] };
  };

  if ((p = match(ctx, 'GET', '/api/trainings/path'))) {
    need(ctx);
    const lessons = await myPath(ctx.me.id, ctx.me.role);
    let team = [];
    if (isLead(ctx.me)) {
      // Kết quả nhóm: nhân viên kinh doanh CÙNG workspace, tính trên lộ trình của chính họ.
      const ws = wsScope(ctx, 'id');
      const { results: members } = await env.DB.prepare(`SELECT id,name,role FROM nv_users WHERE role='sales' AND active=1 AND deleted_at IS NULL${ws.sql} ORDER BY name`).bind(...ws.args).all();
      for (const m of members || []) {
        const L = await myPath(m.id, m.role);
        const scored = L.map(x => x.best_score).filter(x => x != null);
        team.push({ id: m.id, name: m.name, total: L.length, done: L.filter(x => x.passed).length,
          avg: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null });
      }
    }
    return json({ items: lessons, team, passPct: PASS_PCT });
  }

  if ((p = match(ctx, 'POST', '/api/trainings/:id/watched'))) {
    need(ctx);
    const { t } = await findLesson(p.id);
    if (t.prog_status !== 'completed') await upsertProgress(p.id, { status: 'in_progress', progress: 60, watched_at: t.watched_at || now() });
    return json({ ok: true });
  }

  if ((p = match(ctx, 'GET', '/api/trainings/:id/quiz'))) {
    need(ctx);
    const { t } = await findLesson(p.id);
    return json({ questions: publicQuiz(t.category), passPct: PASS_PCT, watched: !!t.watched_at || t.passed });
  }

  if ((p = match(ctx, 'POST', '/api/trainings/:id/quiz'))) {
    need(ctx);
    const { L, i, t } = await findLesson(p.id);
    if (!t.watched_at && !t.passed) return json({ error: 'Xem hết video rồi mới làm bài kiểm tra' }, 409);
    const b = await readBody(ctx.request);
    const Q = publicQuiz(t.category);
    if (!Array.isArray(b.answers) || b.answers.length < Q.length || b.answers.some(a => a == null)) return json({ error: `Hãy trả lời đủ ${Q.length} câu` }, 400);
    const pct = gradeQuiz(t.category, b.answers);
    const pass = pct >= PASS_PCT;
    const best = Math.max(pct, t.best_score ?? 0);
    await upsertProgress(p.id, pass || t.prog_status === 'completed'
      ? { status: 'completed', progress: 100, best_score: best, last_score: pct, completed_at: t.completed_at || now() }
      : { status: 'in_progress', progress: 60, best_score: best, last_score: pct });
    await audit(env, ctx.me.id, 'quiz', 'training', p.id, { pct, pass });
    return json({ pct, passed: pass, nextId: pass && L[i + 1] ? L[i + 1].id : null, isLast: i === L.length - 1 });
  }

  return null;
}
