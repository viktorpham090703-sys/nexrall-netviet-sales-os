import { get } from '../api.js';
import { state, isLead, salesUsers } from '../state.js';
import { esc, money, vnd, mount, chip, bar, ring, empty, fmtDate, stat, pct } from '../ui.js';

let target = '';
let tab = 'score';

export async function render(el) {
  const uidQ = (isLead() && target) ? '?userId=' + target : '';

  const load = async () => {
    const [k, lb, pip] = await Promise.all([
      get('/kpi' + uidQ),
      get('/leaderboard'),
      get('/pip'),
    ]);
    return { ...k, leaderboard: lb.items || [], pips: pip.items || [] };
  };

  const draw = (d) => {
    const k = d.kpi, m = k.metrics;
    return `<div class="page-head">
      <div class="grow"><h2>KPI & Hoa hồng</h2><p>Thẻ điểm 100 điểm 2 tầng · kỳ ${esc(k.period)} · tính realtime từ hoạt động</p></div>
    </div>

    ${isLead() ? `<div class="seg mb">${[{ v: '', n: 'Tôi' }, ...salesUsers().map(u => ({ v: u.id, n: u.name }))]
      .map(o => `<button data-t="${esc(o.v)}" class="${target === o.v ? 'on' : ''}">${esc(o.n)}</button>`).join('')}</div>` : ''}

    <div class="card">
      <div class="row" style="gap:14px">
        ${ring(k.total, 100, k.grade)}
        <div class="grow">
          ${grp('Hiệu suất', k.performance, 55)}
          ${grp('Kỷ luật', k.discipline, 30)}
          ${grp('Chủ động', k.proactive, 15)}
        </div>
      </div>
      <div class="row mt"><div class="grow sm">Xếp loại: <b>${k.grade}</b> — ${esc(k.gradeNote)}</div>
        ${k.total < 60 ? chip('Nguy cơ PIP', 'red') : k.total >= 90 ? chip('Top performer', 'green') : ''}</div>
      ${d.managerNote ? `<div class="sm mut mt">📝 Nhận xét TP: ${esc(d.managerNote)}</div>` : ''}
    </div>

    <div class="seg mt mb">
      <button data-tab="score" class="${tab === 'score' ? 'on' : ''}">Chi tiết điểm</button>
      <button data-tab="comm" class="${tab === 'comm' ? 'on' : ''}">Hoa hồng</button>
      <button data-tab="rank" class="${tab === 'rank' ? 'on' : ''}">Bảng xếp hạng</button>
      <button data-tab="pip" class="${tab === 'pip' ? 'on' : ''}">PIP</button>
    </div>

    ${tab === 'score' ? `
      <div class="grid g3 mb">
        ${stat('Doanh thu kỳ', money(m.revenue), 'Mục tiêu ' + money(m.target_revenue) + ' · ' + pct(m.revenue, m.target_revenue) + '%', 'red')}
        ${stat('Deal chốt', m.wonN + '/' + m.target_deals, 'Pipeline KV ' + money(m.pipeline), 'blue')}
        ${stat('Liên hệ mới', m.newContacts, 'Định mức kỳ ' + m.quota_contacts_month, 'amber')}
      </div>
      <div class="card">${k.breakdown.map(g => `
        <div class="mb"><div class="badge-line"><b>${esc(g.group)}</b><span class="b">${g.score}/${g.max}</span></div>
        ${bar(g.score, g.max)}
        <div class="mt">${g.items.map(i => `<div class="badge-line sm mut"><span>• ${esc(i.label)}</span><span>${i.score}/${i.max}</span></div>`).join('')}</div></div>`).join('')}
        <div class="xs mut">Nguồn: ${m.activities} hoạt động · ${m.reports} báo cáo (${m.lateReports} trễ) · ${m.activeDays}/${m.workdays} ngày làm việc có hoạt động · ${m.overdueDeals}/${m.openDeals} deal quá SLA · ${m.trainingDone}/${m.trainingAll} bài đào tạo · ${m.aiUses} lượt dùng AI.</div>
      </div>` : ''}

    ${tab === 'comm' ? (d.commissions.length ? `<div class="card">${d.commissions.map(c => `<div class="item">
        <div class="dot-i">💰</div><div class="grow"><div class="t">${esc(c.deal_title || 'Hợp đồng')}</div>
        <div class="d">Doanh số ${money(c.base)} · tỷ lệ ${c.rate}% · ${fmtDate(c.created_at)}</div></div>
        <div class="right"><b>${vnd(c.amount)}</b><div>${chip(c.status === 'da_duyet' ? 'Đã duyệt' : 'Dự kiến', c.status === 'da_duyet' ? 'green' : 'amber')}</div></div>
      </div>`).join('')}
      <div class="row mt"><div class="grow b">Tổng hoa hồng kỳ</div><b style="color:#F59E0B">${vnd(d.commissions.reduce((s, c) => s + c.amount, 0))}</b></div>
      </div>` : empty('💰', 'Chưa có hoa hồng trong kỳ này.')) : ''}

    ${tab === 'rank' ? `<div class="card">${d.leaderboard.map((r, i) => `<div class="item">
        <div class="dot-i">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</div>
        <div class="grow"><div class="t">${esc(r.name)}${r.userId === state.me.id ? ' (bạn)' : ''}</div>
        <div class="d">DT ${money(r.revenue)} · ${r.wonN} deal · ${r.newContacts} liên hệ mới</div></div>
        <div class="right"><b>${r.total}</b> ${chip(r.grade, r.total >= 80 ? 'green' : r.total >= 60 ? 'amber' : 'red')}</div>
      </div>`).join('') || empty('🏆', 'Chưa có dữ liệu xếp hạng.')}</div>` : ''}

    ${tab === 'pip' ? (d.pips.length ? `<div class="card">${d.pips.map(p => `<div class="item">
        <div class="dot-i">📋</div><div class="grow"><div class="t">PIP ${esc(p.phase)} ngày${isLead() ? ' · ' + esc(p.user_name || '') : ''}</div>
        <div class="d">${esc(p.goal)}</div>
        <div class="d xs">${fmtDate(p.start_at)} → ${fmtDate(p.end_at)} · chỉ số: ${esc(p.metric || '—')}</div></div>
        ${chip(p.status === 'dat' ? 'Đạt' : p.status === 'khong_dat' ? 'Không đạt' : p.status === 'huy' ? 'Huỷ' : 'Đang chạy',
      p.status === 'dat' ? 'green' : p.status === 'khong_dat' ? 'red' : 'amber')}
      </div>`).join('')}</div>` : empty('📋', 'Không có bản ghi PIP nào. Giữ phong độ nhé!')) : ''}`;
  };

  const bind = () => {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { target = b.dataset.t; render(el); });
  };

  await mount(el, load, draw, bind);
}

const grp = (n, v, max) => `<div class="mb"><div class="badge-line"><span class="sm">${n}</span><span class="sm b">${v}/${max}</span></div>${bar(v, max)}</div>`;
