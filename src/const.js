export const STAGES = [
  { k: 'lead_moi', n: 'Lead mới', ic: '🌱' },
  { k: 'tiep_can', n: 'Tiếp cận', ic: '📞' },
  { k: 'nhu_cau', n: 'Xác định nhu cầu', ic: '🔍' },
  { k: 'bao_gia', n: 'Báo giá / Proposal', ic: '📄' },
  { k: 'dam_phan', n: 'Đàm phán', ic: '🤝' },
  { k: 'chot', n: 'Chốt hợp đồng', ic: '✍️' },
  { k: 'trien_khai', n: 'Triển khai & Tái ký', ic: '🚀' },
];
export const stageName = (k) => (STAGES.find(s => s.k === k) || {}).n || k;

export const TEMPS = { hot: { n: 'Nóng', c: 'red' }, warm: { n: 'Ấm', c: 'amber' }, cold: { n: 'Nguội', c: 'blue' } };

export const ACT_TYPES = [
  { k: 'call', n: 'Cuộc gọi', ic: '📞' },
  { k: 'email', n: 'Email', ic: '✉️' },
  { k: 'meeting', n: 'Gặp mặt', ic: '🤝' },
  { k: 'demo', n: 'Demo/Thuyết trình', ic: '🎬' },
  { k: 'zalo', n: 'Zalo/Chat', ic: '💬' },
  { k: 'other', n: 'Khác', ic: '📌' },
];
export const actName = (k) => (ACT_TYPES.find(a => a.k === k) || {}).n || k;
export const actIcon = (k) => (ACT_TYPES.find(a => a.k === k) || {}).ic || '📌';

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

export const ROLE_NAME = { sales: 'Nhân viên Sales', manager: 'Trưởng phòng KD', admin: 'Admin / BGĐ' };

export const TASK_STATUS = { todo: { n: 'Chờ làm', c: 'grey' }, in_progress: { n: 'Đang làm', c: 'blue' }, done: { n: 'Hoàn thành', c: 'green' } };
export const PRIO = { high: { n: 'Cao', c: 'red' }, medium: { n: 'Vừa', c: 'amber' }, low: { n: 'Thấp', c: 'grey' } };

/* Màn hình chứa dữ liệu nhạy cảm → bật chống chụp màn */
export const SENSITIVE = ['crm', 'saleskit', 'kpi', 'console', 'training', 'admin', 'pipeline'];
