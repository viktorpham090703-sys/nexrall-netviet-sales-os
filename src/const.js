import { icon } from './icons.js';

/** Logo thương hiệu NetViet Sales — nhúng thẳng dạng data URL để không phụ thuộc file ảnh
 * riêng (public/ chỉ sync index.html + src/ + styles/, xem local/sync-assets.mjs). */
export const BRAND_LOGO = 'data:image/png;base64,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';

/* 14 bước theo quy trình vận hành PKD (spec làm cơ sở CRM, mục 7) — thay cho pipeline 7 bước cũ. */
export const STAGES = [
  { k: 'lead_moi', n: 'Lead mới', ic: icon('sprout') },
  { k: 'tiep_can', n: 'Đang tiếp cận', ic: icon('phone') },
  { k: 'du_dieu_kien', n: 'Đủ điều kiện', ic: icon('circleCheck') },
  { k: 'chao_hang', n: 'Đang chào hàng', ic: icon('lightbulb') },
  { k: 'cho_duyet_bg_v1', n: 'Chờ duyệt báo giá V1', ic: icon('clock') },
  { k: 'cho_duyet_bg_v2', n: 'Chờ duyệt báo giá V2', ic: icon('alarmClock') },
  { k: 'da_gui_bao_gia', n: 'Đã gửi báo giá', ic: icon('mail') },
  { k: 'dam_phan', n: 'Đang đàm phán', ic: icon('handshake') },
  { k: 'cho_duyet_hd_v1', n: 'Chờ duyệt HĐ V1', ic: icon('clock') },
  { k: 'cho_duyet_hd_v2', n: 'Chờ duyệt HĐ V2', ic: icon('alarmClock') },
  { k: 'hop_dong_da_ky', n: 'Hợp đồng đã ký', ic: icon('penLine') },
  { k: 'dang_san_xuat', n: 'Đang sản xuất', ic: icon('construction') },
  { k: 'ban_giao', n: 'Bàn giao', ic: icon('inbox') },
  { k: 'hoan_tat', n: 'Hoàn tất', ic: icon('trophy') },
];
/* Quy trình đấu thầu (khách hàng tập đoàn lớn) — chạy song song với STAGES qua deal.process_type.
 * Từ "Trúng thầu" hội tụ thẳng vào TERMINAL_STAGES bên dưới, không định nghĩa lại 4 bước cuối.
 * Khớp thứ tự với server/routes/deals.js TENDER_STAGES (server) — 2 mảng trùng lặp có chủ đích,
 * giống cách STAGES/TENDER_STAGES thường đã trùng lặp client/server trong dự án này. */
export const TENDER_STAGES = [
  { k: 'tiep_can_truoc', n: 'Tiếp cận trước', ic: icon('sprout') },
  { k: 'nhan_thu_moi', n: 'Nhận thư mời thầu', ic: icon('mail') },
  { k: 'chuan_bi_ho_so', n: 'Chuẩn bị hồ sơ', ic: icon('fileText') },
  { k: 'cho_duyet_ho_so', n: 'Chờ duyệt hồ sơ', ic: icon('clock') },
  { k: 'da_nop_ho_so', n: 'Đã nộp hồ sơ', ic: icon('circleCheck') },
  { k: 'thuong_thao', n: 'Đang thương thảo', ic: icon('handshake') },
  { k: 'mou', n: 'Biên bản ghi nhớ (MOU)', ic: icon('penLine') },
  { k: 'trung_thau', n: 'Trúng thầu', ic: icon('trophy') },
];
export const stageName = (k) => (STAGES.find(s => s.k === k) || TENDER_STAGES.find(s => s.k === k) || {}).n || k;
/* Giai đoạn kết thúc — trùng với TERMINAL bên server/routes/deals.js, xem chú thích ở đó. */
export const TERMINAL_STAGES = ['hop_dong_da_ky', 'dang_san_xuat', 'ban_giao', 'hoan_tat'];
export const PROCESS_TYPE_NAME = { thong_thuong: 'Thông thường', dau_thau: 'Đấu thầu' };

/* Quy mô khách hàng — cột nv_customers.scale đã tồn tại trong CSDL (seed ngẫu nhiên 3 giá trị này)
 * nhưng trước đây chưa có field nào trong UI để xem/sửa. 'Tập đoàn' là điều kiện nhận diện khách
 * hàng thuộc diện áp dụng quy trình đấu thầu. */
