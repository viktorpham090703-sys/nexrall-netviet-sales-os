import { json, match, need, uid, now, DAY, readBody, scope, audit, notify, num, str, startOfDay, wsScope, wsBucket, resolveAssignableOwner, LEAD_ROLES } from '../lib/util.js';
import { scoreLead } from '../lib/ai.js';
import { vEmail, vPhone, vText, vPastTs, vCount, vEnum } from '../lib/validate.js';
import { getConfig } from '../lib/kpi.js';
import { ALL_STATUSES, DEFAULT_STATUS, normalizeStatuses, decorateCustomer, dkkhState } from '../lib/customer.js';

/* Nguồn khách hàng cố định (mục 3 quy trình vận hành PKD) — khớp src/const.js LEAD_SOURCES (client). */
const LEAD_SOURCES = ['sale_tu_tim', 'cong_ty_cap', 'khach_cu_gioi_thieu', 'partner_pa1', 'partner_pa2'];

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
  if (!normName(name) && !normPhone(phone)) return null;
  return (await customerDupIndex(env, ctx)).find(name, phone, excludeId);
}

/**
 * Nạp khách hàng của workspace MỘT lần rồi so trùng nhiều lần — dùng cho nhập danh sách từ Excel,
 * nơi mỗi dòng đều cần so trùng mà gọi findDuplicateCustomer() từng dòng sẽ quét lại cả bảng.
 * `add()` đưa thêm dòng vừa nhận vào chỉ mục để 2 dòng trùng nhau TRONG CÙNG file cũng bị bắt.
 */
async function customerDupIndex(env, ctx) {
  const ws = wsScope(ctx, 'c.owner_id');
  const { results } = await env.DB.prepare(
    `SELECT c.id,c.name,c.phone,c.owner_id,u.name owner_name FROM nv_customers c LEFT JOIN nv_users u ON u.id=c.owner_id WHERE 1=1${ws.sql} LIMIT ${CUSTOMER_SCAN_MAX}`)
    .bind(...ws.args).all();
  const rows = (results || []).map(c => ({ ...c, nk: normName(c.name), pk: normPhone(c.phone) }));
  return {
    find(name, phone, excludeId) {
      const nk = normName(name), pk = normPhone(phone);
      return rows.find(c => c.id !== excludeId && ((pk && c.pk === pk) || (nk && c.nk === nk))) || null;
    },
    add(row) { rows.push({ ...row, nk: normName(row.name), pk: normPhone(row.phone) }); },
  };
}

/**
 * Trần số khách quét trong 1 lần đọc (danh sách CRM, so trùng). Đủ rộng cho nhiều năm dữ liệu
 * của 1 phòng kinh doanh; chỉ để chặn truy vấn phình vô hạn chứ không phải trần hiển thị.
 */
const CUSTOMER_SCAN_MAX = 5000;

