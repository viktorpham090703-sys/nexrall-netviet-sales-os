import { json, match, need, uid, now, DAY, readBody, scope, isLead, audit, notify, num, str, monthKey } from '../lib/util.js';
import { getConfig } from '../lib/kpi.js';

export const STAGES = ['lead_moi', 'tiep_can', 'nhu_cau', 'bao_gia', 'dam_phan', 'chot', 'trien_khai'];
const PROB = { lead_moi: 10, tiep_can: 20, nhu_cau: 40, bao_gia: 60, dam_phan: 75, chot: 100, trien_khai: 100 };

export async function dealRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Deals ================= */
  if ((p = match(ctx, 'GET', '/api/deals'))) {
    need(ctx);
    const s = scope(ctx, 'd.owner_id');
    const { results } = await env.DB.prepare(`SELECT d.*, c.name customer_name, c.temp customer_temp, u.name owner_name
      FROM nv_deals d LEFT JOIN nv_customers c ON c.id=d.customer_id LEFT JOIN nv_users u ON u.id=d.owner_id
      WHERE 1=1${s.sql} ORDER BY d.value DESC LIMIT 300`).bind(...s.args).all();
    const cfg = await getConfig(env, ctx.me.id);
    const sla = cfg.sla_days || {};
    const t = now();
    const items = (results || []).map(d => {
      const idle = Math.floor((t - (d.last_activity_at || d.created_at)) / DAY);
      const limit = sla[d.stage] || 5;
      return { ...d, idleDays: idle, slaLimit: limit, slaBreach: d.status === 'open' && idle > limit, expected: (d.value || 0) * (d.probability || 0) / 100 };
    });
    return json({ items, stages: STAGES, sla });
  }

  if ((p = match(ctx, 'POST', '/api/deals'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    if (!b.title) return json({ error: 'Vui lòng nhập tên cơ hội' }, 400);
    const stage = STAGES.includes(b.stage) ? b.stage : 'lead_moi';
    const t = now(), id = uid('dl');
    await env.DB.prepare('INSERT INTO nv_deals (id,owner_id,customer_id,title,service,value,stage,probability,status,source,expected_close_at,last_activity_at,stage_changed_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, isLead(ctx.me) && b.ownerId ? String(b.ownerId) : ctx.me.id, str(b.customerId, 40), str(b.title, 160), str(b.service, 40),
        num(b.value, 0), stage, PROB[stage], 'open', str(b.source, 60), num(b.expectedCloseAt, t + 30 * DAY), t, t, str(b.note, 800), t, t).run();
    await audit(env, ctx.me.id, 'create', 'deal', id, { title: b.title });
    return json({ id });
  }

  if ((p = match(ctx, 'PATCH', '/api/deals/:id'))) {
    need(ctx);
    const s = scope(ctx, 'owner_id');
    const d = await env.DB.prepare('SELECT * FROM nv_deals WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!d) return json({ error: 'Không tìm thấy cơ hội' }, 404);
    const b = await readBody(ctx.request);
    const t = now();
    const stage = STAGES.includes(b.stage) ? b.stage : d.stage;
    const status = b.status === 'lost' ? 'lost' : (stage === 'chot' || stage === 'trien_khai') ? 'won' : b.status === 'open' ? 'open' : d.status === 'lost' ? 'lost' : 'open';
    const value = b.value != null ? num(b.value, d.value) : d.value;
    const prob = b.probability != null ? num(b.probability, PROB[stage]) : (stage !== d.stage ? PROB[stage] : d.probability);
    const wonAt = status === 'won' ? (d.won_at || t) : null;
    await env.DB.prepare('UPDATE nv_deals SET title=?,service=?,value=?,stage=?,probability=?,status=?,lost_reason=?,note=?,expected_close_at=?,last_activity_at=?,stage_changed_at=?,won_at=?,updated_at=? WHERE id=?')
      .bind(b.title != null ? str(b.title, 160) : d.title, b.service != null ? str(b.service, 40) : d.service, value, stage, prob, status,
        b.lostReason != null ? str(b.lostReason, 200) : d.lost_reason, b.note != null ? str(b.note, 800) : d.note,
        b.expectedCloseAt != null ? num(b.expectedCloseAt, d.expected_close_at) : d.expected_close_at,
        t, stage !== d.stage ? t : d.stage_changed_at, wonAt, t, p.id).run();

    if (stage !== d.stage) {
      await env.DB.prepare('INSERT INTO nv_activities (id,user_id,customer_id,deal_id,type,subject,note,outcome,duration,happened_at,created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)')
        .bind(uid('ac'), ctx.me.id, d.customer_id, p.id, 'other', 'Chuyển giai đoạn: ' + d.stage + ' → ' + stage, b.note || '', 'Cập nhật pipeline', t, t).run();
    }
    // Ghi hoa hồng khi chốt
    if (status === 'won' && d.status !== 'won') {
      const rate = d.service === 'Gameshow' ? 4 : d.service === 'Xây kênh' ? 7 : 6;
      await env.DB.prepare('INSERT INTO nv_commissions (id,user_id,deal_id,period,base,rate,amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(uid('cm'), d.owner_id, p.id, monthKey(t), value, rate, Math.round(value * rate / 100), 'du_kien', t).run();
      await notify(env, d.owner_id, { type: 'deal', title: '🎉 Chúc mừng chốt deal!', body: d.title + ' – hoa hồng dự kiến đã được ghi nhận.', link: '#/kpi', level: 'info' });
    }
    return json({ ok: true });
  }

  /* ================= Bảng gói dịch vụ ================= */
  if ((p = match(ctx, 'GET', '/api/products'))) {
    need(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM nv_products WHERE active=1 ORDER BY line, price').all();
    const cfg = await getConfig(env, ctx.me.id);
    return json({ items: results || [], discountThreshold: cfg.discount_threshold || 15 });
  }
  if ((p = match(ctx, 'POST', '/api/products'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    if (!b.name) return json({ error: 'Thiếu tên gói' }, 400);
    const id = uid('pr');
    await env.DB.prepare('INSERT INTO nv_products (id,name,line,unit,price,commission_rate,max_discount,description,active) VALUES (?,?,?,?,?,?,?,?,1)')
      .bind(id, str(b.name, 160), str(b.line, 40), str(b.unit, 20) || 'gói', num(b.price, 0), num(b.commissionRate, 5), num(b.maxDiscount, 10), str(b.description, 500)).run();
    return json({ id });
  }

  /* ================= Báo giá / Proposal ================= */
  if ((p = match(ctx, 'GET', '/api/quotes'))) {
    need(ctx);
    const s = scope(ctx, 'q.owner_id');
    const { results } = await env.DB.prepare(`SELECT q.*, u.name owner_name, c.name customer_name, d.title deal_title
      FROM nv_quotes q LEFT JOIN nv_users u ON u.id=q.owner_id LEFT JOIN nv_customers c ON c.id=q.customer_id LEFT JOIN nv_deals d ON d.id=q.deal_id
      WHERE 1=1${s.sql} ORDER BY q.created_at DESC LIMIT 100`).bind(...s.args).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/quotes'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const items = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
    if (!items.length) return json({ error: 'Chưa chọn gói dịch vụ nào' }, 400);
    const cfg = await getConfig(env, ctx.me.id);
    const { results: prods } = await env.DB.prepare('SELECT * FROM nv_products WHERE active=1').all();
    let subtotal = 0, commission = 0;
    const clean = items.map(it => {
      const pr = (prods || []).find(x => x.id === it.productId);
      const price = pr ? pr.price : num(it.price, 0);
      const qty = Math.max(1, num(it.qty, 1));
      subtotal += price * qty;
      commission += price * qty * ((pr?.commission_rate) || 5) / 100;
      return { productId: it.productId, name: pr ? pr.name : str(it.name, 160), qty, price };
    });
    const disc = Math.max(0, Math.min(60, num(b.discountPct, 0)));
    const total = subtotal * (1 - disc / 100);
    commission = commission * (1 - disc / 100);
    const threshold = cfg.discount_threshold || 15;
    const status = disc > threshold ? 'pending' : 'draft';
    const t = now(), id = uid('qt');
    await env.DB.prepare('INSERT INTO nv_quotes (id,deal_id,owner_id,customer_id,title,items,subtotal,discount_pct,total,commission,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, str(b.dealId, 40), ctx.me.id, str(b.customerId, 40), str(b.title, 160) || 'Báo giá NetViet', JSON.stringify(clean),
        subtotal, disc, total, Math.round(commission), status, t, t).run();
    if (status === 'pending') {
      const { results: mgrs } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='manager' AND active=1").all();
      for (const m of mgrs || []) await notify(env, m.id, { type: 'approval', title: 'Chờ duyệt chiết khấu ' + disc + '%', body: (ctx.me.name || '') + ' gửi báo giá vượt ngưỡng ' + threshold + '%.', link: '#/saleskit', level: 'danger' });
    }
    return json({ id, status, subtotal, total, commission: Math.round(commission), threshold });
  }

  if ((p = match(ctx, 'PATCH', '/api/quotes/:id'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    const q = await env.DB.prepare('SELECT * FROM nv_quotes WHERE id=?').bind(p.id).first();
    if (!q) return json({ error: 'Không tìm thấy báo giá' }, 404);
    const st = ['approved', 'rejected'].includes(b.status) ? b.status : 'approved';
    await env.DB.prepare('UPDATE nv_quotes SET status=?,approver_id=?,approve_note=?,updated_at=? WHERE id=?')
      .bind(st, ctx.me.id, str(b.note, 300), now(), p.id).run();
    await notify(env, q.owner_id, { type: 'approval', title: st === 'approved' ? '✅ Báo giá được duyệt' : '❌ Báo giá bị từ chối', body: q.title + (b.note ? ' – ' + b.note : ''), link: '#/saleskit', level: st === 'approved' ? 'info' : 'warn' });
    await audit(env, ctx.me.id, 'approve_quote', 'quote', p.id, { status: st });
    return json({ ok: true });
  }

  /* ================= Cơ hội đấu thầu (mock scan) ================= */
  if ((p = match(ctx, 'GET', '/api/tenders'))) {
    need(ctx);
    const { results } = await env.DB.prepare('SELECT t.*, u.name assignee_name FROM nv_tender_leads t LEFT JOIN nv_users u ON u.id=t.assigned_to ORDER BY t.score DESC, t.deadline_at ASC LIMIT 100').all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/tenders/scan'))) {
    need(ctx);
    // TODO: cắm API quét thầu thật (muasamcong.mpi.gov.vn / crawler nội bộ) qua env.TENDER_API_KEY
    const t = now();
    const pool = [
      ['Gói thầu: Sản xuất video truyền thông chương trình chuyển đổi số', 'UBND tỉnh Bình Dương', 780000000, 'TVC/Video', 14, 74],
      ['Thuê đơn vị vận hành kênh TikTok/YouTube quảng bá nông sản', 'Bộ NN&PTNT', 520000000, 'Xây kênh', 21, 81],
      ['Tài trợ chương trình truyền hình thực tế mùa 2', 'Đài Truyền hình Hà Nội', 1100000000, 'Gameshow', 30, 67],
    ];
    const pickOne = pool[Math.floor(Math.random() * pool.length)];
    const id = uid('td');
    await env.DB.prepare('INSERT INTO nv_tender_leads (id,title,org,source,url,value,service_tag,deadline_at,score,status,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, pickOne[0] + ' #' + String(t).slice(-4), pickOne[1], 'muasamcong.mpi.gov.vn', 'https://muasamcong.mpi.gov.vn', pickOne[2], pickOne[3], t + pickOne[4] * DAY, pickOne[5], 'new',
        'AI tóm tắt (mock): gói thầu phù hợp mảng ' + pickOne[3] + ', quy mô ' + Math.round(pickOne[2] / 1e6) + ' triệu. Cần hồ sơ năng lực + 3 dự án tương tự.', t).run();
    return json({ ok: true, added: 1, id });
  }

  if ((p = match(ctx, 'POST', '/api/tenders/:id/convert'))) {
    need(ctx);
    const td = await env.DB.prepare('SELECT * FROM nv_tender_leads WHERE id=?').bind(p.id).first();
    if (!td) return json({ error: 'Không tìm thấy cơ hội thầu' }, 404);
    const t = now();
    const owner = (isLead(ctx.me) && (await readBody(ctx.request)).ownerId) || ctx.me.id;
    const cusId = uid('cs'), dealId = uid('dl');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO nv_customers (id,owner_id,name,industry,temp,source,note,services,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(cusId, owner, td.org || td.title, 'Khối nhà nước / Tập đoàn', 'warm', 'Đấu thầu', td.summary, JSON.stringify([td.service_tag]), t, t, t),
      env.DB.prepare('INSERT INTO nv_deals (id,owner_id,customer_id,title,service,value,stage,probability,status,source,expected_close_at,last_activity_at,stage_changed_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(dealId, owner, cusId, td.title, td.service_tag, td.value, 'tiep_can', 20, 'open', 'Đấu thầu', td.deadline_at, t, t, 'Nguồn: ' + (td.source || '') + ' – ' + (td.url || ''), t, t),
      env.DB.prepare("UPDATE nv_tender_leads SET status='converted', assigned_to=? WHERE id=?").bind(owner, p.id),
      env.DB.prepare('INSERT INTO nv_daily_contacts (id,user_id,name,company,channel,phone,customer_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(uid('dc'), owner, td.org || td.title, td.org, 'Đấu thầu', null, cusId, 'Tiếp cận gói thầu', t),
    ]);
    return json({ ok: true, dealId, customerId: cusId });
  }

  if ((p = match(ctx, 'PATCH', '/api/tenders/:id'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const st = ['new', 'ignored', 'converted'].includes(b.status) ? b.status : 'new';
    const r = await env.DB.prepare('UPDATE nv_tender_leads SET status=? WHERE id=?').bind(st, p.id).run();
    if (!r.meta?.changes) return json({ error: 'Không tìm thấy' }, 404);
    return json({ ok: true });
  }

  return null;
}
