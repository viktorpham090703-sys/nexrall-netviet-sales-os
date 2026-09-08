/**
 * Trạng thái khách hàng & quyền chăm sóc (ĐKKH) — nguồn sự thật phía server.
 *
 * Thay cho phân loại Nóng / Ấm / Nguội cũ (cột nv_customers.temp): khách hàng nay được gắn
 * TRẠNG THÁI THEO QUY TRÌNH, và mang được NHIỀU trạng thái cùng lúc vì một khách có thể đồng
 * thời nằm ở hai chỗ trong phễu — ví dụ đã mua gói TVC (Đã mua hàng) trong khi đang được chào
 * gói Gameshow tiếp theo (Chào hàng), hoặc vừa là khách đã ký vừa đang thương thảo một gói thầu.
 *
 * Khớp danh sách với src/const.js CUSTOMER_STATUSES (client) — 2 mảng trùng lặp có chủ đích,
 * giống cách STAGES/TENDER_STAGES đã trùng giữa client và server trong dự án này.
 */
import { now, DAY } from './util.js';

/** Trạng thái theo quy trình bán hàng thông thường. */
export const SALE_STATUSES = ['khach_moi', 'cham_soc', 'chao_hang', 'bao_gia', 'hop_dong', 'da_mua_hang'];
/** Trạng thái theo quy trình đấu thầu — chạy song song, khách hàng tập đoàn có thể có cả hai. */
export const TENDER_STATUSES = ['tiep_can_truoc', 'nhan_thu_moi', 'chuan_bi_ho_so', 'cho_duyet_ho_so',
  'da_nop_ho_so', 'thuong_thao', 'mou', 'trung_thau'];
export const ALL_STATUSES = [...SALE_STATUSES, ...TENDER_STATUSES];

/** Trạng thái mặc định khi tạo khách mới mà client không gửi gì. */
export const DEFAULT_STATUS = 'khach_moi';

/**
 * Chuẩn hoá mảng trạng thái client gửi lên: bỏ giá trị lạ, bỏ trùng, chặn số lượng.
 * KHÔNG ném lỗi khi có giá trị lạ — chỉ lọc bỏ; một trạng thái sai chính tả không đáng để chặn
 * cả thao tác lưu khách hàng, và mảng rỗng đã có DEFAULT_STATUS đỡ.
 */
export function normalizeStatuses(v) {
  if (!Array.isArray(v)) return null;
  const seen = new Set();
  for (const x of v) {
    if (typeof x === 'string' && ALL_STATUSES.includes(x)) seen.add(x);
    if (seen.size >= ALL_STATUSES.length) break;
  }
  return seen.size ? [...seen] : [DEFAULT_STATUS];
}

/** Đọc cột `statuses` (TEXT JSON) về mảng — hàng cũ/hỏng thì rơi về trạng thái mặc định. */
export function readStatuses(row) {
  try {
    const arr = JSON.parse(row?.statuses || '[]');
    const clean = Array.isArray(arr) ? arr.filter(x => ALL_STATUSES.includes(x)) : [];
    return clean.length ? clean : [DEFAULT_STATUS];
  } catch { return [DEFAULT_STATUS]; }
}

/**
 * Tình trạng ĐKKH của một khách hàng.
 *
 * Quy tắc (tài liệu quy trình PKD): sale giữ quyền chăm sóc trong `dkkhDays` (mặc định 30 ngày)
 * kể từ mốc ĐKKH. Quá hạn mà CHƯA ký hợp đồng và sale không tái ĐKKH thì sale khác được phép
 * nhận khách đó, được chăm và ký hợp đồng.
 *
 * `signed` = khách đã có ít nhất 1 deal ở trạng thái 'won'. Khi đó quyền chăm sóc được giữ
 * VĨNH VIỄN (không đếm ngược nữa) — giả định vận hành hiện tại, đổi được bằng cấu hình
 * `dkkh_lock_when_signed` trong Quản trị mà không phải sửa code.
 */
export function dkkhState(row, cfg, signed) {
  const days = Number(cfg?.dkkh_days) > 0 ? Number(cfg.dkkh_days) : 30;
  const lockWhenSigned = cfg?.dkkh_lock_when_signed == null ? 1 : Number(cfg.dkkh_lock_when_signed);
  const at = Number(row?.dkkh_at) || Number(row?.created_at) || now();
  const expiresAt = at + days * DAY;
  if (signed && lockWhenSigned) {
    return { kind: 'locked', at, expiresAt: null, daysLeft: null, claimable: false, count: Number(row?.dkkh_count) || 0 };
  }
  const secLeft = expiresAt - now();
  const daysLeft = Math.ceil(secLeft / DAY);
  const kind = secLeft <= 0 ? 'expired' : daysLeft <= 5 ? 'expiring' : 'active';
  return { kind, at, expiresAt, daysLeft: Math.max(daysLeft, 0), claimable: kind === 'expired', count: Number(row?.dkkh_count) || 0 };
}

/** Gắn `statuses` (mảng) + `dkkh` (đối tượng) vào hàng khách hàng trước khi trả về client. */
export function decorateCustomer(row, cfg, signed) {
  return { ...row, statuses: readStatuses(row), dkkh: dkkhState(row, cfg, signed) };
}
