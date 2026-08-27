import { get, post } from '../api.js';
import { state, isLead } from '../state.js';
import { esc, money, mount, chip, empty, fmtDT, toast, stat, bindTabs } from '../ui.js';
import { actIcon, actName, CONTRACT_STATUS, APPROVAL_TONE } from '../const.js';
import { logActivity } from './crm.js';
import { quickContact } from './cockpit.js';
import { icon } from '../icons.js';
import { canDecideContract, bindApprovalActions } from './saleskit.js';

let tab = 'activities';
const isHR = () => state.me?.role === 'hr';

/* HCNS chỉ xét duyệt hợp đồng — không có nhiệm vụ nhật ký hoạt động/liên hệ mới/lịch nhắc của
 * phòng kinh doanh, nên trang "Duyệt Hợp đồng" của HCNS chỉ còn đúng 1 danh sách chờ duyệt. */
async function renderHR(el) {
  const load = async () => {
    const c = await get('/contracts');
    return { pending: (c.items || []).filter(x => ['pending_v1', 'pending_v2'].includes(x.status)) };
  };
  const draw = (d) => {
    const t = APPROVAL_TONE.contract;
    return `<div class="page-head">
      <div class="grow"><h2>Duyệt Hợp đồng</h2><p>Hợp đồng chờ duyệt 2 vòng</p></div>
    </div>
    <div class="grid g4 mb">${stat('Hợp đồng chờ duyệt', d.pending.length, 'Vòng 2 do HCNS phụ trách', t.chip)}</div>
    <div>${d.pending.length ? `<div class="card">${d.pending.map(c => `<div class="item">
        <div class="dot-i" style="background:transparent;color:${t.color};border:1.5px solid ${t.color}">${icon('penLine')}</div>
        <div class="grow"><div class="t">${esc(c.title)}</div>
          <div class="d">${esc(c.owner_name || '')}</div>
          <div class="d xs">Giá trị ${money(c.value)} · ${esc(CONTRACT_STATUS[c.status]?.n || c.status)}</div></div>
        <div class="right">${canDecideContract(c) ? `<button class="btn sm amber" data-ok-contract="${esc(c.id)}">Duyệt</button>
          <div class="mt"><button class="btn sm" data-revise-contract="${esc(c.id)}">Yêu cầu điều chỉnh</button></div>` : `<span class="xs" style="color:${t.color}">Chờ ${c.status === 'pending_v1' ? 'TPKD' : 'HCNS'} duyệt</span>`}</div>
      </div>`).join('')}</div>` : empty('circleCheck', 'Không có hợp đồng chờ duyệt.')}</div>`;
  };
  const bind = () => bindApprovalActions(el, 'contracts', () => render(el));
  await mount(el, load, draw, bind);
}

export async function render(el) {
  if (isHR()) return renderHR(el);

  const load = async () => {
    const [a, dc, t] = await Promise.all([get('/activities?days=14'), get('/daily-contacts'), get('/tasks')]);
    return { acts: a.items || [], stats: a.stats, contacts: dc.items || [], tasks: (t.items || []).filter(x => x.status !== 'done') };
  };

  const draw = (d) => {
    const byDay = {};
    d.acts.forEach(a => {
      const k = new Date(a.happened_at * 1000).toLocaleDateString('vi-VN');
      (byDay[k] = byDay[k] || []).push(a);
    });
    return `<div class="page-head">
      <div class="grow"><h2>Lịch & Hoạt động</h2><p>Nguồn dữ liệu duy nhất nuôi định mức · KPI · báo cáo</p></div>
      <button class="btn primary sm" data-log>+ Hoạt động</button>
    </div>

    <div class="grid g3 mb">
      ${stat('Hoạt động hôm nay', d.stats.today, '14 ngày: ' + d.stats.total, 'red')}
      ${stat('Liên hệ mới (14 ngày)', d.contacts.length, 'Tính vào định mức', 'amber')}
      ${stat('Việc chưa xong', d.tasks.length, 'Lịch nhắc tự động', 'blue')}
    </div>

    <div class="row mb" style="gap:8px">
      <button class="btn sm grow" data-sync>${icon('phone', 14)} Đồng bộ call log (mock)</button>
      <button class="btn sm grow amber" data-newcontact>+ Liên hệ mới</button>
    </div>

    <div class="seg mb">
      <button data-tab="activities" class="${tab === 'activities' ? 'on' : ''}">Nhật ký hoạt động</button>
      <button data-tab="contacts" class="${tab === 'contacts' ? 'on' : ''}">Liên hệ mới</button>
      <button data-tab="calendar" class="${tab === 'calendar' ? 'on' : ''}">Lịch & nhắc việc</button>
    </div>

    ${tab === 'activities' ? (Object.keys(byDay).length ? Object.entries(byDay).map(([day, arr]) => `
      <div class="sec-title">${esc(day)} · ${arr.length} hoạt động</div>
      <div class="card">${arr.map(a => `<div class="item">
        <div class="dot-i">${actIcon(a.type)}</div>
        <div class="grow"><div class="t">${esc(a.subject || actName(a.type))}</div>
          <div class="d">${esc(a.customer_name || '—')} · ${fmtDT(a.happened_at)}${isLead() ? ' · ' + esc(a.user_name || '') : ''}</div>
          ${a.note ? `<div class="d xs">${esc(a.note)}</div>` : ''}</div>
        ${a.outcome ? chip(a.outcome, a.outcome === 'Tích cực' ? 'green' : a.outcome === 'Từ chối' ? 'red' : 'grey') : ''}
      </div>`).join('')}</div>`).join('') : empty('clock', 'Chưa ghi nhận hoạt động nào.'))
      : tab === 'contacts' ? (d.contacts.length ? `<div class="card">${d.contacts.map(c => `<div class="item">
          <div class="dot-i">${icon('userPlus')}</div><div class="grow"><div class="t">${esc(c.name)}</div>
          <div class="d">${esc(c.company || '')} · ${esc(c.channel || '')} · ${fmtDT(c.created_at)}</div></div>
          ${isLead() ? chip(c.user_name || '', 'grey') : ''}</div>`).join('')}</div>` : empty('userPlus', 'Chưa có liên hệ mới.'))
      : (d.tasks.length ? `<div class="card">${d.tasks.map(t => `<div class="item">
          <div class="dot-i">${icon(t.due_at && t.due_at < Date.now() / 1000 ? 'alarmClock' : 'calendarDays')}</div>
          <div class="grow"><div class="t">${esc(t.title)}</div>
          <div class="d">Hạn ${fmtDT(t.due_at)}${t.assigner_name ? ' · giao bởi ' + esc(t.assigner_name) : ''}</div></div>
          <a class="btn sm" href="#/tasks">Mở</a></div>`).join('')}</div>` : empty('calendarDays', 'Không có lịch nhắc nào.'))}`;
  };

  const bind = () => {
    bindTabs(el, t => tab = t, render);
    el.querySelector('[data-log]').onclick = () => logActivity({}, () => render(el));
    el.querySelector('[data-newcontact]').onclick = () => quickContact(() => render(el));
    el.querySelector('[data-sync]').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await post('/activities/sync-calls', {});
        toast('Đã đồng bộ ' + (r.imported || 0) + ' cuộc gọi từ tổng đài (mock)', 'ok');
        render(el);
      } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
    };
  };

  await mount(el, load, draw, bind);
}
