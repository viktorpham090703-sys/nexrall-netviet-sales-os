import { get } from '../api.js';
import { state, isLead, salesUsers } from '../state.js';
import { esc, money, vnd, mount, chip, bar, ring, empty, fmtDate, stat, pct, bindTabs } from '../ui.js';
import { PIP_STATUS, gradeTone } from '../const.js';
import { icon } from '../icons.js';
import { t as tr, personName } from '../i18n.js';

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
      <div class="grow"><h2>${tr('KPI & Hoa hồng')}</h2><p>${tr('Thẻ điểm 100 điểm 2 tầng')} · ${tr('kỳ')} ${esc(k.period)} · ${tr('tính realtime từ hoạt động')}</p></div>
    </div>

    ${isLead() ? `<div class="seg mb">${[{ v: '', n: tr('Tôi') }, ...salesUsers().map(u => ({ v: u.id, n: personName(u.name) }))]
      .map(o => `<button data-t="${esc(o.v)}" class="${target === o.v ? 'on' : ''}">${esc(o.n)}</button>`).join('')}</div>` : ''}

    <div class="card">
      <div class="row" style="gap:14px">
        ${ring(k.total, 100, tr(k.grade))}
        <div class="grow">
          ${grp(tr('Hiệu suất'), k.performance, 55)}
          ${grp(tr('Kỷ luật'), k.discipline, 30)}
          ${grp(tr('Chủ động'), k.proactive, 15)}
        </div>
      </div>
      <div class="row mt"><div class="grow sm">${tr('Xếp loại:')} <b>${tr(k.grade)}</b> — ${esc(k.gradeNote)}</div>
        ${k.grade === 'Kém' ? chip('Nguy cơ PIP', 'red') : k.grade === 'Xuất sắc' ? chip('Top performer', 'green') : ''}</div>
      ${d.managerNote ? `<div class="sm mut mt">${icon('notepadText', 14)} ${tr('Nhận xét TP:')} ${esc(d.managerNote)}</div>` : ''}
    </div>

    <div class="seg mt mb">
      <button data-tab="score" class="${tab === 'score' ? 'on' : ''}">${tr('Chi tiết điểm')}</button>
      <button data-tab="comm" class="${tab === 'comm' ? 'on' : ''}">${tr('Hoa hồng')}</button>
      <button data-tab="rank" class="${tab === 'rank' ? 'on' : ''}">${tr('Bảng xếp hạng')}</button>
      <button data-tab="pip" class="${tab === 'pip' ? 'on' : ''}">PIP</button>
    </div>

    ${tab === 'score' ? `
      <div class="grid g3 mb">
        ${stat('Doanh thu kỳ', money(m.revenue), tr('Mục tiêu') + ' ' + money(m.target_revenue) + ' · ' + pct(m.revenue, m.target_revenue) + '%', 'red')}
        ${stat('Deal chốt', m.wonN + '/' + m.target_deals, tr('Pipeline KV') + ' ' + money(m.pipeline), 'blue')}
        ${stat('Liên hệ mới', m.newContacts, tr('Định mức kỳ') + ' ' + m.quota_contacts_month, 'amber')}
      </div>
      <div class="card">${k.breakdown.map(g => `
        <div class="mb"><div class="badge-line"><b>${esc(tr(g.group))}</b><span class="b">${g.score}/${g.max}</span></div>
        ${bar(g.score, g.max)}
        <div class="mt">${g.items.map(i => `<div class="badge-line sm mut"><span>• ${esc(tr(i.label))}</span><span>${i.score}/${i.max}</span></div>`).join('')}</div></div>`).join('')}
        <div class="xs mut">${tr('Nguồn:')} ${m.activities} ${tr('hoạt động')} · ${m.reports} ${tr('báo cáo')} (${m.lateReports} ${tr('trễ')}) · ${m.activeDays}/${m.workdays} ${tr('ngày làm việc có hoạt động')} · ${m.overdueDeals}/${m.openDeals} ${tr('deal quá SLA')} · ${m.trainingDone}/${m.trainingAll} ${tr('bài đào tạo')} · ${m.aiUses} ${tr('lượt dùng AI.')}</div>
      </div>` : ''}

    ${tab === 'comm' ? (d.commissions.length ? `<div class="card">${d.commissions.map(c => `<div class="item">
        <div class="dot-i">${icon('banknote')}</div><div class="grow"><div class="t">${esc(c.deal_title || tr('Hợp đồng'))}</div>
        <div class="d">${tr('Doanh số')} ${money(c.base)} · ${tr('tỷ lệ')} ${c.rate}% · ${fmtDate(c.created_at)}</div></div>
        <div class="right"><b>${vnd(c.amount)}</b><div>${chip(c.status === 'da_duyet' ? 'Đã duyệt' : 'Dự kiến', c.status === 'da_duyet' ? 'green' : 'amber')}</div></div>
      </div>`).join('')}
      <div class="row mt"><div class="grow b">${tr('Tổng hoa hồng kỳ')}</div><b style="color:#F59E0B">${vnd(d.commissions.reduce((s, c) => s + c.amount, 0))}</b></div>
      </div>` : empty('banknote', 'Chưa có hoa hồng trong kỳ này.')) : ''}

    ${tab === 'rank' ? `<div class="card">${d.leaderboard.map((r, i) => `<div class="item">
        <div class="dot-i" style="color:${i === 0 ? '#F59E0B' : i === 1 ? '#9CA3AF' : i === 2 ? '#B45309' : 'inherit'}">${i <= 2 ? icon(i === 0 ? 'trophy' : 'medal') : (i + 1)}</div>
        <div class="grow"><div class="t">${esc(personName(r.name))}${r.userId === state.me.id ? ' ' + tr('(bạn)') : ''}</div>
        <div class="d">${tr('DT')} ${money(r.revenue)} · ${r.wonN} deal · ${r.newContacts} ${tr('liên hệ mới')}</div></div>
        <div class="right"><b>${r.total}</b> ${chip(r.grade, gradeTone(r.total))}</div>
      </div>`).join('') || empty('trophy', 'Chưa có dữ liệu xếp hạng.')}</div>` : ''}

    ${tab === 'pip' ? (d.pips.length ? `<div class="card">${d.pips.map(p => `<div class="item">
        <div class="dot-i">${icon('clipboardList')}</div><div class="grow"><div class="t">PIP ${esc(p.phase)} ${tr('ngày')}${isLead() ? ' · ' + esc(p.user_name || '') : ''}</div>
        <div class="d">${esc(p.goal)}</div>
        <div class="d xs">${fmtDate(p.start_at)} → ${fmtDate(p.end_at)} · ${tr('chỉ số:')} ${esc(p.metric || '—')}</div></div>
        ${chip(PIP_STATUS[p.status]?.n, PIP_STATUS[p.status]?.c)}
      </div>`).join('')}</div>` : empty('clipboardList', 'Không có bản ghi PIP nào. Giữ phong độ nhé!')) : ''}`;
  };

  const bind = () => {
    bindTabs(el, t => tab = t, render);
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { target = b.dataset.t; render(el); });
  };

  await mount(el, load, draw, bind);
}

const grp = (n, v, max) => `<div class="mb"><div class="badge-line"><span class="sm">${n}</span><span class="sm b">${v}/${max}</span></div>${bar(v, max)}</div>`;