/** Khoá tìm kiếm: bỏ dấu, hạ chữ (kể cả Đ/đ), gộp khoảng trắng — "ĐÔNG  Đô" → "dong do". */
const searchKey = (s) => String(s || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/** Trần số dòng mỗi lần nhập Excel — đủ cho danh sách của 1 phòng kinh doanh, chặn request phình to. */
const IMPORT_MAX_ROWS = 500;
/** Ô tuỳ chọn từ Excel: cắt khoảng trắng, ô trống lưu NULL thay vì chuỗi rỗng. */
const opt = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

export async function crmRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Khách hàng ================= */
  /**
   * Danh sách khách hàng + bộ lọc.
   *
   * `scope()` vẫn là lớp phân quyền như cũ (sales chỉ thấy khách của mình, TP/Admin thấy cả
   * workspace, kèm ?userId= để lọc theo 1 sale). Các tham số lọc thêm bên dưới CHỈ thu hẹp
   * kết quả trong phạm vi đó, không bao giờ nới ra.
   *
   * Ngoại lệ có chủ đích: `?claimable=1` cho phép SALES nhìn thấy khách của sale KHÁC khi khách
   * đó đã hết hạn ĐKKH — đúng quy trình "sale khác được phép ĐKKH khách đó". Vẫn giới hạn trong
   * cùng workspace (demo/chính thức) và vẫn không lộ ghi chú nội bộ, chỉ đủ thông tin để nhận.
   */
  if ((p = match(ctx, 'GET', '/api/customers'))) {
    need(ctx);
    const cfg = await getConfig(env, ctx.me.id);
    const claimable = url.searchParams.get('claimable') === '1';
    const s = claimable ? wsScope(ctx, 'c.owner_id') : scope(ctx, 'c.owner_id');
    const q = (url.searchParams.get('q') || '').trim();
    // Số liệu deal gộp 1 lần bằng GROUP BY thay vì 3 truy vấn con cho MỖI khách — danh sách giờ
    // không còn trần 400 nên chi phí theo từng hàng phải thấp.
    let sql = `SELECT c.*, u.name owner_name,
      COALESCE(d.open_deals,0) open_deals, COALESCE(d.won_value,0) won_value, COALESCE(d.won_deals,0) won_deals
      FROM nv_customers c LEFT JOIN nv_users u ON u.id=c.owner_id
      LEFT JOIN (SELECT customer_id,
          SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open_deals,
          SUM(CASE WHEN status='won' THEN value ELSE 0 END) won_value,
          SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) won_deals
        FROM nv_deals WHERE customer_id IS NOT NULL GROUP BY customer_id) d ON d.customer_id=c.id
      WHERE 1=1` + s.sql;
    const args = [...s.args];
    // Lọc theo trường thông tin khách hàng — khớp chính xác, giá trị rỗng nghĩa là không lọc.
    for (const [param, col] of [['industry', 'c.industry'], ['scale', 'c.scale'], ['source', 'c.nguon_khach_hang'], ['partnerId', 'c.partner_id']]) {
      const v = (url.searchParams.get(param) || '').trim();
      if (v) { sql += ` AND ${col}=?`; args.push(v); }
    }
    sql += ` ORDER BY c.last_touch_at DESC LIMIT ${CUSTOMER_SCAN_MAX}`;
    const { results } = await env.DB.prepare(sql).bind(...args).all();

    // Tìm kiếm, trạng thái và ĐKKH lọc ở tầng ứng dụng. Riêng tìm kiếm KHÔNG làm bằng SQL: LOWER()
    // và LIKE của SQLite chỉ hiểu chữ ASCII, nên "Đông Đô" không bao giờ khớp "đông đô" (chữ Đ
    // hoa không được hạ). searchKey() bỏ dấu + hạ chữ, nên gõ "dong do", "Đông Đô" hay "ĐÔNG ĐÔ"
    // đều ra; SĐT so theo dãy chữ số nên "0912 345" khớp "0912345678".
    const wantStatuses = (url.searchParams.get('status') || '').split(',').map(x => x.trim()).filter(x => ALL_STATUSES.includes(x));
    const dkFilter = url.searchParams.get('dkkh') || '';
    let items = (results || []).map(r => decorateCustomer(r, cfg, Number(r.won_deals) > 0));
    if (q) {
      const qk = searchKey(q), qd = q.replace(/\D/g, '');
      items = items.filter(c => (qk && (searchKey(c.name).includes(qk) || searchKey(c.industry).includes(qk)))
        || (qd.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(qd)));
    }
    if (wantStatuses.length) items = items.filter(c => c.statuses.some(k => wantStatuses.includes(k)));
    if (dkFilter === 'expiring') items = items.filter(c => c.dkkh.kind === 'expiring');
    if (dkFilter === 'expired') items = items.filter(c => c.dkkh.kind === 'expired');
    if (dkFilter === 'mine') items = items.filter(c => c.owner_id === ctx.me.id);
    // Ở chế độ "khách có thể nhận", chỉ trả về khách ĐÃ hết hạn và KHÔNG phải của chính mình —
    // nếu không, màn "Khách có thể nhận" sẽ lẫn cả danh sách khách của bản thân.
    if (claimable) items = items.filter(c => c.dkkh.claimable && c.owner_id !== ctx.me.id);
    // Panel TPKD cần danh sách người phụ trách độc lập với các hàng khách đang lọc: ví dụ một
    // Sales (hoặc chính TPKD) chưa được gán khách nào vẫn phải xuất hiện trong bộ lọc để TPKD có
    // cái nhìn đủ về cả đội. TPKD là người trực tiếp tham gia chăm sóc khách nên được phép là
    // chủ sở hữu khách bên cạnh các Sales.
    // Chỉ trả danh sách này cho nhóm quản lý; Sales thường không cần, cũng không được dùng nó để
    // suy luận danh sách nhân sự ngoài phạm vi dữ liệu của mình.
    let sales = [];
    if (LEAD_ROLES.includes(ctx.me.role)) {
      const { results: team } = await env.DB.prepare(
        "SELECT id,name,title,role FROM nv_users WHERE active=1 AND role IN ('sales','manager') AND is_demo=? ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END, name"
      ).bind(wsBucket(ctx.me)).all();
      sales = team || [];
    }
    // Phân trang TUỲ CHỌN: màn CRM gửi ?limit= để vẽ dần ("Xem thêm"); các màn khác (Pipeline,
    // Sales Kit, Phương án…) không gửi và nhận đủ danh sách để chọn khách trong ô chọn — trước đây
    // trần 400 làm khách thứ 401 trở đi không chọn được ở đó. Số đếm tổng / ĐKKH sắp hết / đã hết
    // tính trên TOÀN BỘ kết quả lọc, không phải trên trang đang hiển thị.
    const total = items.length;
    const summary = {
      expiring: items.filter(c => c.dkkh.kind === 'expiring').length,
      expired: items.filter(c => c.dkkh.kind === 'expired').length,
    };
    const limit = Number(url.searchParams.get('limit')) || 0;
    if (limit > 0) items = items.slice(0, Math.min(limit, CUSTOMER_SCAN_MAX));
    // Danh sách ngành cho ô lọc lấy từ cả phạm vi xem được, không phụ thuộc bộ lọc/trang hiện tại.
    const { results: ind } = await env.DB.prepare(
      `SELECT DISTINCT c.industry FROM nv_customers c WHERE c.industry IS NOT NULL AND c.industry<>''${s.sql} ORDER BY c.industry LIMIT 300`)
      .bind(...s.args).all();
    return json({ items, total, summary, industries: (ind || []).map(r => r.industry), sales });
  }

  /**
   * Kiểm tra trùng khách hàng NGAY KHI GÕ, trước khi bấm Lưu.
   * Dùng đúng findDuplicateCustomer() của nhánh tạo mới nên cảnh báo hiện lúc gõ và lỗi lúc lưu
   * không bao giờ lệch nhau. Chỉ trả về đúng phần cần để vẽ cảnh báo (tên khách + tên sale đang
   * giữ), không trả cả bản ghi — người gọi có thể chưa có quyền xem khách của sale khác.
   */
  if ((p = match(ctx, 'GET', '/api/customers/check-duplicate'))) {
    need(ctx);
    const name = (url.searchParams.get('name') || '').trim();
    const phone = (url.searchParams.get('phone') || '').trim();
    const excludeId = (url.searchParams.get('excludeId') || '').trim() || undefined;
    const dup = (name || phone) ? await findDuplicateCustomer(env, ctx, name, phone, excludeId) : null;
    if (!dup) return json({ duplicate: null });
    return json({
      duplicate: {
        name: dup.name, ownerName: dup.owner_name || null,
        mine: dup.owner_id === ctx.me.id,
        matchedPhone: !!phone && normPhone(dup.phone) === normPhone(phone),
      },
    });
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
    const owner = await resolveAssignableOwner(env, ctx, b.ownerId);
    // partner_id chỉ có ý nghĩa khi nguồn là 1 trong 2 dòng Partner — không ép buộc, chỉ lưu nếu có.
    const nguonKhachHang = vEnum(b.nguonKhachHang, LEAD_SOURCES, 'Nguồn khách hàng', null);
    const partnerId = str(b.partnerId, 40) || null;
    const statuses = normalizeStatuses(b.statuses) || [DEFAULT_STATUS];
    const t = now(), id = uid('cs');
    // `temp` vẫn được ghi 'warm' cố định để không vi phạm NOT NULL của cột cũ — phân loại thật
    // nằm ở `statuses`, cột temp không còn được đọc ở bất kỳ đâu trong app.
    // dkkh_at = thời điểm tạo: sale bắt đầu giữ quyền chăm sóc từ lúc đăng ký khách vào hệ thống.
    await env.DB.prepare('INSERT INTO nv_customers (id,owner_id,name,industry,scale,phone,email,address,temp,source,note,services,nguon_khach_hang,partner_id,statuses,dkkh_at,dkkh_count,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, owner ? owner.id : ctx.me.id, name, str(b.industry, 60), str(b.scale, 40),
        phone, email, str(b.address, 200), 'warm',
        str(b.source, 60), str(b.note, 1000), JSON.stringify(Array.isArray(b.services) ? b.services.slice(0, 5) : []),
        nguonKhachHang, partnerId, JSON.stringify(statuses), t, 0, t, t, t).run();
    await audit(env, ctx.me.id, 'create', 'customer', id, { name: b.name, statuses });
    return json({ id });
  }

  /**
   * Nhập danh sách khách hàng từ Excel (theo file mẫu Doanh nghiệp · Người liên hệ · SĐT · Email ·
   * Trạng thái · Ghi chú). Trình duyệt tự đọc file rồi gửi lên mảng `rows` đã tách cột.
   *
   * `dryRun: true` chỉ kiểm tra — trả kết quả từng dòng để màn xem trước tô Hợp lệ / Trùng / Lỗi.
   * Lần gửi thật kiểm tra LẠI từ đầu (không tin kết quả xem trước: giữa 2 lần có thể sale khác vừa
   * đăng ký đúng khách đó) rồi chỉ lưu các dòng hợp lệ. Dòng trùng luôn bị bỏ qua, không có "vẫn
   * tạo" như form tay: đó là deal registration, cần trao đổi với sale đang giữ chứ không nhập đè.
   *
   * Mỗi dòng hợp lệ tạo 1 khách hàng (ĐKKH tính từ lúc nhập) và, nếu có tên người liên hệ, 1
   * người liên hệ chính mang cùng SĐT/Email của dòng đó.
   */
  if ((p = match(ctx, 'POST', '/api/customers/import'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const input = Array.isArray(b.rows) ? b.rows : [];
    if (!input.length) return json({ error: 'File không có dòng khách hàng nào' }, 400);
    if (input.length > IMPORT_MAX_ROWS) return json({ error: `Mỗi lần chỉ nhập được tối đa ${IMPORT_MAX_ROWS} khách hàng — chia file nhỏ hơn rồi nhập lần lượt.` }, 400);

    const dryRun = !!b.dryRun;
    const owner = await resolveAssignableOwner(env, ctx, b.ownerId);
    const ownerId = owner ? owner.id : ctx.me.id;
    const nguonKhachHang = vEnum(b.nguonKhachHang, LEAD_SOURCES, 'Nguồn khách hàng', null);
    const idx = await customerDupIndex(env, ctx);

    const results = [], accepted = [];
    input.forEach((r, i) => {
      const line = Number(r?.line) || i + 1;   // số dòng trong Excel để người dùng dò lại file
      let row;
      try {
        row = {
          name: vText(r?.name, 'Tên doanh nghiệp', { max: 160, required: true, min: 2 }),
          phone: vPhone(r?.phone),
          email: vEmail(r?.email),
          contactName: vText(r?.contactName, 'Tên người liên hệ', { max: 80 }),
          contactTitle: opt(r?.contactTitle, 80),
          industry: opt(r?.industry, 60), scale: opt(r?.scale, 40), address: opt(r?.address, 200),
          note: opt(r?.note, 1000),
          statuses: normalizeStatuses(r?.statuses) || [DEFAULT_STATUS],
        };
      } catch (e) {
        results.push({ line, ok: false, error: e.message || 'Dữ liệu không hợp lệ' });
        return;
      }
      const dup = idx.find(row.name, row.phone);
      if (dup) {
        results.push({
          line, ok: false,
          duplicate: dup.inFileLine
            ? { inFileLine: dup.inFileLine, name: dup.name }
            : { name: dup.name, ownerName: dup.owner_name || null, mine: dup.owner_id === ctx.me.id },
        });
        return;
      }
      idx.add({ id: null, name: row.name, phone: row.phone, inFileLine: line });
      accepted.push({ line, row });
      results.push({ line, ok: true });
    });

    if (dryRun || !accepted.length) return json({ dryRun, created: 0, results });

    const t = now(), stmts = [];
    for (const { line, row } of accepted) {
      const id = uid('cs');
      stmts.push(env.DB.prepare('INSERT INTO nv_customers (id,owner_id,name,industry,scale,phone,email,address,temp,source,note,services,nguon_khach_hang,partner_id,statuses,dkkh_at,dkkh_count,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, ownerId, row.name, row.industry, row.scale, row.phone, row.email, row.address, 'warm',
          'Nhập Excel', row.note, '[]', nguonKhachHang, null, JSON.stringify(row.statuses), t, 0, t, t, t));
      if (row.contactName) {
        stmts.push(env.DB.prepare('INSERT INTO nv_contacts (id,customer_id,name,title,phone,email,is_primary,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(uid('ct'), id, row.contactName, row.contactTitle, row.phone, row.email, 1, t));
      }
      results.find(x => x.line === line).id = id;
    }
    // Chia lô cho vừa giới hạn 1 lần batch của D1; mỗi lô là 1 transaction.
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    await audit(env, ctx.me.id, 'import', 'customer', null, { created: accepted.length, total: input.length, ownerId });
    if (ownerId !== ctx.me.id) {
      await notify(env, ownerId, {
        type: 'customer', title: `${ctx.me.name} đã giao ${accepted.length} khách hàng cho bạn`,
        body: 'Danh sách nhập từ Excel — ĐKKH tính từ hôm nay.', link: '#/crm',
      });
    }
    return json({ dryRun: false, created: accepted.length, results });
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

    const cfg = await getConfig(env, ctx.me.id);
    const signed = (deals.results || []).some(d => d.status === 'won');
    return json({
      customer: decorateCustomer(cus, cfg, signed),
      contacts: contacts.results || [], deals: deals.results || [], activities: acts.results || [],
      quotes: quotes.results || [], suggestions,
    });
  }

  if ((p = match(ctx, 'PATCH', '/api/customers/:id'))) {
    need(ctx);
    const s = scope(ctx, 'owner_id');
    const cur = await env.DB.prepare('SELECT * FROM nv_customers WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!cur) return json({ error: 'Không tìm thấy khách hàng' }, 404);
    const b = await readBody(ctx.request);
    const newOwner = await resolveAssignableOwner(env, ctx, b.ownerId);
    const f = {
      name: b.name != null ? str(b.name, 160) : cur.name,
      industry: b.industry != null ? str(b.industry, 60) : cur.industry,
      scale: b.scale != null ? str(b.scale, 40) : cur.scale,
      phone: b.phone != null ? vPhone(b.phone) : cur.phone,
      email: b.email != null ? vEmail(b.email) : cur.email,
      note: b.note != null ? str(b.note, 1000) : cur.note,
      owner_id: newOwner ? newOwner.id : cur.owner_id,
      nguon_khach_hang: b.nguonKhachHang !== undefined ? vEnum(b.nguonKhachHang, LEAD_SOURCES, 'Nguồn khách hàng', null) : cur.nguon_khach_hang,
      partner_id: b.partnerId !== undefined ? (str(b.partnerId, 40) || null) : cur.partner_id,
      statuses: b.statuses !== undefined ? JSON.stringify(normalizeStatuses(b.statuses) || [DEFAULT_STATUS]) : cur.statuses,
    };
    await env.DB.prepare('UPDATE nv_customers SET name=?,industry=?,scale=?,phone=?,email=?,note=?,owner_id=?,nguon_khach_hang=?,partner_id=?,statuses=?,updated_at=? WHERE id=?')
      .bind(f.name, f.industry, f.scale, f.phone, f.email, f.note, f.owner_id, f.nguon_khach_hang, f.partner_id, f.statuses, now(), p.id).run();
    await audit(env, ctx.me.id, 'update', 'customer', p.id, b.statuses !== undefined ? { statuses: JSON.parse(f.statuses) } : {});
    return json({ ok: true });
  }

  /** Xoá khách hàng — chỉ TP/Admin, chặn nếu còn deal gắn với khách. */
  if ((p = match(ctx, 'DELETE', '/api/customers/:id'))) {
    need(ctx, LEAD_ROLES);
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

  /**
   * Tái ĐKKH — sale đang giữ khách gia hạn thêm 1 kỳ (mặc định 30 ngày).
   *
   * Chỉ chủ sở hữu hiện tại (hoặc TP/Admin thay mặt) mới gia hạn được: `scope()` đã lo phần này,
   * sales chỉ lấy được khách của chính mình. Khách đã ký hợp đồng không cần gia hạn — chặn để
   * không sinh thao tác vô nghĩa và không làm `dkkh_count` phình lên vô cớ.
   */
  if ((p = match(ctx, 'POST', '/api/customers/:id/dkkh/renew'))) {
    need(ctx);
    const s = scope(ctx, 'owner_id');
    const cur = await env.DB.prepare('SELECT * FROM nv_customers WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!cur) return json({ error: 'Không tìm thấy khách hàng' }, 404);
    const cfg = await getConfig(env, ctx.me.id);
    const won = Number(await env.DB.prepare("SELECT COUNT(*) n FROM nv_deals WHERE customer_id=? AND status='won'").bind(p.id).first('n')) || 0;
    const st = dkkhState(cur, cfg, won > 0);
    if (st.kind === 'locked') return json({ error: 'Khách đã ký hợp đồng — quyền chăm sóc được giữ vĩnh viễn, không cần gia hạn.' }, 409);
    const t = now();
    await env.DB.prepare('UPDATE nv_customers SET dkkh_at=?, dkkh_count=dkkh_count+1, updated_at=? WHERE id=?').bind(t, t, p.id).run();
    await audit(env, ctx.me.id, 'dkkh_renew', 'customer', p.id, { name: cur.name, count: st.count + 1 });
    return json({ ok: true, dkkh: dkkhState({ ...cur, dkkh_at: t, dkkh_count: st.count + 1 }, cfg, won > 0) });
  }

  /**
   * Nhận khách đã hết hạn ĐKKH của sale khác.
   *
   * Đây là điểm DUY NHẤT trong app cho phép một sale lấy bản ghi của sale khác, nên không dùng
   * scope() mà kiểm tra thủ công từng điều kiện: cùng workspace · thật sự đã hết hạn · chưa ký
   * hợp đồng · không phải khách của chính mình. Chủ cũ được thông báo ngay để biết mất khách,
   * và mọi lần chuyển đều có audit log (ai lấy của ai, lúc nào) để TPKD phân xử khi có tranh chấp.
   */
  if ((p = match(ctx, 'POST', '/api/customers/:id/dkkh/claim'))) {
    need(ctx);
    const cur = await env.DB.prepare(
      'SELECT c.* FROM nv_customers c JOIN nv_users u ON u.id=c.owner_id WHERE c.id=? AND u.is_demo=?')
      .bind(p.id, wsBucket(ctx.me)).first();
    if (!cur) return json({ error: 'Không tìm thấy khách hàng' }, 404);
    if (cur.owner_id === ctx.me.id) return json({ error: 'Khách này đang thuộc về bạn.' }, 409);
    const cfg = await getConfig(env, ctx.me.id);
    const won = Number(await env.DB.prepare("SELECT COUNT(*) n FROM nv_deals WHERE customer_id=? AND status='won'").bind(p.id).first('n')) || 0;
    const st = dkkhState(cur, cfg, won > 0);
    if (!st.claimable) {
      return json({
        error: st.kind === 'locked'
          ? 'Khách đã ký hợp đồng — không thể nhận từ sale khác.'
          : `Khách vẫn còn hạn ĐKKH (còn ${st.daysLeft} ngày). Chỉ nhận được sau khi hết hạn.`,
      }, 409);
    }
    const prevOwner = cur.owner_id;
    const t = now();
    await env.DB.prepare('UPDATE nv_customers SET owner_id=?, dkkh_at=?, dkkh_count=0, updated_at=? WHERE id=?')
      .bind(ctx.me.id, t, t, p.id).run();
    await audit(env, ctx.me.id, 'dkkh_claim', 'customer', p.id, { name: cur.name, from: prevOwner, to: ctx.me.id });
    if (prevOwner) {
      await notify(env, prevOwner, {
        type: 'customer', level: 'warn',
        title: 'Khách hàng đã chuyển sang sale khác',
        body: `"${cur.name}" hết hạn ĐKKH và chưa ký hợp đồng — ${ctx.me.name} đã nhận chăm sóc.`,
        link: '#/crm',
      });
    }
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

  /* ================= Partner (đối tác hợp tác bán hàng) =================
   * Không truy cập CRM trực tiếp — sale phụ trách nhập hộ dữ liệu. Quan hệ partner→sale phụ
   * trách CỐ ĐỊNH, không phải trường tự do (mục 2 tài liệu). */
  if ((p = match(ctx, 'GET', '/api/partners'))) {
    need(ctx);
    const s = scope(ctx, 'pt.sale_phu_trach_id');
    const { results } = await env.DB.prepare(`SELECT pt.*, u.name sale_name FROM nv_partners pt
      LEFT JOIN nv_users u ON u.id=pt.sale_phu_trach_id WHERE pt.active=1${s.sql} ORDER BY pt.name`).bind(...s.args).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/partners'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    const name = vText(b.name, 'Tên partner', { max: 160, required: true, min: 2 });
    const sale = await resolveAssignableOwner(env, ctx, b.saleId);
    const id = uid('pn');
    const t = now();
    await env.DB.prepare('INSERT INTO nv_partners (id,name,phone,email,note,sale_phu_trach_id,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)')
      .bind(id, name, vPhone(b.phone), vEmail(b.email), str(b.note, 500), sale ? sale.id : ctx.me.id, t, t).run();
    await audit(env, ctx.me.id, 'create', 'partner', id, { name });
    return json({ id });
  }

  if ((p = match(ctx, 'PATCH', '/api/partners/:id'))) {
    need(ctx);
    const s = scope(ctx, 'sale_phu_trach_id');
    const cur = await env.DB.prepare('SELECT * FROM nv_partners WHERE id=?' + s.sql).bind(p.id, ...s.args).first();
    if (!cur) return json({ error: 'Không tìm thấy partner' }, 404);
    const b = await readBody(ctx.request);
    const newSale = await resolveAssignableOwner(env, ctx, b.saleId);
    const f = {
      name: b.name != null ? str(b.name, 160) : cur.name,
      phone: b.phone != null ? vPhone(b.phone) : cur.phone,
      email: b.email != null ? vEmail(b.email) : cur.email,
      note: b.note != null ? str(b.note, 500) : cur.note,
      sale_phu_trach_id: newSale ? newSale.id : cur.sale_phu_trach_id,
      active: b.active != null ? (b.active ? 1 : 0) : cur.active,
    };
    await env.DB.prepare('UPDATE nv_partners SET name=?,phone=?,email=?,note=?,sale_phu_trach_id=?,active=?,updated_at=? WHERE id=?')
      .bind(f.name, f.phone, f.email, f.note, f.sale_phu_trach_id, f.active, now(), p.id).run();
    await audit(env, ctx.me.id, 'update', 'partner', p.id, {});
    return json({ ok: true });
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
    const owner = await resolveAssignableOwner(env, ctx, b.ownerId);
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
    // Chống nhân đôi định mức (FR-M2 "Chính xác": chỉ tính lần tiếp cận ĐẦU TIÊN/khách).
    // Không có chốt chặn này thì bấm "Tiếp cận" N lần trên cùng 1 lead sẽ sinh N khách hàng
    // trùng + N liên hệ mới + N hoạt động, thổi phồng định mức ngày và điểm KPI "Chủ động".
    if (lead.status === 'contacted') {
      return json({
        error: `Lead "${lead.name}" đã được tiếp cận trước đó — không tính thêm vào định mức khách mới.`,
        alreadyApproached: true,
      }, 409);
    }
    const t = now();
    const cusId = uid('cs');
    await env.DB.batch([
      // Lead vừa được tiếp cận → khách ở trạng thái "Chăm sóc" (đã có 1 lần liên hệ, chưa chào
      // hàng). Mốc ĐKKH bắt đầu tính từ đây: sale giữ quyền chăm sóc 1 tháng kể từ lần tiếp cận.
      env.DB.prepare('INSERT INTO nv_customers (id,owner_id,name,industry,phone,email,temp,source,note,services,statuses,dkkh_at,dkkh_count,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(cusId, ctx.me.id, lead.company || lead.name, null, lead.phone, lead.email, 'warm', lead.channel, 'Chuyển từ lead: ' + lead.name, '[]', '["cham_soc"]', t, 0, t, t, t),
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
