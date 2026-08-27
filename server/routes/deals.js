import { json, match, need, uid, now, DAY, readBody, scope, audit, notify, num, str, monthKey, resolveAssignableOwner, wsBucket, LEAD_ROLES } from '../lib/util.js';
import { getConfig, slaLimit } from '../lib/kpi.js';
import { vMoney, vPercent, vText, vFutureTs, vCount, MAX_QTY, vEnum } from '../lib/validate.js';

/* 14 bước theo quy trình vận hành PKD (spec làm cơ sở CRM, mục 7) — thay cho pipeline 7 bước cũ.
 * Khớp thứ tự với src/const.js STAGES (client) — 2 mảng trùng lặp có chủ đích, xem chú thích ở đó. */
export const STAGES = [
  'lead_moi', 'tiep_can', 'du_dieu_kien', 'chao_hang',
  'cho_duyet_bg_v1', 'cho_duyet_bg_v2', 'da_gui_bao_gia', 'dam_phan',
  'cho_duyet_hd_v1', 'cho_duyet_hd_v2', 'hop_dong_da_ky', 'dang_san_xuat', 'ban_giao', 'hoan_tat',
];
export const PROB = {
  lead_moi: 10, tiep_can: 15, du_dieu_kien: 25, chao_hang: 35,
  cho_duyet_bg_v1: 45, cho_duyet_bg_v2: 55, da_gui_bao_gia: 65, dam_phan: 70,
  cho_duyet_hd_v1: 80, cho_duyet_hd_v2: 90, hop_dong_da_ky: 100, dang_san_xuat: 100, ban_giao: 100, hoan_tat: 100,
};
/** Giai đoạn kết thúc — không cho kéo ngược về giai đoạn trước (state machine). Từ "Hợp đồng đã
 * ký" trở đi (đã ký hợp đồng, đang sản xuất, bàn giao, hoàn tất) coi như đã chốt được doanh thu. */
const TERMINAL = ['hop_dong_da_ky', 'dang_san_xuat', 'ban_giao', 'hoan_tat'];

/* Quy trình đấu thầu (áp dụng khách hàng tập đoàn lớn) — chạy song song với STAGES thường qua
 * cột nv_deals.process_type. Bước 1-6 riêng của đấu thầu; từ "Trúng thầu" hội tụ thẳng vào
 * TERMINAL ở trên (ký hợp đồng → sản xuất → bàn giao → nghiệm thu chạy đúng quy trình thường,
 * không định nghĩa lại). Khớp thứ tự với src/const.js TENDER_STAGES (client). */
export const TENDER_STAGES = [
  'tiep_can_truoc', 'nhan_thu_moi', 'chuan_bi_ho_so', 'cho_duyet_ho_so',
  'da_nop_ho_so', 'thuong_thao', 'mou', 'trung_thau',
];
export const TENDER_PROB = {
  tiep_can_truoc: 10, nhan_thu_moi: 20, chuan_bi_ho_so: 30, cho_duyet_ho_so: 40,
  da_nop_ho_so: 50, thuong_thao: 65, mou: 80, trung_thau: 95,
};
const PROB_ALL = { ...PROB, ...TENDER_PROB };
/** Tập giai đoạn hợp lệ của 1 deal theo loại quy trình — TERMINAL luôn hội tụ chung cho cả 2 loại. */
const validStages = (processType) => processType === 'dau_thau' ? [...TENDER_STAGES, ...TERMINAL] : STAGES;

/** Trạng thái deal sau khi cập nhật — thứ tự ưu tiên: huỷ tường minh > vào giai đoạn đã ký hợp
 * đồng trở đi > mở lại tường minh > vẫn đang "thất bại" trước đó > mặc định "đang mở". */
function computeDealStatus(d, b, stage) {
  if (b.status === 'lost') return 'lost';
  if (TERMINAL.includes(stage)) return 'won';
  if (b.status === 'open') return 'open';
  if (d.status === 'lost') return 'lost';
  return 'open';
}

