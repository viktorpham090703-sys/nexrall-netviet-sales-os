import { get, post, patch, del, downloadFile, fileToBase64, mimeOf } from '../api.js';
import { state, isLead, assigneeField, salesTeamUsers } from '../state.js';
import { esc, mount, chip, empty, fmtDT, toast, modal, stat } from '../ui.js';
import { TASK_STATUS } from '../const.js';
import { icon } from '../icons.js';
import { t as tr } from '../i18n.js';

/* Công việc: giao việc, nhận việc, hoàn thành, hạn nhận việc (SLA) và thông báo hai chiều — cùng
 * phân loại MỨC ĐỘ (Gấp · Quan trọng · Bình thường · Quá hạn · Tạm dừng · Kế hoạch) và LOẠI VIỆC
 * (Được giao · Đề xuất · CV thường), tài liệu / đường dẫn đính kèm. Mức độ "Quá hạn" không lưu mà
 * tính từ hạn (server trả `overdue`), để đổi hạn là nhãn tự đúng. */
const LEVELS = {
  gap: ['Gấp', 'red'], quan_trong: ['Quan trọng', 'amber'], binh_thuong: ['Bình thường', 'grey'],
  qua_han: ['Quá hạn', 'red'], tam_dung: ['Tạm dừng', 'violet'], ke_hoach: ['Kế hoạch', 'blue'],
};
const SOURCES = { duoc_giao: ['Được giao', 'navy'], de_xuat: ['Đề xuất', 'violet'], cv_thuong: ['CV thường', 'grey'] };
const PRIO_LEVEL = { high: 'gap', medium: 'quan_trong', low: 'binh_thuong' };
/** Mức độ hiển thị: Tạm dừng thắng mọi thứ, rồi tới Quá hạn (tính từ hạn), rồi mức người dùng chọn;
 * việc cũ chưa có mức độ thì suy từ độ ưu tiên. */
function levelOf(t) {
  if (t.level === 'tam_dung') return 'tam_dung';
  if (t.status !== 'done' && t.overdue) return 'qua_han';
  return t.level || PRIO_LEVEL[t.priority] || 'binh_thuong';
}
const sourceOf = (t) => t.source || (t.assigner_id ? 'duoc_giao' : 'cv_thuong');
const attCount = (t) => (t.file_count || 0) + (t.links || []).length;

let fLevel = 'all', fSource = 'all';

