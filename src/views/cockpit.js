import { get, post, patch } from '../api.js';
import { state } from '../state.js';
import { esc, money, mount, ring, bar, chip, stat, empty, rel, fmtDT, toast, modal, pct, counterSpan } from '../ui.js';
import { stageName, PRIO, CHANNELS } from '../const.js';
import { icon, dot } from '../icons.js';
// Bí danh `tr` vì `t` đã dùng làm tên biến vòng lặp/tham số (task, target %) rải rác trong file này
// và nhiều view khác — trùng tên với hàm dịch t() của i18n.js sẽ gây lỗi "t is not a function".
// Lời chào, câu nhắc, thông báo do server sinh sẵn bằng tiếng Việt: src/autoTranslate.js dịch sau khi vẽ.
import { t as tr, personName } from '../i18n.js';
import { personalCharts } from '../dash.js';

export async function render(el) {
  // Biểu đồ KPI tới ngày, doanh thu lũy kế, hoạt động 14 ngày, cơ hội theo giai đoạn — chỉ số liệu
  // của CHÍNH người xem (TP/Admin xem màn này là trang chủ cá nhân, không phải của cả đội).
  const load = async () => {
    const [c, k, dl, ac] = await Promise.all([
      get('/cockpit'), get('/kpi').catch(() => null),
      get('/deals').catch(() => ({ items: [] })), get('/activities?days=14').catch(() => ({ items: [] })),
    ]);
    c._kpi = k && k.kpi;
    c._deals = (dl.items || []).filter(x => x.owner_id === state.me.id);
    c._acts = (ac.items || []).filter(x => x.user_id === state.me.id);
    return c;
  };
  const draw = (d) => `
    <div class="page-head">
      <div class="grow">
        <h2><span>${esc(d.greeting)}</span>, ${esc(personName(state.me.name || '').split(' ').slice(-1)[0])}</h2>
        <p>${tr('Tóm tắt đầu ngày')} ${esc(d.today)} · ${d.openDeals} ${tr('deal đang mở')} · ${tr('pipeline kỳ vọng')} <b>${money(d.pipeline)}</b></p>
      </div>
      <button class="btn amber sm glow-pulse" data-quick>+ ${tr('Liên hệ mới')}</button>
    </div>

    ${personalCharts({ metrics: d._kpi && d._kpi.metrics, deals: d._deals, acts: d._acts })}

    <div class="card fade-in">
      <div class="row" style="gap:14px">
        ${ring(d.quota.contacts.done, d.quota.contacts.target, tr('liên hệ mới'))}
        <div class="grow">
          ${qline(tr('Cuộc gọi'), d.quota.calls.done, d.quota.calls.target)}
          ${qline(tr('Gặp/Demo'), d.quota.meetings.done, d.quota.meetings.target)}
          ${qline(tr('Hoạt động ghi nhận'), d.activitiesToday, Math.max(d.activitiesToday, 10))}
        </div>
      </div>
      <div class="row mt sm mut">${icon('pin', 14)} ${tr('Định mức realtime — mọi hoạt động ghi 1 lần, tự tính vào KPI & báo cáo.')}</div>
    </div>

    <div class="grid g3 mt">
      ${stat('KPI tháng', counterSpan(d.kpi.total) + '<span class="sm mut">/100</span>', tr('Xếp loại') + ' ' + tr(d.kpi.grade), 'red')}
      ${stat('Deal quá SLA', counterSpan(d.riskyCount), d.riskyCount ? tr('Cần chăm ngay') : tr('Sạch SLA'), d.riskyCount ? 'amber' : '')}
      ${stat('Việc hôm nay', counterSpan(d.taskCount), d.reportSubmitted ? tr('Đã nộp EOD') : tr('Chưa nộp EOD'), 'blue')}
    </div>

    <div class="sec-title">${tr('Cảnh báo quan trọng')}</div>
    <div class="card fade-in">${d.reminders.map(r => `<div class="item">
      <div class="dot-i">${icon(r.level === 'danger' ? 'siren' : r.level === 'warn' ? 'triangleAlert' : r.level === 'ok' ? 'circleCheck' : 'info')}</div>
      <div class="grow"><div class="t">${esc(r.text)}</div></div>
      <a class="btn sm" href="${esc(r.link)}">${tr('Xử lý')}</a></div>`).join('')}</div>

    <div class="sec-title">${tr('Việc ưu tiên hôm nay')}</div>
    <div class="card fade-in">${d.tasks.length ? d.tasks.map(t => `<div class="item">
        <div class="dot-i">${icon(t.assigner_id ? 'inbox' : 'notepadText')}</div>
        <div class="grow"><div class="t">${esc(t.title)}</div>
          <div class="d">${t.assigner_name ? tr('TP giao:') + ' ' + esc(t.assigner_name) + ' · ' : ''}${t.due_at ? tr('Hạn') + ' ' + fmtDT(t.due_at) : ''}</div></div>
        ${chip(PRIO[t.priority]?.n || t.priority, PRIO[t.priority]?.c)}
        <button class="btn sm" data-done="${esc(t.id)}">${tr('Xong')}</button>
      </div>`).join('') : empty('target', 'Không còn việc tồn — chủ động tìm khách mới!')}</div>

    <div class="sec-title">${tr('Deal cần chăm gấp (SLA)')}</div>
    <div class="card fade-in">${d.risky.length ? d.risky.map(x => `<div class="item">
        <div class="dot-i">${icon('flame')}</div>
        <div class="grow"><div class="t">${esc(x.title)}</div>
          <div class="d">${esc(x.customer_name || '')} · ${stageName(x.stage)} · ${money(x.value)}</div></div>
        <div class="right">${chip(x.idleDays + ' ' + tr('ngày nguội'), 'red')}
        <div class="mt"><a class="btn sm" href="#/pipeline">${tr('Mở')}</a></div></div>
      </div>`).join('') : empty('circleCheck', 'Không có deal nào vượt SLA.')}</div>

    <div class="sec-title">${tr('Thông báo cá nhân')}</div>
    <div class="card fade-in">${d.notifications.length ? d.notifications.map(n => `<div class="item">
        <div class="dot-i">${dot(n.level === 'danger' ? '#DC2626' : n.level === 'warn' ? '#F59E0B' : '#2563EB')}</div>
        <div class="grow"><div class="t">${esc(n.title)}</div><div class="d">${esc(n.body || '')} · ${rel(n.created_at)}</div></div>
        ${n.link ? `<a class="btn sm" href="${esc(n.link)}">${tr('Xem')}</a>` : ''}
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
