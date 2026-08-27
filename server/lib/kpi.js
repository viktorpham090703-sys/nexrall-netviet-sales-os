import { now, DAY, monthKey, TZ_OFFSET } from './util.js';

const DEFAULTS = {
  quota_daily_contacts: 8, quota_calls: 25, quota_meetings: 2, quota_followups: 10,
  target_revenue: 400000000, target_deals: 3, target_pipeline: 1200000000,
  discount_threshold: 15, discount_hard_cap: 30, report_deadline_hour: 17.5, task_accept_sla_min: 120,
  ramp_days: 30, pip_quota_ratio: 0.7, pip_window_days: 14,
  sla_days: {
    lead_moi: 2, tiep_can: 3, du_dieu_kien: 3, chao_hang: 4,
    cho_duyet_bg_v1: 1, cho_duyet_bg_v2: 1, da_gui_bao_gia: 3, dam_phan: 5,
    cho_duyet_hd_v1: 1, cho_duyet_hd_v2: 1, hop_dong_da_ky: 3, dang_san_xuat: 14, ban_giao: 5, hoan_tat: 3,
  },
};

/** Hạn SLA (ngày) của 1 giai đoạn pipeline theo cấu hình hiệu lực, mặc định 5 ngày nếu chưa cấu hình. */
export const slaLimit = (cfg, stage) => (cfg.sla_days || {})[stage] || 5;

/**
 * Cấu hình hiệu lực = mặc định < global < theo từng user.
 * `asOf` (giây) cho phép lấy cấu hình ĐANG HIỆU LỰC tại một thời điểm trong quá khứ —
 * để KPI kỳ cũ không bị tính lại theo ngưỡng mới (versioning).
 */
export async function getConfig(env, userId, asOf) {
  const at = asOf || now();
  const { results } = await env.DB.prepare(
    `SELECT user_id,ckey,value FROM nv_kpi_config
     WHERE (user_id IS NULL OR user_id = ?)
       AND (valid_from IS NULL OR valid_from <= ?)
       AND (valid_to IS NULL OR valid_to > ?)
     ORDER BY valid_from`).bind(userId || '__none__', at, at).all();
  const out = { ...DEFAULTS };
  const apply = (rows) => rows.forEach(r => {
    let v = r.value;
    try { v = JSON.parse(v); } catch { /* chuỗi thường */ }
    if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) v = Number(v);
    out[r.ckey] = v;
  });
  apply((results || []).filter(r => r.user_id == null));
  apply((results || []).filter(r => r.user_id != null));
  return out;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x || 0));
/** Thang xếp loại theo đặc tả M7: Xuất sắc · Tốt · Đạt · Dưới chuẩn · Kém */
export const grade = (t) => t >= 90 ? 'Xuất sắc' : t >= 80 ? 'Tốt' : t >= 70 ? 'Đạt' : t >= 60 ? 'Dưới chuẩn' : 'Kém';
/** Mã ngắn dùng cho chip/nhãn hẹp trên UI */
export const gradeCode = (t) => t >= 90 ? 'XS' : t >= 80 ? 'T' : t >= 70 ? 'Đ' : t >= 60 ? 'DC' : 'K';
export const gradeNote = (t) => t >= 90 ? 'Vượt chuẩn – đề xuất khen thưởng'
  : t >= 80 ? 'Hoàn thành tốt mục tiêu'
  : t >= 70 ? 'Đạt yêu cầu'
  : t >= 60 ? 'Dưới chuẩn – cần kèm cặp'
  : 'Kém – xem xét đưa vào PIP';

function workdaysSoFar(period) {
  const [y, m] = period.split('-').map(Number);
  // Ngày "hôm nay" phải tính theo giờ VN — dùng UTC thì trong khoảng 00:00–07:00 giờ VN
  // hệ thống vẫn coi là ngày hôm trước, làm lệch mẫu số ngày công của cả tháng.
  const todayVN = new Date((now() + TZ_OFFSET) * 1000);
  const isCurrent = todayVN.toISOString().slice(0, 7) === period;
  const lastDay = isCurrent ? todayVN.getUTCDate() : new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= lastDay; d++) {
    const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return Math.max(1, n);
}

/** Số ngày làm việc (bỏ T7/CN) đã trôi qua giữa 2 mốc thời gian (giây) — dùng cho cảnh báo SLA
 * duyệt báo giá/hợp đồng quá hạn ("quá 1 ngày làm việc"). Khác mục đích với workdaysSoFar() ở
 * trên (đếm ngày công CẢ THÁNG cho mẫu số KPI) nên viết hàm riêng, không dùng chung. */
