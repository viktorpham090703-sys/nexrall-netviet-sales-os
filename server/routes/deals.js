import { json, match, need, uid, now, DAY, readBody, scope, isLead, audit, notify, num, str, monthKey, sameWorkspaceUser, wsBucket } from '../lib/util.js';
import { getConfig } from '../lib/kpi.js';
import { vMoney, vPercent, vText, vFutureTs, vCount, MAX_QTY } from '../lib/validate.js';

export const STAGES = ['lead_moi', 'tiep_can', 'nhu_cau', 'bao_gia', 'dam_phan', 'chot', 'trien_khai'];
const PROB = { lead_moi: 10, tiep_can: 20, nhu_cau: 40, bao_gia: 60, dam_phan: 75, chot: 100, trien_khai: 100 };
/** Giai đoạn kết thúc — không cho kéo ngược về giai đoạn trước (state machine). */
const TERMINAL = ['chot', 'trien_khai'];

/**
 * Tỉ lệ hoa hồng thực tế của 1 deal.
 * Ưu tiên lấy từ báo giá đã duyệt (bình quân gia quyền theo commission_rate của TỪNG gói),
 * chỉ khi không có báo giá mới rơi về tỉ lệ mặc định theo dòng dịch vụ.
 */
async function commissionRate(env, dealId, service) {
  // CHỈ lấy báo giá ĐÃ DUYỆT — 'draft' chưa qua ai duyệt, không phải căn cứ tính hoa hồng thật.
  const q = await env.DB.prepare("SELECT items FROM nv_quotes WHERE deal_id=? AND status='approved' ORDER BY updated_at DESC").bind(dealId).first();
  if (q?.items) {
    try {
      const items = JSON.parse(q.items);
      const ids = items.map(i => i.productId).filter(Boolean);
      if (ids.length) {
        const { results: prods } = await env.DB.prepare(
          `SELECT id,commission_rate FROM nv_products WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
        let base = 0, comm = 0;
        for (const it of items) {
          const pr = (prods || []).find(x => x.id === it.productId);
          const line = (Number(it.price) || 0) * (Number(it.qty) || 1);
          base += line;
          comm += line * ((pr?.commission_rate ?? 5) / 100);
        }
        if (base > 0) return +(comm / base * 100).toFixed(2);
      }
    } catch (e) { /* báo giá hỏng → dùng mặc định */ }
  }
  return service === 'Gameshow' ? 4 : service === 'Xây kênh' ? 7 : 6;
}

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
    const title = vText(b.title, 'Tên cơ hội', { max: 160, required: true, min: 2 });
    const value = vMoney(b.value, 'Giá trị hợp đồng');
    const stage = STAGES.includes(b.stage) ? b.stage : 'lead_moi';
    const t = now(), id = uid('dl');
    const owner = isLead(ctx.me) && b.ownerId ? await sameWorkspaceUser(env, ctx, b.ownerId) : null;
    await env.DB.prepare('INSERT INTO nv_deals (id,owner_id,customer_id,title,service,value,stage,probability,status,source,expected_close_at,last_activity_at,stage_changed_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, owner ? owner.id : ctx.me.id, str(b.customerId, 40), title, str(b.service, 40),
        value, stage, PROB[stage], 'open', str(b.source, 60), vFutureTs(b.expectedCloseAt, t + 30 * DAY, 'Ngày dự kiến chốt'), t, t, str(b.note, 800), t, t).run();
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
    // State machine: deal đã chốt/triển khai chỉ được chuyển sang "thất bại" (huỷ hợp đồng),
    // không cho kéo ngược về các giai đoạn trước — tránh doanh thu & hoa hồng nhảy loạn.
    if (TERMINAL.includes(d.stage) && stage !== d.stage && !TERMINAL.includes(stage) && b.status !== 'lost') {
      return json({ error: 'Deal đã chốt không thể quay lại giai đoạn trước. Nếu hợp đồng bị huỷ, hãy đánh dấu "Thất bại" kèm lý do.' }, 409);
    }
    const status = b.status === 'lost' ? 'lost' : (stage === 'chot' || stage === 'trien_khai') ? 'won' : b.status === 'open' ? 'open' : d.status === 'lost' ? 'lost' : 'open';
    const value = b.value != null ? vMoney(b.value, 'Giá trị hợp đồng') : d.value;
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
      // Audit log bắt buộc theo YC Toàn vẹn M3: ai · khi nào · từ → đến
      await audit(env, ctx.me.id, 'stage_change', 'deal', p.id, { from: d.stage, to: stage, value, status });
    }
    if (value !== d.value) await audit(env, ctx.me.id, 'value_change', 'deal', p.id, { from: d.value, to: value });
    // Ghi hoa hồng khi chốt — mỗi deal chỉ có ĐÚNG 1 bản ghi hoa hồng.
    // Chốt lại nhiều lần chỉ cập nhật bản ghi cũ, không tạo thêm (chống nhân bản hoa hồng).
    if (status === 'won') {
      const rate = await commissionRate(env, p.id, d.service);
      const amount = Math.round(value * rate / 100);
      const existed = await env.DB.prepare('SELECT id,status FROM nv_commissions WHERE deal_id=?').bind(p.id).first();
      if (!existed) {
        await env.DB.prepare('INSERT INTO nv_commissions (id,user_id,deal_id,period,base,rate,amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(uid('cm'), d.owner_id, p.id, monthKey(t), value, rate, amount, 'du_kien', t).run();
        await notify(env, d.owner_id, { type: 'deal', title: '🎉 Chúc mừng chốt deal!', body: d.title + ' – hoa hồng dự kiến đã được ghi nhận.', link: '#/kpi', level: 'info' });
      } else if (existed.status === 'du_kien' || existed.status === 'huy') {
        // Chưa chi (kể cả đã huỷ do kéo deal ra khỏi "chốt") → khôi phục & cập nhật theo giá trị mới.
        // Đã chi ('da_chi') thì giữ nguyên để không sửa lịch sử tiền.
        await env.DB.prepare("UPDATE nv_commissions SET base=?,rate=?,amount=?,period=?,status='du_kien' WHERE id=?")
          .bind(value, rate, amount, monthKey(t), existed.id).run();
      }
    } else if (d.status === 'won' && status !== 'won') {
      // Deal rời khỏi trạng thái chốt → huỷ hoa hồng dự kiến (chống "hoa hồng ma").
      await env.DB.prepare("UPDATE nv_commissions SET status='huy' WHERE deal_id=? AND status='du_kien'").bind(p.id).run();
      await audit(env, ctx.me.id, 'cancel_commission', 'deal', p.id, { from: d.stage, to: stage });
    }
    return json({ ok: true });
  }

  /** Xoá deal — chỉ TP/Admin, và chỉ khi chưa phát sinh hoa hồng đã chi. Ghi audit đầy đủ. */
  if ((p = match(ctx, 'DELETE', '/api/deals/:id'))) {
    need(ctx, ['manager', 'admin']);
    const s = scope(ctx, 'owner_id');
    const d = await env.DB.prepare('SELECT * FROM nv_deals WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!d) return json({ error: 'Không tìm thấy cơ hội' }, 404);
    const paid = await env.DB.prepare("SELECT id FROM nv_commissions WHERE deal_id=? AND status='da_chi'").bind(p.id).first();
    if (paid) return json({ error: 'Deal đã chi hoa hồng, không thể xoá. Hãy đánh dấu "Thất bại" thay vì xoá.' }, 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM nv_commissions WHERE deal_id=?').bind(p.id),
      env.DB.prepare('DELETE FROM nv_quotes WHERE deal_id=?').bind(p.id),
      env.DB.prepare('UPDATE nv_activities SET deal_id=NULL WHERE deal_id=?').bind(p.id),
      env.DB.prepare('DELETE FROM nv_deals WHERE id=?').bind(p.id),
    ]);
    await audit(env, ctx.me.id, 'delete', 'deal', p.id, { title: d.title, value: d.value, stage: d.stage });
    return json({ ok: true });
  }

  /* ================= Bảng gói dịch vụ ================= */
  if ((p = match(ctx, 'GET', '/api/products'))) {
    need(ctx);
    const { results } = await env.DB.prepare('SELECT * FROM nv_products WHERE active=1 ORDER BY line, price').all();
    const cfg = await getConfig(env, ctx.me.id);
    return json({ items: results || [], discountThreshold: cfg.discount_threshold ?? 15 });
  }
  if ((p = match(ctx, 'POST', '/api/products'))) {
    need(ctx, ['admin']);
    const b = await readBody(ctx.request);
    if (!b.name) return json({ error: 'Thiếu tên gói' }, 400);
    const id = uid('pr');
    // vPercent trả 0 cho cả "không nhập" lẫn "nhập 0" — dùng `!= null` để phân biệt, tránh
    // `|| default` âm thầm thay 0% (giá trị hợp lệ, ví dụ "gói không cho chiết khấu") bằng mặc định.
    await env.DB.prepare('INSERT INTO nv_products (id,name,line,unit,price,commission_rate,max_discount,description,active) VALUES (?,?,?,?,?,?,?,?,1)')
      .bind(id, vText(b.name, 'Tên gói', { max: 160, required: true }), str(b.line, 40), str(b.unit, 20) || 'gói',
        vMoney(b.price, 'Giá gói'), b.commissionRate != null ? vPercent(b.commissionRate, 'Tỉ lệ hoa hồng', { max: 50 }) : 5,
        b.maxDiscount != null ? vPercent(b.maxDiscount, 'Chiết khấu tối đa', { max: 100 }) : 10, str(b.description, 500)).run();
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
    const disc = vPercent(b.discountPct, 'Chiết khấu');
    let subtotal = 0, commission = 0;
    // Gói nào bị chiết khấu vượt trần RIÊNG của nó — chỉ để nêu rõ cho TP duyệt, KHÔNG chặn ở đây:
    // trần riêng từng gói (max_discount) chỉ là mốc cần duyệt, trần CHẶN CỨNG duy nhất là hardCap toàn hệ.
    const overCapItems = [];
    const clean = items.map(it => {
      const pr = (prods || []).find(x => x.id === it.productId);
      const price = pr ? pr.price : vMoney(it.price, 'Đơn giá');
      const qty = vCount(it.qty, 'Số lượng', { max: MAX_QTY }) || 1;
      if (pr && disc > Number(pr.max_discount ?? 100)) {
        overCapItems.push({ name: pr.name, cap: Number(pr.max_discount), over: +(disc - Number(pr.max_discount)).toFixed(1) });
      }
      subtotal += price * qty;
      commission += price * qty * ((pr?.commission_rate) || 5) / 100;
      return { productId: it.productId, name: pr ? pr.name : str(it.name, 160), qty, price };
    });
    const hardCap = Number(cfg.discount_hard_cap ?? 30);
    // Trần cứng toàn hệ (spec: tổng ưu đãi ≤ 30%) — DUY NHẤT mức này bị chặn hẳn, kể cả khi vượt
    // trần riêng của gói. Chiết khấu > ngưỡng thường (15%) nhưng ≤ trần cứng phải đi qua TP duyệt,
    // không được chặn cứng — nếu không báo giá không bao giờ tới được trạng thái 'pending'.
    if (disc > hardCap) {
      return json({ error: `Chiết khấu ${disc}% vượt trần cho phép ${hardCap}%. Vui lòng điều chỉnh hoặc xin cơ chế riêng từ Ban Giám đốc.` }, 400);
    }
    const total = subtotal * (1 - disc / 100);
    commission = commission * (1 - disc / 100);
    const threshold = cfg.discount_threshold ?? 15;
    const status = disc > threshold ? 'pending' : 'draft';
    const t = now(), id = uid('qt');
    await env.DB.prepare('INSERT INTO nv_quotes (id,deal_id,owner_id,customer_id,title,items,subtotal,discount_pct,total,commission,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, str(b.dealId, 40), ctx.me.id, str(b.customerId, 40), str(b.title, 160) || 'Báo giá NetViet', JSON.stringify(clean),
        subtotal, disc, total, Math.round(commission), status, t, t).run();
    if (status === 'pending') {
      const overCapNote = overCapItems.length
        ? ' Vượt trần riêng: ' + overCapItems.map(o => `${o.name} (trần ${o.cap}%, chênh +${o.over}%)`).join('; ') + '.'
        : '';
      // Chỉ báo TP CÙNG workspace với người gửi báo giá — TP thật không cần nhận thông báo
      // duyệt chiết khấu cho báo giá demo, và ngược lại.
      const { results: mgrs } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='manager' AND active=1 AND is_demo=?").bind(wsBucket(ctx.me)).all();
      for (const m of mgrs || []) await notify(env, m.id, { type: 'approval', title: 'Chờ duyệt chiết khấu ' + disc + '%', body: (ctx.me.name || '') + ' gửi báo giá vượt ngưỡng ' + threshold + '%.' + overCapNote, link: '#/saleskit', level: 'danger' });
    }
    return json({ id, status, subtotal, total, commission: Math.round(commission), threshold, overCapItems });
  }

  if ((p = match(ctx, 'PATCH', '/api/quotes/:id'))) {
    need(ctx, ['manager', 'admin']);
    const b = await readBody(ctx.request);
    const s = scope(ctx, 'owner_id');
    const q = await env.DB.prepare('SELECT * FROM nv_quotes WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
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
    const b = await readBody(ctx.request);
    const ownerRow = isLead(ctx.me) && b.ownerId ? await sameWorkspaceUser(env, ctx, b.ownerId) : null;
    const owner = ownerRow ? ownerRow.id : ctx.me.id;
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
