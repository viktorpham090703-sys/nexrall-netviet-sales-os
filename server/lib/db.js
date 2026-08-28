import { now, uid, DAY } from './util.js';
import { hashPassword } from './auth.js';
import { PROB, defaultCommissionRate } from '../routes/deals.js';

let _migrated = false;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS nv_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, role TEXT NOT NULL, title TEXT, phone TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_customers (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL, industry TEXT, scale TEXT, phone TEXT, email TEXT, address TEXT, temp TEXT NOT NULL DEFAULT 'warm', source TEXT, note TEXT, services TEXT DEFAULT '[]', last_touch_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_contacts (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT, phone TEXT, email TEXT, is_primary INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_leads (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL, company TEXT, channel TEXT, phone TEXT, email TEXT, need TEXT, score INTEGER DEFAULT 50, status TEXT DEFAULT 'new', note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_tender_leads (id TEXT PRIMARY KEY, title TEXT NOT NULL, org TEXT, source TEXT, url TEXT, value REAL DEFAULT 0, service_tag TEXT, deadline_at INTEGER, score INTEGER DEFAULT 50, status TEXT DEFAULT 'new', assigned_to TEXT, summary TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_deals (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, customer_id TEXT, title TEXT NOT NULL, service TEXT, value REAL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'lead_moi', probability INTEGER DEFAULT 10, status TEXT NOT NULL DEFAULT 'open', source TEXT, expected_close_at INTEGER, last_activity_at INTEGER, stage_changed_at INTEGER, won_at INTEGER, lost_reason TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, line TEXT, unit TEXT, price REAL NOT NULL DEFAULT 0, commission_rate REAL DEFAULT 5, max_discount REAL DEFAULT 10, description TEXT, active INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS nv_quotes (id TEXT PRIMARY KEY, deal_id TEXT, owner_id TEXT NOT NULL, customer_id TEXT, title TEXT, items TEXT DEFAULT '[]', subtotal REAL DEFAULT 0, discount_pct REAL DEFAULT 0, total REAL DEFAULT 0, commission REAL DEFAULT 0, status TEXT DEFAULT 'draft', approver_id TEXT, approve_note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_activities (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT, deal_id TEXT, type TEXT NOT NULL, subject TEXT, note TEXT, outcome TEXT, duration INTEGER DEFAULT 0, happened_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_daily_contacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, company TEXT, channel TEXT, phone TEXT, customer_id TEXT, note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assigner_id TEXT, title TEXT NOT NULL, detail TEXT, type TEXT DEFAULT 'task', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'todo', deal_id TEXT, customer_id TEXT, due_at INTEGER, accept_sla_min INTEGER DEFAULT 120, accepted_at INTEGER, done_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_daily_reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT DEFAULT 'day', period TEXT NOT NULL, calls INTEGER DEFAULT 0, meetings INTEGER DEFAULT 0, new_contacts INTEGER DEFAULT 0, deals_moved INTEGER DEFAULT 0, revenue REAL DEFAULT 0, highlight TEXT, blocker TEXT, plan TEXT, late INTEGER DEFAULT 0, submitted_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_kpi_config (id TEXT PRIMARY KEY, user_id TEXT, ckey TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_kpi_scores (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, performance REAL, discipline REAL, proactive REAL, total REAL, grade TEXT, manager_note TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_commissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, deal_id TEXT, period TEXT, base REAL, rate REAL, amount REAL, status TEXT DEFAULT 'du_kien', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_pip_records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, manager_id TEXT, phase TEXT, goal TEXT, metric TEXT, start_at INTEGER, end_at INTEGER, status TEXT DEFAULT 'dang_chay', result_note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_trainings (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT, url TEXT, duration_min INTEGER DEFAULT 10, role_target TEXT DEFAULT 'sales', required INTEGER DEFAULT 0, description TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_training_progress (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, training_id TEXT NOT NULL, status TEXT DEFAULT 'assigned', progress INTEGER DEFAULT 0, assigned_by TEXT, completed_at INTEGER, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT, title TEXT NOT NULL, body TEXT, link TEXT, level TEXT DEFAULT 'info', read INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_ai_interactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT, prompt TEXT, response TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_audit_logs (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, meta TEXT, created_at INTEGER NOT NULL)`,
  /* --- Từ đây là migration BỔ SUNG: chỉ được THÊM VÀO CUỐI, không sửa/chèn giữa --- */
  // 21: phiên đăng nhập — thay cho việc tin vào header X-Actor-Id
  `CREATE TABLE IF NOT EXISTS nv_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT)`,
  // 22: mỗi deal chỉ có đúng 1 bản ghi hoa hồng (chống nhân bản ở tầng CSDL)
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_deal ON nv_commissions(deal_id)`,
  // 23: chặn trùng email tài khoản ở tầng CSDL
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_user_email ON nv_users(email) WHERE email IS NOT NULL AND email <> ''`,
  // 24: cấu hình có phiên bản — giữ lịch sử hiệu lực để KPI kỳ cũ không bị tính lại sai
  `ALTER TABLE nv_kpi_config ADD COLUMN valid_from INTEGER`,
  `ALTER TABLE nv_kpi_config ADD COLUMN valid_to INTEGER`,
  // 25: tăng tốc tra cứu phiên & audit
  `CREATE INDEX IF NOT EXISTS ix_sessions_user ON nv_sessions(user_id)`,
  // 26: đăng nhập bằng mật khẩu — thêm cột lưu mã băm (PBKDF2), không lưu mật khẩu gốc
  `ALTER TABLE nv_users ADD COLUMN password_hash TEXT`,
  // 27: đánh dấu tài khoản demo (seed) để tách khỏi nhân sự thật thêm qua Quản trị —
  // tránh lộ tên/chức danh nhân sự thật ra màn đăng nhập công khai kèm mật khẩu demo dùng chung.
  `ALTER TABLE nv_users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0`,
  // 28: liên kết thiết lập mật khẩu dùng 1 lần (cấp tài khoản lần đầu / quên mật khẩu) —
  // app chưa có hạ tầng gửi email nên Admin tự gửi link qua kênh nội bộ. Chỉ lưu HASH của
  // token, không lưu token gốc, để lộ CSDL không đồng nghĩa lộ được link còn hiệu lực.
  `CREATE TABLE IF NOT EXISTS nv_password_setup_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL)`,
  // 29: buộc đổi mật khẩu ở lần đăng nhập đầu — dùng cho tài khoản admin khởi tạo tự động
  // ở chế độ production (mật khẩu ban đầu do người vận hành đặt qua secret, không nên dùng lâu dài).
  `ALTER TABLE nv_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`,
  // 30: chống dò mật khẩu — đếm số lần đăng nhập sai theo (định danh+IP) trong 1 cửa sổ thời gian.
  // Dùng bảng D1 thay vì SHARED_KV vì cần đọc-rồi-tăng chính xác trong 1 request; KV không có
  // atomic increment nên dễ đếm thiếu khi có request đua nhau. Không cần cột TTL vì cửa sổ được
  // tự tính từ window_start, hàng cũ tự nguội (không chặn) khi quá cửa sổ dù chưa bị dọn.
  `CREATE TABLE IF NOT EXISTS nv_login_attempts (rl_key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  // 31: sửa dữ liệu — 6 tài khoản nhân sự chính thức (HAUNV, HUONGNT, DUCHT, DUCNH, HUONGLT,
  // PHUONGVH) được tạo thẳng trong CSDL với is_demo=1, khiến họ bị liệt kê nhầm vào "Tài khoản
  // demo" công khai ở màn đăng nhập (is_demo=1 vốn chỉ dành cho 5 tài khoản demo do seed() tạo).
  // Đây là UPDATE dữ liệu 1 lần theo đúng danh sách mã nhân viên đã xác nhận, không đụng schema,
  // không đụng mật khẩu/role/quyền, không ảnh hưởng tài khoản demo hay tài khoản khác.
  `UPDATE nv_users SET is_demo=0 WHERE id IN ('HAUNV','HUONGNT','DUCHT','DUCNH','HUONGLT','PHUONGVH')`,
  // 32: tách quyền QUẢN LÝ TÀI KHOẢN ra khỏi role='admin' — trước đây bất kỳ ai role='admin' cũng
  // toàn quyền thêm/khoá/đổi mật khẩu tài khoản khác. Nay có Admin "điều hành" (toàn quyền) và
  // Admin "nghiệp vụ" (không đụng được tài khoản nhân sự khác). Mặc định 1 để KHÔNG đổi hành vi
  // của các admin đã có từ trước (demo, admin khởi tạo qua BOOTSTRAP_ADMIN_*...).
  `ALTER TABLE nv_users ADD COLUMN can_manage_accounts INTEGER NOT NULL DEFAULT 1`,
  // 33: gán role + quyền quản lý tài khoản theo đúng danh sách đã xác nhận cho 6 tài khoản nhân sự
  // chính thức ở migration 31 — HAUNV là Admin toàn quyền (kể cả quản lý tài khoản); HUONGNT & DUCHT
  // là Admin nhưng KHÔNG được thêm/khoá tài khoản hay đổi mật khẩu nhân sự khác; DUCNH là Trưởng
  // phòng (manager); PHUONGVH & HUONGLT là nhân viên sales. Dùng UPSERT: nếu id đã tồn tại (đã được
  // Admin tạo thẳng trong CSDL production như ghi chú ở migration 31) thì chỉ CẬP NHẬT role/quyền,
  // không đụng tên/email/mật khẩu hiện có; nếu id CHƯA tồn tại (ví dụ CSDL local mới) thì tạo mới
  // với tên tạm = mã nhân viên, chưa có mật khẩu — Admin toàn quyền tự cấp liên kết thiết lập
  // mật khẩu (setup-link) như quy trình cấp tài khoản bình thường.
  `INSERT INTO nv_users (id,name,role,active,created_at,is_demo,can_manage_accounts) VALUES ('HAUNV','HAUNV','admin',1,CAST(strftime('%s','now') AS INTEGER),0,1) ON CONFLICT(id) DO UPDATE SET role='admin', can_manage_accounts=1`,
  `INSERT INTO nv_users (id,name,role,active,created_at,is_demo,can_manage_accounts) VALUES ('HUONGNT','HUONGNT','admin',1,CAST(strftime('%s','now') AS INTEGER),0,0) ON CONFLICT(id) DO UPDATE SET role='admin', can_manage_accounts=0`,
  `INSERT INTO nv_users (id,name,role,active,created_at,is_demo,can_manage_accounts) VALUES ('DUCHT','DUCHT','admin',1,CAST(strftime('%s','now') AS INTEGER),0,0) ON CONFLICT(id) DO UPDATE SET role='admin', can_manage_accounts=0`,
  `INSERT INTO nv_users (id,name,role,active,created_at,is_demo,can_manage_accounts) VALUES ('DUCNH','DUCNH','manager',1,CAST(strftime('%s','now') AS INTEGER),0,0) ON CONFLICT(id) DO UPDATE SET role='manager', can_manage_accounts=0`,
  `INSERT INTO nv_users (id,name,role,active,created_at,is_demo,can_manage_accounts) VALUES ('PHUONGVH','PHUONGVH','sales',1,CAST(strftime('%s','now') AS INTEGER),0,0) ON CONFLICT(id) DO UPDATE SET role='sales', can_manage_accounts=0`,
  `INSERT INTO nv_users (id,name,role,active,created_at,is_demo,can_manage_accounts) VALUES ('HUONGLT','HUONGLT','sales',1,CAST(strftime('%s','now') AS INTEGER),0,0) ON CONFLICT(id) DO UPDATE SET role='sales', can_manage_accounts=0`,
  // 34: hồ sơ nhân sự tự khai — nhân viên tự xem/cập nhật thông tin cá nhân (ngày sinh, CCCD,
  // địa chỉ, trường học, liên hệ khẩn cấp) từ trang "Hồ sơ nhân sự". Không đụng định danh đăng
  // nhập (email) hay phân quyền (role/title) — các cột đó vẫn chỉ do Admin quản lý qua Quản trị.
  `ALTER TABLE nv_users ADD COLUMN birth_date TEXT`,
  `ALTER TABLE nv_users ADD COLUMN id_number TEXT`,
  `ALTER TABLE nv_users ADD COLUMN id_expiry TEXT`,
  `ALTER TABLE nv_users ADD COLUMN address TEXT`,
  `ALTER TABLE nv_users ADD COLUMN school TEXT`,
  `ALTER TABLE nv_users ADD COLUMN emergency_contact TEXT`,
  // 35: pipeline đổi từ 7 → 14 bước theo quy trình vận hành PKD (spec làm cơ sở CRM, mục 7) —
  // chuyển stage của deal ĐANG CÓ trong CSDL sang key mới tương ứng gần nhất. 'lead_moi'/'tiep_can'/
  // 'dam_phan' giữ nguyên key (không cần UPDATE). Không đụng deal đã ở stage cũ không còn tồn tại
  // dưới dạng khác (không có) — mọi key cũ đều có đích đến rõ ràng.
  `UPDATE nv_deals SET stage='du_dieu_kien' WHERE stage='nhu_cau'`,
  `UPDATE nv_deals SET stage='chao_hang' WHERE stage='bao_gia'`,
  `UPDATE nv_deals SET stage='hop_dong_da_ky' WHERE stage='chot'`,
  `UPDATE nv_deals SET stage='hoan_tat' WHERE stage='trien_khai'`,
  // 36: duyệt báo giá 2 vòng (TPKD→Giám đốc) — status cũ 'pending'/'rejected' không còn dùng, thay
  // bằng 'pending_v1'/'pending_v2'; 'draft'/'approved' giữ nguyên. Thêm cột lưu quyết định từng
  // vòng — v1 = TPKD, v2 = Giám đốc. decision chỉ 2 giá trị 'approved'|'revise', không có "từ chối".
  `UPDATE nv_quotes SET status='pending_v1' WHERE status='pending'`,
  `UPDATE nv_quotes SET status='draft' WHERE status='rejected'`,
  `ALTER TABLE nv_quotes ADD COLUMN v1_approver_id TEXT`,
  `ALTER TABLE nv_quotes ADD COLUMN v1_decision TEXT`,
  `ALTER TABLE nv_quotes ADD COLUMN v1_note TEXT`,
  `ALTER TABLE nv_quotes ADD COLUMN v1_decided_at INTEGER`,
  `ALTER TABLE nv_quotes ADD COLUMN v2_approver_id TEXT`,
  `ALTER TABLE nv_quotes ADD COLUMN v2_decision TEXT`,
  `ALTER TABLE nv_quotes ADD COLUMN v2_note TEXT`,
  `ALTER TABLE nv_quotes ADD COLUMN v2_decided_at INTEGER`,
  // 37: thực thể Hợp đồng riêng (trước đây chỉ là trạng thái "Chốt hợp đồng" của deal, không có
  // dữ liệu riêng) — duyệt 2 vòng TPKD→HCNS, cùng khuôn mẫu v1/v2 như báo giá. KHÔNG có ngưỡng
  // bỏ qua duyệt như báo giá (không có trạng thái 'draft') — mọi hợp đồng đều qua đủ 2 vòng.
  `CREATE TABLE IF NOT EXISTS nv_contracts (id TEXT PRIMARY KEY, deal_id TEXT, quote_id TEXT, owner_id TEXT NOT NULL, customer_id TEXT, title TEXT NOT NULL, value REAL DEFAULT 0, payment_schedule TEXT, penalty_terms TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'pending_v1', v1_approver_id TEXT, v1_decision TEXT, v1_note TEXT, v1_decided_at INTEGER, v2_approver_id TEXT, v2_decision TEXT, v2_note TEXT, v2_decided_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  // 38: migration 37 ở trên từng bị lỗi cú pháp (chuỗi SQL nhiều dòng khiến D1 .exec() báo
  // "incomplete input") trên CSDL local đã chạy trước khi sửa — thêm lại ĐÚNG câu lệnh đã sửa
  // (dạng CREATE TABLE IF NOT EXISTS, 1 dòng) làm migration MỚI để CSDL đó bắt kịp. Vô hại với
  // CSDL đã tạo đúng bảng từ migration 37 (IF NOT EXISTS tự bỏ qua).
  `CREATE TABLE IF NOT EXISTS nv_contracts (id TEXT PRIMARY KEY, deal_id TEXT, quote_id TEXT, owner_id TEXT NOT NULL, customer_id TEXT, title TEXT NOT NULL, value REAL DEFAULT 0, payment_schedule TEXT, penalty_terms TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'pending_v1', v1_approver_id TEXT, v1_decision TEXT, v1_note TEXT, v1_decided_at INTEGER, v2_approver_id TEXT, v2_decision TEXT, v2_note TEXT, v2_decided_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  // 39: thực thể Partner (đối tác hợp tác bán hàng) — không truy cập CRM trực tiếp, dữ liệu do
  // sale phụ trách nhập hộ. Quan hệ partner→sale phụ trách CỐ ĐỊNH (1 partner luôn thuộc đúng 1
  // sale), không phải trường tự do — thể hiện bằng cột sale_phu_trach_id bắt buộc (NOT NULL).
  `CREATE TABLE IF NOT EXISTS nv_partners (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, note TEXT, sale_phu_trach_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  // 40: nguồn khách hàng cố định (5 giá trị, mục 3 tài liệu) — cột MỚI, tách riêng khỏi `source`
  // hiện có (source/channel là kênh tiếp cận marketing dùng cho Tìm khách & ghi liên hệ hằng
  // ngày — khác khái niệm, không thay thế). partner_id chỉ có ý nghĩa khi nguồn là 1 trong 2
  // dòng Partner. phương_án_hợp_tác gắn ở CẤP DEAL (không phải cấp partner/customer) vì 1
  // partner có thể chạy cả PA1 lẫn PA2 cùng lúc tuỳ từng deal (đúng lý do nêu ở mục 3 tài liệu).
  `ALTER TABLE nv_customers ADD COLUMN nguon_khach_hang TEXT`,
  `ALTER TABLE nv_customers ADD COLUMN partner_id TEXT`,
  `ALTER TABLE nv_deals ADD COLUMN phuong_an_hop_tac TEXT`,
  // nguồn_thực_hiện: Sale hay Partner thực hiện các bước 1-3 của deal PA2 — chỉ để TÁCH BẠCH
  // công sức phục vụ tính hoa hồng SAU NÀY (mục 5 tài liệu nêu rõ nằm ngoài phạm vi tài liệu
  // này) — không có logic tính hoa hồng nào gắn theo cột này ở đợt này, chỉ lưu dữ liệu.
  `ALTER TABLE nv_deals ADD COLUMN nguon_thuc_hien TEXT`,
  // 41: sáp nhập vai trò Giám đốc (director) vào Admin/BGĐ theo yêu cầu mới — director không còn
  // là vai trò riêng, Admin đảm nhận luôn việc duyệt vòng 2 báo giá. Chuyển mọi user cũ đang mang
  // role='director' sang 'admin' để không bị mất khả năng đăng nhập/đúng quyền sau khi gỡ vai trò.
  `UPDATE nv_users SET role='admin' WHERE role='director'`,
  // 42: chỉ giữ ĐÚNG 1 tài khoản Admin/BGĐ (Nguyễn Văn A, id 'u_admin') — sáp nhập toàn bộ dữ liệu
  // đang gắn với tài khoản Giám đốc cũ (Đặng Minh Giám, id 'u_dir', đã đổi role sang 'admin' ở
  // migration 41) sang 'u_admin' rồi xoá hẳn tài khoản 'u_dir'. Rà theo TỪNG cột tham chiếu user_id
  // có trong toàn bộ schema (không chỉ những bảng thực tế đang có dữ liệu) để migration này vẫn
  // đúng nếu sau này dữ liệu demo phát sinh thêm ở các bảng khác.
  `UPDATE nv_customers SET owner_id='u_admin' WHERE owner_id='u_dir'`,
  `UPDATE nv_leads SET owner_id='u_admin' WHERE owner_id='u_dir'`,
  `UPDATE nv_tender_leads SET assigned_to='u_admin' WHERE assigned_to='u_dir'`,
  `UPDATE nv_deals SET owner_id='u_admin' WHERE owner_id='u_dir'`,
  `UPDATE nv_quotes SET owner_id='u_admin' WHERE owner_id='u_dir'`,
  `UPDATE nv_quotes SET approver_id='u_admin' WHERE approver_id='u_dir'`,
  `UPDATE nv_quotes SET v1_approver_id='u_admin' WHERE v1_approver_id='u_dir'`,
  `UPDATE nv_quotes SET v2_approver_id='u_admin' WHERE v2_approver_id='u_dir'`,
  `UPDATE nv_contracts SET owner_id='u_admin' WHERE owner_id='u_dir'`,
  `UPDATE nv_contracts SET v1_approver_id='u_admin' WHERE v1_approver_id='u_dir'`,
  `UPDATE nv_contracts SET v2_approver_id='u_admin' WHERE v2_approver_id='u_dir'`,
  `UPDATE nv_activities SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_daily_contacts SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_tasks SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_tasks SET assigner_id='u_admin' WHERE assigner_id='u_dir'`,
  `UPDATE nv_daily_reports SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_kpi_config SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_kpi_scores SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_commissions SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_pip_records SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_pip_records SET manager_id='u_admin' WHERE manager_id='u_dir'`,
  `UPDATE nv_training_progress SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_training_progress SET assigned_by='u_admin' WHERE assigned_by='u_dir'`,
  `UPDATE nv_notifications SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_ai_interactions SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_audit_logs SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_password_setup_tokens SET user_id='u_admin' WHERE user_id='u_dir'`,
  `UPDATE nv_password_setup_tokens SET created_by='u_admin' WHERE created_by='u_dir'`,
  `UPDATE nv_partners SET sale_phu_trach_id='u_admin' WHERE sale_phu_trach_id='u_dir'`,
  `DELETE FROM nv_sessions WHERE user_id='u_dir'`,
  `DELETE FROM nv_users WHERE id='u_dir'`,
  // Tài liệu đính kèm (báo giá/hợp đồng) upload ở Sales Kit — file gốc lưu trong R2 (binding DOCS,
  // xem wrangler.toml), bảng này chỉ giữ metadata + kết quả AI đọc/phân tích file.
  `CREATE TABLE IF NOT EXISTS nv_documents (id TEXT PRIMARY KEY, quote_id TEXT, contract_id TEXT, owner_id TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER DEFAULT 0, r2_key TEXT NOT NULL, ai_summary TEXT, ai_provider TEXT, ai_model TEXT, status TEXT DEFAULT 'done', created_at INTEGER NOT NULL)`,
  // 43: quy trình đấu thầu tập đoàn lớn — deal chạy 1 trong 2 loại quy trình song song
  // (thong_thuong | dau_thau, xem TENDER_STAGES ở routes/deals.js). tender_id là liên kết THẬT
  // giữa deal và cơ hội thầu gốc (trước đây convert() chỉ ghi vào note dạng text tự do, không
  // truy vấn được). negotiation_round đếm số vòng thương thảo — tài liệu quy trình đấu thầu nêu
  // rõ có thể lặp nhiều vòng, mỗi vòng cần thống nhất nội bộ trước khi phản hồi khách.
  `ALTER TABLE nv_deals ADD COLUMN process_type TEXT NOT NULL DEFAULT 'thong_thuong'`,
  `ALTER TABLE nv_deals ADD COLUMN tender_id TEXT`,
  `ALTER TABLE nv_deals ADD COLUMN negotiation_round INTEGER NOT NULL DEFAULT 0`,
  // 44: tài khoản HCNS chính thức mới (THUYDT) — theo yêu cầu trực tiếp của người vận hành, có
  // email riêng (khác 6 tài khoản migration 31/33 vốn không có email, đăng nhập bằng mã nhân
  // viên). can_manage_accounts phải set rõ =0 (cột có DEFAULT 1 ở migration 32) — HCNS không được
  // quản lý tài khoản nhân sự khác. Mật khẩu gán riêng ở assignThuydtPassword() bên dưới vì cần
  // hash (không làm được bằng SQL thuần trong mảng MIGRATIONS này).
  `INSERT INTO nv_users (id,name,email,role,active,created_at,is_demo,can_manage_accounts) VALUES ('THUYDT','THUYDT','hr@netviet.com','hr',1,CAST(strftime('%s','now') AS INTEGER),0,0) ON CONFLICT(id) DO UPDATE SET role='hr', email='hr@netviet.com', can_manage_accounts=0`,
  // 45: sửa lỗi lẫn lộn demo/thật phát hiện sau khi lên production — người vận hành xác nhận lại
  // danh sách tài khoản THẬT chỉ còn đúng 6 mã: HAUNV, HUONGNT, THUYDT, DUCNH, PHUONGVH, HUONGLT
  // (xem OFFICIAL_ACCOUNT_IDS đã sửa bên dưới, bỏ DUCHT). Hai tài khoản sau bị xác nhận là DEMO
  // (dùng để trình diễn nghiệp vụ, không phải nhân sự/Admin điều hành thật) nhưng trước đó lại nằm
  // is_demo=0 chung workspace với 6 tài khoản thật ở trên, gây lẫn dữ liệu demo vào danh sách quản
  // trị thật:
  //  - DUCHT: từng bị coi là 1 trong 6 tài khoản chính thức ở migration 31/33 — nay xác nhận lại là demo.
  //  - Tài khoản Admin bootstrap đầu tiên của production (tạo tự động lần chạy đầu qua secret
  //    BOOTSTRAP_ADMIN_EMAIL/PASSWORD, xem bootstrapProductionAdmin() — id sinh ngẫu nhiên nên khớp
  //    theo email cố định 'admin@netviet.vn' thay vì id): người vận hành xác nhận đây là tài khoản
  //    demo dùng để trình diễn, không phải Admin điều hành thật (Admin điều hành thật là HAUNV).
  // Không đụng password_hash/role/can_manage_accounts — chỉ chuyển workspace (is_demo) để 2 tài
  // khoản này không còn thấy/lẫn với dữ liệu của 6 nhân sự thật, và ngược lại.
  `UPDATE nv_users SET is_demo=1 WHERE id='DUCHT'`,
  `UPDATE nv_users SET is_demo=1 WHERE email='admin@netviet.vn'`,
  // 46: người vận hành xác nhận thêm 4 tài khoản NỮA cũng là demo (TPKD tpkd@netviet.vn, 3 Sales
  // trình diễn tuan.le/anh.pham/nam.vo@netviet.vn) — vẫn is_demo=0 chung workspace với 6 tài khoản
  // thật, y hệt tình huống migration 45 vừa sửa. Việc UPDATE thực tế đặt ở
  // reclassifyConfirmedDemoAccounts() (định nghĩa cạnh assignThuydtPassword() bên dưới) thay vì viết
  // thẳng SQL ở đây — hàm đó tự chạy lại và tự sửa mỗi lần migrate(), không phụ thuộc cơ chế theo
  // dõi schema_version theo INDEX của mảng này (từng khiến 1 dòng UPDATE âm thầm không có hiệu lực
  // ở lần đầu mà không ai biết cho tới khi kiểm tra lại danh sách người dùng, xem migration 45).
  // Hàm đó cũng khớp lại DUCHT/admin@netviet.vn ở trên — vô hại vì đã is_demo=1 sẵn (no-op).
];

/** Chế độ vận hành: 'demo' phải khai báo rõ ràng, mọi giá trị khác (kể cả thiếu) → 'production'
 * theo nguyên tắc fail-safe — quên cấu hình thì KHÔNG được tự nạp dữ liệu giả vào CSDL thật. */
export function appMode(env) {
  return env?.APP_MODE === 'demo' ? 'demo' : 'production';
}

/** Mật khẩu demo dùng chung — chỉ có ý nghĩa ở chế độ demo, không tồn tại trong mã nguồn phía client. */
export const DEMO_PASSWORD = 'Netviet@123';

// 5 tài khoản nhân sự chính thức (không tính THUYDT — có mật khẩu khởi tạo riêng ở
// assignThuydtPassword() vì dùng email đăng nhập khác 5 tài khoản này). Từng có 6 mã gồm cả DUCHT ở
// migration 31/33, nhưng migration 45 xác nhận lại DUCHT là tài khoản demo nên đã bỏ khỏi đây —
// DUCHT không còn được gán/đổi theo mật khẩu khởi tạo dùng chung ở dưới.
const OFFICIAL_ACCOUNT_IDS = ['HAUNV', 'HUONGNT', 'DUCNH', 'PHUONGVH', 'HUONGLT'];
/** Mật khẩu khởi tạo dùng CHUNG cho 6 tài khoản nhân sự chính thức trên — theo yêu cầu trực tiếp
 * của người vận hành hệ thống (không phải lựa chọn mặc định của app). Trùng giá trị với
 * DEMO_PASSWORD là chủ ý của người vận hành, không phải nhầm lẫn. */
const OFFICIAL_ACCOUNT_INITIAL_PASSWORD = 'Netviet@123';

/** Mật khẩu khởi tạo riêng cho tài khoản HCNS mới THUYDT (email hr@netviet.com) — theo yêu cầu
 * trực tiếp của người vận hành để demo & test vị trí HCNS, khác mật khẩu tạm dùng chung ở trên. */
const THUYDT_INITIAL_PASSWORD = 'Netviet@2026';

export async function migrate(env) {
  if (_migrated) return;
  _migrated = true;
  // PRAGMA user_version bị chặn trên runtime này → lưu phiên bản schema trong bảng nv_meta.
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS nv_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`); } catch (e) { /* đã có */ }
  let cur = 0;
  try {
    cur = Number(await env.DB.prepare('SELECT v FROM nv_meta WHERE k=?').bind('schema_version').first('v')) || 0;
  } catch (e) { cur = 0; }
  for (let i = cur; i < MIGRATIONS.length; i++) {
    try { await env.DB.exec(MIGRATIONS[i]); } catch (e) { console.error('migration ' + i, e.message); }
  }
  if (MIGRATIONS.length > cur) {
    try {
      await env.DB.prepare('INSERT INTO nv_meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
        .bind('schema_version', String(MIGRATIONS.length)).run();
    } catch (e) { console.error('meta', e.message); }
  }
  // Gán mật khẩu khởi tạo cho 6 tài khoản nhân sự chính thức — chạy ở CẢ 2 chế độ (các tài khoản
  // này là is_demo=0, độc lập với demo/production), TRƯỚC nhánh seed/bootstrap bên dưới.
  await assignOfficialAccountInitialPasswords(env);
  await assignThuydtPassword(env);
  await reclassifyConfirmedDemoAccounts(env);
  // Migration LUÔN chạy ở cả 2 chế độ (production cần đủ bảng); chỉ việc NẠP DỮ LIỆU là tách theo môi trường —
  // demo nạp đầy đủ dữ liệu mẫu, production chỉ khởi tạo đúng 1 tài khoản admin từ secret, không có gì khác.
  if (appMode(env) === 'demo') {
    // CSDL demo đã seed từ trước (seed() dưới đây tự thoát sớm nếu vậy) vẫn cần được BỔ SUNG 2 tài
    // khoản demo mới (Giám đốc, HCNS) khi nâng cấp lên pipeline 2 vòng duyệt — không thể chờ seed()
    // vì seed() không chạy lại một khi đã có 'u_admin'.
    await ensureRoleExpansionDemoAccounts(env);
    await seed(env);
  } else {
    // Production, vận hành Beta (2026-08-28): KHÔNG xoá dữ liệu demo — gộp vào 6 tài khoản chính
    // thức để Beta có dữ liệu thật để test (xem mergeDemoAccountsIntoOfficial()), rồi đặt lại mật
    // khẩu chung Netviet@123 cho cả 6 tài khoản (xem resetOfficialPasswordsForBeta()).
    await mergeDemoAccountsIntoOfficial(env);
    await resetOfficialPasswordsForBeta(env);
    await bootstrapProductionAdmin(env);
  }
}

/** Gán OFFICIAL_ACCOUNT_INITIAL_PASSWORD cho 6 tài khoản nhân sự chính thức — CHỈ cho tài khoản
 * nào đang chưa có mật khẩu (password_hash NULL/rỗng). Không bao giờ ghi đè mật khẩu đã có sẵn
 * (kể cả trên CSDL production, nơi các tài khoản này có thể đã được cấp mật khẩu riêng từ trước) —
 * tự tính lại từ CSDL mỗi lần nên an toàn khi chạy lặp lại (idempotent). Buộc đổi mật khẩu ở lần
 * đăng nhập đầu (must_change_password=1) vì đây là mật khẩu DÙNG CHUNG, không nên giữ lâu dài. */
async function assignOfficialAccountInitialPasswords(env) {
  const placeholders = OFFICIAL_ACCOUNT_IDS.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id FROM nv_users WHERE id IN (${placeholders}) AND (password_hash IS NULL OR password_hash = '')`)
    .bind(...OFFICIAL_ACCOUNT_IDS).all();
  if (!results || !results.length) return;
  const hash = await hashPassword(OFFICIAL_ACCOUNT_INITIAL_PASSWORD);
  for (const row of results) {
    await env.DB.prepare('UPDATE nv_users SET password_hash=?, must_change_password=1 WHERE id=?').bind(hash, row.id).run();
  }
  console.log('[migrate] Đã gán mật khẩu khởi tạo dùng chung cho ' + results.length + ' tài khoản nhân sự chính thức: ' + results.map(r => r.id).join(', '));
}

/** Gán THUYDT_INITIAL_PASSWORD riêng cho tài khoản HCNS mới THUYDT — cùng nguyên tắc idempotent
 * với assignOfficialAccountInitialPasswords() ở trên (chỉ gán khi chưa có mật khẩu, không ghi đè),
 * nhưng tách hàm riêng vì mật khẩu khác 6 tài khoản kia. */
async function assignThuydtPassword(env) {
  const row = await env.DB.prepare("SELECT id FROM nv_users WHERE id='THUYDT' AND (password_hash IS NULL OR password_hash = '')").first();
  if (!row) return;
  const hash = await hashPassword(THUYDT_INITIAL_PASSWORD);
  await env.DB.prepare('UPDATE nv_users SET password_hash=?, must_change_password=1 WHERE id=?').bind(hash, 'THUYDT').run();
  console.log('[migrate] Đã gán mật khẩu khởi tạo cho tài khoản HCNS mới: THUYDT.');
}

// Các tài khoản người vận hành xác nhận là DEMO (xem migration 45/46) — trình diễn nghiệp vụ, không
// phải nhân sự/Admin điều hành thật. Khai báo lại ở đây (thay vì chỉ dựa vào 2 dòng UPDATE trong
// mảng MIGRATIONS) để reclassifyConfirmedDemoAccounts() bên dưới tự SỬA LẠI mỗi lần migrate() chạy,
// không phụ thuộc cơ chế theo dõi schema_version theo INDEX của mảng MIGRATIONS (chỉ chạy đúng 1 lần
// và lỗi thì chỉ log rồi bỏ qua, rất khó phát hiện nếu 1 statement âm thầm không có hiệu lực).
// Mỗi tài khoản khớp theo CẢ email lẫn (tên, role) — 1 lần chạy trước đó chỉ khớp email đã KHÔNG có
// hiệu lực cho 4/6 tài khoản (nghi email lưu lệch khoảng trắng/hoa-thường so với chuỗi hard-code,
// trình duyệt tự làm gọn khoảng trắng khi hiển thị nên nhìn giống hệt trên UI dù dữ liệu khác),
// nên so khớp email đã chuẩn hoá TRIM+LOWER, và thêm khớp theo tên+role làm lưới an toàn thứ 2.
const DEMO_ACCOUNTS = [
  { id: 'DUCHT' },
  { email: 'admin@netviet.vn' },
  { email: 'tpkd@netviet.vn', name: 'Trần Thu Hà', role: 'manager' },
  { email: 'tuan.le@netviet.vn', name: 'Lê Minh Tuấn', role: 'sales' },
  { email: 'anh.pham@netviet.vn', name: 'Phạm Ngọc Anh', role: 'sales' },
  { email: 'nam.vo@netviet.vn', name: 'Võ Hoàng Nam', role: 'sales' },
];

/** Tự sửa lại is_demo=1 cho đúng danh sách tài khoản demo đã xác nhận ở trên — CHỈ đụng dòng đang
 * sai (is_demo=0), không ghi đè gì khác (role/mật khẩu/can_manage_accounts giữ nguyên). Chạy lại
 * MỌI LẦN migrate() (không gate theo schema_version) nên tự chữa được nếu lần chạy trước vì lý do
 * gì đó (deploy chưa restart hẳn, lệch dữ liệu email...) chưa có hiệu lực. Khớp từng tài khoản theo
 * id HOẶC email đã chuẩn hoá HOẶC (tên+role) — chỉ cần khớp 1 trong 3 tiêu chí. */
async function reclassifyConfirmedDemoAccounts(env) {
  const clauses = [];
  const args = [];
  for (const a of DEMO_ACCOUNTS) {
    const ors = [];
    if (a.id) { ors.push('id=?'); args.push(a.id); }
    if (a.email) { ors.push('LOWER(TRIM(email))=?'); args.push(a.email.toLowerCase()); }
    if (a.name && a.role) { ors.push('(TRIM(name)=? AND role=?)'); args.push(a.name, a.role); }
    clauses.push('(' + ors.join(' OR ') + ')');
  }
  const before = await env.DB.prepare(
    `SELECT id,name,email FROM nv_users WHERE is_demo=0 AND (${clauses.join(' OR ')})`
  ).bind(...args).all();
  if (!before.results || !before.results.length) return;
  await env.DB.prepare(
    `UPDATE nv_users SET is_demo=1 WHERE is_demo=0 AND (${clauses.join(' OR ')})`
  ).bind(...args).run();
  console.log('[migrate] Đã chuyển ' + before.results.length + ' tài khoản sang workspace demo: '
    + before.results.map(r => r.id + ' (' + r.name + (r.email ? ', ' + r.email : '') + ')').join('; '));
}

// Mọi cột (bảng, cột) tham chiếu tới id 1 nhân sự trong toàn bộ schema — dùng để gộp dữ liệu của 1
// tài khoản demo VÀO 1 tài khoản chính thức (xem mergeDemoAccountsIntoOfficial() bên dưới), cùng
// nguyên lý với dãy UPDATE gộp u_dir→u_admin ở migration 42, nhưng viết dạng bảng dữ liệu (không
// hard-code từng câu SQL) vì giờ chạy trong hàm JS, không phải mảng MIGRATIONS thuần SQL.
// nv_contacts KHÔNG có ở đây — không có cột chủ sở hữu riêng, chỉ có customer_id nên tự "theo"
// khách hàng khi nv_customers.owner_id được gộp.
const REASSIGN_OWNER_COLUMNS = [
  ['nv_customers', 'owner_id'], ['nv_leads', 'owner_id'], ['nv_tender_leads', 'assigned_to'],
  ['nv_deals', 'owner_id'],
  ['nv_quotes', 'owner_id'], ['nv_quotes', 'approver_id'], ['nv_quotes', 'v1_approver_id'], ['nv_quotes', 'v2_approver_id'],
  ['nv_contracts', 'owner_id'], ['nv_contracts', 'v1_approver_id'], ['nv_contracts', 'v2_approver_id'],
  ['nv_documents', 'owner_id'],
  ['nv_activities', 'user_id'], ['nv_daily_contacts', 'user_id'],
  ['nv_tasks', 'user_id'], ['nv_tasks', 'assigner_id'],
  ['nv_daily_reports', 'user_id'], ['nv_kpi_config', 'user_id'], ['nv_kpi_scores', 'user_id'], ['nv_commissions', 'user_id'],
  ['nv_pip_records', 'user_id'], ['nv_pip_records', 'manager_id'],
  ['nv_training_progress', 'user_id'], ['nv_training_progress', 'assigned_by'],
  ['nv_notifications', 'user_id'], ['nv_ai_interactions', 'user_id'], ['nv_audit_logs', 'user_id'],
  ['nv_password_setup_tokens', 'user_id'], ['nv_password_setup_tokens', 'created_by'],
  ['nv_partners', 'sale_phu_trach_id'],
];

/** Ánh xạ 6 tài khoản demo đã xác nhận (DEMO_ACCOUNTS ở trên) sang tài khoản chính thức sẽ NHẬN dữ
 * liệu của chúng — quyết định trực tiếp của người vận hành (2026-08-28) để vận hành Beta TRƯỚC với
 * dữ liệu thật đã có, thay vì xoá trắng: DUCHT (admin không quản lý tài khoản) và admin@netviet.vn
 * (admin bootstrap ban đầu) đều gộp vào HAUNV; TPKD tpkd@netviet.vn gộp vào DUCNH (manager chính
 * thức duy nhất); 3 sales demo chia đều cho 2 sales chính thức: tuan.le & nam.vo → PHUONGVH,
 * anh.pham → HUONGLT. Dùng lại tiêu chí khớp id/email/(tên+role) giống DEMO_ACCOUNTS/
 * reclassifyConfirmedDemoAccounts() ở trên. */
const DEMO_MERGE_TARGETS = [
  { match: { id: 'DUCHT' }, into: 'HAUNV' },
  { match: { email: 'admin@netviet.vn' }, into: 'HAUNV' },
  { match: { email: 'tpkd@netviet.vn', name: 'Trần Thu Hà', role: 'manager' }, into: 'DUCNH' },
  { match: { email: 'tuan.le@netviet.vn', name: 'Lê Minh Tuấn', role: 'sales' }, into: 'PHUONGVH' },
  { match: { email: 'nam.vo@netviet.vn', name: 'Võ Hoàng Nam', role: 'sales' }, into: 'PHUONGVH' },
  { match: { email: 'anh.pham@netviet.vn', name: 'Phạm Ngọc Anh', role: 'sales' }, into: 'HUONGLT' },
];

/** Gộp dữ liệu của từng tài khoản demo đã xác nhận (DEMO_MERGE_TARGETS ở trên) vào đúng tài khoản
 * chính thức tương ứng, rồi xoá tài khoản demo — CHỈ gọi ở chế độ production (xem migrate() bên
 * dưới). Khác reclassifyConfirmedDemoAccounts() (chỉ cô lập is_demo=1, còn nguyên tài khoản) — hàm
 * này chuyển quyền sở hữu dữ liệu (owner_id/user_id/...) sang tài khoản chính thức RỒI xoá hẳn tài
 * khoản demo, không thể hoàn tác. Tự chạy lại mọi lần migrate() — vô hại khi không còn khớp tài
 * khoản demo nào nữa (SELECT rỗng thì bỏ qua entry đó). */
async function mergeDemoAccountsIntoOfficial(env) {
  for (const { match, into } of DEMO_MERGE_TARGETS) {
    const ors = []; const args = [];
    if (match.id) { ors.push('id=?'); args.push(match.id); }
    if (match.email) { ors.push('LOWER(TRIM(email))=?'); args.push(match.email.toLowerCase()); }
    if (match.name && match.role) { ors.push('(TRIM(name)=? AND role=?)'); args.push(match.name, match.role); }
    const { results } = await env.DB.prepare(
      `SELECT id,name,email FROM nv_users WHERE (${ors.join(' OR ')}) AND id != ?`
    ).bind(...args, into).all();
    for (const row of results || []) {
      for (const [table, col] of REASSIGN_OWNER_COLUMNS) {
        try { await env.DB.prepare(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`).bind(into, row.id).run(); }
        catch (e) { console.error('mergeDemoAccountsIntoOfficial', table, col, e.message); }
      }
      await env.DB.prepare('DELETE FROM nv_sessions WHERE user_id=?').bind(row.id).run();
      await env.DB.prepare('DELETE FROM nv_users WHERE id=?').bind(row.id).run();
      console.log('[migrate] Đã gộp dữ liệu tài khoản demo ' + row.id + ' (' + row.name
        + (row.email ? ', ' + row.email : '') + ') vào ' + into + ' rồi xoá tài khoản demo.');
    }
  }
}

/** Đặt lại mật khẩu CHUNG Netviet@123 cho ĐỦ 6 tài khoản chính thức (kể cả THUYDT, vốn trước đó
 * có mật khẩu khởi tạo riêng Netviet@2026 ở assignThuydtPassword() phía trên) — quyết định trực
 * tiếp của người vận hành (2026-08-28) để đơn giản hoá đăng nhập trong giai đoạn vận hành Beta.
 * Ghi đè mật khẩu HIỆN CÓ (khác assignOfficialAccountInitialPasswords()/assignThuydtPassword() ở
 * trên vốn chỉ gán khi CHƯA có mật khẩu) nên phải gate bằng cờ 1 LẦN trong nv_meta — nếu không sẽ
 * vô tình ghi đè mật khẩu nhân sự tự đổi ở mọi lần migrate() sau (mỗi lần Worker khởi động lại). */
async function resetOfficialPasswordsForBeta(env) {
  const FLAG = 'beta_shared_password_reset_v1';
  const done = await env.DB.prepare('SELECT v FROM nv_meta WHERE k=?').bind(FLAG).first('v');
  if (done) return;
  const hash = await hashPassword(OFFICIAL_ACCOUNT_INITIAL_PASSWORD);
  const ids = [...OFFICIAL_ACCOUNT_IDS, 'THUYDT'];
  for (const id of ids) {
    await env.DB.prepare('UPDATE nv_users SET password_hash=?, must_change_password=1 WHERE id=?').bind(hash, id).run();
  }
  await env.DB.prepare('INSERT INTO nv_meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(FLAG, '1').run();
  console.log('[migrate] Đã đặt lại mật khẩu chung ' + OFFICIAL_ACCOUNT_INITIAL_PASSWORD + ' cho 6 tài khoản chính thức (vận hành Beta): ' + ids.join(', '));
}

/** Bổ sung tài khoản demo mới (HCNS) cho CSDL demo đã seed từ trước — seed() ở dưới tự thoát sớm
 * khi đã có 'u_admin' nên không tự thêm được tài khoản này khi nâng cấp lên pipeline duyệt 2 vòng.
 * Idempotent: dò đúng id 'u_hr', có rồi thì không làm gì. Chỉ chạy ở chế độ demo.
 * Không còn tạo tài khoản 'u_dir' (Giám đốc) nữa — vai trò này đã sáp nhập vào Admin/BGĐ; CSDL nào
 * đã có sẵn 'u_dir' từ trước thì migration 41 ở trên tự chuyển role sang 'admin'. */
async function ensureRoleExpansionDemoAccounts(env) {
  const exists = await env.DB.prepare("SELECT id FROM nv_users WHERE id='u_hr'").first();
  if (exists) return;
  const demoHash = await hashPassword(DEMO_PASSWORD);
  const t = now();
  await env.DB.prepare('INSERT INTO nv_users (id,name,email,role,title,phone,active,created_at,password_hash,is_demo) VALUES (?,?,?,?,?,?,1,?,?,1)')
    .bind('u_hr', 'Ngô Thị Sự', 'demo-hr@example.com', 'hr', 'Chuyên viên Hành chính Nhân sự', '0901000007', t, demoHash).run();
  console.log('[migrate] Đã tạo tài khoản demo mới: u_hr (hr).');
}

/** Production, lần chạy đầu (nv_users rỗng): khởi tạo ĐÚNG 1 tài khoản admin từ secret, không sinh
 * thêm bất kỳ dữ liệu nghiệp vụ giả nào. Thiếu secret thì KHÔNG tạo gì cả — an toàn hơn là đoán bừa. */
async function bootstrapProductionAdmin(env) {
  const c = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_users').first('n')) || 0;
  if (c > 0) return;
  const email = env?.BOOTSTRAP_ADMIN_EMAIL;
  const password = env?.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error(
      '[bootstrap] Chưa có tài khoản admin nào trong CSDL và thiếu secret BOOTSTRAP_ADMIN_EMAIL / ' +
      'BOOTSTRAP_ADMIN_PASSWORD nên KHÔNG tự tạo tài khoản. Hãy đặt 2 secret này (Secrets của app) ' +
      'rồi khởi động lại để hệ thống tự khởi tạo tài khoản quản trị đầu tiên.'
    );
    return;
  }
  const t = now();
  const hash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO nv_users (id,name,email,role,title,phone,active,created_at,password_hash,is_demo,must_change_password) VALUES (?,?,?,?,?,?,1,?,?,0,1)')
    .bind(uid('u'), 'Quản trị viên', String(email).trim(), 'admin', 'Quản trị hệ thống', null, t, hash).run();
  console.log('[bootstrap] Đã khởi tạo tài khoản admin đầu tiên: ' + email + ' (buộc đổi mật khẩu ở lần đăng nhập đầu).');
}

const pick = (arr, i) => arr[i % arr.length];

async function seed(env) {
  // Không dùng COUNT(*) toàn bảng: 6 tài khoản nhân sự chính thức (HAUNV...) ở migration 33 luôn
  // được tạo TRƯỚC bước này bất kể demo/production, nên nv_users không bao giờ rỗng khi tới đây —
  // nếu gác theo tổng số dòng thì seed() vĩnh viễn không chạy, làm mất trắng dữ liệu mẫu demo (kể
  // cả 5 tài khoản demo hiện trên màn đăng nhập). Dùng đúng id demo cố định ('u_admin') làm cờ
  // idempotent cho RIÊNG bộ dữ liệu mẫu này, độc lập với các tài khoản chính thức is_demo=0.
  const seeded = await env.DB.prepare("SELECT id FROM nv_users WHERE id='u_admin'").first();
  if (seeded) return;
  const T = now();
  const S = [];
  const P = (sql, ...b) => S.push(env.DB.prepare(sql).bind(...b));

  /* ---------- Users ---------- */
  // Nhân vật HƯ CẤU rõ ràng (bản demo có thể gửi cho khách hàng ngoài xem) — không dùng tên/email
  // trông như nhân sự thật của NetViet. Giữ nguyên id vì dữ liệu mẫu bên dưới tham chiếu tới chúng.
  const users = [
    ['u_admin', 'Nguyễn Văn A', 'demo-admin@example.com', 'admin', 'Giám đốc điều hành', '0901000001'],
    ['u_tp', 'Trần Thị B', 'demo-manager@example.com', 'manager', 'Trưởng phòng Kinh doanh', '0901000002'],
    ['u_s1', 'Lê Văn C', 'demo-sales1@example.com', 'sales', 'Chuyên viên Kinh doanh', '0901000003'],
    ['u_s2', 'Phạm Thị D', 'demo-sales2@example.com', 'sales', 'Chuyên viên Kinh doanh', '0901000004'],
    ['u_s3', 'Hoàng Văn E', 'demo-sales3@example.com', 'sales', 'Chuyên viên Kinh doanh', '0901000005'],
    // Vai trò duyệt vòng 2 theo quy trình vận hành PKD (báo giá V2 = Admin/BGĐ — vai trò Giám đốc
    // đã sáp nhập vào Admin, dùng chung 'u_admin' ở trên; hợp đồng V2 = HCNS).
    ['u_hr', 'Ngô Thị Sự', 'demo-hr@example.com', 'hr', 'Chuyên viên Hành chính Nhân sự', '0901000007'],
  ];
  // is_demo=1 để tách khỏi nhân sự thật (thêm sau qua Quản trị), không lộ lên màn đăng nhập công khai.
  const demoHash = await hashPassword(DEMO_PASSWORD);
  users.forEach(u => P('INSERT INTO nv_users (id,name,email,role,title,phone,active,created_at,password_hash,is_demo) VALUES (?,?,?,?,?,?,1,?,?,1)', ...u, T - 200 * DAY, demoHash));
  const SALES = ['u_s1', 'u_s2', 'u_s3'];

  /* ---------- Cấu hình KPI / định mức ---------- */
  const cfg = [
    ['quota_daily_contacts', '8'], ['quota_calls', '25'], ['quota_meetings', '2'],
    ['target_revenue', '400000000'], ['target_deals', '3'], ['target_pipeline', '1200000000'],
    ['discount_threshold', '15'], ['report_deadline_hour', '17.5'],
    ['sla_days', '{"lead_moi":2,"tiep_can":3,"du_dieu_kien":3,"chao_hang":4,"cho_duyet_bg_v1":1,"cho_duyet_bg_v2":1,"da_gui_bao_gia":3,"dam_phan":5,"cho_duyet_hd_v1":1,"cho_duyet_hd_v2":1,"hop_dong_da_ky":3,"dang_san_xuat":14,"ban_giao":5,"hoan_tat":3}'],
    ['task_accept_sla_min', '120'],
  ];
  cfg.forEach(([k, v]) => P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,NULL,?,?,?)', uid('cfg'), k, v, T));
  // ngưỡng linh hoạt theo từng sales
  P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,?,?,?,?)', uid('cfg'), 'u_s1', 'target_revenue', '600000000', T);
  P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,?,?,?,?)', uid('cfg'), 'u_s1', 'quota_daily_contacts', '10', T);
  P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,?,?,?,?)', uid('cfg'), 'u_s3', 'target_revenue', '300000000', T);

  /* ---------- Bảng gói dịch vụ ---------- */
  const products = [
    ['pr_tvc30', 'TVC quảng cáo 30s (quay thực tế)', 'TVC/Video', 'gói', 150000000, 5, 10, 'Kịch bản + quay 2 ngày + hậu kỳ + 3 phiên bản cắt.'],
    ['pr_tvcai', 'TVC AI 15s (AI Generative)', 'TVC/Video', 'gói', 45000000, 6, 12, 'Sản xuất bằng AI: storyboard, dựng cảnh, lồng tiếng AI. Giao trong 5 ngày.'],
    ['pr_vidai', 'Chuỗi Video AI viral (10 video)', 'TVC/Video', 'gói', 80000000, 6, 12, '10 video ngắn 30-45s tối ưu TikTok/Reels, sản xuất bằng AI.'],
    ['pr_gs_talk', 'Booking Gameshow – Talkshow chuyên đề', 'Gameshow', 'số', 250000000, 4, 8, 'Xuất hiện thương hiệu trong 1 số talkshow phát sóng đa nền tảng.'],
    ['pr_gs_season', 'Booking Gameshow – Tài trợ mùa', 'Gameshow', 'mùa', 900000000, 3, 6, 'Nhà tài trợ chính 1 mùa (12 số): logo, PPL, MC đọc, hậu trường.'],
    ['pr_tiktok', 'Xây kênh TikTok triệu view – 3 tháng', 'Xây kênh', 'gói', 120000000, 7, 12, '12 video/tháng, chiến lược nội dung, seeding, báo cáo tuần.'],
    ['pr_yt', 'Xây kênh YouTube – 6 tháng', 'Xây kênh', 'gói', 220000000, 6, 10, '4 video dài + 12 shorts/tháng, tối ưu SEO, quản trị cộng đồng.'],
    ['pr_live', 'Livestream bán hàng cùng KOL', 'Xây kênh', 'phiên', 60000000, 8, 15, 'Kịch bản, KOL, setup studio, vận hành 1 phiên 3 giờ.'],
  ];
  products.forEach(p => P('INSERT INTO nv_products (id,name,line,unit,price,commission_rate,max_discount,description,active) VALUES (?,?,?,?,?,?,?,?,1)', ...p));

  /* ---------- Khách hàng + liên hệ ---------- */
  const inds = ['FMCG', 'Bất động sản', 'Ngân hàng', 'Giáo dục', 'Dược phẩm', 'Ô tô', 'Bán lẻ', 'Công nghệ'];
  const customers = [
    ['cs_01', 'u_s1', 'Công ty CP Sữa Việt Xanh', 'FMCG', 'hot', 'Website'],
    ['cs_02', 'u_s1', 'Tập đoàn BĐS An Phát', 'Bất động sản', 'hot', 'Giới thiệu'],
    ['cs_03', 'u_s1', 'Ngân hàng TMCP Đông Đô', 'Ngân hàng', 'warm', 'Sự kiện'],
    ['cs_04', 'u_s1', 'Chuỗi cà phê Nâu Việt', 'Bán lẻ', 'warm', 'Review'],
    ['cs_05', 'u_s2', 'Dược phẩm Minh Long', 'Dược phẩm', 'hot', 'MGM'],
    ['cs_06', 'u_s2', 'Hệ thống Anh ngữ SmartKid', 'Giáo dục', 'warm', 'CTV/KOL'],
    ['cs_07', 'u_s2', 'Ô tô Trường Phát', 'Ô tô', 'cold', 'Hội chợ'],
    ['cs_08', 'u_s2', 'Siêu thị GreenMart', 'Bán lẻ', 'warm', 'Đối tác'],
    ['cs_09', 'u_s3', 'Công nghệ VinaSoft', 'Công nghệ', 'warm', 'Website'],
    ['cs_10', 'u_s3', 'Mỹ phẩm Hạ Vy', 'FMCG', 'hot', 'TikTok'],
    ['cs_11', 'u_s3', 'Nội thất Nhà Mới', 'Bán lẻ', 'cold', 'Game Viral'],
    ['cs_12', 'u_s3', 'Tập đoàn Nông nghiệp Đại Lộc', 'FMCG', 'warm', 'Giới thiệu'],
  ];
  customers.forEach((c, i) => {
    P('INSERT INTO nv_customers (id,owner_id,name,industry,scale,phone,email,address,temp,source,note,services,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c[0], c[1], c[2], c[3], pick(['SME', 'Doanh nghiệp lớn', 'Tập đoàn'], i), '028' + (3800000 + i * 137),
      'contact' + (i + 1) + '@' + c[0] + '.vn', pick(['TP.HCM', 'Hà Nội', 'Đà Nẵng'], i), c[4], c[5],
      'Khách quan tâm mảng ' + pick(['TVC AI', 'Gameshow', 'Xây kênh'], i) + '.',
      JSON.stringify([pick(['TVC/Video', 'Gameshow', 'Xây kênh'], i)]),
      T - (i % 9) * DAY, T - (60 - i) * DAY, T - (i % 9) * DAY);
    P('INSERT INTO nv_contacts (id,customer_id,name,title,phone,email,is_primary,created_at) VALUES (?,?,?,?,?,?,1,?)',
      uid('ct'), c[0], pick(['Chị Lan', 'Anh Hùng', 'Chị Mai', 'Anh Dũng', 'Chị Thảo'], i),
      pick(['Giám đốc Marketing', 'Trưởng phòng Truyền thông', 'CEO', 'Brand Manager'], i),
      '09' + (12000000 + i * 4321), 'mkt' + i + '@netviet-demo.vn', T - 50 * DAY);
    if (i % 3 === 0) P('INSERT INTO nv_contacts (id,customer_id,name,title,phone,email,is_primary,created_at) VALUES (?,?,?,?,?,?,0,?)',
      uid('ct'), c[0], pick(['Anh Khoa', 'Chị Vy'], i), 'Chuyên viên Truyền thông', '09' + (33000000 + i * 771), 'staff' + i + '@netviet-demo.vn', T - 40 * DAY);
  });

  /* ---------- Deals: trải đủ 14 giai đoạn của pipeline mới để demo trực quan ---------- */
  const prob = PROB;
  const dealSeeds = [
    ['dl_01', 'u_s1', 'cs_01', 'TVC AI ra mắt sữa hạt Việt Xanh', 'TVC/Video', 45000000, 'lead_moi', 1],
    ['dl_02', 'u_s1', 'cs_02', 'Chuỗi Video AI dự án An Phát Riverside', 'TVC/Video', 80000000, 'tiep_can', 6],
    ['dl_03', 'u_s1', 'cs_03', 'Tài trợ mùa Gameshow "Tài chính thông minh"', 'Gameshow', 900000000, 'du_dieu_kien', 2],
    ['dl_04', 'u_s1', 'cs_04', 'Xây kênh TikTok Nâu Việt 3 tháng', 'Xây kênh', 120000000, 'chao_hang', 9],
    ['dl_05', 'u_s2', 'cs_05', 'TVC 30s dòng thuốc bổ Minh Long', 'TVC/Video', 150000000, 'cho_duyet_bg_v1', 1],
    ['dl_06', 'u_s2', 'cs_06', 'Booking talkshow giáo dục SmartKid', 'Gameshow', 250000000, 'cho_duyet_bg_v2', 1],
    ['dl_07', 'u_s2', 'cs_07', 'Video AI ra mắt mẫu xe mới', 'TVC/Video', 80000000, 'da_gui_bao_gia', 3],
    ['dl_08', 'u_s2', 'cs_08', 'Livestream bán hàng GreenMart Tết', 'Xây kênh', 60000000, 'dam_phan', 4],
    ['dl_09', 'u_s3', 'cs_09', 'Xây kênh YouTube VinaSoft 6 tháng', 'Xây kênh', 220000000, 'cho_duyet_hd_v1', 1],
    ['dl_10', 'u_s3', 'cs_10', 'TVC AI + chuỗi viral Hạ Vy', 'TVC/Video', 125000000, 'cho_duyet_hd_v2', 1],
    ['dl_11', 'u_s3', 'cs_11', 'TVC AI 15s Nội thất Nhà Mới', 'TVC/Video', 45000000, 'hop_dong_da_ky', 5],
    ['dl_12', 'u_s3', 'cs_12', 'Tài trợ Gameshow nông nghiệp Đại Lộc', 'Gameshow', 250000000, 'dang_san_xuat', 12],
    ['dl_13', 'u_s1', 'cs_01', 'Gói xây kênh TikTok Việt Xanh', 'Xây kênh', 120000000, 'ban_giao', 20],
    ['dl_14', 'u_s2', 'cs_05', 'Chuỗi Video AI dược mỹ phẩm', 'TVC/Video', 80000000, 'hoan_tat', 26],
  ];
  dealSeeds.forEach((d, i) => {
    const [id, owner, cus, title, service, value, stage, idleDays] = d;
    const won = ['hop_dong_da_ky', 'dang_san_xuat', 'ban_giao', 'hoan_tat'].includes(stage);
    P('INSERT INTO nv_deals (id,owner_id,customer_id,title,service,value,stage,probability,status,source,expected_close_at,last_activity_at,stage_changed_at,won_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, owner, cus, title, service, value, stage, prob[stage], won ? 'won' : 'open',
      pick(['Review', 'MGM', 'Liên minh', 'CTV/KOL'], i),
      T + (10 + i * 2) * DAY, T - idleDays * DAY, T - idleDays * DAY, won ? T - idleDays * DAY : null,
      'Deal demo phục vụ trình diễn pipeline.', T - (40 - i) * DAY, T - idleDays * DAY);
    if (won) {
      const rate = defaultCommissionRate(service);
      P('INSERT INTO nv_commissions (id,user_id,deal_id,period,base,rate,amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        uid('cm'), owner, id, new Date((T - idleDays * DAY) * 1000).toISOString().slice(0, 7),
        value, rate, Math.round(value * rate / 100), idleDays > 20 ? 'da_duyet' : 'du_kien', T - idleDays * DAY);
    }
  });

  /* ---------- Hoạt động ---------- */
  const actTypes = ['call', 'email', 'meeting', 'demo', 'zalo'];
  let ai = 0;
  for (let d = 0; d < 14; d++) {
    for (const u of SALES) {
      const cnt = 2 + ((d + u.length) % 4);
      for (let k = 0; k < cnt; k++) {
        ai++;
        const cus = customers.filter(c => c[1] === u)[(k + d) % 4];
        const type = pick(actTypes, ai);
        P('INSERT INTO nv_activities (id,user_id,customer_id,deal_id,type,subject,note,outcome,duration,happened_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          uid('ac'), u, cus[0], null, type,
          pick(['Gọi chào dịch vụ TVC AI', 'Gửi hồ sơ năng lực', 'Họp tìm hiểu nhu cầu', 'Demo mẫu video AI', 'Nhắn Zalo theo dõi báo giá'], ai),
          'Ghi nhận từ ' + (type === 'call' ? 'tổng đài (mock call log)' : 'thao tác thủ công') + '.',
          pick(['Tích cực', 'Cần theo dõi', 'Chưa có nhu cầu', 'Hẹn gặp lại'], ai),
          type === 'call' ? 3 + (ai % 12) : type === 'meeting' ? 45 : 0,
          T - d * DAY - (ai % 8) * 3600, T - d * DAY);
      }
    }
  }

  /* ---------- Liên hệ mới trong ngày ---------- */
  for (let d = 0; d < 10; d++) {
    for (const u of SALES) {
      const cnt = u === 'u_s1' ? 7 : u === 'u_s2' ? 5 : 3;
      for (let k = 0; k < cnt; k++) {
        P('INSERT INTO nv_daily_contacts (id,user_id,name,company,channel,phone,customer_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          uid('dc'), u, 'Liên hệ mới ' + (d * 10 + k + 1), pick(inds, d + k) + ' Corp',
          pick(['Review', 'MGM', 'Liên minh', 'Tài trợ', 'CTV/KOL', 'Kênh cá nhân', 'Game Viral'], d + k),
          '09' + (70000000 + d * 1000 + k), null, 'Tiếp cận lần đầu', T - d * DAY - k * 1800);
      }
    }
  }

  /* ---------- Việc & việc được giao ---------- */
  const tasks = [
    ['u_s1', 'u_tp', 'Chăm sóc deal An Phát – gửi kịch bản v2', 'Khách yêu cầu chỉnh mood cinematic hơn.', 'assignment', 'high', 'todo', 'dl_02', 0.5],
    ['u_s1', null, 'Gọi lại chị Lan – Việt Xanh', 'Chốt lịch demo tuần này.', 'task', 'high', 'todo', 'dl_01', 0.2],
    ['u_s1', 'u_tp', 'Chuẩn bị hồ sơ thầu Gameshow Đông Đô', 'Hạn nộp còn 5 ngày.', 'assignment', 'high', 'in_progress', 'dl_03', -1],
    ['u_s2', 'u_tp', 'Nhận lead Dược Minh Long (phân bổ)', 'Liên hệ trong 24h.', 'assignment', 'medium', 'todo', 'dl_05', 0.8],
    ['u_s2', null, 'Gửi proposal SmartKid', 'Kèm bảng giá talkshow.', 'task', 'medium', 'todo', 'dl_06', 1.2],
    ['u_s2', 'u_tp', 'Cập nhật CRM khách Ô tô Trường Phát', 'Deal đã 11 ngày không hoạt động.', 'assignment', 'high', 'todo', 'dl_07', -0.3],
    ['u_s3', 'u_tp', 'Trình bày phương án YouTube VinaSoft', 'Họp 14h thứ 5.', 'assignment', 'high', 'in_progress', 'dl_09', 2],
    ['u_s3', null, 'Theo dõi hợp đồng Hạ Vy', 'Chờ phản hồi phòng pháp chế.', 'task', 'medium', 'todo', 'dl_10', 1],
    ['u_s3', 'u_tp', 'Hoàn tất nghiệm thu Đại Lộc', 'Gửi báo cáo hiệu quả tháng 1.', 'assignment', 'low', 'done', 'dl_12', -2],
  ];
  tasks.forEach((t, i) => {
    P('INSERT INTO nv_tasks (id,user_id,assigner_id,title,detail,type,priority,status,deal_id,customer_id,due_at,accept_sla_min,accepted_at,done_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uid('tk'), t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], null,
      Math.round(T + t[8] * DAY), 120,
      (t[6] === 'todo' && t[1]) ? null : T - DAY, t[6] === 'done' ? T - DAY : null, T - (i % 4 + 1) * DAY);
  });

  /* ---------- Báo cáo ngày ---------- */
  for (let d = 1; d <= 8; d++) {
    for (const u of SALES) {
      if (u === 'u_s3' && d % 3 === 0) continue; // thiếu báo cáo -> ảnh hưởng KPI kỷ luật
      const date = new Date((T - d * DAY) * 1000).toISOString().slice(0, 10);
      P('INSERT INTO nv_daily_reports (id,user_id,kind,period,calls,meetings,new_contacts,deals_moved,revenue,highlight,blocker,plan,late,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        uid('rp'), u, 'day', date, 12 + (d * 3 + u.length) % 15, d % 3, u === 'u_s1' ? 7 : u === 'u_s2' ? 5 : 3,
        d % 2, d === 2 && u === 'u_s1' ? 120000000 : 0,
        'Khách phản hồi tốt với mẫu video AI demo.', d % 4 === 0 ? 'Chờ bảng giá gameshow mùa mới.' : '',
        'Tiếp tục follow 3 deal đang báo giá.', u === 'u_s3' && d % 2 === 0 ? 1 : 0, T - d * DAY + 64800);
    }
  }

  /* ---------- Cơ hội đấu thầu (mock) ---------- */
  const tenders = [
    ['Gói thầu: Sản xuất phim tư liệu 20 năm thành lập', 'Tổng công ty Điện lực Miền Nam', 'muasamcong.mpi.gov.vn', 1200000000, 'TVC/Video', 12, 88],
    ['Truyền thông số & xây kênh TikTok chương trình OCOP', 'Sở Công Thương TP.HCM', 'muasamcong.mpi.gov.vn', 450000000, 'Xây kênh', 6, 76],
    ['Tài trợ sản xuất gameshow "Nông dân số"', 'Đài PT-TH Vĩnh Long', 'thvl.vn/thongbao', 900000000, 'Gameshow', 20, 71],
    ['Sản xuất TVC quảng bá du lịch tỉnh', 'Sở Du lịch Khánh Hòa', 'muasamcong.mpi.gov.vn', 680000000, 'TVC/Video', 3, 64],
    ['Chuỗi video AI đào tạo nội bộ', 'Tập đoàn Bảo Việt', 'baoviet.com.vn/dauthau', 320000000, 'TVC/Video', 15, 58],
    ['Quản trị kênh YouTube thương hiệu quốc gia', 'Cục Xúc tiến Thương mại', 'muasamcong.mpi.gov.vn', 540000000, 'Xây kênh', 9, 69],
  ];
  tenders.forEach((t, i) => P('INSERT INTO nv_tender_leads (id,title,org,source,url,value,service_tag,deadline_at,score,status,assigned_to,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    uid('td'), t[0], t[1], t[2], 'https://' + t[2], t[3], t[4], T + t[5] * DAY, t[6],
    i === 5 ? 'ignored' : 'new', null,
    'AI tóm tắt: quy mô ' + Math.round(t[3] / 1e6) + ' triệu, phù hợp năng lực NetViet mảng ' + t[4] + '. Yêu cầu hồ sơ năng lực 3 dự án tương tự.',
    T - (i % 5) * DAY));

  /* ---------- Lead theo 7 kênh ---------- */
  const channels = ['Review', 'MGM', 'Liên minh', 'Tài trợ', 'CTV/KOL', 'Kênh cá nhân', 'Game Viral'];
  for (let i = 0; i < 12; i++) {
    P('INSERT INTO nv_leads (id,owner_id,name,company,channel,phone,email,need,score,status,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      uid('ld'), SALES[i % 3], pick(['Anh Trung', 'Chị Hồng', 'Anh Phúc', 'Chị Yến', 'Anh Sơn'], i),
      pick(inds, i) + ' Group ' + (i + 1), pick(channels, i), '09' + (55000000 + i * 913),
      'lead' + i + '@demo.vn', pick(['Cần TVC ra mắt sản phẩm', 'Muốn xây kênh TikTok', 'Tìm hiểu booking gameshow'], i),
      45 + (i * 7) % 50, i % 4 === 0 ? 'contacted' : 'new',
      'AI chấm điểm dựa trên ngành, quy mô & tín hiệu quan tâm.', T - (i % 7) * DAY);
  }

  /* ---------- Báo giá ---------- */
  P('INSERT INTO nv_quotes (id,deal_id,owner_id,customer_id,title,items,subtotal,discount_pct,total,commission,status,approver_id,approve_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'qt_01', 'dl_04', 'u_s1', 'cs_04', 'Báo giá xây kênh TikTok Nâu Việt',
    JSON.stringify([{ productId: 'pr_tiktok', name: 'Xây kênh TikTok triệu view – 3 tháng', qty: 1, price: 120000000 }]),
    120000000, 18, 98400000, 6888000, 'pending', null, null, T - 2 * DAY, T - 2 * DAY);
  P('INSERT INTO nv_quotes (id,deal_id,owner_id,customer_id,title,items,subtotal,discount_pct,total,commission,status,approver_id,approve_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'qt_02', 'dl_06', 'u_s2', 'cs_06', 'Báo giá booking talkshow SmartKid',
    JSON.stringify([{ productId: 'pr_gs_talk', name: 'Booking Gameshow – Talkshow chuyên đề', qty: 1, price: 250000000 }]),
    250000000, 5, 237500000, 9500000, 'approved', 'u_tp', 'Duyệt trong ngưỡng chiết khấu.', T - 6 * DAY, T - 5 * DAY);

  /* ---------- PIP ---------- */
  P('INSERT INTO nv_pip_records (id,user_id,manager_id,phase,goal,metric,start_at,end_at,status,result_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    uid('pip'), 'u_s3', 'u_tp', '30', 'Đạt tối thiểu 8 liên hệ mới/ngày và nộp báo cáo đúng hạn 100%.',
    'daily_contacts>=8; report_on_time=100%', T - 12 * DAY, T + 18 * DAY, 'dang_chay', null, T - 12 * DAY);

  /* ---------- Đào tạo ---------- */
  const trainings = [
    ['Nhập môn dịch vụ NetViet: TVC, Gameshow, Xây kênh', 'Sản phẩm', 'https://www.youtube.com/watch?v=ysz5S6PUM-U', 25, 'sales', 1],
    ['Kịch bản gọi điện 30 giây chốt lịch hẹn', 'Kỹ năng', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 18, 'sales', 1],
    ['Xử lý từ chối: "Giá cao quá"', 'Kỹ năng', 'https://www.youtube.com/watch?v=ScMzIvxBSi4', 15, 'sales', 1],
    ['Quy trình pipeline 7 giai đoạn & SLA', 'Quy trình', 'https://www.youtube.com/watch?v=ysz5S6PUM-U', 20, 'sales', 1],
    ['Đọc hiểu hồ sơ mời thầu truyền thông', 'Chuyên sâu', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 30, 'sales', 0],
    ['Coaching đội sales & vận hành PIP', 'Quản lý', 'https://www.youtube.com/watch?v=ScMzIvxBSi4', 35, 'manager', 1],
  ];
  const tIds = [];
  trainings.forEach((t, i) => {
    const id = 'tr_' + (i + 1); tIds.push([id, t[5], t[4]]);
    P('INSERT INTO nv_trainings (id,title,category,url,duration_min,role_target,required,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id, t[0], t[1], t[2], t[3], t[4], t[5], 'Bài giảng nội bộ NetViet Academy.', T - 30 * DAY);
  });
  SALES.forEach((u, ui) => tIds.filter(t => t[2] === 'sales').forEach(([id], i) => {
    const done = i < (ui === 0 ? 4 : ui === 1 ? 3 : 1);
    P('INSERT INTO nv_training_progress (id,user_id,training_id,status,progress,assigned_by,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      uid('tp'), u, id, done ? 'completed' : (i === 4 ? 'in_progress' : 'assigned'), done ? 100 : (i === 4 ? 40 : 0),
      'u_tp', done ? T - (i + 2) * DAY : null, T - DAY);
  }));

  /* ---------- Thông báo ---------- */
  const notis = [
    ['u_s1', 'sla', 'Deal quá hạn SLA', 'Deal "Xây kênh TikTok Nâu Việt" đã 9 ngày không có hoạt động.', '#/pipeline', 'warn'],
    ['u_s1', 'assignment', 'Bạn được giao 1 việc mới', 'TP giao: Chăm sóc deal An Phát – gửi kịch bản v2', '#/tasks', 'info'],
    ['u_s2', 'sla', 'Deal nguội cần xử lý', 'Deal "Video AI ra mắt mẫu xe mới" 11 ngày không hoạt động.', '#/pipeline', 'danger'],
    ['u_s3', 'report', 'Chưa nộp báo cáo hôm qua', 'Vui lòng nộp báo cáo EOD để không bị trừ điểm kỷ luật.', '#/reports', 'warn'],
    ['u_tp', 'approval', 'Chờ duyệt chiết khấu 18%', 'Báo giá Nâu Việt vượt ngưỡng 15%.', '#/saleskit', 'danger'],
    ['u_tp', 'tender', 'Cơ hội thầu mới điểm cao', '3 gói thầu mới phù hợp năng lực NetViet.', '#/prospect', 'info'],
  ];
  notis.forEach((n, i) => P('INSERT INTO nv_notifications (id,user_id,type,title,body,link,level,read,created_at) VALUES (?,?,?,?,?,?,?,0,?)',
    uid('nt'), n[0], n[1], n[2], n[3], n[4], n[5], T - i * 3600));

  for (let i = 0; i < S.length; i += 50) await env.DB.batch(S.slice(i, i + 50));
}
