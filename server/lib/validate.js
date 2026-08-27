/**
 * Lớp kiểm tra dữ liệu đầu vào dùng chung cho mọi route.
 * Nguyên tắc: chặn ở backend, không tin frontend. Sai thì ném HttpError 400 kèm
 * thông điệp tiếng Việt để UI hiển thị thẳng cho người dùng.
 */
import { HttpError } from './util.js';

export const MAX_DEAL_VALUE = 1e12;   // 1.000 tỷ – trần hợp lý cho 1 hợp đồng
export const MAX_QTY = 1000;
const FUTURE_TOLERANCE = 300;         // cho lệch 5 phút do đồng hồ máy khách

const bad = (msg) => { throw new HttpError(400, msg); };

/** Số tiền: bắt buộc là số hữu hạn, không âm, không vượt trần. */
export function vMoney(v, label = 'Giá trị', { max = MAX_DEAL_VALUE, required = false } = {}) {
  if (v == null || v === '') { if (required) bad(`Vui lòng nhập ${label.toLowerCase()}`); return 0; }
  const n = Number(v);
  if (!Number.isFinite(n)) bad(`${label} phải là số`);
  if (n < 0) bad(`${label} không được âm`);
  if (n > max) bad(`${label} vượt mức cho phép (tối đa ${new Intl.NumberFormat('vi-VN').format(max)} đ)`);
  return Math.round(n);
}

/** Số nguyên đếm được (cuộc gọi, số deal…): không âm, có trần chống nhập nhầm. */
export function vCount(v, label = 'Số lượng', { max = 100000 } = {}) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) bad(`${label} phải là số`);
  if (n < 0) bad(`${label} không được âm`);
  if (n > max) bad(`${label} vượt mức cho phép (tối đa ${max})`);
  return Math.round(n);
}

/** Phần trăm 0–100. */
export function vPercent(v, label = 'Tỉ lệ', { max = 100 } = {}) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) bad(`${label} phải là số`);
  if (n < 0) bad(`${label} không được âm`);
  if (n > max) bad(`${label} không được vượt ${max}%`);
  return n;
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
/** Email: cho phép bỏ trống, nhưng đã nhập thì phải đúng định dạng. */
export function vEmail(v, label = 'Email') {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (s.length > 120 || !RE_EMAIL.test(s)) bad(`${label} không đúng định dạng (ví dụ: ten@congty.vn)`);
  return s;
}

/** Mật khẩu tài khoản: cho phép bỏ trống khi không bắt buộc (giữ nguyên mật khẩu cũ), đã nhập thì tối thiểu 6 ký tự. */
export function vPassword(v, label = 'Mật khẩu', { required = false } = {}) {
  if (v == null || String(v) === '') { if (required) bad(`Vui lòng nhập ${label.toLowerCase()}`); return null; }
  const s = String(v);
  if (s.length < 6) bad(`${label} phải có ít nhất 6 ký tự`);
  if (s.length > 200) bad(`${label} quá dài`);
  return s;
}

const RE_PHONE = /^[0-9+()\s.-]{8,20}$/;
/** Số điện thoại VN: chỉ chấp nhận chữ số và ký tự phân cách thông dụng. */
export function vPhone(v, label = 'Số điện thoại') {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!RE_PHONE.test(s)) bad(`${label} chỉ được chứa chữ số (8–20 ký tự)`);
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8) bad(`${label} quá ngắn`);
  return s;
}

/** Chuỗi bắt buộc, cắt khoảng trắng thừa. */
export function vText(v, label, { max = 200, required = false, min = 1 } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (!s) { if (required) bad(`Vui lòng nhập ${label.toLowerCase()}`); return null; }
  if (s.length < min) bad(`${label} quá ngắn`);
  return s.slice(0, max);
}

/** Mốc thời gian (giây): không cho ghi hoạt động ở tương lai. */
export function vPastTs(v, fallback, label = 'Thời điểm') {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) bad(`${label} không hợp lệ`);
  const now = Math.floor(Date.now() / 1000);
  if (n > now + FUTURE_TOLERANCE) bad(`${label} không được ở tương lai`);
  if (n < now - 3650 * 86400) bad(`${label} quá xa trong quá khứ`);
  return Math.round(n);
}

/** Mốc thời gian tương lai (hạn chốt, hạn xử lý việc). */
export function vFutureTs(v, fallback, label = 'Hạn') {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) bad(`${label} không hợp lệ`);
  const now = Math.floor(Date.now() / 1000);
  if (n > now + 3650 * 86400) bad(`${label} quá xa trong tương lai`);
  return Math.round(n);
}

/** Giá trị phải nằm trong danh sách cho phép. */
export function vEnum(v, allowed, label, fallback) {
  if (v == null || v === '') return fallback;
  if (!allowed.includes(v)) bad(`${label} không hợp lệ`);
  return v;
}

/** Ngày dạng YYYY-MM-DD (input type=date phía client) — cho phép bỏ trống. */
export function vDateStr(v, label = 'Ngày') {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad(`${label} không đúng định dạng`);
  return s;
}

/** Kỳ báo cáo dạng YYYY-MM-DD hoặc YYYY-Www. */
export function vPeriod(v, fallback) {
  if (v == null || v === '') return fallback;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(s) && !/^\d{4}-W\d{1,2}$/.test(s)) bad('Kỳ báo cáo không hợp lệ');
  return s;
}