export async function render(el) {
  const load = async () => {
    const [t, d] = await Promise.all([get('/tasks'), get('/deals')]);
    return { items: t.items || [], deals: d.items || [] };
  };

  const draw = (d) => {
    const open = d.items.filter(x => x.status !== 'done');
    const assigned = open.filter(x => x.assigner_id);
    const late = open.filter(x => x.overdue || x.acceptOverdue);
    const list = open.filter(x => (fLevel === 'all' || levelOf(x) === fLevel) && (fSource === 'all' || sourceOf(x) === fSource));
    const cnt = (fn, k) => open.filter(x => fn(x) === k).length;
    const pills = (cur, map, fn, attr) => `<button type="button" data-${attr}="all" class="${cur === 'all' ? 'on' : ''}">${tr('Tất cả')} <span class="nt-count">${open.length}</span></button>`
      + Object.entries(map).map(([k, [n]]) => `<button type="button" data-${attr}="${k}" class="${cur === k ? 'on' : ''}">${n} <span class="nt-count">${cnt(fn, k)}</span></button>`).join('');
    return `<div class="page-head">
      <div class="grow"><h2>${isLead() ? tr('Giao việc & Phân bổ') : tr('Việc của tôi')}</h2>
        <p>${isLead() ? tr('Giao lead/deal/việc con xuống sale · SLA nhận việc · leo thang khi quá hạn') : tr('Việc tự tạo, việc được giao và việc đề xuất · xác nhận nhận việc trong SLA')}</p></div>
      <button class="btn primary sm" data-add>+ ${isLead() ? tr('Giao việc') : tr('Thêm việc')}</button>
    </div>

    <div class="grid g3 mb">
      ${stat('Đang mở', open.length, '', 'blue')}
      ${stat('Việc được giao', assigned.length, tr('Chưa nhận:') + ' ' + assigned.filter(x => !x.accepted_at).length, 'amber')}
      ${stat('Quá hạn / leo thang', late.length, late.length ? tr('Cần xử lý') : tr('Ổn định'), late.length ? 'red' : '')}
    </div>

    <div class="card mb tk-filters">
      <div class="tk-frow"><span class="tk-lbl">${tr('Mức độ')}</span><div class="seg">${pills(fLevel, LEVELS, levelOf, 'lv')}</div></div>
      <div class="tk-frow"><span class="tk-lbl">${tr('Loại việc')}</span><div class="seg">${pills(fSource, SOURCES, sourceOf, 'src')}</div></div>
    </div>

    ${list.length ? `<div class="tbl-wrap tk-tbl"><table><thead><tr>
        <th>${tr('Công việc')}</th><th>${tr('Mức độ')}</th><th>${tr('Loại')}</th><th>${tr('Hạn')}</th><th>${isLead() ? tr('Người nhận') : tr('Người giao')}</th><th class="c">${tr('Tài liệu')}</th><th></th></tr></thead><tbody>
      ${list.map(row).join('')}</tbody></table></div>`
      : empty('circleCheck', fLevel === 'all' && fSource === 'all' ? 'Không còn việc tồn.' : 'Không có việc nào khớp bộ lọc.')}

    <div class="sec-title">${tr('Đã hoàn thành')}</div>
    <div class="card">${d.items.filter(x => x.status === 'done').slice(0, 10).map(t => `<div class="item">
      <div class="dot-i">${icon('circleCheck')}</div><div class="grow"><div class="t">${esc(t.title)}</div>
      <div class="d">${tr('Hoàn thành')} ${fmtDT(t.done_at)}${isLead() ? ' · ' + esc(t.user_name || '') : ''}</div></div></div>`).join('') || empty('circleCheck', 'Chưa có việc hoàn thành.')}</div>`;
  };

  const row = (t) => {
    const lv = LEVELS[levelOf(t)], sc = SOURCES[sourceOf(t)], n = attCount(t);
    return `<tr class="tk-row" data-open="${esc(t.id)}">
      <td><div class="t b">${esc(t.title)}</div>
        <div class="xs mut">${t.deal_title ? icon('target', 11) + ' ' + esc(t.deal_title) + ' · ' : ''}${chip(TASK_STATUS[t.status]?.n || t.status, TASK_STATUS[t.status]?.c)}
        ${t.assigner_id && !t.accepted_at ? chip(t.acceptOverdue ? 'Quá SLA nhận việc' : 'Chờ nhận việc', t.acceptOverdue ? 'red' : 'amber') : ''}</div></td>
      <td>${chip(lv[0], lv[1])}</td>
      <td>${chip(sc[0], sc[1])}</td>
      <td class="nowrap ${t.overdue ? 'tk-late' : ''}">${fmtDT(t.due_at)}</td>
      <td class="sm">${esc(isLead() ? (t.user_name || '—') : (t.assigner_name || tr('Tự tạo')))}</td>
      <td class="c">${n ? `<span class="tk-att">${icon('paperclip', 13)} ${n}</span>` : '<span class="mut">—</span>'}</td>
      <td class="nowrap tk-act">
        ${t.assigner_id && !t.accepted_at && t.user_id === state.me?.id ? `<button class="btn sm amber" data-accept="${esc(t.id)}">${tr('Nhận')}</button>` : ''}
        <button class="btn sm" data-done="${esc(t.id)}">${tr('Xong')}</button></td></tr>`;
  };

  const bind = (d) => {
    el.querySelectorAll('[data-accept]').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      try { await patch('/tasks/' + b.dataset.accept, { accept: true, status: 'in_progress' }); toast('Đã xác nhận nhận việc', 'ok'); render(el); }
      catch (err) { toast(err.message, 'err'); }
    });
    el.querySelectorAll('[data-done]').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      try { await patch('/tasks/' + b.dataset.done, { status: 'done' }); toast('Đã hoàn thành', 'ok'); render(el); }
      catch (err) { toast(err.message, 'err'); }
    });
    el.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { fLevel = b.dataset.lv; render(el); });
    el.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { fSource = b.dataset.src; render(el); });
    el.querySelectorAll('[data-open]').forEach(r => r.onclick = () => detail(d.items.find(x => x.id === r.dataset.open), () => render(el)));
    el.querySelector('[data-add]').onclick = () => taskModal(d.deals, () => render(el));
  };

  await mount(el, load, draw, bind);
}

