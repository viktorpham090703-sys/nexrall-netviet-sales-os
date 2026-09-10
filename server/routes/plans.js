/**
 * Phương án kinh doanh — luồng trình duyệt 4 hạng mục của một khách hàng/deal.
 *
 * Theo yêu cầu bổ sung của TPKD: "Sau khi làm báo giá, hợp đồng, nghiệm thu, thanh lý — kinh
 * doanh cần nhập các mục trên vào để TP hoặc GĐ duyệt hay có bất kì phản hồi nào, KD sẽ tiếp
 * nhận từ luồng thông tin đã trình."
 *
 * Khác gì với nv_quotes / nv_contracts đã có? Hai bảng đó là CHỨNG TỪ có ràng buộc nghiệp vụ
 * riêng (bảng giá, trần chiết khấu, 2 vòng duyệt cố định TPKD→GĐ/HCNS). Phương án kinh doanh là
 * LUỒNG TRÌNH DUYỆT TỔNG cho cả vòng đời một thương vụ, gồm cả nghiệm thu và thanh lý vốn không
 * có chứng từ trong hệ thống. Ở đây mỗi hạng mục chỉ cần 1 vòng duyệt và người duyệt do kinh
 * doanh chọn (TP hoặc GĐ), nên không gộp vào nv_quotes/nv_contracts để tránh làm rối state
 * machine 2 vòng vốn đang chạy đúng của 2 bảng đó.
 */
import { json, match, need, uid, now, readBody, scope, audit, notify, str, isLead, wsBucket, LEAD_ROLES } from '../lib/util.js';
import { vText, vMoney, vEnum } from '../lib/validate.js';

/** 4 hạng mục cố định, đúng thứ tự vòng đời thương vụ. Khớp src/const.js PLAN_ITEMS (client). */
export const PLAN_KINDS = ['bao_gia', 'hop_dong', 'nghiem_thu', 'thanh_ly'];
const KIND_NAME = { bao_gia: 'Báo giá', hop_dong: 'Hợp đồng', nghiem_thu: 'Nghiệm thu', thanh_ly: 'Thanh lý' };
/* Trạng thái hạng mục: todo (chưa trình) · pending (đã trình, chờ duyệt) · approved (đã duyệt)
 * · revise (bị trả lại để sửa). Không khai báo thành mảng vì mọi chuyển trạng thái ở đây đều do
 * code quyết định chứ không nhận thẳng từ client — không có chỗ nào cần validate theo danh sách. */
/** Người duyệt do kinh doanh chọn khi trình: Trưởng phòng hoặc Giám đốc (Admin/BGĐ). */
const APPROVER_ROLES = ['manager', 'admin'];
const APPROVER_NAME = { manager: 'Trưởng phòng KD', admin: 'Giám đốc' };

/** Hạng mục còn NHẬP TAY trong phương án. `bao_gia`/`hop_dong` nay lập bằng chứng từ thật
 * (nv_quotes / nv_contracts) ngay tại bước 1 và bước 2, không trình bằng ô summary nữa. */
const MANUAL_KINDS = ['nghiem_thu', 'thanh_ly'];

/**
 * Điều kiện khớp 1 chứng từ với phương án đang xét. Nhánh thứ hai là DỰ PHÒNG cho dữ liệu tạo
 * trước migration 70-71 (`plan_id` còn NULL): báo giá/hợp đồng cũ của khách vẫn hiện đúng ở
 * phương án của khách đó thay vì biến mất khỏi màn hình.
 * `planCol`/`cusCol` là biểu thức SQL trỏ tới phương án — trong subquery tương quan thì đó là
 * `pl.id`/`pl.customer_id`, còn khi tra 1 phương án cụ thể thì là tham số `?`.
 */
const docMatch = (x, planCol, cusCol) =>
  `(${x}.plan_id=${planCol} OR (${x}.plan_id IS NULL AND ${x}.customer_id=${cusCol}))`;

/** Chứng từ đang bị trả lại để sửa — khớp đúng needsResubmit() ở src/salesDocs.js.
 * IFNULL là BẮT BUỘC chứ không phải cho gọn: v1_decision/v2_decision là NULL ở chứng từ chưa ai
 * chạm tới, mà so sánh với NULL cho ra NULL (không phải FALSE) — nhánh `NOT (...)` ở countExpr sẽ
 * thành NULL và loại luôn dòng đó khỏi bộ đếm "chờ duyệt". */
