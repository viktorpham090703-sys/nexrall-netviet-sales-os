import { get, post, patch } from '../api.js';
import { state } from '../state.js';
import { esc, money, mount, ring, bar, chip, stat, empty, rel, fmtDT, toast, modal, pct, counterSpan } from '../ui.js';
import { stageName, PRIO, CHANNELS } from '../const.js';
import { icon, dot } from '../icons.js';

export async function render(el) {
  const load = () => get('/cockpit');
  const draw = (d) => `
    <div class="page-head">
      <div class="grow">
        <h2>${esc(d.greeting)}, ${esc((state.me.name || '').split(' ').slice(-1)[0])}</h2>
        <p>Tóm tắt đầu ngày ${esc(d.today)} · ${d.openDeals} deal đang mở · pipeline kỳ vọng <b>${money(d.pipeline)}</b></p>
      </div>
      <button class="btn amber sm glow-pulse" data-quick>+ Liên hệ mới</button>
    </div>

    <div class="card fade-in">
      <div class="row" style="gap:14px">
        ${ring(d.quota.contacts.done, d.quota.contacts.target, 'liên hệ mới')}
        <div class="grow">
          ${qline('Cuộc gọi', d.quota.calls.done, d.quota.calls.target)}
          ${qline('Gặp/Demo', d.quota.meetings.done, d.quota.meetings.target)}
          ${qline('Hoạt động ghi nhận', d.activitiesToday, Math.max(d.activitiesToday, 10))}
        </div>
      </div>
      <div class="row mt sm mut">${icon('pin', 14)} Định mức realtime — mọi hoạt động ghi 1 lần, tự tính vào KPI & báo cáo.</div>
    </div>

    <div class="grid g3 mt">
      ${stat('KPI tháng', counterSpan(d.kpi.total) + '<span class="sm mut">/100</span>', 'Xếp loại ' + d.kpi.grade, 'red')}
      ${stat('Deal quá SLA', counterSpan(d.riskyCount), d.riskyCount ? 'Cần chăm ngay' : 'Sạch SLA', d.riskyCount ? 'amber' : '')}
      ${stat('Việc hôm nay', counterSpan(d.taskCount), d.reportSubmitted ? 'Đã nộp EOD' : 'Chưa nộp EOD', 'blue')}
    </div>

    <div class="sec-title">Nhắc thông minh</div>
    <div class="card fade-in">${d.reminders.map(r => `<div class="item">
      <div class="dot-i">${icon(r.level === 'danger' ? 'siren' : r.level === 'warn' ? 'triangleAlert' : r.level === 'ok' ? 'circleCheck' : 'info')}</div>
      <div class="grow"><div class="t">${esc(r.text)}</div></div>
      <a class="btn sm" href="${esc(r.link)}">Xử lý</a></div>`).join('')}</div>

    <div class="sec-title">Việc ưu tiên hôm nay</div>
    <div class="card fade-in">${d.tasks.length ? d.tasks.map(t => `<div class="item">
        <div class="dot-i">${icon(t.assigner_id ? 'inbox' : 'notepadText')}</div>
        <div class="grow"><div class="t">${esc(t.title)}</div>
          <div class="d">${t.assigner_name ? 'TP giao: ' + esc(t.assigner_name) + ' · ' : ''}${t.due_at ? 'Hạn ' + fmtDT(t.due_at) : ''}</div></div>
        ${chip(PRIO[t.priority]?.n || t.priority, PRIO[t.priority]?.c)}
        <button class="btn sm" data-done="${esc(t.id)}">Xong</button>
      </div>`).join('') : empty('target', 'Không còn việc tồn — chủ động tìm khách mới!')}</div>

    <div class="sec-title">Deal cần chăm gấp (SLA)</div>
    <div class="card fade-in">${d.risky.length ? d.risky.map(x => `<div class="item">
        <div class="dot-i">${icon('flame')}</div>
        <div class="grow"><div class="t">${esc(x.title)}</div>
          <div class="d">${esc(x.customer_name || '')} · ${stageName(x.stage)} · ${money(x.value)}</div></div>
        <div class="right">${chip(x.idleDays + ' ngày nguội', 'red')}
        <div class="mt"><a class="btn sm" href="#/pipeline">Mở</a></div></div>
      </div>`).join('') : empty('circleCheck', 'Không có deal nào vượt SLA.')}</div>

    <div class="sec-title">Thông báo gần đây</div>
    <div class="card fade-in">${d.notifications.length ? d.notifications.map(n => `<div class="item">
        <div class="dot-i">${dot(n.level === 'danger' ? '#DC2626' : n.level === 'warn' ? '#F59E0B' : '#2563EB')}</div>
        <div class="grow"><div class="t">${esc(n.title)}</div><div class="d">${esc(n.body || '')} · ${rel(n.created_at)}</div></div>
        ${n.link ? `<a class="btn sm" href="${esc(n.link)}">Xem</a>` : ''}
      </div>`).join('') : empty('bell', 'Chưa có thông báo.')}</div>`;

  const bind = () => {
    el.querySelector('[data-quick]').onclick = () => quickContact(() => render(el));
    el.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        await patch('/tasks/' + b.dataset.done, { status: 'done' });
        toast('Đã hoàn thành công việc', 'ok');
        render(el);
      } catch (e) { toast(e.message, 'err'); b.disabled = false; }
    });
  };
  await mount(el, load, draw, bind);
}

const qline = (label, v, t) => `<div class="mb"><div class="badge-line"><span class="sm">${esc(label)}</span>
  <span class="sm b">${v}/${t} · ${pct(v, t)}%</span></div>${bar(v, t, v >= t ? 'green' : '')}</div>`;

export function quickContact(after) {
  modal({
    title: 'Ghi nhận liên hệ mới trong ngày',
    fields: [
      { name: 'name', label: 'Tên người liên hệ', required: true, placeholder: 'VD: Chị Lan – Marketing' },
      { name: 'company', label: 'Công ty' },
      { name: 'channel', label: 'Kênh tiếp cận', type: 'select', options: CHANNELS },
      { name: 'phone', label: 'Số điện thoại' },
      { name: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
    ],
    submitText: 'Ghi nhận (+1 định mức)',
    onSubmit: async (v) => {
      await post('/daily-contacts', v);
      toast('Đã +1 liên hệ mới vào định mức hôm nay', 'ok');
      if (after) after();
    },
  });
}