/* Chi tiết việc: đổi mức độ / loại, tạm dừng, tài liệu & đường dẫn đi kèm. */
async function detail(t, after) {
  if (!t) return;
  let files = [];
  try { files = (await get(`/tasks/${t.id}/files`)).items || []; } catch (e) { toast(e.message, 'err'); }
  const links = t.links || [];
  const lvOpts = Object.entries(LEVELS).filter(([k]) => k !== 'qua_han').map(([v, [n]]) => ({ v, n }));
  const srcOpts = t.assigner_id ? [{ v: 'duoc_giao', n: SOURCES.duoc_giao[0] }] : [{ v: 'cv_thuong', n: SOURCES.cv_thuong[0] }, { v: 'de_xuat', n: SOURCES.de_xuat[0] }];
  const { root, close } = modal({
    title: t.title,
    wide: true,
    html: `<div class="sm mut mb">${t.assigner_name ? tr('Giao bởi') + ' ' + esc(t.assigner_name) + ' · ' : ''}${isLead() && t.user_name ? tr('Người nhận:') + ' ' + esc(t.user_name) + ' · ' : ''}${tr('Hạn')} ${fmtDT(t.due_at)}${t.overdue ? ` · <b style="color:var(--danger)">${tr('đang quá hạn')}</b>` : ''}</div>
      ${t.detail ? `<div class="card mb sm">${esc(t.detail)}</div>` : ''}
      <div class="sec-title" style="margin-top:4px">${tr('Tài liệu & liên kết đi kèm')}</div>
      <div class="tk-files">
        ${files.map(f => `<div class="tk-file"><span class="tk-ext">${esc((f.filename.split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</span>
          <button type="button" class="grow tk-dl" data-dl="${esc(f.id)}" title="${esc(tr('Tải về'))}">${esc(f.filename)}</button>
          <span class="xs mut">${Math.max(1, Math.round(f.size / 1024))} KB</span><button type="button" class="btn sm" data-rmf="${esc(f.id)}">${tr('Gỡ')}</button></div>`).join('')}
        ${links.map((l, i) => `<div class="tk-file">${icon('link2', 15)}<a class="grow" href="${esc(l)}" target="_blank" rel="noopener" style="color:var(--blue);overflow-wrap:anywhere">${esc(l)}</a><button type="button" class="btn sm" data-rml="${i}">${tr('Gỡ')}</button></div>`).join('')}
        ${files.length + links.length ? '' : `<div class="sm mut">${tr('Chưa có tài liệu hay đường link nào.')}</div>`}
      </div>
      <div class="row wrap mt" style="gap:8px">
        <label class="btn sm" for="tk-file-in">${icon('paperclip', 13)} ${tr('Thêm tài liệu')}</label><input id="tk-file-in" type="file" multiple hidden>
        <input id="tk-link-in" class="tk-link-in" placeholder="${esc(tr('Dán link Google Drive, website…'))}" style="flex:1;min-width:180px">
        <button type="button" class="btn sm" data-addlink>${icon('link2', 13)} ${tr('Gắn link')}</button>
      </div>`,
    fields: [
      { name: 'level', label: 'Mức độ', type: 'select', options: lvOpts, value: t.level || PRIO_LEVEL[t.priority] || 'binh_thuong' },
      { name: 'source', label: 'Loại việc', type: 'select', options: srcOpts, value: sourceOf(t) },
    ],
    submitText: 'Lưu phân loại',
    onSubmit: async (v) => {
      try { await patch('/tasks/' + t.id, { level: v.level, source: v.source }); toast('Đã lưu phân loại công việc', 'ok'); after(); }
      catch (e) { toast(e.message, 'err'); return false; }
    },
  });
  const q = (sel) => root.querySelector(sel);
  // Tải tệp / gắn link xong thì mở lại chi tiết với dữ liệu mới từ máy chủ.
  const reopen = async () => {
    close();
    try { const r = await get('/tasks'); after(); detail((r.items || []).find(x => x.id === t.id), after); } catch (e) { toast(e.message, 'err'); }
  };
  q('#tk-file-in').onchange = async (e) => {
    const list = [...e.target.files];
    let ok = 0;
    for (const f of list) {
      if (f.size > 8 * 1024 * 1024) { toast(`"${f.name}" vượt quá 8MB`, 'err'); continue; }
      try { await post(`/tasks/${t.id}/files`, { filename: f.name, mime: mimeOf(f), dataBase64: await fileToBase64(f) }); ok++; }
      catch (err) { toast(`${f.name}: ${err.message}`, 'err'); }
    }
    if (ok) { toast(tr('Đã đính kèm') + ' ' + ok + ' ' + tr('tài liệu'), 'ok'); reopen(); }
  };
  q('[data-addlink]').onclick = async () => {
    const v = (q('#tk-link-in').value || '').trim();
    if (!/^https?:\/\/\S+$/i.test(v)) { toast('Link phải bắt đầu bằng http:// hoặc https://', 'err'); return; }
    try { await patch('/tasks/' + t.id, { links: [...links, v] }); toast('Đã gắn link', 'ok'); reopen(); }
    catch (e) { toast(e.message, 'err'); }
  };
  root.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => {
    const f = files.find(x => x.id === b.dataset.dl);
    try { await downloadFile(`/tasks/${t.id}/files/${f.id}`, f.filename); } catch (e) { toast(e.message, 'err'); }
  });
  root.querySelectorAll('[data-rmf]').forEach(b => b.onclick = async () => {
    try { await del(`/tasks/${t.id}/files/${b.dataset.rmf}`); reopen(); } catch (e) { toast(e.message, 'err'); }
  });
  root.querySelectorAll('[data-rml]').forEach(b => b.onclick = async () => {
    try { await patch('/tasks/' + t.id, { links: links.filter((_, i) => i !== +b.dataset.rml) }); reopen(); } catch (e) { toast(e.message, 'err'); }
  });
}

/** Modal tạo/giao việc — dùng ở trang Việc và ở sheet "Tạo mới" (footer điện thoại). */
function taskModal(deals, after) {
  modal({
    title: isLead() ? 'Giao việc cho sale' : 'Thêm việc',
    fields: [
      { name: 'title', label: 'Tên công việc', required: true },
      { name: 'detail', label: 'Mô tả / yêu cầu', type: 'textarea', rows: 2 },
      ...(isLead() ? [assigneeField('userId', salesTeamUsers())] : []),
      { name: 'dealId', label: 'Gắn với deal', type: 'select', options: [{ v: '', n: '— không —' }, ...deals.map(x => ({ v: x.id, n: x.title }))] },
      { name: 'level', label: 'Mức độ', type: 'select', options: [['gap', 'Gấp'], ['quan_trong', 'Quan trọng'], ['binh_thuong', 'Bình thường'], ['ke_hoach', 'Kế hoạch']].map(([v, n]) => ({ v, n })), value: 'quan_trong' },
      { name: 'source', label: 'Loại việc', type: 'select', options: isLead() ? [{ v: 'duoc_giao', n: 'Được giao (giao cho nhân viên)' }] : [{ v: 'cv_thuong', n: 'CV thường (tự làm)' }, { v: 'de_xuat', n: 'Đề xuất (gửi cấp trên)' }] },
      { name: 'dueDate', label: 'Hạn hoàn thành', type: 'date' },
      ...(isLead() ? [{ name: 'acceptSlaMin', label: 'SLA nhận việc (phút)', type: 'number', value: 120 }] : []),
      { name: 'link', label: 'Gắn link tài liệu (không bắt buộc)', placeholder: 'https://drive.google.com/…' },
    ],
    onSubmit: async (v) => {
      const dueAt = v.dueDate ? Math.floor(new Date(v.dueDate + 'T17:00:00').getTime() / 1000) : undefined;
      const { link, ...rest } = v;
      await post('/tasks', { ...rest, dueAt, links: /^https?:\/\//i.test(link || '') ? [link.trim()] : [] });
      toast(isLead() ? 'Đã giao việc & gửi thông báo' : v.source === 'de_xuat' ? 'Đã gửi đề xuất công việc' : 'Đã thêm việc', 'ok');
      if (after) after();
    },
  });
}

/** Mở modal tạo việc từ bất kỳ màn nào (sheet "Tạo mới") — tự nạp danh sách deal để gắn. */
export async function newTask(after) {
  try {
    const d = await get('/deals');
    taskModal(d.items || [], after);
  } catch (e) { toast(e.message, 'err'); }
}
