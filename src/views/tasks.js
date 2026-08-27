import { get, post, patch } from '../api.js';
import { isLead, assigneeField } from '../state.js';
import { esc, mount, chip, empty, fmtDT, toast, modal, stat } from '../ui.js';
import { PRIO, TASK_STATUS } from '../const.js';
import { icon } from '../icons.js';

export async function render(el) {
  const load = async () => {
    const [t, d] = await Promise.all([get('/tasks'), get('/deals')]);
    return { items: t.items || [], deals: d.items || [] };
  };

  const draw = (d) => {
    const open = d.items.filter(x => x.status !== 'done');
    const assigned = open.filter(x => x.assigner_id);
    const late = open.filter(x => x.overdue || x.acceptOverdue);
    return `<div class="page-head">
      <div class="grow"><h2>${isLead() ? 'Giao việc & Phân bổ' : 'Việc của tôi'}</h2>
        <p>${isLead() ? 'Giao lead/deal/việc con xuống sale · SLA nhận việc · leo thang khi quá hạn' : 'Việc tự tạo và việc lãnh đạo giao · xác nhận nhận việc trong SLA'}</p></div>
      <button class="btn primary sm" data-add>+ ${isLead() ? 'Giao việc' : 'Thêm việc'}</button>
    </div>

    <div class="grid g3 mb">
      ${stat('Đang mở', open.length, '', 'blue')}
      ${stat('Việc được giao', assigned.length, 'Chưa nhận: ' + assigned.filter(x => !x.accepted_at).length, 'amber')}
      ${stat('Quá hạn / leo thang', late.length, late.length ? 'Cần xử lý' : 'Ổn định', late.length ? 'red' : '')}
    </div>

    ${open.length ? `<div class="card">${open.map(t => row(t)).join('')}</div>` : empty('circleCheck', 'Không còn việc tồn.')}

    <div class="sec-title">Đã hoàn thành</div>
    <div class="card">${d.items.filter(x => x.status === 'done').slice(0, 10).map(t => `<div class="item">
      <div class="dot-i">${icon('circleCheck')}</div><div class="grow"><div class="t">${esc(t.title)}</div>
      <div class="d">Hoàn thành ${fmtDT(t.done_at)}${isLead() ? ' · ' + esc(t.user_name || '') : ''}</div></div></div>`).join('') || empty('circleCheck', 'Chưa có việc hoàn thành.')}</div>`;
  };

  const row = (t) => `<div class="item">
    <div class="dot-i">${icon(t.assigner_id ? 'inbox' : 'notepadText')}</div>
    <div class="grow"><div class="t">${esc(t.title)}</div>
      <div class="d">${t.deal_title ? icon('target', 12) + ' ' + esc(t.deal_title) + ' · ' : ''}Hạn ${fmtDT(t.due_at)}${t.assigner_name ? ' · giao bởi ' + esc(t.assigner_name) : ''}${isLead() && t.user_name ? ' → ' + esc(t.user_name) : ''}</div>
      ${t.detail ? `<div class="d xs">${esc(t.detail)}</div>` : ''}
      <div class="row wrap mt" style="gap:6px">
        ${chip(PRIO[t.priority]?.n || t.priority, PRIO[t.priority]?.c)}
        ${chip(TASK_STATUS[t.status]?.n || t.status, TASK_STATUS[t.status]?.c)}
        ${t.assigner_id && !t.accepted_at ? chip(t.acceptOverdue ? 'Quá SLA nhận việc' : 'Chờ nhận việc', t.acceptOverdue ? 'red' : 'amber') : ''}
        ${t.overdue ? chip('Quá hạn', 'red') : ''}
      </div>
    </div>
    <div class="right">
      ${t.assigner_id && !t.accepted_at ? `<button class="btn sm amber" data-accept="${esc(t.id)}">Nhận</button>` : ''}
      <div class="mt"><button class="btn sm" data-done="${esc(t.id)}">Xong</button></div>
    </div></div>`;

  const bind = (d) => {
    el.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
      try { await patch('/tasks/' + b.dataset.accept, { accept: true, status: 'in_progress' }); toast('Đã xác nhận nhận việc', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
      try { await patch('/tasks/' + b.dataset.done, { status: 'done' }); toast('Đã hoàn thành', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
    el.querySelector('[data-add]').onclick = () => modal({
      title: isLead() ? 'Giao việc cho sale' : 'Thêm việc',
      fields: [
        { name: 'title', label: 'Tên công việc', required: true },
        { name: 'detail', label: 'Mô tả / yêu cầu', type: 'textarea', rows: 2 },
        ...(isLead() ? [assigneeField('userId')] : []),
        { name: 'dealId', label: 'Gắn với deal', type: 'select', options: [{ v: '', n: '— không —' }, ...d.deals.map(x => ({ v: x.id, n: x.title }))] },
        { name: 'priority', label: 'Ưu tiên', type: 'select', options: [{ v: 'high', n: 'Cao' }, { v: 'medium', n: 'Vừa' }, { v: 'low', n: 'Thấp' }] },
        { name: 'dueDate', label: 'Hạn hoàn thành', type: 'date' },
        ...(isLead() ? [{ name: 'acceptSlaMin', label: 'SLA nhận việc (phút)', type: 'number', value: 120 }] : []),
      ],
      onSubmit: async (v) => {
        const dueAt = v.dueDate ? Math.floor(new Date(v.dueDate + 'T17:00:00').getTime() / 1000) : undefined;
        await post('/tasks', { ...v, dueAt });
        toast(isLead() ? 'Đã giao việc & gửi thông báo' : 'Đã thêm việc', 'ok');
        render(el);
      },
    });
  };

  await mount(el, load, draw, bind);
}
