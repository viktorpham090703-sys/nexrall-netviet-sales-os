import { now, wsBucket } from './util.js';

/**
 * Thiết lập hệ thống dạng khoá → JSON (bảng nv_settings).
 *
 * Mỗi khoá lưu RIÊNG theo workspace (tiền tố "0:" chính thức, "1:" demo — khớp wsBucket): tài khoản
 * demo trình diễn chung CSDL production không được đổi logo, phân quyền hay ngưỡng duyệt của nhân
 * sự thật, và ngược lại.
 *
 * Khoá dùng:
 *   brand  — { logo }                                  logo công ty (data URL, đã giới hạn dung lượng)
 *   titles — { [cấp]: [chức danh…] }                   phân tầng chức danh
 *   perm   — { feat: {userId: {feature: bool}}, ops: {level: {feature: [5 số 0/1]}}, threshold }
 *   ai     — { on, readCrm, readKit, intern, history, provider, prompts: [] }
 *   road_<vai trò> — { image } ảnh lộ trình đào tạo của vai trò đó (tách khoá riêng vì mỗi ảnh vài trăm KB)
 */
export const DEFAULTS = {
  brand: {},
  titles: {
    1: ['Tổng Giám đốc'], 2: ['Phó Tổng Giám đốc'], 3: ['Giám đốc Kinh doanh', 'Giám đốc Dự án'],
    4: ['Trưởng phòng Kinh doanh'], 5: ['Trưởng nhóm Kinh doanh'], 6: ['Chuyên viên Kinh doanh', 'Trợ lý kinh doanh'],
    7: ['Thực tập sinh', 'Nhân viên thử việc'], hr: ['Chuyên viên Hành chính Nhân sự'],
  },
  perm: { feat: {}, ops: {}, threshold: 20000000 },
  ai: {
    on: true, readCrm: true, readKit: true, intern: false, history: true, provider: 'auto',
    prompts: ['Tóm tắt tình hình cơ hội lớn nhất của tôi', 'Soạn email chào giá gói TVC AI theo mẫu báo giá công ty',
      'Những khách nào tôi chưa liên hệ quá 7 ngày?', 'KPI của tôi còn thiếu bao nhiêu để đạt tháng này?'],
  },
  road_sales: {}, road_manager: {}, road_admin: {}, road_hr: {},
};
export const SETTING_KEYS = Object.keys(DEFAULTS);

/* Bộ nhớ đệm trong isolate — phân quyền được đọc ở MỌI request API, không để mỗi lần gọi thêm 1
 * truy vấn D1. Ghi thì xoá đệm của isolate đang ghi; isolate khác tự hết hạn sau TTL. */
const TTL_MS = 20000;
const cache = new Map();

const fullKey = (bucket, key) => `${bucket}:${key}`;

export async function getSetting(env, bucket, key) {
  const k = fullKey(bucket, key);
  const hit = cache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  let v = null;
  try {
    const row = await env.DB.prepare('SELECT v FROM nv_settings WHERE k=?').bind(k).first();
    if (row) v = JSON.parse(row.v);
  } catch (e) { /* bảng chưa có hoặc JSON hỏng → dùng mặc định */ }
  const merged = mergeDefault(key, v);
  cache.set(k, { v: merged, exp: Date.now() + TTL_MS });
  return merged;
}

export async function setSetting(env, bucket, key, value, userId) {
  const k = fullKey(bucket, key);
  await env.DB.prepare('INSERT INTO nv_settings (k,v,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_by=excluded.updated_by, updated_at=excluded.updated_at')
    .bind(k, JSON.stringify(value), userId || null, now()).run();
  cache.delete(k);
}

function mergeDefault(key, v) {
  const d = DEFAULTS[key];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return structuredClone(d);
  return { ...structuredClone(d), ...v };
}

/** Thiết lập theo workspace của người đang đăng nhập. */
export const mySetting = (ctx, key) => getSetting(ctx.env, wsBucket(ctx.me), key);

/** Ngưỡng duyệt báo giá (đồng): dưới ngưỡng Trưởng phòng duyệt là xong, từ ngưỡng trở lên phải qua
 * Giám đốc chuyên môn (Admin/BGĐ) ở vòng 2. */
export async function approvalThreshold(env, me) {
  const p = await getSetting(env, wsBucket(me), 'perm');
  const n = Number(p.threshold);
  return n > 0 ? n : DEFAULTS.perm.threshold;
}