export const CUSTOMER_SCALE_OPTIONS = ['SME', 'Doanh nghiệp lớn', 'Tập đoàn'];

/* Màu theo loại hồ sơ HCNS xét duyệt — khớp màu 3 stat tile trên Console HCNS (báo giá=amber,
 * hợp đồng=blue, hồ sơ thầu=red) để dùng thống nhất ở mọi nơi hiển thị danh sách chờ duyệt. */
export const APPROVAL_TONE = {
  quote: { chip: 'amber', color: 'var(--orange)' },
  contract: { chip: 'blue', color: 'var(--blue)' },
  tender: { chip: 'red', color: 'var(--red)' },
};

/* Phân loại khách hàng THEO TRẠNG THÁI QUY TRÌNH — thay cho Nóng / Ấm / Nguội cũ.
 * Một khách hàng mang được NHIỀU trạng thái cùng lúc: khách đã mua gói TVC có thể đồng thời đang
 * được chào gói Gameshow tiếp theo, hoặc vừa là khách đã ký vừa đang thương thảo một gói thầu.
 * Khớp danh sách với server/lib/customer.js SALE_STATUSES/TENDER_STATUSES — 2 mảng trùng lặp có
 * chủ đích, giống cách STAGES/TENDER_STAGES đã trùng client/server trong dự án này. */
export const CUSTOMER_STATUSES = [
  { k: 'khach_moi', n: 'Khách mới', c: 'grey', track: 'sale' },
  { k: 'cham_soc', n: 'Chăm sóc', c: 'blue', track: 'sale' },
  { k: 'chao_hang', n: 'Chào hàng', c: 'blue', track: 'sale' },
  { k: 'bao_gia', n: 'Báo giá', c: 'amber', track: 'sale' },
  { k: 'hop_dong', n: 'Hợp đồng', c: 'amber', track: 'sale' },
  { k: 'da_mua_hang', n: 'Đã mua hàng', c: 'green', track: 'sale' },
  { k: 'tiep_can_truoc', n: 'Tiếp cận trước', c: 'grey', track: 'tender' },
  { k: 'nhan_thu_moi', n: 'Nhận thư mời thầu', c: 'blue', track: 'tender' },
  { k: 'chuan_bi_ho_so', n: 'Chuẩn bị hồ sơ', c: 'blue', track: 'tender' },
  { k: 'cho_duyet_ho_so', n: 'Chờ duyệt hồ sơ', c: 'amber', track: 'tender' },
  { k: 'da_nop_ho_so', n: 'Đã nộp hồ sơ', c: 'blue', track: 'tender' },
  { k: 'thuong_thao', n: 'Thương thảo', c: 'amber', track: 'tender' },
  { k: 'mou', n: 'Biên bản ghi nhớ (MOU)', c: 'blue', track: 'tender' },
  { k: 'trung_thau', n: 'Trúng thầu', c: 'green', track: 'tender' },
];
export const statusDef = (k) => CUSTOMER_STATUSES.find(s => s.k === k) || { k, n: k, c: 'grey', track: 'sale' };
export const saleStatuses = () => CUSTOMER_STATUSES.filter(s => s.track === 'sale');
export const tenderStatuses = () => CUSTOMER_STATUSES.filter(s => s.track === 'tender');

/* Tình trạng ĐKKH (đăng ký khách hàng) — sale giữ quyền chăm sóc 1 tháng kể từ mốc đăng ký; hết
 * hạn mà chưa ký hợp đồng thì sale khác được phép nhận. `locked` = đã ký hợp đồng, giữ vĩnh viễn. */
export const DKKH_TONE = {
  active: { c: 'green', ic: 'circleCheck' },
  expiring: { c: 'amber', ic: 'alarmClock' },
  expired: { c: 'red', ic: 'triangleAlert' },
  locked: { c: 'grey', ic: 'penLine' },
};
export const dkkhLabel = (dk) => !dk ? '—'
  : dk.kind === 'locked' ? 'Đã ký · giữ vĩnh viễn'
    : dk.kind === 'expired' ? 'Hết hạn ĐKKH'
      : `Còn ${dk.daysLeft} ngày`;

