import { get, patch, post, del } from '../api.js';
import { state, logout } from '../state.js';
import { esc, avatar, mount, modal, toast, confirmDialog, refreshShellAvatars } from '../ui.js';
import { roleDefaultLabel } from '../const.js';
import { icon } from '../icons.js';
import { t as tr, personName, jobTitle } from '../i18n.js';

const fmtDateStr = (s) => {
  if (!s) return '—';
  const [y, m, d] = String(s).split('-').map(Number);
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

export async function render(el) {
  // Thành tích & Vi phạm tính riêng: lỗi ở phần đó không được làm trắng cả trang hồ sơ.
  const load = async () => {
    const [d, record] = await Promise.all([get('/account/profile'), get('/account/record').catch(() => null)]);
    return { ...d, record };
  };
  const draw = (d) => {
    const p = d.profile;
    return `
      <div class="page-head">
        <div class="grow"><h2>${icon('user', 19, { style: 'margin-right:6px' })}${tr('Hồ sơ nhân sự')}</h2>
        <p>${tr('Thông tin cá nhân của bạn — dùng cho hồ sơ nội bộ phòng kinh doanh.')}</p></div>
      </div>

      <div class="card">
        <div class="row" style="gap:14px;align-items:flex-start">
          <div class="avatar-edit">
            ${avatar(p, `data-pick title="${esc(tr('Đổi ảnh đại diện'))}" style="width:72px;height:72px;font-size:24px"`)}
            <button type="button" class="avatar-cam" data-pick title="${esc(tr('Đổi ảnh đại diện'))}">${icon('camera', 14)}</button>
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-file>
          </div>
          <div class="grow">
            <div class="row wrap" style="gap:6px">
              <span class="chip blue">${esc(p.id)}</span>
              <span class="chip">${esc(roleDefaultLabel(p))}</span>
            </div>
            <div class="b" style="font-size:19px;margin-top:6px">${esc(personName(p.name))}</div>
            <div class="sm mut mt">${p.title ? esc(jobTitle(p.title, () => roleDefaultLabel(p))) : '—'}</div>
            <div class="row wrap mt" style="gap:6px">
              <button class="btn sm" data-pick>${icon('camera', 13)}${p.avatar ? tr('Đổi ảnh đại diện') : tr('Tải ảnh đại diện')}</button>
              ${p.avatar ? `<button class="btn sm" data-rm-avatar>${icon('trash2', 13)}${tr('Xoá ảnh')}</button>` : ''}
            </div>
            <div class="xs mut mt">${tr('Ảnh JPG, PNG hoặc WEBP — tối đa 8MB, hệ thống tự cắt vuông và thu nhỏ.')}</div>
          </div>
          <div class="right">
            <button class="btn sm" data-edit>${icon('pencil', 13)}${tr('Chỉnh sửa')}</button>
          </div>
        </div>
      </div>

      <div class="sec-title">${tr('Thông tin cá nhân')}</div>
      ${group('user', 'Thông tin định danh & Liên hệ', 'Các thông tin cơ bản phục vụ nhận diện và liên lạc của nhân viên', [
        field(tr('Mã nhân viên'), p.id, { copy: p.id }),
        field(tr('Họ và tên'), personName(p.name)),
        field('Email', p.email, { copy: p.email }),
        field(tr('Số điện thoại'), p.phone, { copy: p.phone }),
        field(tr('Ngày sinh'), p.birth_date ? fmtDateStr(p.birth_date) : ''),
        field(tr('Giới tính'), GENDERS[p.gender] ? tr(GENDERS[p.gender]) : ''),
        field(tr('Địa chỉ liên hệ'), p.address, { copy: p.address, span2: true }),
      ], 'g4')}
      ${group('shieldCheck', 'Căn cước công dân (CCCD)', 'Giấy tờ tùy thân để khai báo thuế và bảo hiểm', [
        field(tr('Số CCCD'), p.id_number, { copy: p.id_number }),
        field(tr('Ngày cấp'), p.id_issue_date ? fmtDateStr(p.id_issue_date) : ''),
        field(tr('Nơi cấp'), p.id_issue_place),
        field(tr('Hạn CCCD'), p.id_expiry ? fmtDateStr(p.id_expiry) : ''),
      ], 'g4')}
      ${group('graduationCap', 'Học vấn & Liên hệ khẩn cấp', 'Trình độ, trường học và người cần liên hệ khi có việc gấp', [
        field(tr('Trình độ học vấn'), p.education_level ? tr(p.education_level) : ''),
        field(tr('Trường học'), p.school),
        field(tr('Liên hệ khẩn cấp'), p.emergency_contact, { span2: true }),
      ], 'g4')}
      ${group('briefcase', 'Chức vụ & kinh nghiệm', 'Bạn tự khai ở nút Chỉnh sửa — chức vụ hiện tại do Quản trị phân công', [
        field(tr('Chức vụ hiện tại'), p.title ? jobTitle(p.title, () => roleDefaultLabel(p)) : roleDefaultLabel(p)),
        field(tr('Kinh nghiệm sale'), p.sales_experience, { multi: true }),
        field(tr('Chức vụ đã đảm nhiệm'), p.past_positions, { multi: true, span2: true }),
      ], 'g2')}
      ${recordSection(d.record)}

      <div class="sec-title">${tr('Bảo mật tài khoản')}</div>
      <div class="card">
        <div class="item">
          <div class="dot-i">${icon('lock')}</div>
          <div class="grow"><div class="t">${tr('Đổi mật khẩu')}</div><div class="d">${tr('Cập nhật mật khẩu đăng nhập của bạn')}</div></div>
          <button class="btn sm" data-change-pw>${tr('Đổi mật khẩu')}</button>
        </div>
        <div class="item">
          <div class="dot-i">${icon('logOut')}</div>
          <div class="grow"><div class="t">${tr('Đăng xuất')}</div><div class="d">${tr('Thoát khỏi phiên đăng nhập hiện tại')}</div></div>
          <button class="btn sm" data-logout>${tr('Đăng xuất')}</button>
        </div>
      </div>`;
  };

  const bind = (d) => {
    const file = el.querySelector('[data-file]');
    el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => file.click());
    file.onchange = async () => {
      const f = file.files && file.files[0];
      file.value = '';               // chọn lại đúng ảnh vừa huỷ vẫn phải kích hoạt được onchange
      if (!f) return;
      try {
        const dataUrl = await squareThumb(f);
        const r = await post('/account/avatar', { avatar: dataUrl });
        applyAvatar(r.avatar);
        toast('Đã cập nhật ảnh đại diện.', 'ok');
        render(el);
      } catch (e) { toast(e.message || 'Không xử lý được ảnh này.', 'err'); }
    };
    const rm = el.querySelector('[data-rm-avatar]');
    if (rm) rm.onclick = () => confirmDialog('Xoá ảnh đại diện', 'Hồ sơ sẽ quay lại hiển thị chữ viết tắt tên bạn.', async () => {
      await del('/account/avatar');
      applyAvatar(null);
      toast('Đã xoá ảnh đại diện.', 'ok');
      render(el);
    });
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editProfile(d.profile, () => render(el)));
    el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.innerHTML = icon('circleCheck', 13);
        b.classList.add('ok');
        setTimeout(() => { b.innerHTML = icon('copy', 13); b.classList.remove('ok'); }, 1400);
        toast('Đã sao chép', 'ok');
      } catch (e) { toast('Không sao chép được', 'err'); }
    });
    el.querySelector('[data-change-pw]').onclick = () => { location.hash = '#/more/bao-mat'; };
    el.querySelector('[data-logout]').onclick = async () => {
      await logout();
      location.hash = '#/login';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
  };
  await mount(el, load, draw, bind);
}