const docRevise = (x) =>
  `((${x}.status='pending_v1' AND IFNULL(${x}.v1_decision,'')='revise') OR (${x}.status='pending_v2' AND IFNULL(${x}.v2_decision,'')='revise'))`;

/**
 * Biểu thức đếm cho danh sách phương án. Từ khi bước 1 & 2 chạy bằng chứng từ thật, trạng thái
 * một phương án nằm ở HAI nguồn: nv_plan_items (nghiệm thu, thanh lý) và nv_quotes/nv_contracts
 * (báo giá, hợp đồng). Gộp lại ở đây để giao diện vẫn đọc đúng 3 con số cũ và giữ nguyên cách
 * hiển thị "x/4 hạng mục đã duyệt".
 * - approved: mỗi loại chứng từ tính TỐI ĐA 1 (một phương án có thể có nhiều báo giá, nhưng bước
 *   "Báo giá" thì chỉ xong một lần) — nếu không con số sẽ vượt quá 4.
 * - pending: trừ các bản đang bị trả lại, vì chúng vẫn mang status pending_v* nhưng đã được đếm
 *   ở revise rồi — để nguyên thì 1 báo giá bị trả lại hiện cùng lúc 2 chip mâu thuẫn.
 */
function countExpr(kind) {
  const items = `(SELECT COUNT(*) FROM nv_plan_items i WHERE i.plan_id=pl.id
    AND i.kind IN ('nghiem_thu','thanh_ly') AND i.status='${kind}')`;
  const m = (x) => docMatch(x, 'pl.id', 'pl.customer_id');
  if (kind === 'approved') {
    return `(${items}
      + (SELECT CASE WHEN EXISTS(SELECT 1 FROM nv_quotes q WHERE ${m('q')} AND q.status IN ('approved','draft')) THEN 1 ELSE 0 END)
      + (SELECT CASE WHEN EXISTS(SELECT 1 FROM nv_contracts ct WHERE ${m('ct')} AND ct.status='approved') THEN 1 ELSE 0 END))`;
  }
  const docCond = kind === 'revise'
    ? (x) => docRevise(x)
    : (x) => `${x}.status IN ('pending_v1','pending_v2') AND NOT ${docRevise(x)}`;
  return `(${items}
    + (SELECT COUNT(*) FROM nv_quotes q WHERE ${m('q')} AND ${docCond('q')})
    + (SELECT COUNT(*) FROM nv_contracts ct WHERE ${m('ct')} AND ${docCond('ct')}))`;
}