/** Tỉ lệ hoa hồng mặc định theo dòng dịch vụ, khi deal chưa có báo giá đã duyệt để tính chính xác hơn. */
export const defaultCommissionRate = (service) => service === 'Gameshow' ? 4 : service === 'Xây kênh' ? 7 : 6;

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
  return defaultCommissionRate(service);
}

/**
 * Tính giá 1 báo giá theo danh sách gói + chiết khấu — dùng chung cho tạo mới (POST /api/quotes)
 * và sửa & trình lại (PATCH /api/quotes/:id nhánh resubmit) để không chép lại logic tính giá.
 * `overCapItems` chỉ để NÊU RÕ cho người duyệt (gói nào vượt trần riêng của nó), KHÔNG chặn ở đây —
 * trần chặn cứng duy nhất (hardCap toàn hệ) do nơi gọi tự kiểm tra trước khi gọi hàm này.
 */
async function computeQuotePricing(env, items, disc) {
  const { results: prods } = await env.DB.prepare('SELECT * FROM nv_products WHERE active=1').all();
  let subtotal = 0, commission = 0;
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
  const total = subtotal * (1 - disc / 100);
  commission = Math.round(commission * (1 - disc / 100));
  return { clean, subtotal, total, commission, overCapItems };
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
    const t = now();
    const items = (results || []).map(d => {
      const idle = Math.floor((t - (d.last_activity_at || d.created_at)) / DAY);
      const limit = slaLimit(cfg, d.stage);
      return { ...d, idleDays: idle, slaLimit: limit, slaBreach: d.status === 'open' && idle > limit, expected: (d.value || 0) * (d.probability || 0) / 100 };
    });
    return json({ items, stages: STAGES, sla: cfg.sla_days || {} });
  }

  if ((p = match(ctx, 'POST', '/api/deals'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const title = vText(b.title, 'Tên cơ hội', { max: 160, required: true, min: 2 });
    const value = vMoney(b.value, 'Giá trị hợp đồng');
    const processType = b.processType === 'dau_thau' ? 'dau_thau' : 'thong_thuong';
    const stageSet = validStages(processType);
    const stage = stageSet.includes(b.stage) ? b.stage : stageSet[0];
    const t = now(), id = uid('dl');
    const owner = await resolveAssignableOwner(env, ctx, b.ownerId);
    // Phương án hợp tác gắn ở cấp deal (không phải cấp partner/khách hàng) — xem chú thích ở
    // migration nv_deals.phuong_an_hop_tac (server/lib/db.js). nguồn_thực_hiện chỉ để tách bạch
    // công sức Sale/Partner phục vụ tính hoa hồng SAU NÀY, không có logic tính toán ở đợt này.
    const pa = vEnum(b.phuongAnHopTac, ['PA1', 'PA2'], 'Phương án hợp tác', null);
    const execSource = vEnum(b.nguonThucHien, ['sale', 'partner'], 'Nguồn thực hiện', null);
    await env.DB.prepare('INSERT INTO nv_deals (id,owner_id,customer_id,title,service,value,stage,probability,status,source,expected_close_at,last_activity_at,stage_changed_at,note,phuong_an_hop_tac,nguon_thuc_hien,process_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, owner ? owner.id : ctx.me.id, str(b.customerId, 40), title, str(b.service, 40),
        value, stage, PROB_ALL[stage], 'open', str(b.source, 60), vFutureTs(b.expectedCloseAt, t + 30 * DAY, 'Ngày dự kiến chốt'), t, t, str(b.note, 800), pa, execSource, processType, t, t).run();
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
    const stageSet = validStages(d.process_type);
    const stage = stageSet.includes(b.stage) ? b.stage : d.stage;
    // State machine: deal đã chốt/triển khai chỉ được chuyển sang "thất bại" (huỷ hợp đồng),
    // không cho kéo ngược về các giai đoạn trước — tránh doanh thu & hoa hồng nhảy loạn.
    if (TERMINAL.includes(d.stage) && stage !== d.stage && !TERMINAL.includes(stage) && b.status !== 'lost') {
      return json({ error: 'Deal đã chốt không thể quay lại giai đoạn trước. Nếu hợp đồng bị huỷ, hãy đánh dấu "Thất bại" kèm lý do.' }, 409);
    }
    const status = computeDealStatus(d, b, stage);
    const value = b.value != null ? vMoney(b.value, 'Giá trị hợp đồng') : d.value;
    const prob = b.probability != null ? num(b.probability, PROB_ALL[stage]) : (stage !== d.stage ? PROB_ALL[stage] : d.probability);
    const wonAt = status === 'won' ? (d.won_at || t) : null;
    const pa = b.phuongAnHopTac !== undefined ? vEnum(b.phuongAnHopTac, ['PA1', 'PA2'], 'Phương án hợp tác', null) : d.phuong_an_hop_tac;
    const execSource = b.nguonThucHien !== undefined ? vEnum(b.nguonThucHien, ['sale', 'partner'], 'Nguồn thực hiện', null) : d.nguon_thuc_hien;
    // Vòng thương thảo — chỉ tăng/giảm qua giá trị FE gửi lên (nút "+ Vòng thương thảo"), không tự suy luận.
    const negotiationRound = b.negotiationRound != null ? num(b.negotiationRound, d.negotiation_round) : d.negotiation_round;
    await env.DB.prepare('UPDATE nv_deals SET title=?,service=?,value=?,stage=?,probability=?,status=?,lost_reason=?,note=?,expected_close_at=?,last_activity_at=?,stage_changed_at=?,won_at=?,phuong_an_hop_tac=?,nguon_thuc_hien=?,negotiation_round=?,updated_at=? WHERE id=?')
      .bind(b.title != null ? str(b.title, 160) : d.title, b.service != null ? str(b.service, 40) : d.service, value, stage, prob, status,
        b.lostReason != null ? str(b.lostReason, 200) : d.lost_reason, b.note != null ? str(b.note, 800) : d.note,
        b.expectedCloseAt != null ? num(b.expectedCloseAt, d.expected_close_at) : d.expected_close_at,
        t, stage !== d.stage ? t : d.stage_changed_at, wonAt, pa, execSource, negotiationRound, t, p.id).run();

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
    need(ctx, LEAD_ROLES);
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
    const disc = vPercent(b.discountPct, 'Chiết khấu');
    const hardCap = Number(cfg.discount_hard_cap ?? 30);
    // Trần cứng toàn hệ (spec: tổng ưu đãi ≤ 30%) — DUY NHẤT mức này bị chặn hẳn, kể cả khi vượt
    // trần riêng của gói. Chiết khấu > ngưỡng thường (15%) nhưng ≤ trần cứng phải đi qua TPKD duyệt,
    // không được chặn cứng — nếu không báo giá không bao giờ tới được trạng thái chờ duyệt.
    if (disc > hardCap) {
      return json({ error: `Chiết khấu ${disc}% vượt trần cho phép ${hardCap}%. Vui lòng điều chỉnh hoặc xin cơ chế riêng từ Ban Giám đốc.` }, 400);
    }
    const { clean, subtotal, total, commission, overCapItems } = await computeQuotePricing(env, items, disc);
    const threshold = cfg.discount_threshold ?? 15;
    const status = disc > threshold ? 'pending_v1' : 'draft';
    const t = now(), id = uid('qt');
    await env.DB.prepare('INSERT INTO nv_quotes (id,deal_id,owner_id,customer_id,title,items,subtotal,discount_pct,total,commission,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, str(b.dealId, 40), ctx.me.id, str(b.customerId, 40), str(b.title, 160) || 'Báo giá NetViet', JSON.stringify(clean),
        subtotal, disc, total, commission, status, t, t).run();
    if (status === 'pending_v1') {
      const overCapNote = overCapItems.length
        ? ' Vượt trần riêng: ' + overCapItems.map(o => `${o.name} (trần ${o.cap}%, chênh +${o.over}%)`).join('; ') + '.'
        : '';
      // V1 = TPKD duyệt trước — chỉ báo TPKD CÙNG workspace với người gửi báo giá.
      const { results: mgrs } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='manager' AND active=1 AND is_demo=?").bind(wsBucket(ctx.me)).all();
      for (const m of mgrs || []) await notify(env, m.id, { type: 'approval', title: 'Chờ duyệt báo giá (V1) — chiết khấu ' + disc + '%', body: (ctx.me.name || '') + ' gửi báo giá vượt ngưỡng ' + threshold + '%.' + overCapNote, link: '#/saleskit', level: 'danger' });
    }
    return json({ id, status, subtotal, total, commission, threshold, overCapItems });
  }

  /* Duyệt báo giá 2 vòng (TPKD→Giám đốc) VÀ sửa & trình lại đều đi qua route này — phân nhánh
   * theo hình dạng body, giống cách PATCH /api/deals/:id đã là 1 route đa năng. `scope()` tự khớp
   * đúng quyền cho cả 2 phía: lead thấy toàn workspace (đủ cho nhánh duyệt), sales chỉ thấy đúng
   * báo giá của mình (đủ cho nhánh sửa & trình lại — không cần kiểm tra owner riêng nữa). */
  if ((p = match(ctx, 'PATCH', '/api/quotes/:id'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const s = scope(ctx, 'owner_id');
    const q = await env.DB.prepare('SELECT * FROM nv_quotes WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!q) return json({ error: 'Không tìm thấy báo giá' }, 404);
    const t = now();

    // Nhánh DUYỆT: body có `decision` ('approved' | 'revise') — chỉ 2 kết quả, không có "từ chối".
    if (b.decision != null) {
      need(ctx, LEAD_ROLES);
      const decision = ['approved', 'revise'].includes(b.decision) ? b.decision : null;
      if (!decision) return json({ error: 'Kết quả duyệt không hợp lệ' }, 400);
      const note = str(b.note, 300);
      if (q.status === 'pending_v1') {
        if (!['manager', 'admin'].includes(ctx.me.role)) return json({ error: 'Chỉ Trưởng phòng kinh doanh (hoặc Admin) mới duyệt được vòng 1' }, 403);
        // "Yêu cầu điều chỉnh" quay lại ĐÚNG vòng đang chờ, không lùi thêm — status giữ pending_v1.
        const nextStatus = decision === 'approved' ? 'pending_v2' : 'pending_v1';
        await env.DB.prepare('UPDATE nv_quotes SET status=?,v1_approver_id=?,v1_decision=?,v1_note=?,v1_decided_at=?,updated_at=? WHERE id=?')
          .bind(nextStatus, ctx.me.id, decision, note, t, t, p.id).run();
        if (decision === 'approved') {
          // Admin cũng có thể tự duyệt V1 (vai trò Giám đốc đã sáp nhập vào Admin) — bỏ qua chính
          // người vừa duyệt để không tự báo cho mình chờ duyệt V2.
          const { results: dirs } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='admin' AND active=1 AND is_demo=?").bind(wsBucket(ctx.me)).all();
          for (const d2 of dirs || []) if (d2.id !== ctx.me.id) await notify(env, d2.id, { type: 'approval', title: 'Chờ duyệt báo giá (V2): ' + q.title, body: (ctx.me.name || '') + ' đã duyệt vòng 1.', link: '#/saleskit', level: 'danger' });
        } else {
          await notify(env, q.owner_id, { type: 'approval', title: '✏️ TPKD yêu cầu điều chỉnh báo giá', body: q.title + (note ? ' – ' + note : ''), link: '#/saleskit', level: 'warn' });
        }
        await audit(env, ctx.me.id, 'approve_quote_v1', 'quote', p.id, { decision });
        return json({ ok: true, status: nextStatus });
      }
      if (q.status === 'pending_v2') {
        if (ctx.me.role !== 'admin') return json({ error: 'Chỉ Admin/BGĐ mới duyệt được vòng 2' }, 403);
        // TPKD KHÔNG cần duyệt lại nếu Admin/BGĐ yêu cầu điều chỉnh — quay lại đúng vòng V2.
        const nextStatus = decision === 'approved' ? 'approved' : 'pending_v2';
        await env.DB.prepare('UPDATE nv_quotes SET status=?,v2_approver_id=?,v2_decision=?,v2_note=?,v2_decided_at=?,updated_at=? WHERE id=?')
          .bind(nextStatus, ctx.me.id, decision, note, t, t, p.id).run();
        await notify(env, q.owner_id, decision === 'approved'
          ? { type: 'approval', title: '✅ Báo giá đã được duyệt', body: q.title, link: '#/saleskit', level: 'info' }
          : { type: 'approval', title: '✏️ Admin/BGĐ yêu cầu điều chỉnh báo giá', body: q.title + (note ? ' – ' + note : ''), link: '#/saleskit', level: 'warn' });
        await audit(env, ctx.me.id, 'approve_quote_v2', 'quote', p.id, { decision });
        return json({ ok: true, status: nextStatus });
      }
      return json({ error: 'Báo giá không ở trạng thái chờ duyệt' }, 409);
    }

    // Nhánh SỬA & TRÌNH LẠI: body có `items` — chỉ chủ báo giá, chỉ khi vòng hiện tại đang bị yêu
    // cầu điều chỉnh. `scope()` ở trên đã đảm bảo sales chỉ lấy được đúng báo giá của chính mình.
    if (b.items != null) {
      const roundRevising = (q.status === 'pending_v1' && q.v1_decision === 'revise') || (q.status === 'pending_v2' && q.v2_decision === 'revise');
      if (!roundRevising) return json({ error: 'Báo giá chưa bị yêu cầu điều chỉnh, không cần trình lại' }, 409);
      const items = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
      if (!items.length) return json({ error: 'Chưa chọn gói dịch vụ nào' }, 400);
      const cfg = await getConfig(env, ctx.me.id);
      const disc = vPercent(b.discountPct, 'Chiết khấu');
      const hardCap = Number(cfg.discount_hard_cap ?? 30);
      if (disc > hardCap) return json({ error: `Chiết khấu ${disc}% vượt trần cho phép ${hardCap}%.` }, 400);
      const { clean, subtotal, total, commission } = await computeQuotePricing(env, items, disc);
      const round = q.status === 'pending_v1' ? 1 : 2;
      const sql = round === 1
        ? 'UPDATE nv_quotes SET title=?,items=?,subtotal=?,discount_pct=?,total=?,commission=?,v1_approver_id=NULL,v1_decision=NULL,v1_note=NULL,v1_decided_at=NULL,updated_at=? WHERE id=?'
        : 'UPDATE nv_quotes SET title=?,items=?,subtotal=?,discount_pct=?,total=?,commission=?,v2_approver_id=NULL,v2_decision=NULL,v2_note=NULL,v2_decided_at=NULL,updated_at=? WHERE id=?';
      const title = b.title != null ? str(b.title, 160) : q.title;
      await env.DB.prepare(sql).bind(title, JSON.stringify(clean), subtotal, disc, total, commission, t, p.id).run();
      // V1 báo lại TPKD; V2 báo THẲNG Admin/BGĐ — không quay lại TPKD (đúng tài liệu).
      const targetRole = round === 1 ? 'manager' : 'admin';
      const { results: targets } = await env.DB.prepare('SELECT id FROM nv_users WHERE role=? AND active=1 AND is_demo=?').bind(targetRole, wsBucket(ctx.me)).all();
      for (const u2 of targets || []) await notify(env, u2.id, { type: 'approval', title: 'Báo giá đã sửa, chờ duyệt lại: ' + title, body: (ctx.me.name || '') + ' đã cập nhật theo yêu cầu điều chỉnh.', link: '#/saleskit', level: 'danger' });
      await audit(env, ctx.me.id, 'resubmit_quote', 'quote', p.id, { round });
      return json({ ok: true, subtotal, total, commission });
    }

    return json({ error: 'Thiếu dữ liệu cập nhật' }, 400);
  }

  /* ================= Hợp đồng sản xuất (duyệt 2 vòng TPKD→HCNS) =================
   * Không có ngưỡng bỏ qua duyệt như báo giá — mọi hợp đồng đều bắt buộc qua đủ 2 vòng, bắt đầu
   * thẳng ở 'pending_v1'. Đổi điều khoản hợp đồng so với báo giá đã duyệt KHÔNG cần duyệt lại báo
   * giá (đã chốt với người dùng) — chỉ chạy đúng luồng duyệt hợp đồng này là đủ. */
  if ((p = match(ctx, 'GET', '/api/contracts'))) {
    need(ctx);
    const s = scope(ctx, 'c.owner_id');
    const { results } = await env.DB.prepare(`SELECT c.*, u.name owner_name, cu.name customer_name, d.title deal_title
      FROM nv_contracts c LEFT JOIN nv_users u ON u.id=c.owner_id LEFT JOIN nv_customers cu ON cu.id=c.customer_id LEFT JOIN nv_deals d ON d.id=c.deal_id
      WHERE 1=1${s.sql} ORDER BY c.created_at DESC LIMIT 100`).bind(...s.args).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/contracts'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const title = vText(b.title, 'Tên hợp đồng', { max: 160, required: true });
    const value = vMoney(b.value, 'Giá trị hợp đồng');
    const t = now(), id = uid('ct2');
    await env.DB.prepare(`INSERT INTO nv_contracts (id,deal_id,quote_id,owner_id,customer_id,title,value,payment_schedule,penalty_terms,note,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'pending_v1',?,?)`)
      .bind(id, str(b.dealId, 40) || null, str(b.quoteId, 40) || null, ctx.me.id, str(b.customerId, 40) || null,
        title, value, str(b.paymentSchedule, 500), str(b.penaltyTerms, 500), str(b.note, 500), t, t).run();
    // V1 = TPKD duyệt trước — chỉ báo TPKD CÙNG workspace với người tạo hợp đồng.
    const { results: mgrs } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='manager' AND active=1 AND is_demo=?").bind(wsBucket(ctx.me)).all();
    for (const m of mgrs || []) await notify(env, m.id, { type: 'approval', title: 'Chờ duyệt hợp đồng (V1): ' + title, body: (ctx.me.name || '') + ' đã lập hợp đồng ' + new Intl.NumberFormat('vi-VN').format(value) + 'đ.', link: '#/saleskit', level: 'danger' });
    await audit(env, ctx.me.id, 'create', 'contract', id, { title, value });
    return json({ id, status: 'pending_v1' });
  }

  /* Cùng khuôn mẫu như PATCH /api/quotes/:id — duyệt (`decision`) hoặc sửa & trình lại (`title`/
   * `value` có mặt trong body cùng lúc). */
  if ((p = match(ctx, 'PATCH', '/api/contracts/:id'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const s = scope(ctx, 'owner_id');
    const c = await env.DB.prepare('SELECT * FROM nv_contracts WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!c) return json({ error: 'Không tìm thấy hợp đồng' }, 404);
    const t = now();

    if (b.decision != null) {
      need(ctx, LEAD_ROLES);
      const decision = ['approved', 'revise'].includes(b.decision) ? b.decision : null;
      if (!decision) return json({ error: 'Kết quả duyệt không hợp lệ' }, 400);
      const note = str(b.note, 300);
      if (c.status === 'pending_v1') {
        if (!['manager', 'admin'].includes(ctx.me.role)) return json({ error: 'Chỉ Trưởng phòng kinh doanh (hoặc Admin) mới duyệt được vòng 1' }, 403);
        const nextStatus = decision === 'approved' ? 'pending_v2' : 'pending_v1';
        await env.DB.prepare('UPDATE nv_contracts SET status=?,v1_approver_id=?,v1_decision=?,v1_note=?,v1_decided_at=?,updated_at=? WHERE id=?')
          .bind(nextStatus, ctx.me.id, decision, note, t, t, p.id).run();
        if (decision === 'approved') {
          const { results: hrs } = await env.DB.prepare("SELECT id FROM nv_users WHERE role='hr' AND active=1 AND is_demo=?").bind(wsBucket(ctx.me)).all();
          for (const h of hrs || []) await notify(env, h.id, { type: 'approval', title: 'Chờ duyệt hợp đồng (V2): ' + c.title, body: (ctx.me.name || '') + ' đã duyệt vòng 1.', link: '#/saleskit', level: 'danger' });
        } else {
          await notify(env, c.owner_id, { type: 'approval', title: '✏️ TPKD yêu cầu điều chỉnh hợp đồng', body: c.title + (note ? ' – ' + note : ''), link: '#/saleskit', level: 'warn' });
        }
        await audit(env, ctx.me.id, 'approve_contract_v1', 'contract', p.id, { decision });
        return json({ ok: true, status: nextStatus });
      }
      if (c.status === 'pending_v2') {
        if (!['hr', 'admin'].includes(ctx.me.role)) return json({ error: 'Chỉ Hành chính nhân sự (hoặc Admin) mới duyệt được vòng 2' }, 403);
        const nextStatus = decision === 'approved' ? 'approved' : 'pending_v2';
        await env.DB.prepare('UPDATE nv_contracts SET status=?,v2_approver_id=?,v2_decision=?,v2_note=?,v2_decided_at=?,updated_at=? WHERE id=?')
          .bind(nextStatus, ctx.me.id, decision, note, t, t, p.id).run();
        await notify(env, c.owner_id, decision === 'approved'
          ? { type: 'approval', title: '✅ Hợp đồng đã ký', body: c.title, link: '#/saleskit', level: 'info' }
          : { type: 'approval', title: '✏️ HCNS yêu cầu điều chỉnh hợp đồng', body: c.title + (note ? ' – ' + note : ''), link: '#/saleskit', level: 'warn' });
        await audit(env, ctx.me.id, 'approve_contract_v2', 'contract', p.id, { decision });
        return json({ ok: true, status: nextStatus });
      }
      return json({ error: 'Hợp đồng không ở trạng thái chờ duyệt' }, 409);
    }

    if (b.title != null || b.value != null) {
      const roundRevising = (c.status === 'pending_v1' && c.v1_decision === 'revise') || (c.status === 'pending_v2' && c.v2_decision === 'revise');
      if (!roundRevising) return json({ error: 'Hợp đồng chưa bị yêu cầu điều chỉnh, không cần trình lại' }, 409);
      const title = vText(b.title, 'Tên hợp đồng', { max: 160, required: true });
      const value = vMoney(b.value, 'Giá trị hợp đồng');
      const round = c.status === 'pending_v1' ? 1 : 2;
      const sql = round === 1
        ? 'UPDATE nv_contracts SET title=?,value=?,payment_schedule=?,penalty_terms=?,note=?,v1_approver_id=NULL,v1_decision=NULL,v1_note=NULL,v1_decided_at=NULL,updated_at=? WHERE id=?'
        : 'UPDATE nv_contracts SET title=?,value=?,payment_schedule=?,penalty_terms=?,note=?,v2_approver_id=NULL,v2_decision=NULL,v2_note=NULL,v2_decided_at=NULL,updated_at=? WHERE id=?';
      await env.DB.prepare(sql).bind(title, value, str(b.paymentSchedule, 500), str(b.penaltyTerms, 500), str(b.note, 500), t, p.id).run();
      // V1 báo lại TPKD; V2 báo THẲNG HCNS — không quay lại TPKD.
      const targetRole = round === 1 ? 'manager' : 'hr';
      const { results: targets } = await env.DB.prepare('SELECT id FROM nv_users WHERE role=? AND active=1 AND is_demo=?').bind(targetRole, wsBucket(ctx.me)).all();
      for (const u2 of targets || []) await notify(env, u2.id, { type: 'approval', title: 'Hợp đồng đã sửa, chờ duyệt lại: ' + title, body: (ctx.me.name || '') + ' đã cập nhật theo yêu cầu điều chỉnh.', link: '#/saleskit', level: 'danger' });
      await audit(env, ctx.me.id, 'resubmit_contract', 'contract', p.id, { round });
      return json({ ok: true });
    }

    return json({ error: 'Thiếu dữ liệu cập nhật' }, 400);
  }

  /* ================= Cơ hội đấu thầu (mock scan) ================= */
  if ((p = match(ctx, 'GET', '/api/tenders'))) {
    need(ctx);
    const { results } = await env.DB.prepare('SELECT t.*, u.name assignee_name FROM nv_tender_leads t LEFT JOIN nv_users u ON u.id=t.assigned_to ORDER BY t.score DESC, t.deadline_at ASC LIMIT 100').all();
    return json({ items: results || [] });
  }

  /* Ghi nhận thủ công 1 cơ hội thầu đến từ quan hệ trực tiếp (Bước 1-2 quy trình đấu thầu: GĐ/BLĐ
   * tiếp cận trước, khách chủ động gửi mời thầu) — khác luồng vào với /tenders/scan (cổng công
   * khai, mock). Giới hạn LEAD_ROLES vì đây là bước do GĐ/Ban lãnh đạo chủ trì theo tài liệu. */
  if ((p = match(ctx, 'POST', '/api/tenders'))) {
    need(ctx, LEAD_ROLES);
    const b = await readBody(ctx.request);
    const title = vText(b.title, 'Tên gói thầu', { max: 200, required: true, min: 2 });
    const t = now(), id = uid('td');
    await env.DB.prepare('INSERT INTO nv_tender_leads (id,title,org,source,url,value,service_tag,deadline_at,score,status,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, title, str(b.org, 160), 'Quan hệ trực tiếp', str(b.url, 300) || null, b.value != null ? vMoney(b.value, 'Giá trị ước tính') : 0,
        str(b.serviceTag, 40), b.deadlineAt != null ? vFutureTs(b.deadlineAt, t + 14 * DAY, 'Hạn nộp') : t + 14 * DAY, 50, 'new', str(b.summary, 500), t).run();
    await audit(env, ctx.me.id, 'create', 'tender', id, { title });
    return json({ id });
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
    // Mỗi cơ hội thầu chỉ được chuyển thành Deal ĐÚNG 1 LẦN — chuyển lại sẽ sinh thêm khách
    // hàng/deal trùng và cộng khống định mức liên hệ mới (FR-M2 "chống nhân đôi định mức").
    if (td.status === 'converted') {
      return json({ error: `Cơ hội thầu "${td.title}" đã được chuyển thành deal trước đó.` }, 409);
    }
    const t = now();
    const b = await readBody(ctx.request);
    const ownerRow = await resolveAssignableOwner(env, ctx, b.ownerId);
    const owner = ownerRow ? ownerRow.id : ctx.me.id;
    const cusId = uid('cs'), dealId = uid('dl');
    // scale='Tập đoàn' mặc định — mọi khách hàng sinh từ cơ hội thầu (dù nguồn quét công khai hay
    // quan hệ trực tiếp) đều thuộc diện đấu thầu, đúng đối tượng tài liệu quy trình đấu thầu nhắm tới.
    const firstStage = TENDER_STAGES[0];
    await env.DB.batch([
      env.DB.prepare('INSERT INTO nv_customers (id,owner_id,name,industry,scale,temp,source,note,services,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(cusId, owner, td.org || td.title, 'Khối nhà nước / Tập đoàn', 'Tập đoàn', 'warm', 'Đấu thầu', td.summary, JSON.stringify([td.service_tag]), t, t, t),
      env.DB.prepare('INSERT INTO nv_deals (id,owner_id,customer_id,title,service,value,stage,probability,status,source,expected_close_at,last_activity_at,stage_changed_at,note,process_type,tender_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(dealId, owner, cusId, td.title, td.service_tag, td.value, firstStage, TENDER_PROB[firstStage], 'open', 'Đấu thầu', td.deadline_at, t, t, 'Nguồn: ' + (td.source || '') + ' – ' + (td.url || ''), 'dau_thau', td.id, t, t),
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