/** Ghi ảnh mới vào phiên hiện tại để sidebar/topbar đổi theo ngay, không phải tải lại trang. */
function applyAvatar(dataUrl) {
  if (state.me) state.me.avatar = dataUrl || null;
  refreshShellAvatars(state.me);
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;  // trần ảnh GỐC người dùng chọn, trước khi thu nhỏ
const THUMB_SIZE = 320;                    // đủ nét cho avatar 72px ở màn hình Retina

/**
 * Cắt vuông (giữa ảnh) + thu nhỏ về THUMB_SIZE rồi nén JPEG ngay tại trình duyệt. Làm ở client để
 * ảnh máy ảnh 5-10MB không phải đi qua đường truyền và không phải nằm trong CSDL nguyên kích thước.
 */
function squareThumb(f) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return reject(new Error('Chỉ nhận ảnh JPG, PNG hoặc WEBP.'));
    if (f.size > MAX_UPLOAD_BYTES) return reject(new Error('Ảnh vượt quá 8MB. Hãy chọn ảnh nhỏ hơn.'));
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.width, img.height);
        const cv = document.createElement('canvas');
        cv.width = cv.height = THUMB_SIZE;
        const cx = cv.getContext('2d');
        cx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      } catch (e) { reject(new Error('Không xử lý được ảnh này.')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Tệp không phải ảnh hợp lệ.')); };
    img.src = url;
  });
}

const GENDERS = { nam: 'Nam', nu: 'Nữ', khac: 'Khác' };
export const EDUCATION_LEVELS = ['THPT', 'Trung cấp', 'Cao đẳng', 'Đại học', 'Thạc sĩ', 'Tiến sĩ', 'Khác'];

/** Ô thông tin 1 dòng: chữ dài quá ô thì cắt bằng "…" (di chuột xem đủ). `copy` = giá trị thật để sao chép. */
const field = (label, value, { copy, span2, multi } = {}) => `<div class="pf-field${span2 ? ' span2' : ''}${multi ? ' multi' : ''}">
  <div class="l">${esc(label)}</div>
  <div class="pf-val">
    <div class="v${value ? '' : ' none'}"${value && !multi ? ` title="${esc(value)}"` : ''}>${value ? esc(value) : tr('Chưa cập nhật')}</div>
    ${value && copy ? `<button type="button" class="pf-copy" data-copy="${esc(copy)}" title="${esc(tr('Sao chép'))}" aria-label="${esc(tr('Sao chép'))} ${esc(label)}">${icon('copy', 13)}</button>` : ''}
  </div></div>`;