export function businessDaysElapsed(fromTs, toTs) {
  if (!fromTs || !toTs || toTs <= fromTs) return 0;
  const d = new Date((fromTs + TZ_OFFSET) * 1000);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date((toTs + TZ_OFFSET) * 1000);
  end.setUTCHours(0, 0, 0, 0);
  let n = 0;
  while (d.getTime() < end.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export async function computeKpi(env, user, period = monthKey()) {
  // Biên kỳ = 00:00 giờ VN ngày 1 của tháng (không phải 00:00 UTC) — nếu không, deal chốt lúc
  // 0h–7h sáng ngày 1 sẽ bị tính nhầm sang tháng trước, kéo theo doanh thu & hoa hồng lệch kỳ.
  const from = Math.floor(Date.UTC(+period.slice(0, 4), +period.slice(5, 7) - 1, 1) / 1000) - TZ_OFFSET;
  const to = Math.floor(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 1) / 1000) - TZ_OFFSET;
  // Kỳ đã kết thúc → dùng cấu hình đang hiệu lực ở CUỐI kỳ đó, không dùng ngưỡng hôm nay
  const cfg = await getConfig(env, user.id, Math.min(now(), to - 1));
  const wd = workdaysSoFar(period);
  const D = env.DB;

  /* --- Giai đoạn ramp: nhân sự mới được giảm chỉ tiêu theo tỉ lệ thời gian đã làm --- */
  const joinedAt = Number(user.created_at) || (await D.prepare('SELECT created_at FROM nv_users WHERE id=?').bind(user.id).first('created_at')) || 0;
  const rampDays = Number(cfg.ramp_days ?? 30);
  const daysOnJob = joinedAt ? Math.floor((now() - joinedAt) / DAY) : 9999;
  const inRamp = daysOnJob < rampDays;
  // Hệ số 0.2 → 1.0 theo số ngày đã làm; nhân sự cũ luôn = 1
  const rampFactor = inRamp ? Math.max(0.2, Math.min(1, (daysOnJob + 1) / rampDays)) : 1;
  const T = (x) => Math.max(1, (x || 1) * rampFactor); // chỉ tiêu sau khi áp ramp

  const won = await D.prepare("SELECT COUNT(*) n, COALESCE(SUM(value),0) v FROM nv_deals WHERE owner_id=? AND status='won' AND won_at>=? AND won_at<?").bind(user.id, from, to).first();
  const pipe = await D.prepare("SELECT COALESCE(SUM(value*probability/100.0),0) v, COUNT(*) n FROM nv_deals WHERE owner_id=? AND status='open'").bind(user.id).first();
  const acts = await D.prepare('SELECT COUNT(*) n, COUNT(DISTINCT date(happened_at + 25200,"unixepoch")) d FROM nv_activities WHERE user_id=? AND happened_at>=? AND happened_at<?').bind(user.id, from, to).first();
  const dc = await D.prepare('SELECT COUNT(*) n FROM nv_daily_contacts WHERE user_id=? AND created_at>=? AND created_at<?').bind(user.id, from, to).first();
  // Mỗi lần nộp/cập nhật báo cáo tạo 1 bản ghi MỚI (bất biến, giữ lịch sử — xem POST /api/reports)
  // nên 1 ngày có thể có NHIỀU bản ghi; chỉ tính bản MỚI NHẤT của mỗi ngày (rn=1) để "số ngày đã
  // nộp"/"số ngày trễ hạn" không bị đếm trùng khi nhân sự cập nhật lại báo cáo cùng ngày nhiều lần.
  const rp = await D.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(late),0) l FROM (
       SELECT late, ROW_NUMBER() OVER (PARTITION BY period ORDER BY submitted_at DESC) rn
       FROM nv_daily_reports WHERE user_id=? AND kind='day' AND period>=? AND period<=?
     ) WHERE rn=1`).bind(user.id, period + '-01', period + '-31').first();
  const trn = await D.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) c FROM nv_training_progress WHERE user_id=?").bind(user.id).first();
  const aiN = await D.prepare('SELECT COUNT(*) n FROM nv_ai_interactions WHERE user_id=? AND created_at>=?').bind(user.id, from).first();
  const openDeals = await D.prepare("SELECT stage, last_activity_at FROM nv_deals WHERE owner_id=? AND status='open'").bind(user.id).all();

  const sla = cfg.sla_days || DEFAULTS.sla_days;
  const t = now();
  const overdue = (openDeals.results || []).filter(d => (t - (d.last_activity_at || 0)) > (sla[d.stage] || 5) * DAY).length;
  const openN = (openDeals.results || []).length;

  const revenue = Number(won.v) || 0, wonN = Number(won.n) || 0, pipeline = Number(pipe.v) || 0;
  const newContacts = Number(dc.n) || 0, reports = Number(rp.n) || 0, lateR = Number(rp.l) || 0;
  const activeDays = Number(acts.d) || 0, actN = Number(acts.n) || 0;
  const trnAll = Number(trn.n) || 0, trnDone = Number(trn.c) || 0;

  // Tầng 1 – Hiệu suất (55đ) — chỉ tiêu đã áp hệ số ramp cho nhân sự mới
  const p1 = 25 * clamp01(revenue / T(cfg.target_revenue));
  const p2 = 15 * clamp01(wonN / T(cfg.target_deals));
  const p3 = 15 * clamp01(pipeline / T(cfg.target_pipeline));
  // Tầng 2 – Kỷ luật (30đ)
  const d1 = 12 * clamp01((reports - lateR) / wd);
  // Tuân thủ SLA: KHÔNG cho điểm tuyệt đối khi không có deal nào (chống "0 deal = 10/10").
  // Không có pipeline và cũng không chốt được deal nào ⇒ chưa có gì để tuân thủ ⇒ 0 điểm.
  const d2 = openN > 0
    ? 10 * (1 - overdue / openN)
    : (wonN > 0 ? 10 : 0);
  const d3 = 8 * clamp01(activeDays / wd);
  // Tầng 2 – Chủ động (15đ)
  const c1 = 8 * clamp01(newContacts / (T(cfg.quota_daily_contacts || 8) * wd));
  const c2 = 4 * (trnAll ? trnDone / trnAll : 0);
  const c3 = 3 * clamp01((Number(aiN.n) || 0) / 20);

  const performance = +(p1 + p2 + p3).toFixed(1);
  const discipline = +(d1 + d2 + d3).toFixed(1);
  const proactive = +(c1 + c2 + c3).toFixed(1);
  const total = +(performance + discipline + proactive).toFixed(1);

  return {
    userId: user.id, name: user.name, period, performance, discipline, proactive, total,
    grade: grade(total), gradeCode: gradeCode(total), gradeNote: gradeNote(total),
    ramp: { inRamp, daysOnJob, rampDays, factor: +rampFactor.toFixed(2) },
    metrics: {
      revenue, target_revenue: Math.round(T(cfg.target_revenue)), wonN, target_deals: Math.round(T(cfg.target_deals)),
      pipeline, target_pipeline: Math.round(T(cfg.target_pipeline)), newContacts,
      quota_contacts_month: Math.round(T(cfg.quota_daily_contacts || 8) * wd), quota_daily_contacts: cfg.quota_daily_contacts,
      reports, lateReports: lateR, workdays: wd, activeDays, activities: actN,
      overdueDeals: overdue, openDeals: openN, trainingDone: trnDone, trainingAll: trnAll, aiUses: Number(aiN.n) || 0,
    },
    breakdown: [
      { group: 'Hiệu suất', max: 55, score: performance, items: [
        { label: 'Doanh thu ký mới', max: 25, score: +p1.toFixed(1) },
        { label: 'Số deal chốt', max: 15, score: +p2.toFixed(1) },
        { label: 'Giá trị pipeline kỳ vọng', max: 15, score: +p3.toFixed(1) }] },
      { group: 'Kỷ luật', max: 30, score: discipline, items: [
        { label: 'Báo cáo đúng hạn', max: 12, score: +d1.toFixed(1) },
        { label: 'Tuân thủ SLA deal', max: 10, score: +d2.toFixed(1) },
        { label: 'Ngày có hoạt động', max: 8, score: +d3.toFixed(1) }] },
      { group: 'Chủ động', max: 15, score: proactive, items: [
        { label: 'Liên hệ mới', max: 8, score: +c1.toFixed(1) },
        { label: 'Hoàn thành đào tạo', max: 4, score: +c2.toFixed(1) },
        { label: 'Dùng AI hỗ trợ', max: 3, score: +c3.toFixed(1) }] },
    ],
  };
}

export async function saveKpi(env, k, managerNote) {
  const id = 'kpi_' + k.userId + '_' + k.period;
  await env.DB.prepare(`INSERT INTO nv_kpi_scores (id,user_id,period,performance,discipline,proactive,total,grade,manager_note,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET performance=excluded.performance,discipline=excluded.discipline,
    proactive=excluded.proactive,total=excluded.total,grade=excluded.grade,manager_note=COALESCE(excluded.manager_note,nv_kpi_scores.manager_note),updated_at=excluded.updated_at`)
    .bind(id, k.userId, k.period, k.performance, k.discipline, k.proactive, k.total, k.grade, managerNote || null, now()).run();
}