/* 4 hạng mục cố định của Phương án kinh doanh — khớp server/routes/plans.js PLAN_KINDS. */
export const PLAN_KINDS = [
  { k: 'bao_gia', n: 'Báo giá', ic: icon('banknote') },
  { k: 'hop_dong', n: 'Hợp đồng', ic: icon('penLine') },
  { k: 'nghiem_thu', n: 'Nghiệm thu', ic: icon('circleCheck') },
  { k: 'thanh_ly', n: 'Thanh lý', ic: icon('fileText') },
];
export const planKindName = (k) => (PLAN_KINDS.find(x => x.k === k) || {}).n || k;
/* Trạng thái từng hạng mục — chỉ 2 kết quả duyệt (đã duyệt / cần chỉnh sửa), không có "từ chối",
 * đồng bộ với báo giá & hợp đồng. */
export const PLAN_ITEM_STATUS = {
  todo: { n: 'Chưa trình', c: 'grey' },
  pending: { n: 'Chờ duyệt', c: 'amber' },
  approved: { n: 'Đã duyệt', c: 'green' },
  revise: { n: 'Cần chỉnh sửa', c: 'red' },
};
export const PLAN_APPROVERS = [{ v: 'manager', n: 'Trưởng phòng KD' }, { v: 'admin', n: 'Giám đốc / BGĐ' }];

export const ACT_TYPES = [
  { k: 'call', n: 'Cuộc gọi', ic: icon('phone') },
  { k: 'email', n: 'Email', ic: icon('mail') },
  { k: 'meeting', n: 'Gặp mặt', ic: icon('handshake') },
  { k: 'demo', n: 'Demo/Thuyết trình', ic: icon('clapperboard') },
  { k: 'zalo', n: 'Zalo/Chat', ic: icon('messageSquare') },
  { k: 'other', n: 'Khác', ic: icon('pin') },
];
export const actName = (k) => (ACT_TYPES.find(a => a.k === k) || {}).n || k;
export const actIcon = (k) => (ACT_TYPES.find(a => a.k === k) || {}).ic || icon('pin');

export const SERVICES = ['TVC/Video', 'Gameshow', 'Xây kênh'];
/* 7 kênh nguồn khách theo Kế hoạch tái cấu trúc PKD NetViet 2026 (FR-M2-1).
   'Đấu thầu' KHÔNG nằm trong 7 kênh — cơ hội thầu là nguồn riêng (TenderLead). */
export const CHANNELS = [
  'Review', 'MGM', 'Liên minh', 'Tài trợ', 'CTV/KOL', 'Kênh cá nhân', 'Game Viral',
];
export const CHANNEL_DESC = {
  'Review': 'Khách đến từ bài review / đánh giá dịch vụ',
  'MGM': 'Member Get Member — khách cũ giới thiệu khách mới',
  'Liên minh': 'Đối tác liên minh cùng bán chéo tệp khách',
  'Tài trợ': 'Cơ hội từ hoạt động tài trợ chương trình/sự kiện',
  'CTV/KOL': 'Cộng tác viên & người có ảnh hưởng giới thiệu',
  'Kênh cá nhân': 'Quan hệ cá nhân, mạng lưới riêng của sales',
  'Game Viral': 'Khách đến từ minigame / nội dung lan truyền',
};
/* Nguồn ngoài 7 kênh — dùng cho lead sinh từ đấu thầu */
export const SOURCE_TENDER = 'Đấu thầu';

/* Nguồn khách hàng cố định (5 giá trị, mục 3 quy trình vận hành PKD) — khác khái niệm với
 * CHANNELS/kênh tiếp cận ở trên (dùng cho Tìm khách & ghi liên hệ hằng ngày). Đây trả lời câu hỏi
 * "ai/đâu mang khách này về" ở cấp khách hàng, không phải "tiếp cận qua kênh nào". */
export const LEAD_SOURCES = [
  { v: 'sale_tu_tim', n: 'Sale tự tìm kiếm' },
  { v: 'cong_ty_cap', n: 'Công ty cấp' },
  { v: 'khach_cu_gioi_thieu', n: 'Khách hàng cũ giới thiệu' },
  { v: 'partner_pa1', n: 'Partner – Giới thiệu' },
  { v: 'partner_pa2', n: 'Partner – Partner tự chăm sóc' },
];
export const leadSourceName = (v) => (LEAD_SOURCES.find(s => s.v === v) || {}).n || v || '—';
/* Phương án hợp tác — gắn ở CẤP DEAL (không phải cấp partner/khách hàng), vì 1 partner có thể
 * chạy cả PA1 lẫn PA2 cùng lúc tuỳ từng deal (mục 3 tài liệu). */
