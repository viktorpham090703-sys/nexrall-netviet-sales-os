import { json, match, need, uid, now, DAY, readBody, scope, isLead, audit, num, str, startOfDay, wsScope, sameWorkspaceUser } from '../lib/util.js';
import { scoreLead } from '../lib/ai.js';
import { vEmail, vPhone, vText, vPastTs, vCount } from '../lib/validate.js';

/** Khoá chuẩn hoá để so trùng: bỏ dấu, bỏ ký tự thừa, thường hoá. Chuyển "đ"→"d" TRƯỚC khi
 * chuẩn hoá NFD vì "đ" (U+0111) không có phân rã NFD — để nguyên sẽ bị xoá luôn ở bước lọc
 * ký tự cuối, khiến "Đông Đô" và "Dong Do" không khớp nhau. Cùng cách làm với tokenize() ở ai.js. */
const normName = (s) => String(s || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(cong ty|cty|tnhh|co phan|cp|jsc|ltd|corp)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
const normPhone = (s) => String(s || '').replace(/\D/g, '').replace(/^84/, '0');

/**
 * Chống trùng khách hàng (FR-M2-7) + deal registration.
 * Trả về bản ghi trùng đầu tiên, kèm chủ sở hữu để cảnh báo "sales khác đã đăng ký".
 * CHỈ so trùng trong đúng workspace (demo/chính thức) của người xem — nếu không, 1 tài khoản
 * demo (mật khẩu công khai) có thể dò ra tên khách hàng + tên sales thật qua thông báo 409.
 */
async function findDuplicateCustomer(env, ctx, name, phone, excludeId) {
  const nk = normName(name), pk = normPhone(phone);
  if (!nk && !pk) return null;
  const ws = wsScope(ctx, 'c.owner_id');
  const { results } = await env.DB.prepare(
    `SELECT c.id,c.name,c.phone,c.owner_id,u.name owner_name FROM nv_customers c LEFT JOIN nv_users u ON u.id=c.owner_id WHERE 1=1${ws.sql} LIMIT 2000`)
    .bind(...ws.args).all();
  return (results || []).find(c => c.id !== excludeId && ((pk && normPhone(c.phone) === pk) || (nk && normName(c.name) === nk))) || null;
}

export async function crmRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Khách hàng ================= */
  if ((p = match(ctx, 'GET', '/api/customers'))) {
    need(ctx);
    const s = scope(ctx, 'c.owner_id');
    const q = (url.searchParams.get('q') || '').trim();
    const temp = url.searchParams.get('temp') || '';
    let sql = `SELECT c.*, u.name owner_name,
      (SELECT COUNT(*) FROM nv_deals d WHERE d.customer_id=c.id AND d.status='open') open_deals,
      (SELECT COALESCE(SUM(d.value),0) FROM nv_deals d WHERE d.customer_id=c.id AND d.status='won') won_value
      FROM nv_customers c LEFT JOIN nv_users u ON u.id=c.owner_id WHERE 1=1` + s.sql;
    const args = [...s.args];
    if (q) { sql += ' AND (LOWER(c.name) LIKE ? OR LOWER(c.industry) LIKE ?)'; args.push('%' + q.toLowerCase() + '%', '%' + q.toLowerCase() + '%'); }
    if (temp) { sql += ' AND c.temp=?'; args.push(temp); }
    sql += ' ORDER BY c.last_touch_at DESC LIMIT 200';
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/customers'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const name = vText(b.name, 'Tên khách hàng', { max: 160, required: true, min: 2 });
    const phone = vPhone(b.phone), email = vEmail(b.email);

    // Chống trùng — trừ khi người dùng xác nhận "vẫn tạo" (force)
    if (!b.force) {
      const dup = await findDuplicateCustomer(env, ctx, name, phone);
      if (dup) {
        const mine = dup.owner_id === ctx.me.id;
        return json({
          error: mine
            ? `Khách "${dup.name}" đã có trong danh sách của bạn.`
            : `Khách "${dup.name}" đã được ${dup.owner_name || 'sales khác'} đăng ký. Vui lòng trao đổi trước khi tiếp cận (deal registration).`,
          duplicate: { id: dup.id, name: dup.name, ownerName: dup.owner_name, mine },
        }, 409);
      }
    }

    // TP/Admin có thể gán khách cho nhân sự khác — nhưng chỉ nhân sự CÙNG workspace (demo/chính
    // thức) với người gán; id không hợp lệ/khác workspace thì coi như không gán, rơi về chính người tạo.
    const owner = isLead(ctx.me) && b.ownerId ? await sameWorkspaceUser(env, ctx, b.ownerId) : null;
    const t = now(), id = uid('cs');
    await env.DB.prepare('INSERT INTO nv_customers (id,owner_id,name,industry,scale,phone,email,address,temp,source,note,services,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, owner ? owner.id : ctx.me.id, name, str(b.industry, 60), str(b.scale, 40),
        phone, email, str(b.address, 200), ['hot', 'warm', 'cold'].includes(b.temp) ? b.temp : 'warm',
        str(b.source, 60), str(b.note, 1000), JSON.stringify(Array.isArray(b.services) ? b.services.slice(0, 5) : []), t, t, t).run();
    await audit(env, ctx.me.id, 'create', 'customer', id, { name: b.name });
    return json({ id });
  }

  if ((p = match(ctx, 'GET', '/api/customers/:id'))) {
    need(ctx);
    const s = scope(ctx, 'owner_id');
    const cus = await env.DB.prepare('SELECT * FROM nv_customers WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!cus) return json({ error: 'Không tìm thấy khách hàng' }, 404);
    const [contacts, deals, acts, quotes] = await Promise.all([
      env.DB.prepare('SELECT * FROM nv_contacts WHERE customer_id=? ORDER BY is_primary DESC').bind(p.id).all(),
      env.DB.prepare('SELECT * FROM nv_deals WHERE customer_id=? ORDER BY updated_at DESC').bind(p.id).all(),
      env.DB.prepare('SELECT a.*, u.name user_name FROM nv_activities a LEFT JOIN nv_users u ON u.id=a.user_id WHERE a.customer_id=? ORDER BY a.happened_at DESC LIMIT 40').bind(p.id).all(),
      env.DB.prepare('SELECT * FROM nv_quotes WHERE customer_id=? ORDER BY created_at DESC').bind(p.id).all(),
    ]);
    // Gợi ý cross-sell / tái ký (AI mock dựa trên dữ liệu thật)
    const lines = new Set((deals.results || []).map(d => d.service));
    const all = ['TVC/Video', 'Gameshow', 'Xây kênh'];
    const suggestions = all.filter(x => !lines.has(x)).map(x => ({
      type: 'cross-sell', service: x,
      text: `Khách chưa dùng mảng ${x} — đề xuất gói ${x === 'Gameshow' ? 'Booking talkshow chuyên đề' : x === 'Xây kênh' ? 'TikTok triệu view 3 tháng' : 'TVC AI 15s'} để mở rộng giá trị hợp đồng.`,
    }));
    const wonOld = (deals.results || []).filter(d => d.status === 'won' && (now() - (d.won_at || 0)) > 60 * DAY);
    if (wonOld.length) suggestions.unshift({ type: 're-sign', service: wonOld[0].service, text: `Hợp đồng "${wonOld[0].title}" đã hơn 2 tháng — thời điểm tốt để chào tái ký/gia hạn.` });
    if ((now() - (cus.last_touch_at || 0)) > 14 * DAY) suggestions.unshift({ type: 'warm-up', service: '', text: 'Đã hơn 14 ngày không tương tác — gửi bản tin case-study để hâm nóng.' });

    return json({ customer: cus, contacts: contacts.results || [], deals: deals.results || [], activities: acts.results || [], quotes: quotes.results || [], suggestions });
  }

  if ((p = match(ctx, 'PATCH', '/api/customers/:id'))) {
    need(ctx);
    const s = scope(ctx, 'owner_id');
    const cur = await env.DB.prepare('SELECT * FROM nv_customers WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!cur) return json({ error: 'Không tìm thấy khách hàng' }, 404);
    const b = await readBody(ctx.request);
    const newOwner = isLead(ctx.me) && b.ownerId ? await sameWorkspaceUser(env, ctx, b.ownerId) : null;
    const f = {
      name: b.name != null ? str(b.name, 160) : cur.name,
      industry: b.industry != null ? str(b.industry, 60) : cur.industry,
      phone: b.phone != null ? vPhone(b.phone) : cur.phone,
      email: b.email != null ? vEmail(b.email) : cur.email,
      temp: ['hot', 'warm', 'cold'].includes(b.temp) ? b.temp : cur.temp,
      note: b.note != null ? str(b.note, 1000) : cur.note,
      owner_id: newOwner ? newOwner.id : cur.owner_id,
    };
    await env.DB.prepare('UPDATE nv_customers SET name=?,industry=?,phone=?,email=?,temp=?,note=?,owner_id=?,updated_at=? WHERE id=?')
      .bind(f.name, f.industry, f.phone, f.email, f.temp, f.note, f.owner_id, now(), p.id).run();
    await audit(env, ctx.me.id, 'update', 'customer', p.id, {});
    return json({ ok: true });
  }

  /** Xoá khách hàng — chỉ TP/Admin, chặn nếu còn deal gắn với khách. */
  if ((p = match(ctx, 'DELETE', '/api/customers/:id'))) {
    need(ctx, ['manager', 'admin']);
    const s = scope(ctx, 'owner_id');
    const cus = await env.DB.prepare('SELECT * FROM nv_customers WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!cus) return json({ error: 'Không tìm thấy khách hàng' }, 404);
    const n = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_deals WHERE customer_id=?').bind(p.id).first('n')) || 0;
    if (n) return json({ error: `Khách hàng còn ${n} cơ hội gắn kèm. Hãy xử lý các deal trước khi xoá.` }, 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM nv_contacts WHERE customer_id=?').bind(p.id),
      env.DB.prepare('UPDATE nv_activities SET customer_id=NULL WHERE customer_id=?').bind(p.id),
      env.DB.prepare('DELETE FROM nv_customers WHERE id=?').bind(p.id),
    ]);
    await audit(env, ctx.me.id, 'delete', 'customer', p.id, { name: cus.name });
    return json({ ok: true });
  }

  if ((p = match(ctx, 'POST', '/api/contacts'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    if (!b.customerId || !b.name) return json({ error: 'Thiếu khách hàng hoặc tên người liên hệ' }, 400);
    const id = uid('ct');
    await env.DB.prepare('INSERT INTO nv_contacts (id,customer_id,name,title,phone,email,is_primary,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, String(b.customerId), vText(b.name, 'Tên người liên hệ', { max: 80, required: true }), str(b.title, 80),
        vPhone(b.phone), vEmail(b.email), b.isPrimary ? 1 : 0, now()).run();
    return json({ id });
  }

  /* ================= Hoạt động ================= */
  if ((p = match(ctx, 'GET', '/api/activities'))) {
    need(ctx);
    const s = scope(ctx, 'a.user_id');
    const days = num(url.searchParams.get('days'), 14);
    const cid = url.searchParams.get('customerId');
    let sql = `SELECT a.*, u.name user_name, c.name customer_name FROM nv_activities a
      LEFT JOIN nv_users u ON u.id=a.user_id LEFT JOIN nv_customers c ON c.id=a.customer_id
      WHERE a.happened_at >= ?` + s.sql;
    const args = [now() - days * DAY, ...s.args];
    if (cid) { sql += ' AND a.customer_id=?'; args.push(cid); }
    sql += ' ORDER BY a.happened_at DESC LIMIT 200';
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const sod = startOfDay();
    const stats = { today: (results || []).filter(r => r.happened_at >= sod).length, total: (results || []).length };
    return json({ items: results || [], stats });
  }

  if ((p = match(ctx, 'POST', '/api/activities'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const types = ['call', 'email', 'meeting', 'demo', 'zalo', 'other'];
    if (!types.includes(b.type)) return json({ error: 'Loại hoạt động không hợp lệ' }, 400);
    const t = now(), id = uid('ac');
    const happened = vPastTs(b.happenedAt, t, 'Thời điểm hoạt động');
    await env.DB.prepare('INSERT INTO nv_activities (id,user_id,customer_id,deal_id,type,subject,note,outcome,duration,happened_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, ctx.me.id, str(b.customerId, 40), str(b.dealId, 40), b.type, str(b.subject, 160), str(b.note, 1000), str(b.outcome, 60),
        vCount(b.duration, 'Thời lượng', { max: 1440 }), happened, t).run();
    if (b.customerId) await env.DB.prepare('UPDATE nv_customers SET last_touch_at=?, updated_at=? WHERE id=?').bind(happened, t, String(b.customerId)).run();
    if (b.dealId) await env.DB.prepare('UPDATE nv_deals SET last_activity_at=?, updated_at=? WHERE id=?').bind(happened, t, String(b.dealId)).run();
    return json({ id });
  }

  /* --- Mock call log từ tổng đài --- */
  if ((p = match(ctx, 'POST', '/api/activities/sync-calls'))) {
    need(ctx);
    // TODO: cắm API tổng đài thật (env.PBX_API_KEY) — hiện trả log mẫu.
    const { results: cus } = await env.DB.prepare('SELECT id,name FROM nv_customers WHERE owner_id=? LIMIT 5').bind(ctx.me.id).all();
    if (!cus?.length) return json({ imported: 0 });
    const t = now(), stmts = [];
    cus.slice(0, 3).forEach((c, i) => stmts.push(env.DB.prepare('INSERT INTO nv_activities (id,user_id,customer_id,deal_id,type,subject,note,outcome,duration,happened_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(uid('ac'), ctx.me.id, c.id, null, 'call', 'Cuộc gọi đồng bộ từ tổng đài', 'Bản ghi mock từ PBX (chưa cắm API thật)', 'Đã kết nối', 3 + i * 2, t - i * 900, t)));
    await env.DB.batch(stmts);
    return json({ imported: stmts.length });
  }

  /* ================= Liên hệ mới trong ngày ================= */
  if ((p = match(ctx, 'GET', '/api/daily-contacts'))) {
    need(ctx);
    const s = scope(ctx, 'dc.user_id');
    const { results } = await env.DB.prepare(`SELECT dc.*, u.name user_name FROM nv_daily_contacts dc LEFT JOIN nv_users u ON u.id=dc.user_id
      WHERE dc.created_at >= ?${s.sql} ORDER BY dc.created_at DESC LIMIT 200`).bind(now() - 14 * DAY, ...s.args).all();
    return json({ items: results || [] });
  }
  if ((p = match(ctx, 'POST', '/api/daily-contacts'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const dcName = vText(b.name, 'Tên liên hệ', { max: 80, required: true });
    const dcPhone = vPhone(b.phone);
    // Chống nhân đôi định mức: cùng 1 người liên hệ chỉ tính 1 lần trong ngày
    const sod = startOfDay();
    const { results: todayDc } = await env.DB.prepare('SELECT name,phone FROM nv_daily_contacts WHERE user_id=? AND created_at>=?').bind(ctx.me.id, sod).all();
    const dupDc = (todayDc || []).some(x => (dcPhone && normPhone(x.phone) === normPhone(dcPhone)) || normName(x.name) === normName(dcName));
    if (dupDc && !b.force) return json({ error: `Bạn đã ghi nhận liên hệ "${dcName}" trong hôm nay. Không tính trùng vào định mức.` }, 409);
    const id = uid('dc');
    await env.DB.prepare('INSERT INTO nv_daily_contacts (id,user_id,name,company,channel,phone,customer_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, ctx.me.id, dcName, str(b.company, 120), str(b.channel, 40), dcPhone, str(b.customerId, 40), str(b.note, 400), now()).run();
    return json({ id });
  }

  /* ================= Lead ================= */
  if ((p = match(ctx, 'GET', '/api/leads'))) {
    need(ctx);
    const s = scope(ctx, 'l.owner_id');
    const { results } = await env.DB.prepare(`SELECT l.*, u.name owner_name FROM nv_leads l LEFT JOIN nv_users u ON u.id=l.owner_id WHERE 1=1${s.sql} ORDER BY l.score DESC, l.created_at DESC LIMIT 200`).bind(...s.args).all();
    return json({ items: results || [] });
  }
  if ((p = match(ctx, 'POST', '/api/leads'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const ldName = vText(b.name, 'Tên lead', { max: 80, required: true });
    const id = uid('ld');
    const score = scoreLead({ channel: b.channel, need: b.need, company: b.company });
    const owner = isLead(ctx.me) && b.ownerId ? await sameWorkspaceUser(env, ctx, b.ownerId) : null;
    await env.DB.prepare('INSERT INTO nv_leads (id,owner_id,name,company,channel,phone,email,need,score,status,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, owner ? owner.id : ctx.me.id, ldName, str(b.company, 120), str(b.channel, 40),
        vPhone(b.phone), vEmail(b.email), str(b.need, 300), score, 'new', 'AI chấm điểm tự động.', now()).run();
    return json({ id, score });
  }

  /* --- Nút "Tiếp cận": tạo hoạt động + tính vào định mức liên hệ mới --- */
  if ((p = match(ctx, 'POST', '/api/leads/:id/approach'))) {
    need(ctx);
    const s = scope(ctx, 'owner_id');
    const lead = await env.DB.prepare('SELECT * FROM nv_leads WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!lead) return json({ error: 'Không tìm thấy lead' }, 404);
    const t = now();
    const cusId = uid('cs');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO nv_customers (id,owner_id,name,industry,phone,email,temp,source,note,services,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(cusId, ctx.me.id, lead.company || lead.name, null, lead.phone, lead.email, 'warm', lead.channel, 'Chuyển từ lead: ' + lead.name, '[]', t, t, t),
      env.DB.prepare('INSERT INTO nv_daily_contacts (id,user_id,name,company,channel,phone,customer_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(uid('dc'), ctx.me.id, lead.name, lead.company, lead.channel, lead.phone, cusId, 'Tiếp cận từ danh sách lead', t),
      env.DB.prepare('INSERT INTO nv_activities (id,user_id,customer_id,deal_id,type,subject,note,outcome,duration,happened_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uid('ac'), ctx.me.id, cusId, null, 'call', 'Tiếp cận lead ' + lead.name, lead.need || '', 'Đã liên hệ', 5, t, t),
      env.DB.prepare("UPDATE nv_leads SET status='contacted' WHERE id=?").bind(p.id),
    ]);
    await audit(env, ctx.me.id, 'approach_lead', 'lead', p.id, {});
    return json({ ok: true, customerId: cusId });
  }

  return null;
}