/** Thành tích & Vi phạm — tính tự động từ dữ liệu Sales OS (server/lib/record.js); dùng chung cho
 * trang Hồ sơ của nhân sự và hồ sơ trong Quản trị. */
export function recordSection(rec, { compact = false } = {}) {
  if (!rec) return '';
  const item = (x) => `<div class="rc-item ${x.level}">
    <span class="rc-ic">${icon(x.icon || 'circle', 15)}</span>
    <div class="grow"><div class="t">${esc(tr(x.title))}</div>${x.detail ? `<div class="d">${esc(x.detail)}</div>` : ''}</div>
    <span class="rc-when">${esc(tr(x.period || ''))}</span></div>`;
  const col = (cls, ic, title, list, emptyText) => `<div class="rc-col ${cls}">
    <div class="rc-head">${icon(ic, 16)}${tr(title)} <span class="rc-n">${list.length}</span></div>
    ${list.length ? list.map(item).join('') : `<div class="rc-empty">${tr(emptyText)}</div>`}</div>`;
  const time = new Date(rec.asOf * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const body = `<div class="rc-grid">
      ${col('good', 'trophy', 'Thành tích', rec.achievements, 'Chưa có thành tích nào được ghi nhận.')}
      ${col('bad', 'triangleAlert', 'Vi phạm', rec.violations, 'Không có vi phạm — tiếp tục giữ vững!')}
    </div>
    <div class="rc-foot">${icon('repeat', 12)} ${tr('Tự động cập nhật từ dữ liệu Sales OS')} · ${tr('lúc')} ${time}</div>`;
  if (compact) return body;
  return `<div class="card pf-group">
    <div class="pf-head">
      <div class="pf-ic">${icon('medal', 18)}</div>
      <div class="grow"><div class="t">${tr('Thành tích & Vi phạm')}</div><div class="d">${tr('Tự động tổng hợp từ deal, KPI, báo cáo, công việc, SLA và PIP trên Sales OS — không nhập tay')}</div></div>
    </div>
    <div class="rc-wrap">${body}</div></div>`;
}

const group = (ic, title, sub, fields, gridCls = '') => `<div class="card pf-group">
  <div class="pf-head">
    <div class="pf-ic">${icon(ic, 18)}</div>
    <div class="grow"><div class="t">${tr(title)}</div><div class="d">${tr(sub)}</div></div>
  </div>
  <div class="pf-grid ${gridCls}">${fields.join('')}</div></div>`;

function editProfile(p, after) {
  modal({
    title: 'Chỉnh sửa hồ sơ nhân sự',
    titleIcon: 'user',
    fields: [
      { name: 'name', label: 'Họ và tên', required: true, value: p.name },
      { name: 'email', label: 'Email', type: 'email', required: true, value: p.email || '' },
      { name: 'phone', label: 'Số điện thoại', value: p.phone || '' },
      { name: 'gender', label: 'Giới tính', type: 'select', value: p.gender || '',
        options: [{ v: '', n: '— Chọn —' }, ...Object.entries(GENDERS).map(([v, n]) => ({ v, n }))] },
      { name: 'birth_date', label: 'Ngày sinh', type: 'date', value: p.birth_date || '' },
      { name: 'id_number', label: 'Số CCCD', value: p.id_number || '' },
      { name: 'id_issue_date', label: 'Ngày cấp CCCD', type: 'date', value: p.id_issue_date || '' },
      { name: 'id_issue_place', label: 'Nơi cấp CCCD', placeholder: 'VD: Cục Cảnh sát QLHC về TTXH', value: p.id_issue_place || '' },
      { name: 'id_expiry', label: 'Hạn CCCD', type: 'date', value: p.id_expiry || '' },
      { name: 'address', label: 'Địa chỉ liên hệ', value: p.address || '' },
      { name: 'education_level', label: 'Trình độ học vấn', type: 'select', value: p.education_level || '',
        options: [{ v: '', n: '— Chọn —' }, ...EDUCATION_LEVELS.map(x => ({ v: x, n: x }))] },
      { name: 'school', label: 'Trường học', value: p.school || '' },
      { name: 'sales_experience', label: 'Kinh nghiệm sale', type: 'textarea', rows: 3, placeholder: 'VD: 3 năm sale B2B mảng TVC/quảng cáo tại…', value: p.sales_experience || '' },
      { name: 'past_positions', label: 'Chức vụ đã đảm nhiệm', type: 'textarea', rows: 3, placeholder: 'VD: 2021–2023 Chuyên viên KD · 2023–nay Trưởng nhóm', value: p.past_positions || '' },
      { name: 'emergency_contact', label: 'Liên hệ khẩn cấp', placeholder: 'VD: Nguyễn Văn A - 0901xxxxxx', value: p.emergency_contact || '' },
    ],
    submitText: 'Lưu thay đổi',
    onSubmit: async (v) => {
      await patch('/account/profile', v);
      if (v.name) state.me.name = v.name;
      if (v.email) state.me.email = v.email;
      toast('Đã cập nhật hồ sơ.', 'ok');
      if (after) after();
    },
  });
}
