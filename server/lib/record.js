import { now, DAY, TZ_OFFSET } from './util.js';
import { getConfig, slaLimit, computeKpi } from './kpi.js';

/* Thành tích & Vi phạm của một nhân sự — TÍNH TRỰC TIẾP từ dữ liệu Sales OS mỗi lần mở hồ sơ (không ai
 * nhập tay, không lưu bản sao), nên luôn khớp tình hình thực tế: deal chốt, xếp hạng doanh số, KPI,
 * báo cáo EOD, công việc, SLA deal, PIP, lần bị tạm dừng công việc. Khung thời gian: tháng này và 12
 * tháng gần nhất. Mỗi mục: { icon, title, detail, period, level } — level: good | warn | bad. */

const fmtTr = (v) => (Math.round((v || 0) / 1e5) / 10).toLocaleString('vi-VN') + ' tr';
const monthLabel = (key) => { const [y, m] = key.split('-'); return `${m}/${y}`; };

function monthStart(ts, back = 0) {
  const d = new Date((ts + TZ_OFFSET) * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) / 1000) - TZ_OFFSET;
}
const monthKeyOf = (ts) => { const d = new Date((ts + TZ_OFFSET) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export async function computeRecord(env, user) {
  const D = env.DB, t = now(), id = user.id;
  const m0 = monthStart(t), y1 = monthStart(t, 11);
  const achievements = [], violations = [];
  const good = (icon, title, detail, period) => achievements.push({ icon, title, detail, period, level: 'good' });
  const bad = (icon, title, detail, period, level = 'bad') => violations.push({ icon, title, detail, period, level });

  /* ---------- THÀNH TÍCH ---------- */
  const won = (await D.prepare("SELECT id,title,value,won_at FROM nv_deals WHERE owner_id=? AND status='won' AND won_at>=? ORDER BY value DESC").bind(id, y1).all()).results || [];
  const wonMonth = won.filter(d => d.won_at >= m0);
  if (wonMonth.length) good('trophy', `Chốt ${wonMonth.length} deal tháng này`, `Tổng giá trị ${fmtTr(wonMonth.reduce((s, d) => s + (d.value || 0), 0))}`, 'Tháng này');
  if (won.length) good('handshake', `Chốt ${won.length} deal trong 12 tháng`, `Tổng ${fmtTr(won.reduce((s, d) => s + (d.value || 0), 0))} · lớn nhất: ${won[0].title} (${fmtTr(won[0].value)})`, '12 tháng');

  // Top 1 doanh số tháng trong đội sales cùng workspace (6 tháng gần nhất, tính theo deal đã chốt).
  if (user.role === 'sales') {
    const rows = (await D.prepare(
      `SELECT d.owner_id, d.value, d.won_at FROM nv_deals d JOIN nv_users u ON u.id=d.owner_id
       WHERE d.status='won' AND d.won_at>=? AND u.role='sales' AND u.is_demo=?`).bind(monthStart(t, 5), user.is_demo ? 1 : 0).all()).results || [];
    const byMonth = new Map();
    for (const r of rows) {
      const k = monthKeyOf(r.won_at);
      const m = byMonth.get(k) || new Map();
      m.set(r.owner_id, (m.get(r.owner_id) || 0) + (r.value || 0));
      byMonth.set(k, m);
    }
    for (const [k, m] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0]))) {
      const ranked = [...m].sort((a, b) => b[1] - a[1]);
      const pos = ranked.findIndex(([uid]) => uid === id);
      if (pos === 0) good('medal', `Top 1 doanh số tháng ${monthLabel(k)}`, `${fmtTr(ranked[0][1])} — dẫn đầu ${ranked.length} sales có doanh số`, monthLabel(k));
      else if (pos > 0 && pos < 3 && ranked.length >= 3) good('award', `Top ${pos + 1} doanh số tháng ${monthLabel(k)}`, fmtTr(ranked[pos][1]), monthLabel(k));
    }
  }

  // KPI: điểm tháng TP đã chấm (nv_kpi_scores) + tháng hiện tại tính trực tiếp.
  const scores = (await D.prepare('SELECT period,total,grade FROM nv_kpi_scores WHERE user_id=? ORDER BY period DESC LIMIT 12').bind(id).all()).results || [];
  const curKey = monthKeyOf(t);
  let cur = null;
  if (user.role === 'sales') { try { cur = await computeKpi(env, user, curKey); } catch (e) { cur = null; } }
  const kpiRows = [...(cur ? [{ period: curKey, total: cur.total, grade: cur.grade, live: true }] : []), ...scores.filter(s => s.period !== curKey)];
  for (const s of kpiRows) {
    const total = Math.round(Number(s.total) || 0);
    if (total >= 80) good('star', `KPI ${s.live ? 'tháng này' : 'tháng ' + monthLabel(s.period)}: ${s.grade}`, `${total} điểm${s.live ? ' (đang cập nhật)' : ''}`, s.live ? 'Tháng này' : monthLabel(s.period));
    else if (total > 0 && total < 60 && !s.live) bad('trendingUp', `KPI tháng ${monthLabel(s.period)}: ${s.grade}`, `${total} điểm — dưới chuẩn 60`, monthLabel(s.period), total < 50 ? 'bad' : 'warn');
  }

  const reports = (await D.prepare("SELECT late,highlight,submitted_at FROM nv_daily_reports WHERE user_id=? AND kind='day' AND submitted_at>=?").bind(id, m0).all()).results || [];
  const onTime = reports.filter(r => !r.late).length;
  if (reports.length >= 5 && onTime === reports.length) good('clipboardList', 'Nộp báo cáo EOD đúng hạn 100%', `${onTime}/${reports.length} ngày tháng này`, 'Tháng này');

  const doneTraining = Number(await D.prepare("SELECT COUNT(*) n FROM nv_training_progress WHERE user_id=? AND status='completed' AND completed_at>=?").bind(id, y1).first('n')) || 0;
  if (doneTraining) good('graduationCap', `Hoàn thành ${doneTraining} khoá đào tạo`, 'Trong 12 tháng gần nhất', '12 tháng');

  const comm = Number(await D.prepare("SELECT SUM(amount) v FROM nv_commissions WHERE user_id=? AND status IN ('da_duyet','da_chi') AND created_at>=?").bind(id, y1).first('v')) || 0;
  if (comm > 0) good('banknote', `Hoa hồng được duyệt ${fmtTr(comm)}`, 'Trong 12 tháng gần nhất', '12 tháng');

  /* ---------- VI PHẠM ---------- */
  const auto = reports.filter(r => r.late && /^Hệ thống tự tổng hợp/.test(r.highlight || '')).length;
  const late = reports.filter(r => r.late).length - auto;
  if (auto) bad('siren', `Không nộp báo cáo EOD ${auto} ngày`, 'Hệ thống phải tự tổng hợp và nộp thay lúc 18h', 'Tháng này');
  if (late) bad('alarmClock', `Nộp báo cáo EOD trễ hạn ${late} lần`, 'Nộp sau giờ hạn 17h', 'Tháng này', 'warn');

  const overdueNow = (await D.prepare("SELECT title,due_at FROM nv_tasks WHERE user_id=? AND status!='done' AND due_at IS NOT NULL AND due_at<? ORDER BY due_at").bind(id, t).all()).results || [];
  if (overdueNow.length) bad('alarmClock', `${overdueNow.length} công việc đang quá hạn`, overdueNow.slice(0, 3).map(x => x.title).join(' · ') + (overdueNow.length > 3 ? ` · +${overdueNow.length - 3}` : ''), 'Hiện tại');
  const doneLate = Number(await D.prepare("SELECT COUNT(*) n FROM nv_tasks WHERE user_id=? AND status='done' AND done_at>=? AND due_at IS NOT NULL AND done_at>due_at").bind(id, m0).first('n')) || 0;
  if (doneLate) bad('clock', `Hoàn thành trễ hạn ${doneLate} công việc`, 'Xong sau thời hạn được giao', 'Tháng này', 'warn');
  const slowAccept = Number(await D.prepare(
    `SELECT COUNT(*) n FROM nv_tasks WHERE user_id=? AND assigner_id IS NOT NULL AND created_at>=?
     AND (COALESCE(accepted_at, ?) - created_at) > COALESCE(accept_sla_min,120)*60`).bind(id, m0, t).first('n')) || 0;
  if (slowAccept) bad('inbox', `Nhận việc chậm quá SLA ${slowAccept} lần`, 'Xác nhận tiếp nhận việc được giao sau thời hạn SLA', 'Tháng này', 'warn');

  const cfg = await getConfig(env, id);
  const open = (await D.prepare("SELECT title,stage,last_activity_at,created_at FROM nv_deals WHERE owner_id=? AND status='open'").bind(id).all()).results || [];
  const cold = open.filter(d => (t - (d.last_activity_at || d.created_at)) / DAY > slaLimit(cfg, d.stage));
  if (cold.length) bad('thermometer', `${cold.length} deal đang quá SLA chăm sóc`, cold.slice(0, 3).map(d => d.title).join(' · ') + (cold.length > 3 ? ` · +${cold.length - 3}` : ''), 'Hiện tại', cold.length >= 3 ? 'bad' : 'warn');

  const pips = (await D.prepare("SELECT status,goal,start_at FROM nv_pip_records WHERE user_id=? AND (status='dang_chay' OR start_at>=?) ORDER BY start_at DESC").bind(id, y1).all()).results || [];
  for (const p of pips) {
    if (p.status === 'dang_chay') bad('target', 'Đang trong chương trình cải thiện hiệu suất (PIP)', p.goal || '', 'Hiện tại');
    else if (p.status === 'khong_dat') bad('target', 'PIP không đạt', p.goal || '', monthLabel(monthKeyOf(p.start_at || t)));
  }

  const suspends = (await D.prepare("SELECT meta,created_at FROM nv_audit_logs WHERE entity='user' AND entity_id=? AND action='suspend_user' AND created_at>=? ORDER BY created_at DESC").bind(id, y1).all()).results || [];
  for (const s of suspends) {
    let reason = '';
    try { reason = JSON.parse(s.meta || '{}').reason || ''; } catch (e) { /* meta cũ */ }
    bad('lock', 'Bị tạm dừng công việc', reason, monthLabel(monthKeyOf(s.created_at)));
  }

  return { achievements, violations, asOf: t };
}