/** Ghi 1 dòng vào nhật ký trao đổi của phương án — mọi thay đổi trạng thái đều đi qua đây. */
async function logEvent(env, planId, itemId, userId, kind, message) {
  await env.DB.prepare('INSERT INTO nv_plan_events (id,plan_id,item_id,user_id,kind,message,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(uid('pe'), planId, itemId || null, userId, kind, str(message, 1000), now()).run();
}

/** Lấy phương án theo id, đã lọc đúng phạm vi người xem (sales chỉ thấy của mình). */
async function findPlan(env, ctx, id) {
  const s = scope(ctx, 'owner_id');
  return await env.DB.prepare('SELECT * FROM nv_business_plans WHERE id=?' + s.sql).bind(id, ...s.args).first();
}

export async function planRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /**
   * Danh sách phương án. `?customerId=` để mở từ CRM 360°; không truyền thì trả toàn bộ trong
   * phạm vi người xem, kèm đếm hạng mục đang chờ duyệt / bị trả lại để vẽ chip cảnh báo.
   */
  if ((p = match(ctx, 'GET', '/api/plans'))) {
    need(ctx);
    const s = scope(ctx, 'pl.owner_id');
    const customerId = (url.searchParams.get('customerId') || '').trim();
    let sql = `SELECT pl.*, c.name customer_name, u.name owner_name,
      ${countExpr('pending')} pending_n,
      ${countExpr('revise')} revise_n,
      ${countExpr('approved')} approved_n
      FROM nv_business_plans pl
      LEFT JOIN nv_customers c ON c.id=pl.customer_id
      LEFT JOIN nv_users u ON u.id=pl.owner_id WHERE 1=1` + s.sql;
    const args = [...s.args];
    if (customerId) { sql += ' AND pl.customer_id=?'; args.push(customerId); }
    sql += ' ORDER BY pl.updated_at DESC LIMIT 200';
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return json({ items: results || [], kinds: PLAN_KINDS });
  }

  /**
   * Tạo phương án cho 1 khách hàng — sinh luôn đủ 4 hạng mục ở trạng thái "chưa trình".
   * Tạo sẵn cả 4 thay vì để kinh doanh thêm từng cái: 4 hạng mục là cố định theo quy trình,
   * và có sẵn khung thì màn hình luôn cho thấy còn thiếu bước nào.
   */
  if ((p = match(ctx, 'POST', '/api/plans'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const s = scope(ctx, 'owner_id');
    const cus = await env.DB.prepare('SELECT * FROM nv_customers WHERE id=?' + s.sql).bind(str(b.customerId, 40), ...s.args).first();
    if (!cus) return json({ error: 'Không tìm thấy khách hàng' }, 404);
    const title = vText(b.title, 'Tên phương án', { max: 160, required: true, min: 2 });
    const t = now(), id = uid('pl');
    const stmts = [
      env.DB.prepare('INSERT INTO nv_business_plans (id,customer_id,deal_id,owner_id,title,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, cus.id, str(b.dealId, 40) || null, cus.owner_id, title, str(b.note, 1000), t, t),
      ...PLAN_KINDS.map(k => env.DB.prepare(
        'INSERT INTO nv_plan_items (id,plan_id,kind,status,approver_role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .bind(uid('pi'), id, k, 'todo', 'manager', t, t)),
    ];
    await env.DB.batch(stmts);
    await logEvent(env, id, null, ctx.me.id, 'create', 'Đã tạo phương án kinh doanh: ' + title);
    await audit(env, ctx.me.id, 'create', 'plan', id, { customer: cus.name, title });
    return json({ id });
  }

  /** Chi tiết 1 phương án: 4 hạng mục + nhật ký trao đổi. */
  if ((p = match(ctx, 'GET', '/api/plans/:id'))) {
    need(ctx);
    const plan = await findPlan(env, ctx, p.id);
    if (!plan) return json({ error: 'Không tìm thấy phương án' }, 404);
    // Bước 1 & 2 của phương án đọc thẳng chứng từ thật, nên trả kèm luôn ở đây thay vì bắt giao
    // diện gọi /api/quotes + /api/contracts rồi tự lọc — điều kiện khớp (gồm nhánh dự phòng cho
    // dữ liệu cũ) chỉ nên tồn tại đúng một chỗ là máy chủ.
    const [items, events, cus, quotes, contracts] = await Promise.all([
      env.DB.prepare('SELECT i.*, u.name approver_name FROM nv_plan_items i LEFT JOIN nv_users u ON u.id=i.approver_id WHERE i.plan_id=? ORDER BY i.created_at').bind(p.id).all(),
      env.DB.prepare('SELECT e.*, u.name user_name, u.role user_role FROM nv_plan_events e LEFT JOIN nv_users u ON u.id=e.user_id WHERE e.plan_id=? ORDER BY e.created_at DESC LIMIT 60').bind(p.id).all(),
      env.DB.prepare('SELECT id,name,industry FROM nv_customers WHERE id=?').bind(plan.customer_id).first(),
      env.DB.prepare(`SELECT q.*, u.name owner_name, c.name customer_name FROM nv_quotes q
        LEFT JOIN nv_users u ON u.id=q.owner_id LEFT JOIN nv_customers c ON c.id=q.customer_id
        WHERE ${docMatch('q', '?', '?')} ORDER BY q.created_at DESC LIMIT 50`).bind(p.id, plan.customer_id).all(),
      env.DB.prepare(`SELECT ct.*, u.name owner_name, c.name customer_name, d.title deal_title FROM nv_contracts ct
        LEFT JOIN nv_users u ON u.id=ct.owner_id LEFT JOIN nv_customers c ON c.id=ct.customer_id LEFT JOIN nv_deals d ON d.id=ct.deal_id
        WHERE ${docMatch('ct', '?', '?')} ORDER BY ct.created_at DESC LIMIT 50`).bind(p.id, plan.customer_id).all(),
    ]);
    // Giữ đúng thứ tự vòng đời kể cả khi CSDL trả về lệch (4 hàng tạo cùng 1 giây).
    const byKind = new Map((items.results || []).map(i => [i.kind, i]));
    const ordered = PLAN_KINDS.map(k => byKind.get(k)).filter(Boolean);
    return json({
      plan, customer: cus || null, items: ordered, events: events.results || [],
      quotes: quotes.results || [], contracts: contracts.results || [],
    });
  }

  /**
   * Cập nhật 1 hạng mục — 2 nhánh tách bạch theo nội dung body, giống cách PATCH /api/quotes/:id
   * đã làm (nhánh DUYỆT có `decision`, nhánh TRÌNH có nội dung hạng mục).
   */
  if ((p = match(ctx, 'PATCH', '/api/plans/:id/items/:itemId'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    // Người duyệt không phải chủ phương án nên KHÔNG dùng findPlan() (đã lọc theo owner) ở nhánh
    // duyệt — tra thẳng rồi tự kiểm tra workspace, giống cách các route duyệt khác đang làm.
    const plan = await env.DB.prepare(
      'SELECT pl.* FROM nv_business_plans pl JOIN nv_users u ON u.id=pl.owner_id WHERE pl.id=? AND u.is_demo=?')
      .bind(p.id, wsBucket(ctx.me)).first();
    if (!plan) return json({ error: 'Không tìm thấy phương án' }, 404);
    const item = await env.DB.prepare('SELECT * FROM nv_plan_items WHERE id=? AND plan_id=?').bind(p.itemId, p.id).first();
    if (!item) return json({ error: 'Không tìm thấy hạng mục' }, 404);
    const t = now();
    const kindName = KIND_NAME[item.kind] || item.kind;

    /* ----- Nhánh DUYỆT: chỉ 2 kết quả 'approved' | 'revise', không có "từ chối" (đồng bộ với
       báo giá & hợp đồng — quy trình NetViet không có nhánh từ chối thẳng, mọi phản hồi tiêu cực
       đều quay về "yêu cầu điều chỉnh" để kinh doanh sửa và trình lại). ----- */
    if (b.decision) {
      need(ctx, LEAD_ROLES);
      if (item.status !== 'pending') return json({ error: 'Hạng mục này không ở trạng thái chờ duyệt.' }, 409);
      // Admin/BGĐ duyệt được mọi hạng mục; TPKD chỉ duyệt hạng mục đã trình cho Trưởng phòng.
      if (ctx.me.role !== 'admin' && item.approver_role !== ctx.me.role) {
        return json({ error: `Hạng mục này đang trình ${APPROVER_NAME[item.approver_role] || 'người khác'} duyệt.` }, 403);
      }
      const decision = vEnum(b.decision, ['approved', 'revise'], 'Quyết định', null);
      if (!decision) return json({ error: 'Quyết định không hợp lệ' }, 400);
      const note = str(b.note, 800);
      if (decision === 'revise' && !note) return json({ error: 'Vui lòng nêu rõ cần điều chỉnh gì để kinh doanh sửa đúng.' }, 400);
      await env.DB.prepare('UPDATE nv_plan_items SET status=?,approver_id=?,decision=?,decision_note=?,decided_at=?,updated_at=? WHERE id=?')
        .bind(decision, ctx.me.id, decision, note, t, t, p.itemId).run();
      await env.DB.prepare('UPDATE nv_business_plans SET updated_at=? WHERE id=?').bind(t, p.id).run();
      await logEvent(env, p.id, p.itemId, ctx.me.id, decision,
        (decision === 'approved' ? 'Đã duyệt ' : 'Yêu cầu điều chỉnh ') + kindName + (note ? ': ' + note : ''));
      await notify(env, plan.owner_id, {
        type: 'plan', level: decision === 'approved' ? 'info' : 'warn',
        title: decision === 'approved' ? `Đã duyệt ${kindName}` : `Cần chỉnh sửa ${kindName}`,
        body: `${plan.title}${note ? ' — ' + note : ''}`,
        link: '#/plans/' + p.id,
      });
      await audit(env, ctx.me.id, 'decide', 'plan_item', p.itemId, { plan: p.id, kind: item.kind, decision });
      return json({ ok: true, status: decision });
    }

    /* ----- Nhánh TRÌNH DUYỆT: chỉ chủ phương án, chỉ khi hạng mục chưa trình hoặc đang bị trả
       lại. Trình lại sau khi bị trả lại sẽ XOÁ quyết định cũ để người duyệt không nhìn nhầm
       phản hồi của vòng trước là phản hồi cho nội dung mới. ----- */
    // Báo giá & hợp đồng đã có chứng từ thật với luồng duyệt 2 vòng riêng — không cho trình bằng
    // ô summary nữa, nếu không lại quay về đúng cảnh nhập số hai lần và duyệt hai lần mà việc gộp
    // này sinh ra để dẹp. Hai hàng nv_plan_items tương ứng vẫn được giữ (dữ liệu cũ không mất).
    if (!MANUAL_KINDS.includes(item.kind)) {
      return json({ error: `${kindName} nay lập trực tiếp trong phương án bằng chứng từ thật — không trình bằng ô nhập tay.` }, 409);
    }
    if (plan.owner_id !== ctx.me.id && !isLead(ctx.me)) {
      return json({ error: 'Chỉ người phụ trách mới trình được hạng mục này.' }, 403);
    }
    if (!['todo', 'revise'].includes(item.status)) {
      return json({ error: item.status === 'pending' ? 'Hạng mục đang chờ duyệt.' : 'Hạng mục đã được duyệt.' }, 409);
    }
    const summary = vText(b.summary, 'Nội dung hạng mục', { max: 1000, required: true, min: 2 });
    const value = vMoney(b.value, 'Giá trị');
    const approverRole = vEnum(b.approverRole, APPROVER_ROLES, 'Người duyệt', 'manager');
    await env.DB.prepare('UPDATE nv_plan_items SET status=?,summary=?,value=?,approver_role=?,approver_id=NULL,decision=NULL,decision_note=NULL,decided_at=NULL,submitted_at=?,updated_at=? WHERE id=?')
      .bind('pending', summary, value, approverRole, t, t, p.itemId).run();
    await env.DB.prepare('UPDATE nv_business_plans SET updated_at=? WHERE id=?').bind(t, p.id).run();
    await logEvent(env, p.id, p.itemId, ctx.me.id, 'submit',
      `Đã trình ${kindName} lên ${APPROVER_NAME[approverRole]}: ${summary}`);
    // Báo cho đúng nhóm người duyệt trong CÙNG workspace — không làm phiền workspace còn lại.
    const { results: approvers } = await env.DB.prepare('SELECT id FROM nv_users WHERE role=? AND active=1 AND is_demo=?')
      .bind(approverRole, wsBucket(ctx.me)).all();
    for (const a of approvers || []) {
      await notify(env, a.id, {
        type: 'plan', level: 'warn', title: `${kindName} chờ bạn duyệt`,
        body: `${plan.title} — ${ctx.me.name} vừa trình.`, link: '#/plans/' + p.id,
      });
    }
    await audit(env, ctx.me.id, 'submit', 'plan_item', p.itemId, { plan: p.id, kind: item.kind, approverRole });
    return json({ ok: true, status: 'pending' });
  }

  /** Thêm 1 dòng trao đổi vào phương án — cả kinh doanh lẫn người duyệt đều dùng chung. */
  if ((p = match(ctx, 'POST', '/api/plans/:id/comment'))) {
    need(ctx);
    const plan = await env.DB.prepare(
      'SELECT pl.* FROM nv_business_plans pl JOIN nv_users u ON u.id=pl.owner_id WHERE pl.id=? AND u.is_demo=?')
      .bind(p.id, wsBucket(ctx.me)).first();
    if (!plan) return json({ error: 'Không tìm thấy phương án' }, 404);
    if (plan.owner_id !== ctx.me.id && !isLead(ctx.me)) return json({ error: 'Bạn không có quyền trao đổi trong phương án này.' }, 403);
    const b = await readBody(ctx.request);
    const msg = vText(b.message, 'Nội dung trao đổi', { max: 1000, required: true, min: 1 });
    await logEvent(env, p.id, str(b.itemId, 40) || null, ctx.me.id, 'comment', msg);
    await env.DB.prepare('UPDATE nv_business_plans SET updated_at=? WHERE id=?').bind(now(), p.id).run();
    // Người còn lại của cuộc trao đổi được báo: kinh doanh viết thì báo người duyệt gần nhất và
    // ngược lại. Không có người duyệt nào từng chạm vào thì chỉ ghi nhật ký, không báo ai.
    if (plan.owner_id !== ctx.me.id) {
      await notify(env, plan.owner_id, { type: 'plan', level: 'info', title: 'Phản hồi mới trên phương án', body: `${plan.title}: ${msg}`, link: '#/plans/' + p.id });
    } else {
      const last = await env.DB.prepare("SELECT approver_id FROM nv_plan_items WHERE plan_id=? AND approver_id IS NOT NULL ORDER BY decided_at DESC LIMIT 1").bind(p.id).first();
      if (last?.approver_id) {
        await notify(env, last.approver_id, { type: 'plan', level: 'info', title: 'Kinh doanh phản hồi phương án', body: `${plan.title}: ${msg}`, link: '#/plans/' + p.id });
      }
    }
    return json({ ok: true });
  }

  return null;
}
