/* Hệ thống › Cấu trúc hệ thống (Admin / BGĐ): logo công ty · mẫu biểu dùng chung · phân tầng chức danh.
 * Logo và chức danh lưu ở /api/settings; tệp mẫu biểu lưu ở kho tệp (/api/templates). */
import { get, post, patch, del, put, downloadFile, fileToBase64, mimeOf } from '../api.js';
import { state } from '../state.js';
import { esc, mount, chip, toast, modal, fmtDate, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { BRAND_LOGO } from '../const.js';
import { t as tr, personName } from '../i18n.js';

/* 7 cấp + nhánh HCNS. `role` = vai trò tài khoản đang có; null = cấp mới chưa có vai trò. */
const LEVELS = [
  [1, 'Admin', 'admin'], [2, 'BOD', 'admin'], [3, 'Giám đốc bộ phận', null], [4, 'Trưởng phòng', 'manager'],
  [5, 'Trưởng nhóm', null], [6, 'Nhân viên', 'sales'], [7, 'Thực tập / Thử việc', null],
];
const EXT_TONE = { xlsx: '#16A34A', xls: '#16A34A', pdf: '#DC2626', docx: '#2563EB', doc: '#2563EB', pptx: '#EA580C', ppt: '#EA580C' };

/** Thu nhỏ logo về cao tối đa 160px, giữ nền trong suốt (PNG). SVG giữ nguyên. */
function shrinkLogo(file) {
  if (file.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 160 / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = URL.createObjectURL(file);
  });
}

/** Áp logo mới cho khung app đang mở (sidebar) mà không cần tải lại trang. */
function applyLogo(src) {
  document.querySelectorAll('img.brand-logo, img.login-brand').forEach(img => { img.src = src || BRAND_LOGO; });
}

