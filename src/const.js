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
export const CHANNELS = ['Cold call', 'LinkedIn', 'Facebook Ads', 'Giới thiệu', 'Sự kiện/Hội chợ', 'Inbound Website', 'Đấu thầu'];

export const ROLE_NAME = { sales: 'Nhân viên Sales', manager: 'Trưởng phòng KD', admin: 'Admin / BGĐ' };

export const TASK_STATUS = { todo: { n: 'Chờ làm', c: 'grey' }, in_progress: { n: 'Đang làm', c: 'blue' }, done: { n: 'Hoàn thành', c: 'green' } };
export const PRIO = { high: { n: 'Cao', c: 'red' }, medium: { n: 'Vừa', c: 'amber' }, low: { n: 'Thấp', c: 'grey' } };

/* Màn hình chứa dữ liệu nhạy cảm → bật chống chụp màn */
export const SENSITIVE = ['crm', 'saleskit', 'kpi', 'console', 'training', 'admin', 'pipeline'];