export const PA_OPTIONS = [{ v: 'PA1', n: 'PA1 – Giới thiệu' }, { v: 'PA2', n: 'PA2 – Partner tự bán' }];
/* Ai thực hiện các bước 1-3 của deal (mục 5) — chỉ để tách bạch công sức phục vụ tính hoa hồng
 * SAU NÀY, không có logic tính toán nào gắn theo trường này ở đợt hiện tại. */
export const EXEC_SOURCE_OPTIONS = [{ v: 'sale', n: 'Sale' }, { v: 'partner', n: 'Partner' }];

export const ROLE_NAME = {
  sales: 'Nhân viên Sales', manager: 'Trưởng phòng KD', admin: 'Admin / BGĐ',
  hr: 'Hành chính nhân sự',
};

/* Chức danh do Admin/TGĐ đặt ở "Vai trò & chức danh" (cột nv_users.title) là nhãn ƯU TIÊN: đổi
 * chức danh ở màn Quản trị thì mọi chỗ hiển thị vai trò (thẻ hồ sơ sidebar, danh sách người dùng,
 * Console đội, Hồ sơ nhân sự, Báo cáo) đổi theo, không còn kẹt ở nhãn mặc định của vai trò.
 * Chưa đặt chức danh mới rơi về nhãn mặc định — riêng HAUNV là TGĐ kiêm Admin toàn quyền nên có
 * nhãn mặc định riêng thay vì "Admin / BGĐ" chung. */
/* Nhãn mặc định theo VAI TRÒ hệ thống — dùng ở nơi đã hiện chức danh riêng ngay bên cạnh (thẻ hồ
 * sơ nhân sự, Console đội) để không lặp lại cùng một chuỗi hai lần. */
export const roleDefaultLabel = (u) => (u && u.id === 'HAUNV')
  ? 'Admin/TGĐ' : ROLE_NAME[(u || {}).role] || (u || {}).role || '';
export const roleLabel = (u) => (u && String(u.title || '').trim()) || roleDefaultLabel(u);

export const TASK_STATUS = { todo: { n: 'Chờ làm', c: 'grey' }, in_progress: { n: 'Đang làm', c: 'blue' }, done: { n: 'Hoàn thành', c: 'green' } };
export const PRIO = { high: { n: 'Cao', c: 'red' }, medium: { n: 'Vừa', c: 'amber' }, low: { n: 'Thấp', c: 'grey' } };
export const PIP_STATUS = {
  dang_chay: { n: 'Đang chạy', c: 'amber' }, dat: { n: 'Đạt', c: 'green' },
  khong_dat: { n: 'Không đạt', c: 'red' }, huy: { n: 'Huỷ', c: 'amber' },
};
export const gradeTone = (total) => total >= 80 ? 'green' : total >= 60 ? 'amber' : 'red';
/* 2 vòng duyệt (TPKD → Giám đốc), chỉ 2 kết quả — không có "từ chối" (xem PATCH /api/quotes/:id). */
export const QUOTE_STATUS = {
  draft: { n: 'Nháp', c: 'grey' },
  pending_v1: { n: 'Chờ TPKD duyệt (V1)', c: 'amber' },
  pending_v2: { n: 'Chờ Giám đốc duyệt (V2)', c: 'amber' },
  approved: { n: 'Đã duyệt', c: 'green' },
};
/* Hợp đồng: 2 vòng duyệt (TPKD → HCNS) — không có ngưỡng bỏ qua như báo giá, mọi hợp đồng đều bắt
 * đầu ở pending_v1. Cùng 2 kết quả 'approved'|'revise', không có "từ chối" (PATCH /api/contracts/:id). */
export const CONTRACT_STATUS = {
  pending_v1: { n: 'Chờ TPKD duyệt (V1)', c: 'amber' },
  pending_v2: { n: 'Chờ HCNS duyệt (V2)', c: 'amber' },
  approved: { n: 'Đã ký', c: 'green' },
};
