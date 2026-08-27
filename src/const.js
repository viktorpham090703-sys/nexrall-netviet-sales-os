import { icon } from './icons.js';

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
export const stageName = (k) => (STAGES.find(s => s.k === k) || {}).n || k;
/* Giai đoạn kết thúc — trùng với TERMINAL bên server/routes/deals.js, xem chú thích ở đó. */
export const TERMINAL_STAGES = ['hop_dong_da_ky', 'dang_san_xuat', 'ban_giao', 'hoan_tat'];

export const TEMPS = { hot: { n: 'Nóng', c: 'red' }, warm: { n: 'Ấm', c: 'amber' }, cold: { n: 'Nguội', c: 'blue' } };

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
  { v: 'partner_pa1', n: 'Partner – phương án 1 (giới thiệu)' },
  { v: 'partner_pa2', n: 'Partner – phương án 2 (partner tự chăm sóc)' },
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

/* HAUNV là TGĐ kiêm Admin toàn quyền — hiển thị chức danh riêng thay vì nhãn "Admin / BGĐ" chung. */
export const roleLabel = (u) => (u && u.id === 'HAUNV') ? 'Admin/TGĐ' : ROLE_NAME[(u || {}).role] || (u || {}).role || '';

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
