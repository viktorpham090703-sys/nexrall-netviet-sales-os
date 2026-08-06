import { now, DAY, monthKey } from './util.js';

const DEFAULTS = {
  quota_daily_contacts: 8, quota_calls: 25, quota_meetings: 2,
  target_revenue: 400000000, target_deals: 3, target_pipeline: 1200000000,
  discount_threshold: 15, report_deadline_hour: 18, task_accept_sla_min: 120,
  sla_days: { lead_moi: 2, tiep_can: 3, nhu_cau: 5, bao_gia: 4, dam_phan: 5, chot: 3, trien_khai: 14 },
};

/** Cấu hình hiệu lực = mặc định < global < theo từng user */
export async function getConfig(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT user_id,ckey,value FROM nv_kpi_config WHERE user_id IS NULL OR user_id = ?').bind(userId || '__none__').all();
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
export const grade = (t) => t >= 90 ? 'A+' : t >= 80 ? 'A' : t >= 70 ? 'B' : t >= 60 ? 'C' : 'D';
export const gradeNote = (t) => t >= 90 ? 'Xuất sắc' : t >= 80 ? 'Tốt' : t >= 70 ? 'Đạt' : t >= 60 ? 'Cần cải thiện' : 'Nguy cơ – xem xét PIP';

function workdaysSoFar(period) {
  const [y, m] = period.split('-').map(Number);
  const today = new Date();
  const isCurrent = today.toISOString().slice(0, 7) === period;
  const lastDay = isCurrent ? today.getUTCDate() : new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= lastDay; d++) {
    const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return Math.max(1, n);
}

export async function computeKpi(env, user, period = monthKey()) {
  const cfg = await getConfig(env, user.id);
  const from = Math.floor(Date.UTC(+period.slice(0, 4), +period.slice(5, 7) - 1, 1) / 1000);
  const to = Math.floor(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 1) / 1000);
  const wd = workdaysSoFar(period);
  const D = env.DB;

  const won = await D.prepare("SELECT COUNT(*) n, COALESCE(SUM(value),0) v FROM nv_deals WHERE owner_id=? AND status='won' AND won_at>=? AND won_at<?").bind(user.id, from, to).first();
  const pipe = await D.prepare("SELECT COALESCE(SUM(value*probability/100.0),0) v, COUNT(*) n FROM nv_deals WHERE owner_id=? AND status='open'").bind(user.id).first();
  const acts = await D.prepare('SELECT COUNT(*) n, COUNT(DISTINCT date(happened_at,"unixepoch")) d FROM nv_activities WHERE user_id=? AND happened_at>=? AND happened_at<?').bind(user.id, from, to).first();
  const dc = await D.prepare('SELECT COUNT(*) n FROM nv_daily_contacts WHERE user_id=? AND created_at>=? AND created_at<?').bind(user.id, from, to).first();
  const rp = await D.prepare("SELECT COUNT(*) n, COALESCE(SUM(late),0) l FROM nv_daily_reports WHERE user_id=? AND kind='day' AND period>=? AND period<=?").bind(user.id, period + '-01', period + '-31').first();
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

  // Tầng 1 – Hiệu suất (55đ)
  const p1 = 25 * clamp01(revenue / (cfg.target_revenue || 1));
  const p2 = 15 * clamp01(wonN / (cfg.target_deals || 1));
  const p3 = 15 * clamp01(pipeline / (cfg.target_pipeline || 1));
  // Tầng 2 – Kỷ luật (30đ)
  const d1 = 12 * clamp01((reports - lateR) / wd);
  const d2 = 10 * (openN ? 1 - overdue / openN : 1);
  const d3 = 8 * clamp01(activeDays / wd);
  // Tầng 2 – Chủ động (15đ)
  const c1 = 8 * clamp01(newContacts / ((cfg.quota_daily_contacts || 8) * wd));
  const c2 = 4 * (trnAll ? trnDone / trnAll : 0);
  const c3 = 3 * clamp01((Number(aiN.n) || 0) / 20);

  const performance = +(p1 + p2 + p3).toFixed(1);
  const discipline = +(d1 + d2 + d3).toFixed(1);
  const proactive = +(c1 + c2 + c3).toFixed(1);
  const total = +(performance + discipline + proactive).toFixed(1);

  return {
    userId: user.id, name: user.name, period, performance, discipline, proactive, total,
    grade: grade(total), gradeNote: gradeNote(total),
    metrics: {
      revenue, target_revenue: cfg.target_revenue, wonN, target_deals: cfg.target_deals,
      pipeline, target_pipeline: cfg.target_pipeline, newContacts,
      quota_contacts_month: (cfg.quota_daily_contacts || 8) * wd, quota_daily_contacts: cfg.quota_daily_contacts,
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
    proactive=excluded.proactive,total=excluded.total,grade=excluded.grade,manager_note=COALESCE(excluded.manager_note,kpi_scores.manager_note),updated_at=excluded.updated_at`)
    .bind(id, k.userId, k.period, k.performance, k.discipline, k.proactive, k.total, k.grade, managerNote || null, now()).run();
}