export async function render(el) {
  if (state.me.role !== 'admin') {
    el.innerHTML = `<div class="card" style="text-align:center;padding:28px">${icon('lock', 36)}<div class="b mt">${tr('Chỉ Admin / Ban Giám đốc')}</div></div>`;
    return;
  }
  const load = async () => {
    const [s, tp] = await Promise.all([get('/settings'), get('/templates')]);
    return { brand: s.brand || {}, titles: s.titles || {}, templates: tp.items || [], kinds: tp.kinds || [] };
  };
  const byRole = (r) => state.users.filter(u => u.role === r);

  const draw = (d) => `<div class="page-head"><div class="grow"><h2>${tr('Cấu trúc hệ thống')}</h2>
      <p>${tr('Logo công ty · mẫu biểu dùng chung (báo giá, hồ sơ năng lực, hợp đồng…) · phân tầng chức danh trong công ty')}</p></div></div>

    <div class="grid g2 dm-grid mb">
      <div class="card">
        <div class="row"><b>${icon('building2', 16)} ${tr('Logo công ty')}</b></div>
        <div class="cs-logo mt"><span class="cs-logo-bg"><img src="${esc(d.brand.logo || BRAND_LOGO)}" alt="${esc(tr('Logo hiện tại'))}"></span></div>
        <div class="xs mut mt">${tr('Hiện trên menu và màn đăng nhập. Nên dùng PNG nền trong, cao tối thiểu 96px — ảnh được thu nhỏ tự động.')}</div>
        <div class="row mt" style="gap:8px"><label class="btn sm primary" for="cs-logo-in">${icon('upload', 13)} ${tr('Tải logo mới')}</label><input id="cs-logo-in" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden>
          ${d.brand.logo ? `<button type="button" class="btn sm" data-logo-reset>${tr('Dùng lại logo gốc')}</button>` : ''}</div>
      </div>
      <div class="card">
        <div class="row"><b>${icon('fileText', 16)} ${tr('Mẫu biểu')}</b><span class="grow"></span><button type="button" class="btn sm" data-tpl-add>${icon('upload', 13)} ${tr('Tải mẫu lên')}</button></div>
        <div class="xs mut mb">${tr('Mỗi loại có một mẫu "Đang dùng" — mọi người tải đúng bản mới nhất ở đây thay vì gửi qua Zalo.')}</div>
        <div class="cs-tpls">${d.templates.map(t => { const ext = (t.filename.split('.').pop() || '').toLowerCase(); return `<div class="tk-file">
          <span class="tk-ext" style="background:${EXT_TONE[ext] || 'var(--mut)'}">${esc(ext.toUpperCase().slice(0, 4))}</span>
          <span class="grow"><span class="b sm">${esc(t.kind)}</span><br><button type="button" class="tk-dl xs" data-tpl-dl="${esc(t.id)}">${esc(t.filename)}</button><span class="xs mut"> · v${t.version} · ${fmtDate(t.created_at)}</span></span>
          ${t.is_default ? chip('Đang dùng', 'green') : `<button type="button" class="btn sm" data-tpl-def="${esc(t.id)}">${tr('Đặt mặc định')}</button>`}
          <button type="button" class="btn sm" data-tpl-del="${esc(t.id)}" aria-label="${esc(tr('Xoá mẫu'))}">${icon('trash2', 13)}</button></div>`; }).join('')
          || `<div class="sm mut">${tr('Chưa có mẫu biểu nào.')}</div>`}</div>
      </div>
    </div>

    <div class="card">
      <div class="row wrap"><b>${icon('usersRound', 16)} ${tr('Phân tầng chức danh')}</b><span class="grow"></span><span class="xs mut">Admin › BOD › ${tr('Giám đốc bộ phận')} › ${tr('Trưởng phòng')} › ${tr('Trưởng nhóm')} › ${tr('Nhân viên')} › ${tr('Thực tập')}</span></div>
      <div class="cs-tree mt">${LEVELS.map(([lv, n, role]) => node(d, lv, `${tr('Cấp')} ${lv}`, n, role ? `${byRole(role).length} ${tr('tài khoản')}` : tr('cấp mới'), lv - 1, '')).join('')}
        ${node(d, 'hr', tr('Nhánh'), 'HCNS', `${byRole('hr').length} ${tr('tài khoản')}`, 0, 'branch')}
      </div>
      <div class="xs mut mt">${tr('Tài khoản hiện có:')} ${state.users.map(u => esc(personName(u.name))).join(', ')}.</div>
    </div>`;

  const node = (d, key, lvLabel, name, count, depth, cls) => `<div class="cs-node ${cls}" style="--d:${depth}">
      <span class="cs-lv ${key === 'hr' ? 'hr' : ''}">${esc(lvLabel)}</span><span class="cs-n">${esc(name)}</span>
      <span class="cs-titles">${(d.titles[key] || []).map((x, i) => `<span class="chip grey">${esc(x)} <button type="button" class="cs-x" data-title-rm="${key}|${i}" aria-label="${esc(tr('Gỡ chức danh'))} ${esc(x)}">×</button></span>`).join('')}</span>
      <span class="grow"></span><span class="xs mut">${esc(count)}</span>
      <button type="button" class="btn sm" data-title-add="${key}">+ ${tr('Chức danh')}</button></div>`;

  const saveTitles = async (titles, msg) => {
    try { await put('/settings/titles', titles); toast(msg, 'ok'); render(el); } catch (e) { toast(e.message, 'err'); }
  };

  const bind = (d) => {
    el.querySelector('#cs-logo-in').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5e6) { toast(tr('Ảnh quá lớn (tối đa 5 MB)'), 'err'); return; }
      try {
        const logo = await shrinkLogo(f);
        await put('/settings/brand', { logo });
        state.settings.brand = { logo };
        applyLogo(logo);
        toast(tr('Đã đổi logo công ty cho toàn hệ thống'), 'ok'); render(el);
      } catch (err) { toast(err.message, 'err'); }
    };
    const lr = el.querySelector('[data-logo-reset]');
    if (lr) lr.onclick = async () => {
      try { await put('/settings/brand', { logo: null }); state.settings.brand = {}; applyLogo(null); toast(tr('Đã dùng lại logo gốc'), 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    };
    el.querySelectorAll('[data-tpl-dl]').forEach(b => b.onclick = async () => {
      const t = d.templates.find(x => x.id === b.dataset.tplDl);
      try { await downloadFile(`/templates/${t.id}/file`, t.filename); } catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-tpl-def]').forEach(b => b.onclick = async () => {
      const t = d.templates.find(x => x.id === b.dataset.tplDef);
      try { await patch('/templates/' + t.id, { isDefault: true }); toast(`${tr('Đã đặt')} "${t.filename}" ${tr('làm mẫu mặc định')}`, 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-tpl-del]').forEach(b => b.onclick = () => {
      const t = d.templates.find(x => x.id === b.dataset.tplDel);
      confirmDialog('Xoá mẫu biểu', `${tr('Xoá')} "${t.filename}"? ${tr('Tệp bị xoá khỏi kho, không khôi phục được.')}`, async () => {
        try { await del('/templates/' + t.id); toast(tr('Đã xoá mẫu'), 'ok'); render(el); } catch (e) { toast(e.message, 'err'); return false; }
      });
    });
    el.querySelector('[data-tpl-add]').onclick = () => {
      const { root } = modal({
        title: 'Tải mẫu biểu lên',
        fields: [{ name: 'kind', label: 'Loại mẫu', type: 'select', options: d.kinds }],
        html: `<label class="f"><span>${tr('Tệp mẫu')} *</span><input type="file" name="__file" accept=".doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx"></label>
          <div class="xs mut">${tr('Word, Excel, PowerPoint hoặc PDF, tối đa 8MB. Mẫu đầu tiên của mỗi loại tự thành mẫu đang dùng.')}</div>`,
        submitText: 'Tải lên',
        onSubmit: async (v) => {
          const f = root.querySelector('input[type=file]').files[0];
          if (!f) { toast(tr('Chọn tệp mẫu'), 'err'); return false; }
          if (f.size > 8 * 1024 * 1024) { toast(tr('Tệp vượt quá 8MB'), 'err'); return false; }
          try { await post('/templates', { kind: v.kind, filename: f.name, mime: mimeOf(f), dataBase64: await fileToBase64(f) }); toast(tr('Đã tải mẫu') + ' ' + v.kind.toLowerCase(), 'ok'); render(el); }
          catch (e) { toast(e.message, 'err'); return false; }
        },
      });
    };
    el.querySelectorAll('[data-title-add]').forEach(b => b.onclick = () => modal({
      title: 'Thêm chức danh',
      fields: [{ name: 'title', label: 'Tên chức danh', required: true, placeholder: 'VD: Trưởng nhóm Kinh doanh B' }],
      onSubmit: async (v) => {
        const k = b.dataset.titleAdd, titles = { ...d.titles };
        titles[k] = [...(titles[k] || []), v.title.trim()];
        await saveTitles(titles, tr('Đã thêm chức danh'));
      },
    }));
    el.querySelectorAll('[data-title-rm]').forEach(b => b.onclick = () => {
      const [k, i] = b.dataset.titleRm.split('|');
      const titles = { ...d.titles, [k]: (d.titles[k] || []).filter((_, j) => j !== +i) };
      saveTitles(titles, tr('Đã gỡ chức danh'));
    });
  };

  await mount(el, load, draw, bind);
}
