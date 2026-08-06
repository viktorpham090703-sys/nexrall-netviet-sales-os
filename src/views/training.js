import { get, post } from '../api.js';
import { isLead, salesUsers } from '../state.js';
import { esc, mount, chip, bar, empty, toast, modal, stat, fmtDate } from '../ui.js';

export async function render(el) {
  const load = () => get('/trainings');

  const draw = (d) => {
    const mine = d.items.filter(t => t.role_target === (isLead() ? 'manager' : 'sales') || t.prog_status);
    const done = mine.filter(t => t.prog_status === 'completed').length;
    return `<div class="page-head">
      <div class="grow"><h2>NetViet Academy</h2><p>Lộ trình học theo vai trò · khoá bắt buộc · theo dõi hoàn thành</p></div>
      ${isLead() ? '<button class="btn primary sm" data-add>+ Bài giảng</button>' : ''}
    </div>

    <div class="card mb">
      <div class="badge-line"><span class="sm">Tiến độ lộ trình của bạn</span><span class="sm b">${done}/${mine.length} bài</span></div>
      ${bar(done, mine.length || 1, 'green')}
      <div class="xs mut mt">Hoàn thành đào tạo đóng góp 4 điểm vào nhóm "Chủ động" của thẻ điểm KPI.</div>
    </div>

    ${['Sản phẩm', 'Kỹ năng', 'Quy trình', 'Chuyên sâu', 'Quản lý'].map(cat => {
      const arr = d.items.filter(t => t.category === cat);
      if (!arr.length) return '';
      return `<div class="sec-title">${esc(cat)}</div><div class="card">${arr.map(t => `<div class="item">
        <div class="dot-i">${t.prog_status === 'completed' ? '✅' : t.required ? '⭐' : '🎬'}</div>
        <div class="grow"><div class="t">${esc(t.title)}</div>
          <div class="d">${t.duration_min} phút · ${t.required ? 'Bắt buộc' : 'Tự chọn'} · dành cho ${esc(t.role_target)}</div>
          <div class="d xs">${esc(t.description || '')}</div>
          <div class="row wrap mt" style="gap:6px">
            ${chip(t.prog_status === 'completed' ? 'Đã hoàn thành' : t.prog_status === 'in_progress' ? 'Đang học ' + (t.progress || 0) + '%' : 'Chưa học',
              t.prog_status === 'completed' ? 'green' : t.prog_status === 'in_progress' ? 'amber' : 'grey')}
            ${t.completed_at ? chip(fmtDate(t.completed_at), 'grey') : ''}</div></div>
        <div class="right">
          <a class="btn sm blue" href="${esc(t.url)}" target="_blank" rel="noopener" data-watch="${esc(t.id)}">Xem</a>
          ${t.prog_status !== 'completed' ? `<div class="mt"><button class="btn sm" data-done="${esc(t.id)}">Hoàn thành</button></div>` : ''}
          ${isLead() ? `<div class="mt"><button class="btn sm" data-assign="${esc(t.id)}">Giao</button></div>` : ''}
        </div></div>`).join('')}</div>`;
    }).join('')}

    ${isLead() && d.team.length ? `<div class="sec-title">Tiến độ đội</div><div class="card">${d.team.map(m => `<div class="item">
      <div class="dot-i">👤</div><div class="grow"><div class="t">${esc(m.name)}</div>
      <div class="mt">${bar(m.done || 0, m.total || 1, 'green')}</div>
      <div class="d xs">${m.done || 0}/${m.total || 0} bài hoàn thành</div></div></div>`).join('')}</div>` : ''}`;
  };

  const bind = (d) => {
    el.querySelectorAll('[data-watch]').forEach(b => b.onclick = async () => {
      try { await post('/trainings/progress', { trainingId: b.dataset.watch, status: 'in_progress', progress: 40 }); } catch (e) { /* noop */ }
    });
    el.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
      try { await post('/trainings/progress', { trainingId: b.dataset.done, status: 'completed' }); toast('Đã đánh dấu hoàn thành 🎓', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-assign]').forEach(b => b.onclick = () => modal({
      title: 'Giao khoá học bắt buộc',
      fields: [{ name: 'userId', label: 'Nhân sự', type: 'select', options: salesUsers().map(u => ({ v: u.id, n: u.name })) }],
      submitText: 'Giao khoá',
      onSubmit: async (v) => { await post('/trainings/assign', { ...v, trainingId: b.dataset.assign }); toast('Đã giao khoá học', 'ok'); },
    }));
    const add = el.querySelector('[data-add]');
    if (add) add.onclick = () => modal({
      title: 'Thêm bài giảng',
      fields: [
        { name: 'title', label: 'Tiêu đề', required: true },
        { name: 'url', label: 'Link video', required: true, placeholder: 'https://youtube.com/…' },
        { name: 'category', label: 'Nhóm', type: 'select', options: ['Sản phẩm', 'Kỹ năng', 'Quy trình', 'Chuyên sâu', 'Quản lý'] },
        { name: 'durationMin', label: 'Thời lượng (phút)', type: 'number', value: 15 },
        { name: 'roleTarget', label: 'Dành cho', type: 'select', options: [{ v: 'sales', n: 'Sales' }, { v: 'manager', n: 'Trưởng phòng' }] },
        { name: 'required', label: 'Bắt buộc', type: 'select', options: [{ v: '1', n: 'Có' }, { v: '', n: 'Không' }] },
        { name: 'description', label: 'Mô tả', type: 'textarea', rows: 2 },
      ],
      onSubmit: async (v) => { await post('/trainings/new', v); toast('Đã thêm bài giảng', 'ok'); render(el); },
    });
  };

  await mount(el, load, draw, bind);
}
